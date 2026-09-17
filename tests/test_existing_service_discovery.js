const assert = require("node:assert/strict");
const { buildExistingServiceDiscoveryCommand, parseExistingServiceDiscoveryOutput } = require("../tools/existing-service-discovery");

const command = buildExistingServiceDiscoveryCommand({ publicHost: "2001:db8::1", machineName: "东京 VPS" });
assert.match(command, /^python3 -c /);
assert.match(command, /base64 -d/);
assert.doesNotMatch(command, /东京 VPS|2001:db8::1/, "discovery payload must be encoded before it enters the remote shell command");
const encodedParts = [...command.matchAll(/'([^']+)'/g)].map((match) => match[1]);
const scanner = Buffer.from(encodedParts[1], "base64").toString("utf8");
assert(scanner.includes('startswith("portal://")'), "running Nowhere portal URI should be parsed directly");
assert(scanner.includes('unit["adapter"] = "native-cli"'));
assert(!scanner.includes("nowhere-sh"), "discovery must not depend on the convenience script");

const payload = {
  ok: true,
  publicHost: "example.com",
  units: [{ unit: "nowhere.service", active: "active" }],
  candidates: [{ id: "abc", kind: "nowhere", protocol: "nowhere", name: "东京 Nowhere", uri: "nowhere://key@example.com:2077?up=udp&down=udp#Tokyo", confidence: "ready" }],
  needsReview: [],
};
const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
assert.deepEqual(parseExistingServiceDiscoveryOutput(`noise\nPCDISCOVERY\t1\t${encoded}\n`), payload);
assert.equal(parseExistingServiceDiscoveryOutput("invalid").ok, false);
assert.equal(parseExistingServiceDiscoveryOutput("PCDISCOVERY\t1\t%%%invalid").ok, false);

console.log("existing service discovery tests passed");
