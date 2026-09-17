const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "wherever-backup-test-"));
try {
  const methods = new Map();
  const routes = new Map();
  const server = { registerRPC(name, handler) { methods.set(name, handler); }, route(method, url, handler) { routes.set(`${method} ${url}`, handler); } };
  const runtimeBuffer = Object.create(Buffer);
  runtimeBuffer.byteLength = undefined; // Komari's plugin Buffer does not expose this Node helper.
  const sandbox = { console, Buffer: runtimeBuffer, __storageDir__: storage, __dirname: root, require(name) { return name === "server" ? server : require(name); } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), sandbox, { filename: "script.js" });
  sandbox.load();
  const call = (name, params) => methods.get(`proxyConsole:${name}`)(params);
  const original = call("getState");
  original.machines.push({ id: "host-1", name: "Tokyo", monitorClientId: "agent-old" });
  original.nodes.push({ id: "node-1", name: "Tokyo 01", protocol: "vless", uri: "vless://example@example.com:443", machineId: "host-1" });
  original.subscriptions.push({ id: "sub-1", name: "Personal", token: "a".repeat(48), nodeIds: ["node-1"] });
  original.providers.push({ id: "panel-1", name: "Panel", type: "2s-ui", baseUrl: "https://panel.example.com/app", hasToken: true });
  original.ruleSets.push({ id: "rules-1", name: "Rules", url: "https://rules.example.com/list", action: "proxy", enabled: true });
  const saved = call("saveState", { state: original });
  fs.writeFileSync(path.join(storage, "provider-secrets.json"), JSON.stringify({ "panel-1": { token: "private-api-token" } }));
  fs.writeFileSync(path.join(storage, "rule-set-cache.json"), JSON.stringify({ "rules-1": { version: "abc", fetchedAt: "2026-09-17T00:00:00Z", rules: [] } }));
  const backup = call("exportPortableBackup");
  assert.equal(backup.format, "wherever-station-backup");
  assert.equal(backup.providerSecrets["panel-1"].token, "private-api-token");
  assert.equal(backup.ruleSetCache["rules-1"].version, "abc");
  assert.equal(backup.state.subscriptions[0].token, "a".repeat(48));
  const ticket = call("preparePortableBackupDownload");
  assert.match(ticket.url, /^\/proxy\/backup\/[a-f0-9]{64}$/);
  const headers = {};
  let responseBody = "";
  const response = { statusCode: 200, setHeader(name, value) { headers[name] = value; }, end(body) { responseBody = body; } };
  const download = routes.get("GET /proxy/backup/:token");
  download({ url: ticket.url }, response);
  assert.equal(response.statusCode, 200);
  assert.match(headers["Content-Disposition"], /^attachment; filename="wherever-station-backup-/);
  assert.equal(JSON.parse(responseBody).providerSecrets["panel-1"].token, "private-api-token");
  const replay = { statusCode: 200, setHeader() {}, end() {} };
  download({ url: ticket.url }, replay);
  assert.equal(replay.statusCode, 404);
  const preview = call("previewPortableBackup", { backup });
  assert.equal(preview.incoming.nodes, 1);
  assert.equal(preview.boundAgents, 1);

  const empty = call("getState");
  empty.machines = []; empty.nodes = []; empty.subscriptions = []; empty.providers = []; empty.ruleSets = [];
  const cleared = call("saveState", { state: empty });
  assert.throws(() => call("restorePortableBackup", { backup, expectedRevision: saved.revision }), /重新预览/);
  const restored = call("restorePortableBackup", { backup, expectedRevision: cleared.revision });
  assert.equal(restored.revision, cleared.revision + 1);
  assert.equal(restored.nodes[0].name, "Tokyo 01");
  assert.equal(restored.subscriptions[0].token, "a".repeat(48));
  assert.equal(JSON.parse(fs.readFileSync(path.join(storage, "provider-secrets.json")))["panel-1"].token, "private-api-token");
  assert.equal(JSON.parse(fs.readFileSync(path.join(storage, "rule-set-cache.json")))["rules-1"].version, "abc");
  assert.throws(() => call("previewPortableBackup", { backup: { ...backup, schema: 99 } }), /不受支持|不是受支持/);
  assert.throws(() => call("restorePortableBackup", { backup: { ...backup, state: { ...backup.state, nodes: [{ id: "bad" }] } }, expectedRevision: restored.revision }), /无效记录/);
  assert.equal(call("getState").nodes.length, 1, "invalid import does not replace current state");
  console.log("portable backup export, preview, restore and rejection passed");
} finally {
  fs.rmSync(storage, { recursive: true, force: true });
}
