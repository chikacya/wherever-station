const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  buildCertificateCommand,
  certificateId,
  parseCertificateOutput,
  planCertificateAsset,
} = require("../tools/certificate-manager");

function decoded(action, input) {
  const command = buildCertificateCommand(action, input);
  const parts = [...command.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  return {
    command,
    script: Buffer.from(parts[1], "base64").toString("utf8"),
    payload: JSON.parse(Buffer.from(parts[2], "base64").toString("utf8")),
  };
}

const id = certificateId("fixture");
assert.match(id, /^cert-[a-f0-9]{18}$/);
const managed = planCertificateAsset({ id, mode: "managed", subjectName: "edge.example.com", sans: ["edge.example.com", "192.0.2.7"], days: 365 });
assert.equal(managed.certificatePath, `/var/lib/proxy-console/certificates/${id}/certificate.pem`);
assert.deepEqual(managed.sans, ["edge.example.com", "192.0.2.7"]);
const create = decoded("create", managed);
assert(create.script.includes('PCCERT\\t1\\t'));
assert(create.script.includes('if os.geteuid()!=0'));
assert(create.script.includes('basicConstraints = critical,CA:FALSE'));
assert(!create.command.includes("systemctl"));
assert.throws(() => planCertificateAsset({ id: "bad", subjectName: "example.com" }), /id/);
assert.throws(() => planCertificateAsset({ id, mode: "existing", subjectName: "example.com", certificatePath: "relative.pem", privateKeyPath: "/tmp/key.pem" }), /path/);
assert.throws(() => buildCertificateCommand("rotate", managed), /action/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wherever-cert-"));
try {
  const cert = path.join(temp, "certificate.pem");
  const key = path.join(temp, "private-key.pem");
  const generated = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "45", "-subj", "/CN=fixture.example.com", "-addext", "subjectAltName=DNS:fixture.example.com,IP:192.0.2.7"], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const existing = planCertificateAsset({ id, mode: "existing", subjectName: "fixture.example.com", certificatePath: cert, privateKeyPath: key });
  const inspect = decoded("inspect", existing);
  const result = spawnSync("python3", ["-c", inspect.script, Buffer.from(JSON.stringify(inspect.payload)).toString("base64")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const parsed = parseCertificateOutput(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, "valid");
  assert.equal(parsed.keyMatch, true);
  assert.deepEqual(parsed.sans, ["fixture.example.com", "192.0.2.7"]);
  assert.match(parsed.fingerprintSha256, /^[a-f0-9]{64}$/);
  assert.match(parsed.publicKeySha256, /^[A-Za-z0-9+/]{43}=$/);

  const certDer = spawnSync("openssl", ["x509", "-in", cert, "-outform", "DER"]).stdout;
  assert.equal(parsed.fingerprintSha256, crypto.createHash("sha256").update(certDer).digest("hex"));
  const certPublic = spawnSync("openssl", ["x509", "-in", cert, "-pubkey", "-noout"]).stdout;
  const publicDer = spawnSync("openssl", ["pkey", "-pubin", "-outform", "DER"], { input: certPublic }).stdout;
  assert.equal(parsed.publicKeySha256, crypto.createHash("sha256").update(publicDer).digest("base64"));

  fs.writeFileSync(path.join(temp, "other.key"), spawnSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048"]).stdout);
  const mismatch = decoded("inspect", { ...existing, privateKeyPath: path.join(temp, "other.key") });
  const mismatchRun = spawnSync("python3", ["-c", mismatch.script, Buffer.from(JSON.stringify(mismatch.payload)).toString("base64")], { encoding: "utf8" });
  assert.equal(parseCertificateOutput(mismatchRun.stdout).error, "certificate-key-mismatch");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("certificate manager tests passed (isolated certificate files only)");
