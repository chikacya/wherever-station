const assert = require("node:assert/strict");
const {
  compareNowhereVersions,
  nowhereCapabilities,
  parseNowhereVersion,
} = require("../tools/nowhere-capabilities");

assert.deepEqual(parseNowhereVersion("1.8.3"), {
  text: "v1.8.3", major: 1, minor: 8, patch: 3, suffix: "",
});
assert.equal(parseNowhereVersion("latest"), null);
assert.equal(compareNowhereVersions("v1.8.3", "v1.8.0"), 1);
assert.equal(compareNowhereVersions("v1.8.0-beta.1", "v1.8.0"), -1);
assert.deepEqual(nowhereCapabilities("v1.5.0"), {
  version: "v1.5.0", known: true, supported: true, adapter: "nowhere-v1", verified: true, compatibility: "verified", legacyPool: true,
  vectorPin: false, telemetryIpcV2: false, vectorMux: false,
  quicMemoryProfile: false, isV2: false, protocolGeneration: 1,
  wireProtocol: "now/1", customAlpn: true, carrierEndpoints: false,
  morph: false, transportMemoryProfile: false,
});
assert.equal(nowhereCapabilities("v1.5.1").vectorPin, true);
assert.equal(nowhereCapabilities("v1.6.0").telemetryIpcV2, true);
assert.equal(nowhereCapabilities("v1.8.0").legacyPool, false);
assert.equal(nowhereCapabilities("v1.8.0").vectorMux, true);
assert.deepEqual(nowhereCapabilities("v2.0.0"), {
  version: "v2.0.0", known: true, supported: true, adapter: "nowhere-v2", verified: true, compatibility: "verified", legacyPool: false,
  vectorPin: true, telemetryIpcV2: true, vectorMux: true,
  quicMemoryProfile: false, isV2: true, protocolGeneration: 2,
  wireProtocol: "nw2", customAlpn: false, carrierEndpoints: true,
  morph: true, transportMemoryProfile: true,
});
assert.equal(nowhereCapabilities("unknown").known, false);
assert.deepEqual(nowhereCapabilities("v3.0.0"), {
  version: "v3.0.0", known: true, supported: false, adapter: "", verified: false, compatibility: "unverified",
  legacyPool: false, vectorPin: false, telemetryIpcV2: false, vectorMux: false,
  quicMemoryProfile: false, isV2: false, protocolGeneration: 0, wireProtocol: "",
  customAlpn: false, carrierEndpoints: false, morph: false, transportMemoryProfile: false,
});

console.log("Nowhere capability matrix tests passed");
