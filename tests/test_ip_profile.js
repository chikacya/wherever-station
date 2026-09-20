const assert = require("node:assert/strict");
const { buildIpProfileCommand, parseIpProfileOutput, PINNED_COMMIT, PINNED_SHA256 } = require("../tools/ip-profile-check");

const command = buildIpProfileCommand();
assert(command.includes(PINNED_COMMIT));
assert(command.includes(PINNED_SHA256));
assert(command.includes("sha256sum -c"));
assert(command.includes("--json"));

const report = {
  version: "1.2.3",
  public_ip: "203.0.113.8",
  geo: "US Los Angeles AS64500 Example",
  risk: "score=12 low",
  results: [{ category: "STREAM", name: "Netflix", status: "YES", region: "US", detail: "Originals" }],
};
const output = `noise\nPCIPPROFILE\t1\t${Buffer.from(JSON.stringify(report)).toString("base64")}\n`;
assert.deepEqual(parseIpProfileOutput(output), {
  ok: true,
  version: "1.2.3",
  publicIp: "203.0.113.8",
  geo: "US Los Angeles AS64500 Example",
  risk: "score=12 low",
  results: [{ category: "STREAM", name: "Netflix", status: "YES", region: "US", detail: "Originals" }],
});
assert.equal(parseIpProfileOutput("plain output").ok, false);
assert.equal(parseIpProfileOutput("PCIPPROFILE\t1\tbad").ok, false);

console.log("IP profile command tests passed");
