const assert = require("node:assert/strict");
const { protocolCapability, protocolCatalog } = require("../tools/protocol-capabilities");

assert.deepEqual(protocolCapability("anywhere", "sudoku"), { supported: true, mode: "passthrough", clientSupport: "native" });
assert.deepEqual(protocolCapability("anywhere", "future-proxy"), { supported: true, mode: "passthrough", clientSupport: "unknown" });
assert.deepEqual(protocolCapability("loon", "vless"), { supported: true, mode: "passthrough", clientSupport: "native" });
assert.deepEqual(protocolCapability("loon", "nowhere"), { supported: true, mode: "passthrough", clientSupport: "unknown" });
assert.deepEqual(protocolCapability("mihomo", "vless"), { supported: true, mode: "converted", clientSupport: "native" });
assert.deepEqual(protocolCapability("sing-box", "sudoku"), { supported: false, mode: "unsupported", clientSupport: "unsupported" });
assert.deepEqual(protocolCapability("mihomo", "http"), { supported: true, mode: "converted", clientSupport: "native" });
assert.deepEqual(protocolCapability("sing-box", "https"), { supported: true, mode: "converted", clientSupport: "native" });
assert.deepEqual(protocolCapability("anywhere", "http"), { supported: true, mode: "passthrough", clientSupport: "native" });
assert(protocolCatalog().clientNativeUri.anywhere.includes("sudoku"));

console.log("protocol capability contract tests passed");
