const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[.-]([A-Za-z0-9._-]+))?$/;
const COMPATIBILITY = require("./nowhere-compatibility.json");

function parseNowhereVersion(value) {
  const text = String(value || "").trim();
  const match = VERSION_PATTERN.exec(text);
  if (!match) return null;
  return {
    text: text.startsWith("v") ? text : `v${text}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    suffix: match[4] || "",
  };
}

function compareNowhereVersions(left, right) {
  const a = typeof left === "string" ? parseNowhereVersion(left) : left;
  const b = typeof right === "string" ? parseNowhereVersion(right) : right;
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.suffix === b.suffix) return 0;
  if (!a.suffix) return 1;
  if (!b.suffix) return -1;
  return a.suffix.localeCompare(b.suffix);
}

function atLeast(version, target) {
  const compared = compareNowhereVersions(version, target);
  return compared !== null && compared >= 0;
}

function adapterFor(parsed) {
  if (!parsed) return null;
  return COMPATIBILITY.adapters.find((adapter) => (
    adapter.major === parsed.major
    && atLeast(parsed, adapter.minimumVersion)
    && compareNowhereVersions(parsed, adapter.maximumVersion) <= 0
  )) || null;
}

function compatibilityCatalog() {
  return JSON.parse(JSON.stringify(COMPATIBILITY));
}

function nowhereCapabilities(version) {
  const parsed = parseNowhereVersion(version);
  if (!parsed) {
    return {
      version: String(version || ""), known: false, supported: false,
      adapter: "", verified: false, compatibility: "invalid",
      vectorPin: false, vectorMux: false, localTelemetry: false,
      protocolGeneration: 0, wireProtocol: "", carrierEndpoints: false,
      morph: false, morphWireGeneration: 0, morphTcpPrelude: false, transportMemoryProfile: false,
    };
  }
  const normalized = parsed.text;
  const adapter = adapterFor(parsed);
  if (!adapter) {
    return {
      version: normalized, known: true, supported: false,
      adapter: "", verified: false, compatibility: "unverified",
      vectorPin: false, vectorMux: false, localTelemetry: false,
      protocolGeneration: 0, wireProtocol: "", carrierEndpoints: false,
      morph: false, morphWireGeneration: 0, morphTcpPrelude: false, transportMemoryProfile: false,
    };
  }
  const verified = adapter.verifiedVersions.includes(normalized);
  return {
    version: normalized, known: true, supported: true,
    adapter: adapter.id, verified, compatibility: verified ? "verified" : "compatible-range",
    vectorPin: true,
    vectorMux: true,
    localTelemetry: atLeast(normalized, "v2.0.2"),
    protocolGeneration: adapter.generation,
    wireProtocol: "nw2",
    carrierEndpoints: true,
    morph: true,
    morphWireGeneration: atLeast(normalized, "v2.1.0") ? 2 : 1,
    morphTcpPrelude: atLeast(normalized, "v2.1.0"),
    transportMemoryProfile: true,
  };
}

module.exports = {
  VERSION_PATTERN,
  compatibilityCatalog,
  compareNowhereVersions,
  nowhereCapabilities,
  parseNowhereVersion,
};
