const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { buildConnectivityCommand, parseConnectivityOutput } = require("../tools/connectivity-check");

for (const input of [
  { kind: "sing-box", outbound: { type: "shadowsocks", server: "example.com", server_port: 443, method: "aes-128-gcm", password: "secret" }, expectedIp: "192.0.2.1", preferredBinary: "/var/lib/proxy-console/instances/sb-test123/bin/sing-box" },
  { kind: "vector", uri: "vector://secret@example.com:443?socks=127.0.0.1%3A1080", expectedIp: "", preferredBinary: "/var/lib/proxy-console/instances/nw-test123/bin/nowhere" },
]) {
  const command = buildConnectivityCommand(input);
  const parts = [...command.matchAll(/'([^']+)'/g)];
  const script = Buffer.from(parts[1][1], "base64").toString();
  const payload = JSON.parse(Buffer.from(parts[2][1], "base64").toString());
  assert.equal(payload.kind, input.kind);
  assert.equal(payload.preferredBinary, input.preferredBinary);
  assert(script.includes("PCCONNECT"));
  assert(script.includes("socks5h://127.0.0.1:"));
  assert(!script.includes("systemctl restart"));
  assert.equal(spawnSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: script }).status, 0);
}
assert.throws(() => buildConnectivityCommand({ kind: "vector", uri: "vector://key@example.com:443", preferredBinary: "/usr/local/bin/nowhere" }), /preferred/);
const encoded = Buffer.from(JSON.stringify({ ok: true, https: true })).toString("base64");
assert.deepEqual(parseConnectivityOutput("noise\nPCCONNECT\t1\t" + encoded), { ok: true, https: true });
assert.equal(parseConnectivityOutput("bad").error, "invalid-response");
console.log("connectivity command is isolated, parseable and read-only to system services");
