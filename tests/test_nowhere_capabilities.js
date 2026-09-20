const assert = require("node:assert/strict");
const { compareNowhereVersions, nowhereCapabilities, parseNowhereVersion } = require("../tools/nowhere-capabilities");

assert.deepEqual(parseNowhereVersion("2.0.2"), { text: "v2.0.2", major: 2, minor: 0, patch: 2, suffix: "" });
assert.equal(parseNowhereVersion("latest"), null);
assert.equal(compareNowhereVersions("v2.0.2", "v2.0.1"), 1);
assert.equal(compareNowhereVersions("v2.0.2-beta.1", "v2.0.2"), -1);
assert.equal(nowhereCapabilities("v1.8.3").supported, false);
assert.deepEqual(nowhereCapabilities("v2.0.2"), {
  version: "v2.0.2", known: true, supported: true, adapter: "nowhere-v2", verified: true, compatibility: "verified",
  vectorPin: true, vectorMux: true, localTelemetry: true, protocolGeneration: 2,
  wireProtocol: "nw2", carrierEndpoints: true, morph: true, transportMemoryProfile: true,
});
assert.equal(nowhereCapabilities("v2.0.1").localTelemetry, false);
assert.equal(nowhereCapabilities("v2.1.0").compatibility, "compatible-range");
assert.equal(nowhereCapabilities("unknown").known, false);
assert.deepEqual(nowhereCapabilities("v3.0.0"), {
  version: "v3.0.0", known: true, supported: false, adapter: "", verified: false, compatibility: "unverified",
  vectorPin: false, vectorMux: false, localTelemetry: false,
  protocolGeneration: 0, wireProtocol: "", carrierEndpoints: false, morph: false, transportMemoryProfile: false,
});

console.log("Nowhere 2.x-only capability matrix tests passed");
