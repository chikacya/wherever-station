const assert = require("assert");
const { createSuiProvider, normalizeSuiBaseUrl, parseSuiDiscovery } = require("../tools/provider-s-ui");

assert.equal(normalizeSuiBaseUrl("https://panel.example.com/app/apiv2/"), "https://panel.example.com/app");
assert.throws(() => normalizeSuiBaseUrl("ftp://panel.example.com"), /HTTP/);

const inbounds = { success: true, obj: { inbounds: [
  { id: 4, tag: "Reality", type: "vless", listen: "::", listen_port: 443 },
  { id: 8, tag: "SS", type: "shadowsocks", listen: "::", listen_port: 8443 },
] } };
const clients = { success: true, obj: { clients: [
  { id: 10, enable: true, name: "alice", remark: "东京", up: 12, down: 34, volume: 1024, expiry: 2000000000 },
] } };
const detailed = { success: true, obj: { clients: [
  { id: 10, enable: true, name: "alice", remark: "东京", links: [
    { type: "local", remark: "Reality", uri: "vless://00000000-0000-4000-8000-000000000001@example.com:443?security=reality&type=tcp#%F0%9F%87%AF%F0%9F%87%B5%20%E4%B8%9C%E4%BA%AC" },
    { type: "local", remark: "SS", uri: "ss://YWVzLTEyOC1nY206cGFzcw@example.com:8443#SS" },
 ] },
] } };

const parsed = parseSuiDiscovery(inbounds, clients, detailed);
assert.equal(parsed.candidates.length, 2);
assert.equal(parsed.candidates[0].remoteName, "🇯🇵 东京");
assert.equal(parsed.candidates[0].remoteId, "client:10:inbound:4:0");
assert.equal(parsed.clients[0].upload, 12);
assert.equal(parsed.clients[0].download, 34);
assert.equal(parsed.clients[0].total, 1024);
assert.equal(parsed.clients[0].expire, 2000000000);
assert.equal(parsed.inbounds.every((item) => item.readiness === "ready"), true);

const clientlessHttp = parseSuiDiscovery(
  { success: true, obj: { inbounds: [{ id: 12, tag: "http-57543", type: "http", listen: "::", listen_port: 57543, users: [] }] } },
  { success: true, obj: { clients: [] } },
  null,
);
assert.equal(clientlessHttp.candidates.length, 0, "inbounds without native Client links must never become guessed nodes");
assert.equal(clientlessHttp.inbounds[0].readiness, "needs-client");
assert.match(clientlessHttp.inbounds[0].reason, /创建或绑定客户端/);

const authenticatedHttp = parseSuiDiscovery(
  { success: true, obj: { inbounds: [{ id: 13, tag: "http-auth", type: "http", listen: "::", listen_port: 57544, users: [{ username: "name@example", password: "p:a ss" }] }] } },
  { success: true, obj: { clients: [] } },
  null,
);
assert.equal(authenticatedHttp.candidates.length, 0);
assert.equal(authenticatedHttp.inbounds[0].readiness, "needs-link");
assert.deepEqual(authenticatedHttp.inbounds[0].clients, ["name@example"]);

const linkedHttp = parseSuiDiscovery(
  { success: true, obj: { inbounds: [{ id: 14, tag: "http-linked", type: "http", listen: "::", listen_port: 57545, users: [] }] } },
  { success: true, obj: { clients: [{ id: 20, name: "linked" }] } },
  { success: true, obj: { clients: [{ id: 20, name: "linked", links: [{ type: "local", remark: "http-linked", uri: "http://panel.example.com:57545#linked" }] }] } },
);
assert.equal(linkedHttp.candidates.length, 1, "only the native Client link is importable");
assert.equal(linkedHttp.candidates[0].remoteId, "client:20:inbound:14:0");
assert.equal(linkedHttp.inbounds[0].readiness, "ready");

const requests = [];
const bodies = { inbounds, clients, "clients?id=10": detailed };
const provider = createSuiProvider({ fetchImpl: async (url, options) => {
  const key = `${url.pathname.split("/").at(-1)}${url.search}`;
  requests.push({ url: url.toString(), token: options.headers.Token, method: options.method });
  return { ok: true, status: 200, headers: { get: () => "" }, text: async () => JSON.stringify(bodies[key]) };
} });

(async () => {
  const result = await provider.discover({ baseUrl: "https://panel.example.com/app" }, { token: "secret-token" });
  assert.equal(result.candidates.length, 2);
  assert(requests.every((item) => item.token === "secret-token" && item.method === "GET"));
  assert(requests.every((item) => item.url.includes("/app/apiv2/")));
  const twoSRequests = [];
  const twoS = createSuiProvider({ type: "2s-ui", fetchImpl: async (url, options) => {
    const key = `${url.pathname.split("/").at(-1)}${url.search}`;
    twoSRequests.push(key);
    const body = key.startsWith("status?") ? { success: true, obj: { sbd: { running: true, version: "1.12.9", stats: { Uptime: 88 } } } } : bodies[key];
    return { ok: true, status: 200, headers: { get: () => "" }, text: async () => JSON.stringify(body) };
  } });
  const twoSResult = await twoS.discover({ baseUrl: "https://panel.example.com/app" }, { token: "secret-token" });
  assert.deepEqual(twoSResult.status, { running: true, version: "1.12.9", uptime: 88 });
  assert(twoSRequests.includes("status?r=sbd"));
  const rejected = createSuiProvider({ fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => "" }, text: async () => JSON.stringify({ success: false, msg: "invalid token" }) }) });
  await assert.rejects(() => rejected.test({ baseUrl: "https://panel.example.com/app" }, { token: "bad" }), /invalid token/);
  console.log("s-ui provider tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
