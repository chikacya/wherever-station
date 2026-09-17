const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildManagedNowhereCommand, parseManagedNowhereOutput } = require("../tools/managed-nowhere-remote");

const input = { id: "test-node-0001", name: "Test", publicHost: "example.com", listenHost: "127.0.0.1", port: 52077, key: "secret", network: "mix" };
function decoded(action) {
  const command = buildManagedNowhereCommand(action, input);
  const parts = [...command.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const script = Buffer.from(parts[1], "base64").toString("utf8");
  assert(!script.split("\n").some((line) => line.startsWith("+")), `${action} script contains patch markers`);
  return { command, script, payload: JSON.parse(Buffer.from(parts[2], "base64").toString("utf8")) };
}

const preflight = decoded("preflight");
assert(preflight.script.includes("PCNOWHERE"));
assert(preflight.script.includes("active('nowhere.service')"));
assert(!preflight.script.includes("systemctl\",\"restart\",\"nowhere.service"));
assert.equal(preflight.payload.directory, "/var/lib/proxy-console/instances/test-node-0001");
assert.equal(preflight.payload.unitPath, "/etc/systemd/system/proxy-console-nowhere@test-node-0001.service");

const create = decoded("create");
assert(create.script.includes("os.makedirs(P['directory'], mode=0o700)"));
assert(create.script.includes("release-checksum-mismatch"));
assert(create.script.includes("release-not-found"));
assert(create.script.includes("prepare_certificate()"));
assert(create.script.includes("certificate-key-mismatch"));
assert(create.script.includes("run(['systemctl', 'daemon-reload']"));
assert(!create.script.includes("run(['systemctl', 'start'"));
assert.equal(create.payload.sourceMode, "download");
assert(create.payload.environment.includes("NOWHERE_PORTAL="));
assert(create.payload.unit.includes("proxy-console/instances/test-node-0001/bin/nowhere"));

for (const action of ["start", "stop", "restart", "status", "logs", "delete"]) {
  const value = decoded(action);
  assert(value.script.includes("unitName"));
  assert(!value.command.includes("nowhere.service"), `${action} command must not embed the legacy unit`);
}
assert(decoded("status").script.includes("context.wrap_socket"), "tls=1 fingerprint should be read without nowhere-sh");
const upgrade = buildManagedNowhereCommand("upgrade", { ...input, targetVersion: "v1.8.3" });
const upgradeParts = [...upgrade.matchAll(/'([^']+)'/g)].map((match) => match[1]);
const upgradeScript = Buffer.from(upgradeParts[1], "base64").toString("utf8");
assert(upgradeScript.includes("release-checksum-mismatch"));
assert(upgradeScript.includes("release-not-found"));
assert(upgradeScript.includes("os.replace(P['binaryPath'], previous)"));
assert(upgradeScript.includes("NOWHERE_VERSION_VALUE"));
assert(!upgradeScript.includes("systemctl', 'stop', 'nowhere.service"));
assert.throws(() => buildManagedNowhereCommand("upgrade", { ...input, targetVersion: "v2.0.0" }), /migration required/);
assert.throws(() => buildManagedNowhereCommand("upgrade", { ...input, targetVersion: "v1.7.2" }), /unverified/);
const migrationPlan = { ...input, version: "v2.0.0", tcpPort: 52077, udpPort: 52077, morph: 0, transportMemoryProfile: "throughput", previousVersion: "v1.8.3" };
const migration = buildManagedNowhereCommand("migrate-v2", migrationPlan);
const migrationParts = [...migration.matchAll(/'([^']+)'/g)].map((match) => match[1]);
const migrationScript = Buffer.from(migrationParts[1], "base64").toString("utf8");
const migrationPayload = JSON.parse(Buffer.from(migrationParts[2], "base64").toString("utf8"));
assert(migrationScript.includes("V1 instance to V2"));
assert(migrationScript.includes("restoreDirectory"));
assert(migrationPayload.environment.includes('NOWHERE_VERSION_VALUE="v2.0.0"'));
assert.deepEqual(migrationPayload.ports, [{ transport: "tcp", port: 52077 }, { transport: "udp", port: 52077 }]);
const v2Plan = require("../tools/managed-nowhere").planManagedNowhere(migrationPlan);
const rollbackCommand = buildManagedNowhereCommand("rollback-v1", { ...v2Plan, backupDirectory: "/var/lib/proxy-console/instances/test-node-0001/migrations/fixture-v1-to-v2" });
const rollbackParts = [...rollbackCommand.matchAll(/'([^']+)'/g)].map((match) => match[1]);
assert(Buffer.from(rollbackParts[1], "base64").toString("utf8").includes("V1 snapshot"));
const update = buildManagedNowhereCommand("update", { ...input, certificateMode: "managed", expectedHash: "a".repeat(64) });
const updateParts = [...update.matchAll(/'([^']+)'/g)].map((match) => match[1]);
const updateScript = Buffer.from(updateParts[1], "base64").toString("utf8");
assert(updateScript.includes("validate_certificate_pair"));
assert(updateScript.includes("certificateRotated"));
assert(updateScript.includes("NOWHERE_CERTIFICATE_HOST_VALUE"));
assert.throws(() => buildManagedNowhereCommand("shell", input), /action/);

const encoded = Buffer.from(JSON.stringify({ ok: true, state: "stopped" })).toString("base64");
assert.deepEqual(parseManagedNowhereOutput(`noise\nPCNOWHERE\t2\t${encoded}\n`), { ok: true, state: "stopped" });
assert.deepEqual(parseManagedNowhereOutput("bad"), { ok: false, error: "invalid-response" });
// Exercise failed-preflight cleanup: only a verified absence may remove a draft.
// All systemctl calls are intercepted, even if this test runs as root.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "managed-draft-test-"));
try {
  const deletion = decoded("delete");
  const payload = { ...deletion.payload, directory: path.join(temp, "instance"), unitPath: path.join(temp, "unit.service") };
  payload.environmentPath = path.join(payload.directory, "nowhere.env");
  const stub = `import os,subprocess\nos.geteuid=lambda:0\ndef fake_run(args,**kwargs):\n if args[:2]!=["systemctl","is-active"]: raise Exception("unexpected mutation")\n return subprocess.CompletedProcess(args,3,stdout="inactive\\n",stderr="")\nsubprocess.run=fake_run\n`;
  const check = () => {
    const result = spawnSync("python3", ["-c", stub + deletion.script, Buffer.from(JSON.stringify(payload)).toString("base64")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return parseManagedNowhereOutput(result.stdout);
  };
  assert.deepEqual(check(), { ok: true, state: "deleted", draftOnly: true });
  fs.mkdirSync(payload.directory);
  fs.writeFileSync(path.join(payload.directory, "keep"), "partial installation");
  assert.equal(check().error, "managed-instance-incomplete");
  assert(fs.existsSync(path.join(payload.directory, "keep")));
  const held = `import fcntl\nheld=open(${JSON.stringify(payload.environmentPath + '.update-lock')},"a")\nfcntl.flock(held.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)\n`;
  for (const action of ['start', 'stop', 'restart', 'delete', 'read-config']) {
    const operation = decoded(action);
    const result = spawnSync('python3', ['-c', stub + held + operation.script, Buffer.from(JSON.stringify(payload)).toString('base64')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(parseManagedNowhereOutput(result.stdout).error, 'update-in-progress');
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log("managed Nowhere remote command tests passed (commands inspected only; no host operations)");
