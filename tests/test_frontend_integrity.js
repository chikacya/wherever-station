const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "frontend", "src", "App.jsx"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "komari-plugin.json"), "utf8"));
const icon = fs.readFileSync(path.join(__dirname, "..", "icon.svg"), "utf8");

for (const component of [
  "Overview",
  "Nodes",
  "Subscriptions",
  "Sources",
  "Providers",
  "Machines",
  "TrafficPlanDialog",
  "HostServiceControls",
  "ManagedNowhereDeploy",
]) {
  assert.match(source, new RegExp(`function ${component}\\b`), `${component} must be defined`);
}

assert.doesNotMatch(source, /function ConfigurationPlanning\b/);
assert.doesNotMatch(source, /\["planning",/);
assert.doesNotMatch(source, /\["discovery",/);
assert.doesNotMatch(source, /\["services",/);
assert.doesNotMatch(source, /function Discovery\b|<Discovery\b/);
assert.equal(manifest.icon, "icon.svg", "Komari plugin list icon must be declared at plugin level");
assert(fs.existsSync(path.join(__dirname, "..", manifest.icon)), "declared plugin icon must exist");
assert.equal(manifest.name.zh_CN, "Wherever Station", "plugin brand must be consistent");
assert.match(icon, /wherever-station-icon-title/, "brand mark must have an accessible identity");
assert.match(icon, /class="station-sign"/, "brand mark must use the approved station sign");
assert.match(icon, /class="station-location"/, "brand mark must end in a location marker");
assert.doesNotMatch(icon, /station-letter/, "compact brand mark must remain text-free");
assert.doesNotMatch(icon, /M17 18h7a8 8/, "superseded route-and-stations symbol must not return");
assert.match(source, /function StationMark\b/, "header must use the Wherever Station mark");
assert.match(source, /单节点输出/, "nodes must expose direct URI and QR output");
assert.match(source, /deploymentPresets/, "sing-box deployment presets must come from persisted state");
assert.match(source, /sing-box 预设/, "deployment presets must have a management surface");
assert.match(source, /面板连接/, "external panels must have a provider surface");
assert.match(source, /接入新 VPS/, "machines must expose the Agent onboarding flow");
assert.match(source, /--month-rotate/, "new Agent onboarding must align the traffic counter cycle");
assert.match(source, /saveMachineTrafficPlan/, "server traffic plans must sync through one business RPC");
assert.match(source, /prepareExistingServiceDiscovery/, "machines must expose read-only existing service discovery");
assert.match(source, /\[tab, me\?\.two_factor_enabled, refreshServices\]/, "host service polling must follow the loaded machine set");
assert.match(source, /Promise\.allSettled\(/, "host service polling must isolate failures per Agent");
assert.match(source, /state: "unavailable", pending: false/, "host service failures must settle instead of remaining busy");
assert.match(source, /statusesRef\.current\[machine\.monitorClientId\]\?\.online === false/, "offline Agents must not receive remote status tasks");
assert.match(source, /const statusesRef = useRef\(statuses\)/, "metrics refreshes must not recreate the service polling callback");
assert.match(source, /provider-node-row/, "providers must expose synchronized nodes on their first screen");
assert.match(source, /等待客户端/, "provider preview must expose inbound readiness");
assert.match(source, /删除本地记录/, "provider preview must expose remote-missing cleanup choices");
assert.doesNotMatch(source, /provider-metrics/, "providers must not return to oversized summary cards");
assert.doesNotMatch(source, /READ-ONLY|ISOLATED SERVER|SUBSCRIPTION WORKBENCH|LOCAL REVISION HISTORY/, "developer-facing labels must not leak into the UI");

console.log("frontend navigation integrity tests passed");
