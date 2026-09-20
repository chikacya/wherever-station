const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

test("provider nodes can derive a reusable region profile from their resolved IP", async () => {
  const root = path.resolve(__dirname, "..");
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "wherever-provider-geo-"));
  const methods = new Map();
  const fakeServer = {
    route() {},
    registerRPC(name, handler) { methods.set(name, handler); },
  };
  const requests = [];
  const sandbox = {
    AbortController,
    Buffer,
    clearTimeout,
    console,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.startsWith("https://cloudflare-dns.com/")) return {
        ok: true,
        json: async () => ({ Answer: [{ type: 1, data: "203.0.113.8" }] }),
      };
      return {
        ok: true,
        json: async () => [{
          ip: "203.0.113.8",
          country: "US",
          city: "Los Angeles",
          asn: { number: 64500, organization: "Example Transit" },
        }],
      };
    },
    setTimeout,
    __dirname: root,
    __storageDir__: storage,
    require(name) { return name === "server" ? fakeServer : require(name); },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), sandbox, { filename: "script.js" });
  sandbox.load();

  let state = methods.get("proxyConsole:getState")();
  state.providers.push({ id: "provider-geo", name: "测试面板", type: "2s-ui", baseUrl: "https://panel.example.com" });
  state.nodes.push({
    id: "provider-node", name: "外部节点", protocol: "vless", machineId: "",
    uri: "vless://00000000-0000-4000-8000-000000000001@edge.example.com:443?security=tls&sni=edge.example.com#External",
    enabled: true, tags: [], source: "provider", sourceId: "provider-geo", remoteId: "remote-1",
  });
  state = methods.get("proxyConsole:saveState")({ state });

  const result = await methods.get("proxyConsole:geolocateProviderNodes")({ providerId: "provider-geo" });
  const node = result.state.nodes.find((item) => item.id === "provider-node");
  assert.equal(result.updated, 1);
  assert.equal(node.countryCode, "US");
  assert.deepEqual(JSON.parse(JSON.stringify(node.geo)), {
    countryCode: "US",
    city: "Los Angeles",
    asn: "AS64500",
    organization: "Example Transit",
    checkedAt: result.checkedAt,
  });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /cloudflare-dns\.com\/dns-query\?name=edge\.example\.com&type=A/);
  assert.deepEqual(JSON.parse(requests[1].options.body), ["203.0.113.8"]);
});
