const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

(async () => {
  const root = path.resolve(__dirname, "..");
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "wherever-traffic-plan-"));
  const methods = new Map();
  const calls = [];
  let failSync = false;
  const fakeServer = {
    route() {},
    cron() {},
    registerRPC(name, handler) { methods.set(name, handler); },
    async call(method, params) {
      calls.push({ method, params });
      if (failSync) throw new Error("komari unavailable");
      return { ok: true };
    },
  };
  const sandbox = { console, Buffer, setTimeout, clearTimeout, __storageDir__: storage, __dirname: root, require(name) { return name === "server" ? fakeServer : require(name); } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), sandbox, { filename: "script.js" });
  sandbox.load();
  const plain = (value) => JSON.parse(JSON.stringify(value));

  const migrated = sandbox.cleanState({
    version: 13,
    settings: { monitoring: { monthlyTrafficGB: 500 } },
    machines: [{ id: "legacy", name: "Legacy VPS" }],
  });
  assert.equal(migrated.version, 14);
  assert.deepEqual(plain(migrated.settings.monitoring), { cpuPercent: 85, memoryPercent: 90, diskPercent: 90 });
  assert.deepEqual(plain(migrated.machines[0].trafficPlan), { enabled: true, limitBytes: 500 * 1024 ** 3, accounting: "sum", resetDay: 1, warningLevels: [70, 90, 100] });

  let state = methods.get("proxyConsole:getState")();
  state.machines.push({ id: "machine-1", name: "GCP 美西", monitorClientId: "client-1" });
  state = methods.get("proxyConsole:saveState")({ state });
  assert.equal(methods.has("proxyConsole:saveMachineTrafficPlan"), false, "async functions must not be exposed as Komari RPC results");
  async function savePlan(input, requestId) {
    const start = methods.get("proxyConsole:startMachineTrafficPlanOperation")({ ...input, requestId });
    assert.equal(start.phase, "running");
    assert.equal(typeof start.then, "undefined", "Komari must receive a synchronous RPC result");
    for (let index = 0; index < 10; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const operation = methods.get("proxyConsole:getMachineTrafficPlanOperation")({ operationId: start.operationId });
      if (operation.phase !== "running") return operation;
    }
    throw new Error("traffic plan operation did not finish");
  }
  const completed = await savePlan({
    machineId: "machine-1",
    revision: state.revision,
    plan: { enabled: true, limitBytes: 107374182400, accounting: "max", resetDay: 15, warningLevels: [65, 85, 100] },
  }, "save-plan-first-request");
  assert.equal(completed.phase, "completed");
  const result = completed.result;
  assert.deepEqual(plain(calls.at(-1)), { method: "admin:editClient", params: { uuid: "client-1", traffic_limit: 107374182400, traffic_limit_type: "max" } });
  assert.deepEqual(plain(result.state.machines.find((item) => item.id === "machine-1").trafficPlan), { enabled: true, limitBytes: 107374182400, accounting: "max", resetDay: 15, warningLevels: [65, 85, 100] });
  assert.equal(result.sync.komari, true);
  const replay = methods.get("proxyConsole:startMachineTrafficPlanOperation")({ machineId: "machine-1", revision: state.revision, plan: { enabled: true, limitBytes: 107374182400, accounting: "max", resetDay: 15, warningLevels: [65, 85, 100] }, requestId: "save-plan-first-request" });
  assert.equal(replay.phase, "completed");
  assert.equal(calls.length, 1, "replaying a requestId must not sync Komari twice");

  const beforeFailedSync = JSON.stringify(methods.get("proxyConsole:getState")());
  failSync = true;
  const failed = await savePlan({ machineId: "machine-1", revision: result.state.revision, plan: { enabled: true, limitBytes: 50, accounting: "down", resetDay: 1, warningLevels: [70, 90, 100] } }, "save-plan-failed-request");
  assert.equal(failed.phase, "failed");
  assert.match(failed.error, /komari unavailable/);
  assert.equal(JSON.stringify(methods.get("proxyConsole:getState")()), beforeFailedSync, "failed Komari sync must not persist a misleading local plan");
  failSync = false;

  const disabled = (await savePlan({ machineId: "machine-1", revision: result.state.revision, plan: { ...result.state.machines.find((item) => item.id === "machine-1").trafficPlan, enabled: false } }, "save-plan-disable-request")).result;
  assert.deepEqual(plain(calls.at(-1)), { method: "admin:editClient", params: { uuid: "client-1", traffic_limit: 0, traffic_limit_type: "max" } });
  assert.equal(disabled.state.machines.find((item) => item.id === "machine-1").trafficPlan.enabled, false);
  console.log("per-server traffic plan sync tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
