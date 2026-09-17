const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

(async () => {
  const root = path.resolve(__dirname, ".."); const storage = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-console-rules-")); const methods = new Map(); let fail = false;
  const fakeServer = { route() {}, cron() {}, registerRPC(name, handler) { methods.set(name, handler); } };
  const sandbox = { console, Buffer, __storageDir__: storage, __dirname: root, AbortController, setTimeout, clearTimeout, fetch: async () => { if (fail) throw new Error("network offline"); return { ok: true, headers: { get: () => "" }, text: async () => "example.com\nIP-CIDR,10.0.0.0/8" }; }, require(name) { return name === "server" ? fakeServer : require(name); } };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), sandbox); sandbox.load();
  let state = methods.get("proxyConsole:getState")(); state.ruleSets.push({ id: "rules-1", name: "测试规则", url: "https://example.com/rules.txt", action: "direct", enabled: true }); state = methods.get("proxyConsole:saveState")({ state });
  const first = await methods.get("proxyConsole:syncRuleSet")({ ruleSetId: "rules-1" }); assert.equal(first.entryCount, 2); assert.match(first.version, /^[a-f0-9]{12}$/);
  const cacheBefore = fs.readFileSync(path.join(storage, "rule-set-cache.json"), "utf8"); fail = true;
  await assert.rejects(methods.get("proxyConsole:syncRuleSet")({ ruleSetId: "rules-1" }), /继续使用最后成功缓存/);
  assert.equal(fs.readFileSync(path.join(storage, "rule-set-cache.json"), "utf8"), cacheBefore, "failed refresh must preserve successful cache");
  state = methods.get("proxyConsole:getState")(); assert(state.ruleSets[0].lastSuccessAt); assert.match(state.ruleSets[0].lastError, /offline/);
  console.log("rule-set refresh preserves the last successful cache on failure");
})().catch((error) => { console.error(error); process.exitCode = 1; });
