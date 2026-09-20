const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildManagedNowhereCommand, parseManagedNowhereOutput } = require("../tools/managed-nowhere-remote");
const { planManagedNowhere } = require("../tools/managed-nowhere");

const input = { id: "test-node-0001", name: "Test", publicHost: "example.com", listenHost: "127.0.0.1", port: 52077, key: "secret", network: "mix" };
function decoded(action, value = input, sourceMode) {
  const command = buildManagedNowhereCommand(action, value, sourceMode);
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

const adoptionPlan = { ...planManagedNowhere(input), sourceBinaryPath: "/usr/local/bin/nowhere", sourceUnit: "nowhere.service", sourceWasEnabled: true };
const stagedCreate = decoded("create", adoptionPlan, "copy");
assert.equal(stagedCreate.payload.sourceBinaryPath, "/usr/local/bin/nowhere");
assert.equal(stagedCreate.payload.sourceMode, "copy");
assert(stagedCreate.script.includes("P.get('sourceBinaryPath')"));
for (const action of ["adopt", "rollback-adoption"]) {
  const value = decoded(action, adoptionPlan);
  assert.equal(value.payload.sourceUnit, "nowhere.service");
  assert.equal(value.payload.sourceWasEnabled, true);
  assert(value.script.includes("restore_source"));
  assert(value.script.includes("proxy-console-nowhere@"));
}

const adoptionTemp = fs.mkdtempSync(path.join(os.tmpdir(), "nowhere-adoption-test-"));
try {
  const instanceDirectory = path.join(adoptionTemp, "instance");
  fs.mkdirSync(instanceDirectory);
  const unitPath = path.join(adoptionTemp, "managed.service");
  fs.writeFileSync(unitPath, "fixture");
  const runAdoption = (action, initial, failStart = "") => {
    const operation = decoded(action, adoptionPlan);
    const payload = { ...operation.payload, directory: instanceDirectory, environmentPath: path.join(instanceDirectory, "nowhere.env"), unitPath };
    const stub = `import os,subprocess\nos.geteuid=lambda:0\nstates=${JSON.stringify(initial)}\nenabled_units={"nowhere.service":True,${JSON.stringify(payload.unitName)}:False}\nfail_start=${JSON.stringify(failStart)}\ndef fake_run(args,**kwargs):\n cmd=args[1] if len(args)>1 else ""\n unit=args[2] if len(args)>2 else ""\n if args[0]!="systemctl": return subprocess.CompletedProcess(args,0,stdout="",stderr="")\n if cmd=="is-active": return subprocess.CompletedProcess(args,0 if states.get(unit)=="active" else 3,stdout=states.get(unit,"inactive")+"\\n",stderr="")\n if cmd=="is-enabled": return subprocess.CompletedProcess(args,0 if enabled_units.get(unit) else 1,stdout=("enabled" if enabled_units.get(unit) else "disabled")+"\\n",stderr="")\n if cmd=="start":\n  if unit==fail_start: return subprocess.CompletedProcess(args,1,stdout="",stderr="failed")\n  states[unit]="active"; return subprocess.CompletedProcess(args,0,stdout="",stderr="")\n if cmd=="stop": states[unit]="inactive"; return subprocess.CompletedProcess(args,0,stdout="",stderr="")\n if cmd=="enable": enabled_units[unit]=True; return subprocess.CompletedProcess(args,0,stdout="",stderr="")\n if cmd=="disable": enabled_units[unit]=False; return subprocess.CompletedProcess(args,0,stdout="",stderr="")\n return subprocess.CompletedProcess(args,1,stdout="",stderr="unexpected")\nsubprocess.run=fake_run\n`;
    const result = spawnSync("python3", ["-c", stub + operation.script, Buffer.from(JSON.stringify(payload)).toString("base64")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return parseManagedNowhereOutput(result.stdout);
  };
  assert.deepEqual(runAdoption("adopt", { "nowhere.service": "active", [adoptionPlan.unitName]: "inactive" }), { ok: true, state: "active", sourceState: "inactive", sourceWasEnabled: true });
  const recovered = runAdoption("adopt", { "nowhere.service": "active", [adoptionPlan.unitName]: "inactive" }, adoptionPlan.unitName);
  assert.equal(recovered.error, "adoption-start-failed");
  assert.equal(recovered.rolledBack, true);
  assert.equal(recovered.sourceState, "active");
  assert.deepEqual(runAdoption("rollback-adoption", { "nowhere.service": "inactive", [adoptionPlan.unitName]: "active" }), { ok: true, state: "inactive", sourceState: "active", sourceWasEnabled: true });
} finally { fs.rmSync(adoptionTemp, { recursive: true, force: true }); }

for (const action of ["start", "stop", "restart", "status", "logs", "delete"]) {
  const value = decoded(action);
  assert(value.script.includes("unitName"));
  assert(!value.command.includes("nowhere.service"), `${action} command must not embed the legacy unit`);
}
assert(decoded("status").script.includes("context.wrap_socket"), "tls=1 fingerprint should be read without nowhere-sh");
const upgrade = buildManagedNowhereCommand("upgrade", { ...input, targetVersion: "v2.0.1" });
const upgradeParts = [...upgrade.matchAll(/'([^']+)'/g)].map((match) => match[1]);
const upgradeScript = Buffer.from(upgradeParts[1], "base64").toString("utf8");
assert(upgradeScript.includes("release-checksum-mismatch"));
assert(upgradeScript.includes("release-not-found"));
assert(upgradeScript.includes("os.replace(P['binaryPath'], previous)"));
assert(upgradeScript.includes("NOWHERE_VERSION_VALUE"));
assert(!upgradeScript.includes("systemctl', 'stop', 'nowhere.service"));
assert.throws(() => buildManagedNowhereCommand("upgrade", { ...input, targetVersion: "v1.8.3" }), /unverified|2\.x/);
assert.throws(() => buildManagedNowhereCommand("migrate-v2", input), /action/);
assert.throws(() => buildManagedNowhereCommand("rollback-v1", input), /action/);
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
