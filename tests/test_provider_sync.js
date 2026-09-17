const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-console-provider-test-"));
const methods = new Map();
const fakeServer = { route() {}, registerRPC(name, handler) { methods.set(name, handler); } };
const sandbox = { console, Buffer, URL, AbortController, setTimeout, clearTimeout, __storageDir__: storage, __dirname: root, require(name) { return name === "server" ? fakeServer : require(name); } };
vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), sandbox); sandbox.load();

const trojanLink = { type: "local", remark: "B", uri: "trojan://secret@b.example.com:443?sni=b.example.com#Same" };
let links = [
  { type: "local", remark: "A", uri: "vless://00000000-0000-4000-8000-000000000001@a.example.com:443?security=tls&type=tcp#Same" },
  trojanLink,
];
let clientlessHttp = false;
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.headers.token !== "test-token") return response.end(JSON.stringify({ success: false, msg: "invalid token" }));
  if (request.url.includes("/status")) return response.end(JSON.stringify({ success: true, obj: { sbd: { running: true, version: "1.12.9", stats: { Uptime: 10 } } } }));
  if (request.url.includes("/inbounds")) return response.end(JSON.stringify({ success: true, obj: { inbounds: clientlessHttp ? [{ id: 9, tag: "HTTP 代理", type: "http", listen: "::", listen_port: 57543, users: [] }] : [{ id: 1, tag: "A", type: "vless" }, { id: 2, tag: "B", type: "trojan" }] } }));
  if (clientlessHttp) return response.end(JSON.stringify({ success: true, obj: { clients: [] } }));
  const detailed = request.url.includes("?id=");
  return response.end(JSON.stringify({ success: true, obj: { clients: [{ id: 5, enable: true, name: "user", remark: "Same", ...(detailed ? { links } : {}) }] } }));
});

(async () => {
  const providerOperation = async (action, input) => {
    const started = methods.get("proxyConsole:startProviderOperation")({ action, input });
    for (let attempt = 0; attempt < 100; attempt++) {
      const operation = methods.get("proxyConsole:getProviderOperation")({ operationId: started.operationId });
      if (operation.phase === "completed") return operation.result;
      if (operation.phase === "failed") throw new Error(operation.error);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("provider operation timeout");
  };
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/panel`;
  const saved = methods.get("proxyConsole:saveProvider")({ provider: { name: "My S-UI", type: "s-ui", baseUrl }, token: "test-token" });
  const providerId = saved.providerId;
  assert.equal(saved.state.providers[0].hasToken, true);
  assert(!JSON.stringify(saved.state).includes("test-token"));
  assert.equal(fs.statSync(path.join(storage, "provider-secrets.json")).mode & 0o777, 0o600);
  const tested = await providerOperation("test", { providerId });
  assert.equal(tested.links, 2);
  let preview = await providerOperation("preview", { providerId });
  assert.deepEqual(preview.summary, { create: 2, update: 0, unchanged: 0, pending: 0, missing: 0, unsupported: 0 });
  let result = await providerOperation("apply", { providerId, remoteIds: preview.candidates.map((item) => item.remoteId) });
  assert.equal(result.created, 2); const providerNodes = result.state.nodes.filter((item) => item.sourceId === providerId); assert.equal(new Set(providerNodes.map((item) => item.name)).size, 2, "same remote names get a deterministic local suffix");
  assert(providerNodes.every((item) => item.remoteClientName === "Same"), "provider client identity must remain visible after sync");
  assert(providerNodes.some((item) => item.remoteInboundName === "A"), "provider inbound identity must remain visible after sync");
  result = await providerOperation("apply", { providerId });
  assert.equal(result.created, 0); assert.equal(result.unchanged, 2);
  let state = result.state; const renamed = state.nodes.find((item) => item.protocol === "vless"); renamed.name = "我的本地名称";
  state = methods.get("proxyConsole:saveState")({ state });
  links[0] = { ...links[0], uri: links[0].uri.replace("a.example.com", "new.example.com").replace("#Same", "#Remote-New") };
  result = await providerOperation("apply", { providerId });
  assert.equal(result.state.nodes.find((item) => item.id === renamed.id).name, "我的本地名称", "local rename survives remote updates");
  links = [links[0]];
  result = await providerOperation("apply", { providerId });
  const missing = result.state.nodes.find((item) => item.protocol === "trojan");
  assert.equal(missing.providerMissing, true); assert.equal(missing.enabled, false); assert.equal(result.disabled, 1);
  state = result.state;
  state.subscriptions.push({ id: "sub", name: "provider cleanup", token: "a".repeat(32), nodeIds: [missing.id], groups: [{ id: "group", name: "PROXY", type: "select", entries: [{ kind: "node", id: missing.id }], url: "https://www.gstatic.com/generate_204", interval: 3600 }], enabled: true, expiresAt: "", quota: { mode: "none" }, policyMode: "proxy-all", customRules: [], ruleSetIds: [], devices: [] });
  methods.get("proxyConsole:saveState")({ state });
  preview = await providerOperation("preview", { providerId });
  result = await providerOperation("apply", { providerId, missingActions: { [missing.id]: "delete" } });
  assert.equal(result.deleted, 1); assert(!result.state.nodes.some((item) => item.id === missing.id));
  const cleanedSubscription = result.state.subscriptions.find((item) => item.id === "sub");
  assert(cleanedSubscription); assert.equal(cleanedSubscription.nodeIds.length, 0); assert.equal(cleanedSubscription.groups[0].entries.length, 0);
  links = [links[0], trojanLink];
  result = await providerOperation("apply", { providerId });
  const restored = result.state.nodes.find((item) => item.protocol === "trojan" && item.sourceId === providerId);
  assert(restored && restored.enabled);
  links = [links[0]];
  result = await providerOperation("apply", { providerId, missingActions: { [restored.id]: "detach" } });
  const detached = result.state.nodes.find((item) => item.id === restored.id);
  assert.equal(result.detached, 1); assert.equal(detached.source, "manual"); assert.equal(detached.sourceId, ""); assert.equal(detached.providerMissing, false);
  const deleted = methods.get("proxyConsole:deleteProvider")({ providerId });
  assert.equal(deleted.providers.length, 0); assert(deleted.nodes.filter((item) => item.source === "provider").every((item) => !item.enabled && item.providerMissing));
  clientlessHttp = true;
  const twoSaved = methods.get("proxyConsole:saveProvider")({ provider: { name: "My 2S-UI", type: "2s-ui", baseUrl }, token: "test-token" });
  const twoTested = await providerOperation("test", { providerId: twoSaved.providerId });
  assert.equal(twoTested.status.running, true);
  assert.equal(twoTested.links, 0); assert.equal(twoTested.clients, 0); assert.equal(twoTested.pending, 1);
  const twoPreview = await providerOperation("preview", { providerId: twoSaved.providerId });
  assert.equal(twoPreview.summary.create, 0); assert.equal(twoPreview.summary.pending, 1); assert.equal(twoPreview.candidates.length, 0);
  assert.equal(twoPreview.inbounds[0].readiness, "needs-client");
  const twoState = methods.get("proxyConsole:getState")();
  assert.equal(twoState.providers.find((item) => item.id === twoSaved.providerId).type, "2s-ui");
  assert.match(twoState.providers.find((item) => item.id === twoSaved.providerId).status, /^running:/);
  console.log("provider sync tests passed");
})().finally(() => { server.close(); }).catch((error) => { console.error(error); process.exitCode = 1; });
