const assert = require("node:assert/strict");
const { compatibilityReport, stableReleaseTags } = require("../tools/check-nowhere-releases");

const releases = [
  { tag_name: "v3.0.0" },
  { tag_name: "v2.0.1" },
  { tag_name: "v2.0.0" },
  { tag_name: "v1.8.3" },
  { tag_name: "v1.4.0" },
  { tag_name: "v2.1.0-beta.1", prerelease: true },
];
assert.deepEqual(stableReleaseTags(releases), ["v3.0.0", "v2.0.1", "v2.0.0", "v1.8.3"]);
const report = compatibilityReport(releases);
assert.deepEqual(report.entries.map((entry) => [entry.tag, entry.status]), [
  ["v3.0.0", "unknown-adapter"],
  ["v2.0.1", "unknown-adapter"],
  ["v2.0.0", "verified"],
  ["v1.8.3", "verified"],
]);
assert.deepEqual(report.pending.map((entry) => entry.tag), ["v3.0.0", "v2.0.1"]);

console.log("Nowhere release monitor tests passed");
