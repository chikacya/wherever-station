const assert = require("node:assert/strict");
const fs = require("node:fs");
const { planManagedSingBox, randomCredentials } = require("../tools/managed-sing-box");
const { buildManagedSingBoxCommand } = require("../tools/managed-sing-box-remote");
const { managedSingBoxInput } = require("../tools/managed-sing-box-config");

const defaults = randomCredentials();
assert.match(defaults.uuid, /^[0-9a-f-]{36}$/);
assert.match(defaults.password, /^[A-Za-z0-9_-]{32}$/);
assert.equal(defaults.realityPrivateKey, "");
assert.equal(defaults.realityPublicKey, "");
const credentials = { ...defaults, realityPrivateKey: "A".repeat(43), realityPublicKey: "B".repeat(43) };
const reality = planManagedSingBox({ id: "sb-reality-0001", name: "🇺🇸 Reality", protocol: "vless-reality", publicHost: "2001:db8::2", listenHost: "127.0.0.1", port: 62101, ...credentials, serverName: "apple.com", handshakeServer: "apple.com", handshakePort: 443, flow: "xtls-rprx-vision" });
assert.equal(reality.unitName, "proxy-console-singbox@sb-reality-0001.service");
assert(reality.unit.includes("/var/lib/proxy-console/instances/sb-reality-0001/bin/sing-box run"));
assert(!reality.unit.includes("sing-box.service"));
assert(reality.clientUri.startsWith("vless://"));
assert(reality.clientUri.includes("@[2001:db8::2]:62101"));
assert(JSON.parse(reality.config).inbounds[0].tls.reality.private_key === credentials.realityPrivateKey);
assert(!JSON.stringify(reality.summary).includes(credentials.realityPrivateKey));

const vmess = planManagedSingBox({ id: "sb-vmess-00001", name: "VMess", protocol: "vmess", publicHost: "example.com", listenHost: "127.0.0.1", port: 62102, uuid: credentials.uuid, transport: "ws", wsPath: "/wherever" });
assert.equal(JSON.parse(vmess.config).inbounds[0].transport.path, "/wherever");
assert.equal(JSON.parse(Buffer.from(vmess.clientUri.slice(8), "base64").toString()).net, "ws");
const shadowsocks = planManagedSingBox({ id: "sb-ss-00000001", name: "SS", protocol: "shadowsocks", publicHost: "example.com", listenHost: "127.0.0.1", port: 62103, method: "2022-blake3-aes-128-gcm", password: credentials.shadowsocks128 });
assert(shadowsocks.clientUri.startsWith("ss://"));
for (const [method, password, length] of [['2022-blake3-aes-128-gcm', credentials.shadowsocks128, 16], ['2022-blake3-aes-256-gcm', credentials.shadowsocks256, 32]]) {
  assert.equal(Buffer.from(password, 'base64').length, length);
  const input = { id: 'sb-ss-00000002', name: 'SS key test', protocol: 'shadowsocks', publicHost: 'example.com', port: 62104, method, password };
  assert.doesNotThrow(() => planManagedSingBox(input));
  assert.throws(() => planManagedSingBox({ ...input, password: credentials.password }), /密钥需要/);
}

