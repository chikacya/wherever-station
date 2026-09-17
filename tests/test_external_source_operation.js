const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "wherever-source-operation-"));
const methods = new Map();
const fakeServer = {
  route() {},
  registerRPC(method, handler) { methods.set(method, handler); },
};
const uri = "vless://00000000-0000-4000-8000-000000000001@example.com:443?security=tls&type=tcp#External";
const fakeFetch = async () => ({
  ok: true,
  headers: { get(name) { return String(name).toLowerCase() === "subscription-userinfo" ? "upload=1024; download=2048; total=8192; expire=2000000000" : null; } },
  async text() { return uri; },
});
const sandbox = {
  console,
  Buffer,
  AbortController,
  setTimeout,
  clearTimeout,
  fetch: fakeFetch,
  __storageDir__: storage,
  __dirname: root,
  require(name) { return name === "server" ? fakeServer : require(name); },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), sandbox, { filename: "script.js" });
sandbox.load();

(async () => {
  let state = methods.get("proxyConsole:getState")();
  const baselineNodeCount = state.nodes.length;
  state.externalSources.push({
    id: "external-fixture",
    name: "Fixture",
    url: "https://example.com/subscription",
    machineId: "",
    tags: ["external"],
    enabled: true,
    refreshIntervalHours: 24,
    nodeIds: [],
  });
  methods.get("proxyConsole:saveState")({ state });

  const started = methods.get("proxyConsole:startExternalSourceOperation")({
    sourceId: "external-fixture",
    requestId: "source-operation-0001",
  });
  assert.equal(started.phase, "running");

  let operation;
  for (let i = 0; i < 50; i += 1) {
    operation = methods.get("proxyConsole:getExternalSourceOperation")({ operationId: started.operationId });
    if (operation.phase !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(operation.phase, "completed");
  assert.equal(operation.result.created, 1);
  assert.equal(operation.result.state.nodes.length, baselineNodeCount + 1);
  assert.equal(operation.result.state.externalSources.find((item) => item.id === "external-fixture").nodeIds.length, 1);
  assert.deepEqual(operation.result.state.externalSources.find((item) => item.id === "external-fixture").traffic, { upload: 1024, download: 2048, total: 8192, expire: 2000000000, observedAt: operation.result.state.externalSources.find((item) => item.id === "external-fixture").lastSyncAt });

  const repeated = methods.get("proxyConsole:startExternalSourceOperation")({
    sourceId: "external-fixture",
    requestId: "source-operation-0001",
  });
  assert.equal(repeated.operationId, started.operationId);
  assert.equal(repeated.phase, "completed");
  assert.throws(() => methods.get("proxyConsole:startExternalSourceOperation")({
    sourceId: "another-source",
    requestId: "source-operation-0001",
  }), /requestId/);

  console.log("external source operation tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
