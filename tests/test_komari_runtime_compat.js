const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtimeSource = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
assert.doesNotMatch(runtimeSource, /require\(["']node:dns["']\)/, "Komari's embedded runtime does not provide node:dns");
assert.doesNotMatch(runtimeSource, /registerRPC\(["']proxyConsole:geolocateProviderNodes["']/, "async provider geolocation must use the polled operation transport instead of returning a Promise through Komari RPC");
assert.match(runtimeSource, /geolocate:\s*geolocateProviderNodes/, "provider operation transport must expose geolocation");

// Komari 1.4.3 exposes URL APIs through node:url, not as JavaScript globals.
// Removing Node's globals here keeps managed configuration code honest about that contract.
global.URL = undefined;
global.URLSearchParams = undefined;

const { planManagedNowhere } = require("../tools/managed-nowhere");
const { planManagedSingBox } = require("../tools/managed-sing-box");

const nowhere = planManagedNowhere({
  id: "nw-compat1", name: "compat", publicHost: "203.0.113.7", port: 32077,
  key: "test-key", version: "v2.0.2",
});
const singBox = planManagedSingBox({
  id: "sb-compat1", name: "compat", protocol: "shadowsocks",
  publicHost: "203.0.113.7", listenHost: "0.0.0.0", port: 32078,
  tag: "compat", method: "aes-128-gcm", password: "test-password",
});
assert.match(nowhere.clientLink, /^nowhere:\/\//);
assert.match(singBox.clientUri, /^ss:\/\//);
console.log("Komari URL module compatibility tests passed (no URL globals)");