for (const action of ["create", "start", "stop", "restart", "status", "logs", "delete"]) {
  const command = buildManagedSingBoxCommand(action, reality);
  const parts = [...command.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const script = Buffer.from(parts[1], "base64").toString("utf8");
  assert(script.includes("PCSINGBOX"));
  assert(!script.split("\n").some((line) => line.startsWith("+")));
  assert(!command.includes("systemctl restart sing-box.service"));
  if (action === "create") { assert(script.includes('[binary,"check","-c",config_path]')); assert(!script.includes('["systemctl","start"')); }
  if (action === "delete") assert(script.includes('daemon-reload"],15).returncode!=0'));
}
assert.throws(() => planManagedSingBox({ ...vmess, id: "bad", uuid: credentials.uuid }), /id/);
const downloadCommand = buildManagedSingBoxCommand('create', reality, 'download', '1.13.11');
const downloadScript = Buffer.from([...downloadCommand.matchAll(/'([^']+)'/g)][1][1], 'base64').toString();
assert(downloadScript.includes('install_release(binary,P["version"])'));
assert(!downloadScript.includes('shutil.which("sing-box")'), 'download requires no preinstalled binary');
const syntax = require('child_process').spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: downloadScript, encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr);
assert.throws(() => buildManagedSingBoxCommand('create', reality, 'download', '../../bad'), /版本/);
for (const protocol of ['trojan', 'hysteria2', 'tuic', 'anytls']) {
  const tlsPlan = planManagedSingBox({ id: 'sb-tls-test001', name: 'TLS test', protocol, publicHost: 'example.com', port: 62105, serverName: 'example.com', certificateMode: 'self-signed', ...credentials });
  assert(tlsPlan.selfSigned);
  assert.equal(tlsPlan.summary.serverName, 'example.com');
  assert(tlsPlan.clientUri.includes('insecure=1'));
  assert.equal(JSON.parse(tlsPlan.config).inbounds[0].tls.key_path, tlsPlan.directory + '/server.key');
  const cmd = buildManagedSingBoxCommand('create', tlsPlan);
  const code = Buffer.from([...cmd.matchAll(/'([^']+)'/g)][1][1], 'base64').toString();
  const parsed = require('child_process').spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: code, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert(code.indexOf('certificate=run') < code.indexOf('checked=run'));
  assert(code.includes('subjectAltName='));
  assert(code.includes('openssl-not-found'));
  const reconstructed = managedSingBoxInput({ id: tlsPlan.id, protocol, publicHost: 'example.com', directory: tlsPlan.directory }, { name: 'TLS test', uri: tlsPlan.clientUri }, JSON.parse(tlsPlan.config));
  assert.equal(reconstructed.certificateMode, 'managed-self-signed');
  assert.equal(planManagedSingBox(reconstructed).config, tlsPlan.config);
}
const certificatePin = 'a'.repeat(64);
const publicKeyPin = Buffer.alloc(32, 7).toString('base64');
const pinnedHysteria = planManagedSingBox({ id: 'sb-hy2-pinned01', name: 'Pinned Hysteria2', protocol: 'hysteria2', publicHost: 'example.com', port: 62106, serverName: 'example.com', certificateMode: 'existing', certificatePath: '/etc/ssl/example.crt', privateKeyPath: '/etc/ssl/example.key', certificateAssetId: 'cert-pinned0001', certificateFingerprintSha256: certificatePin, certificatePublicKeySha256: publicKeyPin, ...credentials });
assert.equal(new URL(pinnedHysteria.clientUri).searchParams.get('pinSHA256'), certificatePin);
assert.equal(new URL(pinnedHysteria.clientUri).searchParams.has('insecure'), false);
assert.equal(pinnedHysteria.certificate.publicKeySha256, publicKeyPin);
const readCommand = buildManagedSingBoxCommand('read-config', reality);
const readCode = Buffer.from([...readCommand.matchAll(/'([^']+)'/g)][1][1], 'base64').toString();
assert(readCode.includes('configurationHash'));
assert(readCode.includes('update-in-progress'));
const updateCommand = buildManagedSingBoxCommand('update', { ...reality, expectedHash: 'a'.repeat(64) });
const updateParts = [...updateCommand.matchAll(/'([^']+)'/g)];
const updateCode = Buffer.from(updateParts[1][1], 'base64').toString();
const updatePayload = JSON.parse(Buffer.from(updateParts[2][1], 'base64').toString());
assert(updateCode.includes('[binary,"check","-c",next_path]'));
assert(updateCode.includes('rolledBack=rolled_back'));
assert.equal(Buffer.from(updatePayload.configuration, 'base64').toString(), reality.config);
const runtimeSource = fs.readFileSync(require.resolve("../tools/managed-sing-box"), "utf8");
assert(!runtimeSource.includes("generateKeyPairSync"));
assert(!runtimeSource.includes('.toString("base64url")'));
console.log("managed sing-box planning and command tests passed (no host operations)");
