const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-console-test-"));
const routes = new Map(); const methods = new Map();
const fakeServer = { route(method, route, handler) { routes.set(`${method} ${route}`, handler); }, registerRPC(method, handler) { methods.set(method, handler); } };
const sandbox = { console, Buffer, __storageDir__: storage, __dirname: root, require(name) { return name === "server" ? fakeServer : require(name); } };
vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), sandbox, { filename: "script.js" }); sandbox.load();

let state = methods.get("proxyConsole:getState")();
const compatibilityCatalog = methods.get("proxyConsole:getCompatibilityCatalog")();
assert(compatibilityCatalog.nowhere.adapters.some((adapter) => adapter.id === "nowhere-v2"));
assert(compatibilityCatalog.protocols.clientNativeUri.anywhere.includes("sudoku"));
assert.equal(state.version, 14); assert.equal(state.revision, 0); assert.deepEqual(state.certificates, []);
if (!state.machines.length) state.machines.push({ id: "fixture-machine", name: "测试宿主", provider: "fixture", region: "test", country: "测试", countryCode: "ZZ", tags: [], monitorClientId: "" });
assert.deepEqual(state.settings, { publicBaseUrl: "", monitoring: { cpuPercent: 85, memoryPercent: 90, diskPercent: 90 } }); assert.deepEqual(state.externalSources, []); assert(!Object.hasOwn(state, "operationLogs"));
assert(!Object.hasOwn(state, "discoverySnapshots"));
assert.deepEqual(state.managedInstances, []);
assert.equal(state.deploymentPresets.length, 7); assert.deepEqual(state.providers, []); assert.deepEqual(state.ruleSets, []);
assert.equal(sandbox.cleanState({ version: 6 }).deploymentPresets.length, 7, "v6 migration receives example presets once");
assert.equal(sandbox.cleanState({ version: 7, deploymentPresets: [] }).deploymentPresets.length, 0, "a v7 user may intentionally remove every preset");
const migratedPreset = sandbox.cleanState({ version: 10, deploymentPresets: [{ ...state.deploymentPresets[0], summary: "免证书", badges: ["推荐"] }] }).deploymentPresets[0];
assert.match(migratedPreset.summary, /Reality 仍使用 TLS/); assert.deepEqual(migratedPreset.badges, []);
assert(state.nodes.every((node) => !Object.hasOwn(node, "password")), "login passwords must never enter public state");
const draftState = sandbox.cleanState({ version: 9, nodeDrafts: [{ id: "draft-1", name: "待确认 Reality", protocol: "vless", reason: "缺少公网参数", source: "/etc/sing-box/config.json", repair: { publicHost: "edge.example.com", port: 443, userNames: ["a".repeat(80)], certificate: { path: "/etc/tls/fullchain.pem", keyPath: "/etc/tls/private.key", validTo: "2030-01-01T00:00:00Z", sans: ["a-very-long-subdomain-that-must-not-be-truncated.edge.example.com"], keyMatch: true, readable: true } } }], subscriptions: [{ id: "draft-sub", name: "草稿隔离", token: "d".repeat(48), nodeIds: ["draft-1"], enabled: true }] });
assert.equal(draftState.nodeDrafts.length, 1);
assert.equal(draftState.nodeDrafts[0].repair.userNames[0].length, 80);
assert.equal(draftState.nodeDrafts[0].repair.certificate.sans[0], "a-very-long-subdomain-that-must-not-be-truncated.edge.example.com");
assert.deepEqual(draftState.subscriptions[0].nodeIds, [], "discovery drafts must never become subscription nodes");

const machineId = state.machines[0].id;
state.machines[0].monitorClientId = "test-client";
const androidNode = { id: "test-android", name: "🇯🇵 | 东京 A#B 50% + 节点", protocol: "vless", machineId, uri: "vless://00000000-0000-4000-8000-000000000001@example.com:443?security=tls&type=tcp#Old", enabled: true, tags: [] };
const nowhere = { id: "test-nowhere", name: "东京 · Nowhere TCP→UDP", protocol: "nowhere", machineId, uri: "nowhere://sample-key@example.com:443?up=udp&down=tcp&mux=1#Old", enabled: true, tags: ["test"] };
const vmessValue = { v: "2", ps: "Old VMess", add: "example.com", port: "443", id: "00000000-0000-4000-8000-000000000000", aid: "0", net: "ws", host: "example.com", path: "/", tls: "tls" };
const vmess = { id: "test-vmess", name: "VMess 新名称", protocol: "vmess", machineId, uri: "vmess://" + Buffer.from(JSON.stringify(vmessValue)).toString("base64"), enabled: true, tags: [] };
const airportSource = { id: "test-airport", name: "机场订阅", url: "https://example.com/sub", machineId: "", tags: ["机场"], enabled: true, refreshIntervalHours: 24, nodeIds: ["test-airport-node"] };
const airportNode = { id: "test-airport-node", name: "机场节点", protocol: "vmess", machineId: "", uri: vmess.uri, enabled: true, tags: ["机场"], source: "external", sourceId: airportSource.id };
const unassignedManualNode = { id: "test-unassigned", name: "未关联手动节点", protocol: "vless", machineId: "", uri: "vless://00000000-0000-4000-8000-000000000008@unassigned.example.com:443?security=tls#Unassigned", enabled: true, tags: [], source: "manual" };
state.externalSources.push(airportSource); state.nodes.push(airportNode);
state.nodes.push(unassignedManualNode);
state.nodes.push({ ...nowhere, id: "legacy-encoded-name", name: "%E4%B8%9C%E4%BA%AC%20%C2%B7%20Nowhere" });
state.nodes.push(nowhere, vmess, androidNode); state.subscriptions.push({
  id: "test-mixed", name: "Mixed", token: "a".repeat(48), nodeIds: [nowhere.id, vmess.id, androidNode.id], enabled: true,
  groups: [
    { id: "manual", name: "手动选择", type: "select", entries: [{ kind: "node", id: nowhere.id }, { kind: "group", id: "auto" }], url: "https://www.gstatic.com/generate_204", interval: 3600 },
    { id: "auto", name: "自动测速", type: "url-test", entries: [{ kind: "node", id: vmess.id }], url: "https://www.gstatic.com/generate_204", interval: 600 },
  ],
});
state = methods.get("proxyConsole:saveState")({ state }); assert.equal(state.revision, 1);
const certCreate = methods.get("proxyConsole:prepareCertificateAction")({ action: "create", requestId: "request-certificate-create-001", input: { name: "测试已有证书", machineId, mode: "existing", certificatePath: "/etc/ssl/example.crt", privateKeyPath: "/etc/ssl/example.key" } });
const certScript = Buffer.from([...certCreate.command.matchAll(/'([^']+)'/g)][1][1], "base64").toString();
assert.equal(certCreate.clientId, "test-client"); assert(certScript.includes("PCCERT")); assert(!certCreate.command.includes("systemctl"));
const certificatePin = "c".repeat(64); const publicKeyPin = Buffer.alloc(32, 9).toString("base64");
state = methods.get("proxyConsole:recordCertificateResult")({ operationId: certCreate.operationId, result: { ok: true, status: "valid", fingerprintSha256: certificatePin, publicKeySha256: publicKeyPin, sans: ["managed.example.com"], validFrom: "2026-01-01T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z" } }).state;
const certificateAsset = state.certificates.find((item) => item.name === "测试已有证书");
assert(certificateAsset); assert.equal(certificateAsset.publicKeySha256, publicKeyPin);
const pinnedPreview = methods.get("proxyConsole:previewManagedSingBox")({ input: { id: "sb-pinned-test01", name: "Pinned Hysteria", machineId, protocol: "hysteria2", publicHost: "managed.example.com", port: 52076, password: "pinned-password", certificateAssetId: certificateAsset.id } });
assert.equal(new URL(pinnedPreview.clientUri).searchParams.get("pinSHA256"), certificatePin); assert(!new URL(pinnedPreview.clientUri).searchParams.has("insecure"));
const certInspect = methods.get("proxyConsole:prepareCertificateAction")({ action: "inspect", certificateId: certificateAsset.id, requestId: "request-certificate-inspect-01" });
state = methods.get("proxyConsole:recordCertificateResult")({ operationId: certInspect.operationId, result: { ok: true, status: "warning", fingerprintSha256: certificatePin, publicKeySha256: publicKeyPin, sans: ["managed.example.com"], expiresAt: "2026-10-01T00:00:00Z" } }).state;
assert.equal(state.certificates.find((item) => item.id === certificateAsset.id).status, "warning");
const managedDefaults = methods.get("proxyConsole:newManagedNowhereValues")();
assert(/^nw-[a-f0-9]{24}$/.test(managedDefaults.id)); assert(managedDefaults.key.length >= 24);
assert.equal(managedDefaults.version, "v2.0.0");
const managedInput = { ...managedDefaults, version: "v1.8.3", name: "托管 Nowhere", machineId, publicHost: "managed.example.com", listenHost: "127.0.0.1", port: 52077, client: "anywhere", network: "mix", tls: 1, pool: 0 };
const nowhereCertificatePreview = methods.get("proxyConsole:previewManagedNowhere")({ input: { ...managedInput, certificateAssetId: certificateAsset.id } });
assert.equal(nowhereCertificatePreview.certificate.mode, "existing");
assert.equal(nowhereCertificatePreview.certificate.certificatePath, "/etc/ssl/example.crt");
assert.equal(nowhereCertificatePreview.certificate.privateKeyPath, "/etc/ssl/example.key");
assert.throws(() => methods.get("proxyConsole:previewManagedNowhere")({ input: { ...managedInput, version: "v1.7.2" } }), /尚未通过/);
assert.throws(() => methods.get("proxyConsole:previewManagedNowhere")({ input: { ...managedInput, version: "v3.0.0" } }), /尚未通过/);
const managedPreview = methods.get("proxyConsole:previewManagedNowhere")({ input: managedInput });
assert.equal(managedPreview.summary.port, 52077); assert(managedPreview.links.anywhere[0].uri.startsWith("nowhere://")); assert(!JSON.stringify(managedPreview.summary).includes(managedDefaults.key));
const managedCreated = methods.get("proxyConsole:createManagedNowhereDraft")({ input: managedInput }); state = managedCreated.state;
assert.equal(state.managedInstances.at(-1).pool, 0, 'explicit zero pool must survive draft persistence');
assert.equal(state.managedInstances.at(-1).status, "draft"); assert(state.nodes.some((item) => item.id === state.managedInstances.at(-1).nodeId && item.protocol === "nowhere"));
const managedPreflight = methods.get("proxyConsole:prepareManagedNowhereAction")({ instanceId: managedDefaults.id, action: "preflight" });
assert.equal(managedPreflight.clientId, "test-client"); assert(!managedPreflight.command.includes("systemctl restart nowhere.service"));
const managedChecked = methods.get("proxyConsole:recordManagedNowhereResult")({ operationId: managedPreflight.operationId, result: { ok: true, portAvailable: true, binaryAvailable: true, existingNowhere: "active", existingSingBox: "active" } }); state = managedChecked.state;
assert.equal(state.managedInstances.find((item) => item.id === managedDefaults.id).status, "validated");
const managedCreate = methods.get("proxyConsole:prepareManagedNowhereAction")({ instanceId: managedDefaults.id, action: "create" });
assert(!managedCreate.command.includes("systemctl start"));
const managedInstalled = methods.get("proxyConsole:recordManagedNowhereResult")({ operationId: managedCreate.operationId, result: { ok: true, state: "stopped", existingNowhere: "active", existingSingBox: "active" } }); state = managedInstalled.state;
assert.equal(state.managedInstances.find((item) => item.id === managedDefaults.id).status, "stopped");
const currentPlan = require('../tools/managed-nowhere').planManagedNowhere(managedInput);
const configuration = Object.fromEntries(currentPlan.environment.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), JSON.parse(line.slice(i + 1))]; }));
const readSpec = methods.get('proxyConsole:prepareManagedNowhereAction')({ instanceId: managedDefaults.id, action: 'read-config' });
methods.get('proxyConsole:recordManagedNowhereResult')({ operationId: readSpec.operationId, result: { ok: true, configuration, configurationHash: require('crypto').createHash('sha256').update(currentPlan.environment).digest('hex') } });
const oldUri = state.nodes.find(item => item.id === state.managedInstances.find(item => item.id === managedDefaults.id).nodeId).uri;
const failedEdit = methods.get('proxyConsole:prepareManagedNowhereUpdate')({ instanceId: managedDefaults.id, readOperationId: readSpec.operationId, changes: { port: 53077 } });
state = methods.get('proxyConsole:recordManagedNowhereResult')({ operationId: failedEdit.operationId, result: { ok: false, error: 'update-failed', rolledBack: true } }).state;
assert(state.nodes.some(item => item.uri === oldUri), 'rollback preserves published link');
const edit = methods.get('proxyConsole:prepareManagedNowhereUpdate')({ instanceId: managedDefaults.id, readOperationId: readSpec.operationId, changes: { name: 'Renamed Nowhere', port: 53077 } });
const editedPlan = require('../tools/managed-nowhere').planManagedNowhere({ ...managedInput, name: 'Renamed Nowhere', port: 53077 });
state = methods.get('proxyConsole:recordManagedNowhereResult')({ operationId: edit.operationId, result: { ok: true, state: 'inactive', configurationHash: require('crypto').createHash('sha256').update(editedPlan.environment).digest('hex') } }).state;
assert.equal(state.managedInstances.find(item => item.id === managedDefaults.id).port, 53077);
assert.equal(state.managedInstances.find(item => item.id === managedDefaults.id).name, 'Renamed Nowhere');
assert.equal(state.nodes.find(item => item.id === state.managedInstances.find(item => item.id === managedDefaults.id).nodeId).name, 'Renamed Nowhere');
assert(state.nodes.some(item => item.uri === editedPlan.links.anywhere[0].uri), 'successful edit publishes new link');
assert.throws(() => methods.get("proxyConsole:prepareManagedNowhereAction")({ instanceId: managedDefaults.id, action: "upgrade", targetVersion: "v2.0.0" }), /迁移流程/);
const migrationPreview = methods.get("proxyConsole:previewManagedNowhereMigration")({ instanceId: managedDefaults.id, targetVersion: "v2.0.0" });
assert.equal(migrationPreview.from.capabilities.protocolGeneration, 1);
assert.equal(migrationPreview.to.capabilities.protocolGeneration, 2);
assert.equal(migrationPreview.wireCompatible, false);
const migrate = methods.get("proxyConsole:prepareManagedNowhereAction")({ instanceId: managedDefaults.id, action: "migrate-v2", targetVersion: "v2.0.0" });
assert.equal(migrate.plan.summary.tcpPort, 53077); assert.equal(migrate.plan.summary.udpPort, 53077);
assert(Buffer.from([...migrate.command.matchAll(/'([^']+)'/g)][1][1], "base64").toString().includes("V1 instance to V2"));
state = methods.get("proxyConsole:recordManagedNowhereResult")({ operationId: migrate.operationId, result: { ok: true, state: "inactive", version: "v2.0.0", backupDirectory: `/var/lib/proxy-console/instances/${managedDefaults.id}/migrations/fixture-v1-to-v2` } }).state;
let migratedInstance = state.managedInstances.find(item => item.id === managedDefaults.id);
assert.equal(migratedInstance.version, "v2.0.0"); assert.equal(migratedInstance.alpn, "nw2"); assert.equal(migratedInstance.migration.fromVersion, "v1.8.3");
assert(state.nodes.find(item => item.id === migratedInstance.nodeId).uri.includes("morph=0"));
const rollback = methods.get("proxyConsole:prepareManagedNowhereAction")({ instanceId: managedDefaults.id, action: "rollback-v1" });
assert(Buffer.from([...rollback.command.matchAll(/'([^']+)'/g)][1][1], "base64").toString().includes("V1 snapshot"));
state = methods.get("proxyConsole:recordManagedNowhereResult")({ operationId: rollback.operationId, result: { ok: true, state: "inactive", version: "v1.8.3", rolledBack: true } }).state;
migratedInstance = state.managedInstances.find(item => item.id === managedDefaults.id);
assert.equal(migratedInstance.version, "v1.8.3"); assert.equal(migratedInstance.migration, null); assert.equal(migratedInstance.port, 53077);
assert.equal(state.nodes.find(item => item.id === migratedInstance.nodeId).uri, editedPlan.links.anywhere[0].uri);
assert.throws(() => methods.get("proxyConsole:prepareManagedNowhereAction")({ instanceId: managedDefaults.id, action: "delete", confirmation: "wrong" }), /确认/);
const singDefaults = methods.get("proxyConsole:newManagedSingBoxValues")();
assert.equal(singDefaults.realityPrivateKey, ""); assert.equal(singDefaults.realityPublicKey, "");
const singInput = { ...singDefaults, realityPrivateKey: "A".repeat(43), realityPublicKey: "B".repeat(43), name: "托管 Reality", machineId, protocol: "vless-reality", publicHost: "managed.example.com", listenHost: "127.0.0.1", port: 52078, serverName: "apple.com", handshakeServer: "apple.com", handshakePort: 443, flow: "xtls-rprx-vision" };
const singPreview = methods.get("proxyConsole:previewManagedSingBox")({ input: singInput });
assert.equal(singPreview.summary.label, "VLESS Reality"); assert(singPreview.clientUri.startsWith("vless://")); assert(!JSON.stringify(singPreview.summary).includes(singInput.realityPrivateKey));
const singRequestId = "request-sing-create-0001";
const singCreate = methods.get("proxyConsole:prepareManagedSingBoxCreate")({ input: singInput, requestId: singRequestId });
assert.equal(singCreate.clientId, "test-client"); assert(!singCreate.command.includes("systemctl restart sing-box.service"));
const singDuplicateBeforeResult = methods.get("proxyConsole:prepareManagedSingBoxCreate")({ input: singInput, requestId: singRequestId });
assert.equal(singDuplicateBeforeResult.operationId, singCreate.operationId); assert.equal(singDuplicateBeforeResult.deduplicated, true); assert.equal(singDuplicateBeforeResult.command, "");
assert.throws(() => methods.get("proxyConsole:prepareManagedSingBoxCreate")({ input: { ...singInput, port: 52079 }, requestId: singRequestId }), /requestId/);
const singCreated = methods.get("proxyConsole:recordManagedSingBoxResult")({ operationId: singCreate.operationId, result: { ok: true, state: "stopped", kernelValid: true, binaryVersion: "sing-box version 1.12.0", existingSingBox: "active", existingNowhere: "active" } }); state = singCreated.state;
assert(state.managedInstances.some((item) => item.id === singDefaults.id && item.kind === "sing-box" && item.status === "stopped"));
const singFullPlan = require("../tools/managed-sing-box").planManagedSingBox(singInput);
const singConfigHash = require("crypto").createHash("sha256").update(singFullPlan.config).digest("hex");
const singRead = methods.get("proxyConsole:prepareManagedSingBoxAction")({ instanceId: singDefaults.id, action: "read-config", requestId: "request-sing-read-00001" });
methods.get("proxyConsole:recordManagedSingBoxResult")({ operationId: singRead.operationId, result: { ok: true, configuration: Buffer.from(singFullPlan.config).toString("base64"), configurationHash: singConfigHash, state: "inactive" } });
const singUpdate = methods.get("proxyConsole:prepareManagedSingBoxUpdate")({ instanceId: singDefaults.id, readOperationId: singRead.operationId, changes: { name: "Renamed sing-box", port: 52079 }, requestId: "request-sing-update-001" });
const singUpdatedPlan = require("../tools/managed-sing-box").planManagedSingBox({ ...singInput, port: 52079 });
state = methods.get("proxyConsole:recordManagedSingBoxResult")({ operationId: singUpdate.operationId, result: { ok: true, state: "inactive", configurationHash: require("crypto").createHash("sha256").update(singUpdatedPlan.config).digest("hex") } }).state;
assert.equal(state.managedInstances.find(item => item.id === singDefaults.id).port, 52079);
assert.equal(state.managedInstances.find(item => item.id === singDefaults.id).name, "Renamed sing-box");
assert.equal(Number(new URL(state.nodes.find(item => item.id === state.managedInstances.find(value => value.id === singDefaults.id).nodeId).uri).port), 52079);
const singDuplicateAfterResult = methods.get("proxyConsole:prepareManagedSingBoxCreate")({ input: singInput, requestId: singRequestId });
assert.equal(singDuplicateAfterResult.operationId, singCreate.operationId); assert.equal(singDuplicateAfterResult.deduplicated, true);
const singRepeated = methods.get("proxyConsole:recordManagedSingBoxResult")({ operationId: singCreate.operationId, result: { ok: true, state: "stopped" } });
assert.equal(singRepeated.state.revision, state.revision);
assert.equal(singRepeated.state.managedInstances.filter(item => item.id === singDefaults.id).length, 1);
assert(state.nodes.some((item) => item.machineId === machineId && item.protocol === "vless" && item.name === "Renamed sing-box"));
const singStart = methods.get("proxyConsole:prepareManagedSingBoxAction")({ instanceId: singDefaults.id, action: "start" });
const singStarted = methods.get("proxyConsole:recordManagedSingBoxResult")({ operationId: singStart.operationId, result: { ok: true, state: "active", existingSingBox: "active", existingNowhere: "active" } }); state = singStarted.state;
assert.equal(state.managedInstances.find((item) => item.id === singDefaults.id).status, "running");
const connectivitySpec = methods.get("proxyConsole:prepareConnectivityCheck")({ instanceId: singDefaults.id, sourceMachineId: machineId, requestId: "request-connectivity-001" });
assert.equal(connectivitySpec.clientId, "test-client");
const connectivityProbe = Buffer.from([...connectivitySpec.command.matchAll(/'([^']+)'/g)][1][1], "base64").toString();
assert(connectivityProbe.includes("PCCONNECT"));
assert(!connectivitySpec.command.includes("systemctl restart"));
const connectivityPayload = Buffer.from(JSON.stringify({ ok: true, https: true, exitIpMatches: null, actualIp: "192.0.2.18", clientVersion: "sing-box version 1.12.0" })).toString("base64");
const connectivitySaved = methods.get("proxyConsole:recordConnectivityCheck")({ instanceId: singDefaults.id, sourceMachineId: machineId, output: `PCCONNECT\t1\t${connectivityPayload}` }); state = connectivitySaved.state;
assert.equal(connectivitySaved.result.status, "passed");
assert.equal(connectivitySaved.result.sourceKind, "target");
assert.equal(state.managedInstances.find(item => item.id === singDefaults.id).connectivity.actualIp, "192.0.2.18");
assert.equal(state.nodes.find(item => item.id === state.managedInstances.find(item => item.id === singDefaults.id).nodeId).connectivity.status, "passed");
const genericProbe = methods.get("proxyConsole:prepareNodeConnectivityCheck")({ nodeId: vmess.id, sourceMachineId: machineId, requestId: "request-node-probe-0001" });
assert.equal(genericProbe.clientId, "test-client"); assert(!genericProbe.command.includes("systemctl restart"));
const genericSaved = methods.get("proxyConsole:recordNodeConnectivityCheck")({ nodeId: vmess.id, sourceMachineId: machineId, output: `PCCONNECT\t1\t${connectivityPayload}` }); state = genericSaved.state;
assert.equal(genericSaved.result.status, "passed"); assert(methods.get("proxyConsole:getConnectivityHistory")({ nodeIds: [vmess.id] }).some(item => item.nodeId === vmess.id));
const renamedNode = state.nodes.find(item => item.id === state.managedInstances.find(item => item.id === singDefaults.id).nodeId);
renamedNode.name = "🇯🇵 自定义托管名称";
state = methods.get("proxyConsole:saveState")({ state });
assert.equal(state.managedInstances.find(item => item.id === singDefaults.id).name, renamedNode.name);
assert.equal(state.managedInstances.find(item => item.id === singDefaults.id).status, "running");
assert.throws(() => methods.get("proxyConsole:prepareManagedSingBoxAction")({ instanceId: singDefaults.id, action: "delete", confirmation: "wrong" }), /确认/);
assert(!Object.hasOwn(state.subscriptions.find((item) => item.id === "test-mixed"), "includeFlags"));
assert.equal(state.nodes.find((node) => node.id === "legacy-encoded-name").name, "东京 · Nowhere");
assert(state.externalSources.some((source) => source.id === airportSource.id && source.machineId === ""));
assert(state.nodes.some((node) => node.id === airportNode.id && node.machineId === ""));
assert(state.nodes.some((node) => node.id === unassignedManualNode.id && node.machineId === ""), "manual nodes do not require a host");
assert.throws(() => methods.get("proxyConsole:saveState")({ state: { ...state, revision: 0 } }), /其他页面/);
assert(methods.get("proxyConsole:validateNode")({ protocol: "nowhere", uri: nowhere.uri }).valid);
assert.throws(() => methods.get("proxyConsole:validateNode")({ protocol: "nowhere", uri: "nowhere://key@example.com:1?up=bad" }), /udp/);
const parsed = methods.get("proxyConsole:parseNodeUris")({ text: `${nowhere.uri}\n${vmess.uri}\nnot-a-uri\n${nowhere.uri}` });
assert.equal(parsed.nodes.length, 2); assert.equal(parsed.errors.length, 1); assert.equal(parsed.nodes[0].name, "Old");
const httpParsed = methods.get("proxyConsole:parseNodeUris")({ text: "http://user:p%3Aa@proxy.example.com:8080#HTTP%20Proxy" });
assert.equal(httpParsed.errors.length, 0); assert.equal(httpParsed.nodes[0].protocol, "http");
assert.deepEqual(sandbox.parseNode(httpParsed.nodes[0]), { ...httpParsed.nodes[0], host: "proxy.example.com", port: 8080, username: "user", password: "p:a", tls: false });
const httpSub = { id: "http-sub", name: "HTTP", token: "e".repeat(48), nodeIds: ["http-node"], groups: [], enabled: true, policyMode: "proxy-all" };
const httpNode = { ...httpParsed.nodes[0], id: "http-node", enabled: true, machineId: "", tags: [], source: "provider" };
assert.match(sandbox.render([httpNode], httpSub, "mihomo").body, /type: http/);
assert.equal(JSON.parse(sandbox.render([httpNode], httpSub, "sing-box").body).outbounds[0].type, "http");
assert.match(sandbox.render([httpNode], httpSub, "surge").body, /HTTP Proxy = http, proxy\.example\.com, 8080/);
const opaqueInput = [
  "snell://secret@snell.example.com:443?version=4&obfs=http#Snell%20Original",
  "sudoku://opaque%2Fcredential@sudoku.example.com:443?future=%252Fkeep#Sudoku%20Original",
  "future-proxy://byte%2Fexact@example.com:8443?x=%2525&flag=%F0%9F%87%AF%F0%9F%87%B5#Future%20Original",
];
const opaqueParsed = methods.get("proxyConsole:parseNodeUris")({ text: opaqueInput.join("\n") });
assert.equal(opaqueParsed.errors.length, 0); assert.deepEqual(opaqueParsed.nodes.map((node) => node.uri), opaqueInput);
const opaqueNodes = opaqueParsed.nodes.map((node, index) => ({ ...node, id: `opaque-${index}`, name: `本地显示名 ${index + 1}`, machineId: "", enabled: true, tags: [], source: "import" }));
const opaqueSub = { id: "opaque-sub", name: "Opaque", token: "c".repeat(48), nodeIds: opaqueNodes.map((node) => node.id), groups: [], enabled: true, policyMode: "proxy-all" };
const opaqueOutputNodes = sandbox.uniqueNodes(opaqueSub, { machines: [], nodes: opaqueNodes });
assert.deepEqual(opaqueOutputNodes.map((node) => node.uri), opaqueInput, "opaque protocols must remain byte-for-byte unchanged even when display names differ");
assert.equal(sandbox.render(opaqueOutputNodes, opaqueSub, "raw").body, opaqueInput.join("\n") + "\n");
assert.equal(Buffer.from(sandbox.render(opaqueOutputNodes, opaqueSub, "anywhere").body, "base64").toString("utf8"), opaqueInput.join("\n") + "\n");
assert.equal(Buffer.from(sandbox.render(opaqueOutputNodes, opaqueSub, "loon").body, "base64").toString("utf8"), opaqueInput.join("\n") + "\n");
state.nodes.push(...opaqueNodes); state.subscriptions.push(opaqueSub); state = methods.get("proxyConsole:saveState")({ state });
const opaquePreflight = methods.get("proxyConsole:subscriptionPreflight")({ subscriptionId: opaqueSub.id });
assert.equal(opaquePreflight.formats.find((item) => item.format === "anywhere").included, 3);
assert.equal(opaquePreflight.formats.find((item) => item.format === "loon").included, 3);
assert.equal(opaquePreflight.formats.find((item) => item.format === "mihomo").skipped, 3);
assert.equal(opaquePreflight.formats.find((item) => item.format === "anywhere").nodes.find((node) => node.protocol === "sudoku").clientSupport, "native");
const clashYaml = `proxies:
  - { name: "🇯🇵 SS", type: ss, server: ss.example.com, port: 443, cipher: aes-128-gcm, password: "p:a ss" }
  - { name: "Trojan", type: trojan, server: tr.example.com, port: 443, password: secret, sni: edge.example.com }
  - { name: "SOCKS", type: socks5, server: socks.example.com, port: 1080, username: user, password: pass }
  - { name: "VLESS TLS", type: vless, server: vl.example.com, port: 443, uuid: 00000000-0000-4000-8000-000000000003, tls: true, servername: sni.example.com }
  - { name: "VMess TLS", type: vmess, server: vm.example.com, port: 443, uuid: 00000000-0000-4000-8000-000000000004, tls: true, servername: vm-sni.example.com }
  - { name: "不完整传输", type: vless, server: bad.example.com, port: 443, uuid: 00000000-0000-4000-8000-000000000005, network: grpc }
`;
const clashParsed = methods.get("proxyConsole:parseNodeUris")({ text: clashYaml });
assert.equal(clashParsed.nodes.length, 5); assert.equal(clashParsed.errors.length, 1); assert.match(clashParsed.errors[0].message, /grpc/);
const encodedClashParsed = methods.get("proxyConsole:parseNodeUris")({ text: Buffer.from(clashYaml).toString("base64") });
assert.equal(encodedClashParsed.nodes.length, 5, "Base64-wrapped Clash YAML should parse");
const importedNodes = clashParsed.nodes.map((node, index) => ({ ...node, id: `clash-${index}`, machineId, enabled: true }));
const importedSub = { id: "clash-sub", name: "Clash", token: "b".repeat(48), nodeIds: importedNodes.map((node) => node.id), groups: [], enabled: true, policyMode: "proxy-all" };
const importedMihomo = sandbox.renderMihomo(sandbox.uniqueNodes(importedSub, { ...state, nodes: [...state.nodes, ...importedNodes] }), importedSub);
assert(importedMihomo.includes('name: "🇯🇵 SS"')); assert(importedMihomo.includes("cipher: \"aes-128-gcm\"")); assert(importedMihomo.includes("servername: \"sni.example.com\"")); assert(importedMihomo.includes("servername: \"vm-sni.example.com\""));
assert.equal(sandbox.parseNode({ protocol: "vless", uri: "vless://id@example.com:443?type=ws&path=%252Fkeep" }).path, "%2Fkeep", "query parameters must not be decoded twice");
const wsWithoutHost = sandbox.singBoxOutbound({ protocol: "vless", name: "WS no host", uri: "vless://00000000-0000-4000-8000-000000000099@example.com:443?type=ws&path=%2Fws" });
assert.equal(wsWithoutHost.transport.type, "ws");
assert(!Object.hasOwn(wsWithoutHost.transport, "headers"), "sing-box WebSocket outbound must omit an empty Host header");
assert.equal(sandbox.parseNode({ protocol: "ss", uri: "ss://aes-128-gcm:p%3Aa%20ss@example.com:443#test" }).password, "p:a ss", "plain SIP002 userinfo should retain password punctuation");
const ipv6Node = { ...androidNode, name: "IPv6", uri: "vless://id@[2001:db8::1]:443?security=tls" };
assert.equal(sandbox.parseNode(ipv6Node).host, "2001:db8::1");
sandbox.validateGeneratedOutput("mihomo", sandbox.renderMihomo([ipv6Node], { groups: [] }));
assert.throws(() => sandbox.validateGeneratedOutput("mihomo", "password: [secret"), (error) => !error.message.includes("secret") && /隐藏/.test(error.message));
const reordered = sandbox.uniqueNodes({ ...importedSub, nodeIds: [importedNodes[2].id, importedNodes[0].id] }, { ...state, nodes: [...state.nodes, ...importedNodes] });
assert.deepEqual(reordered.map((node) => node.id), [importedNodes[2].id, importedNodes[0].id], "subscription drag order must drive output order");
const grpcNode = { id: "grpc", name: "gRPC 保真检查", protocol: "vless", machineId, uri: "vless://00000000-0000-4000-8000-000000000006@example.com:443?security=tls&type=grpc#grpc", enabled: true };
assert(methods.get("proxyConsole:validateNode")({ protocol: "vless", uri: grpcNode.uri }).valid, "raw URI storage may retain transports not handled by exporters");
assert.equal(sandbox.canRenderNode("mihomo", grpcNode), false); assert(!sandbox.renderMihomo([grpcNode], { ...importedSub, nodeIds: [grpcNode.id] }).includes(grpcNode.name));
for (const name of ["中文 空格", "A#B", "A%B", "A%20B"]) {
  const rewritten = sandbox.rewriteNodeName({ ...nowhere, name });
  assert.equal(decodeURIComponent(new URL(rewritten).hash.slice(1)), name, `fragment should round-trip: ${name}`);
}
const duplicateVmess = "vmess://" + Buffer.from(JSON.stringify({ ...vmessValue, ps: "Another name" })).toString("base64");
assert.equal(methods.get("proxyConsole:parseNodeUris")({ text: `${vmess.uri}\n${duplicateVmess}` }).nodes.length, 1);

state.ruleSets.push({ id: "cached-rules", name: "缓存规则", url: "https://example.com/rules.txt", action: "direct", enabled: true, version: "abc123", entryCount: 1, lastSuccessAt: new Date().toISOString() });
state.subscriptions.find((item) => item.id === "test-mixed").ruleSetIds = ["cached-rules"];
state.subscriptions.find((item) => item.id === "test-mixed").devices = [{ id: "device-ios", name: "iPhone", client: "anywhere-ios" }];
state = methods.get("proxyConsole:saveState")({ state });
fs.writeFileSync(path.join(storage, "rule-set-cache.json"), JSON.stringify({ "cached-rules": { version: "abc123", fetchedAt: new Date().toISOString(), rules: [{ id: "cached-1", type: "domain-suffix", value: "cached.example", action: "direct" }] } }));
const preview = methods.get("proxyConsole:previewSubscriptionChange")({ subscription: { ...state.subscriptions.find((item) => item.id === "test-mixed"), name: "Mixed changed", nodeIds: [vmess.id] } });
assert(preview.changed); assert(preview.fields.some((item) => item.startsWith("名称："))); assert(preview.removedNodes.length >= 1);

function requestDetailed(format = "", userAgent = "") {
  const sub = state.subscriptions.find((s) => s.id === "test-mixed"); let result = "";
  const response = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { result += v || ""; } };
  const query = format ? { format } : {};
  routes.get("GET /proxy/sub/:token")({ url: `/proxy/sub/${sub.token}${format ? `?format=${format}` : ""}`, query, headers: { "user-agent": userAgent } }, response);
  assert.equal(response.statusCode, 200); assert(result.length > 10); return { body: result, headers: response.headers };
}
function request(format = "", userAgent = "") { return requestDetailed(format, userAgent).body; }

const raw = request("raw");
assert(raw.includes("nowhere://")); assert(raw.includes(encodeURIComponent(nowhere.name))); assert(!raw.includes(encodeURIComponent(encodeURIComponent(nowhere.name)))); assert(!raw.includes("#Old"));
assert.equal(decodeURIComponent(new URL(raw.split("\n").find((line) => line.startsWith("vless://"))).hash.slice(1)), androidNode.name);
assert.equal(decodeURIComponent(new URL(raw.split("\n").find((line) => line.startsWith("nowhere://"))).hash.slice(1)), nowhere.name);
const base64 = Buffer.from(request("base64"), "base64").toString(); assert(base64.includes("nowhere://"));
const anywhere = Buffer.from(request("", "Anywhere/1.0"), "base64").toString(); assert(anywhere.includes("nowhere://"));
const vmessLine = raw.split("\n").find((line) => line.startsWith("vmess://"));
assert.equal(JSON.parse(Buffer.from(vmessLine.slice(8), "base64").toString()).ps, vmess.name);
const mihomo = request("mihomo"); assert(!mihomo.includes(nowhere.name)); assert(mihomo.includes(vmess.name)); assert(mihomo.includes('name: "自动测速"')); assert(mihomo.includes("type: url-test"));
assert(mihomo.includes("DOMAIN-SUFFIX,cached.example,DIRECT"), "successful rule-set cache participates in generated subscriptions");
const androidYaml = request("mihomo", "Anywhere");
assert.equal(androidYaml, mihomo, "explicit Android QR format must override Anywhere UA detection");
assert(androidYaml.includes("proxies:"));
assert(androidYaml.includes(`name: ${JSON.stringify(androidNode.name)}`), "YAML names retain Unicode, flags and literal punctuation");
assert(!androidYaml.includes(encodeURIComponent(androidNode.name)), "Android YAML should not percent-encode display names");
const singbox = JSON.parse(request("sing-box")); assert(!singbox.outbounds.some((o) => o.tag === nowhere.name)); assert(singbox.outbounds.some((o) => o.tag === vmess.name)); assert(singbox.outbounds.some((o) => o.tag === "自动测速" && o.type === "urltest"));
const surge = request("surge"); assert(!surge.includes(nowhere.name)); assert(surge.includes("自动测速 = url-test"));
const emptyBranchSub = { ...state.subscriptions.find((item) => item.id === "test-mixed"), groups: [
  { id: "empty-parent", name: "空父组", type: "select", entries: [{ kind: "group", id: "empty-child" }] },
  { id: "empty-child", name: "仅 Nowhere", type: "select", entries: [{ kind: "node", id: nowhere.id }] },
  { id: "valid", name: "有效出口", type: "select", entries: [{ kind: "node", id: vmess.id }, { kind: "group", id: "empty-parent" }] },
] };
const branchNodes = sandbox.uniqueNodes(emptyBranchSub, state);
for (const format of ["mihomo", "sing-box"]) { const output = sandbox.render(branchNodes, emptyBranchSub, format).body; assert(!output.includes("空父组")); assert(!output.includes("仅 Nowhere")); sandbox.validateGeneratedOutput(format, output); }
assert(sandbox.renderSurge(branchNodes, emptyBranchSub).endsWith("FINAL,有效出口\n"), "Surge final policy must target an actually emitted group");
assert.throws(() => sandbox.validateGeneratedOutput("sing-box", JSON.stringify({ outbounds: [{ type: "selector", tag: "PROXY", outbounds: ["missing"] }] })), /引用/);
assert.throws(() => sandbox.validateGeneratedOutput("mihomo", 'proxies: []\nproxy-groups:\n  - name: PROXY\n    proxies: []\n'), /空代理组/);
const policySub = { ...state.subscriptions.find((item) => item.id === "test-mixed"), policyMode: "private-direct" }; const policyNodes = sandbox.uniqueNodes(policySub, state);
assert(sandbox.renderMihomo(policyNodes, policySub).includes("GEOSITE,private,DIRECT")); assert(sandbox.renderSurge(policyNodes, policySub).includes("10.0.0.0/8,DIRECT")); assert(JSON.parse(sandbox.renderSingBox(policyNodes, policySub)).route.rules.some((rule) => rule.ip_is_private));
const cnSub = { ...policySub, policyMode: "cn-direct" }; assert(sandbox.renderMihomo(policyNodes, cnSub).includes("GEOIP,CN,DIRECT")); assert(sandbox.renderSurge(policyNodes, cnSub).includes("GEOIP,CN,DIRECT")); assert.throws(() => sandbox.renderSingBox(policyNodes, cnSub), /显式规则/);
const customRules = [
  { id: "r1", type: "domain-suffix", value: ".Example.COM.", action: "proxy" },
  { id: "r2", type: "domain-keyword", value: "ads", action: "reject" },
  { id: "r3", type: "ip-cidr", value: "192.168.0.0/16", action: "direct" },
  { id: "r4", type: "ip-cidr", value: "fc00::/7", action: "direct" },
];
const customSub = { ...policySub, customRules };
const mhRules = require("js-yaml").load(sandbox.renderMihomo(policyNodes, customSub)).rules;
assert(mhRules[0].startsWith("DOMAIN-SUFFIX,example.com,"));
assert.equal(mhRules[1], "DOMAIN-KEYWORD,ads,REJECT");
assert.equal(mhRules[3], "IP-CIDR6,fc00::/7,DIRECT,no-resolve");
assert(mhRules[4].startsWith("GEOSITE,private")); assert(mhRules.at(-1).startsWith("MATCH,"));
const sbRules = JSON.parse(sandbox.renderSingBox(policyNodes, customSub)).route.rules;
assert.deepEqual(sbRules[0].domain_suffix, ["example.com"]); assert.equal(sbRules[0].action, "route");
assert.equal(sbRules[1].action, "reject"); assert(!sbRules[1].outbound);
assert.deepEqual(sbRules[3].ip_cidr, ["fc00::/7"]); assert.equal(sbRules[4].ip_is_private, true);
const sgRules = sandbox.renderSurge(policyNodes, customSub).split("[Rule]\n")[1];
assert(sgRules.startsWith("DOMAIN-SUFFIX,example.com,")); assert(sgRules.includes("IP-CIDR6,fc00::/7,DIRECT,no-resolve"));
assert.equal(sandbox.subscriptionSnapshot(customSub).customRules.length, 4);
const cleanedRuleState = sandbox.cleanState({ ...state, subscriptions: [customSub] });
assert.equal(cleanedRuleState.subscriptions[0].customRules[0].value, "example.com");
const policyPreview = methods.get("proxyConsole:previewPolicy")({ customRules, policyMode: "private-direct" });
assert.equal(policyPreview.formats.length, 3); assert(policyPreview.formats.every((item) => item.content.includes("example.com")));
assert(!JSON.stringify(policyPreview).includes("sample-key"));
for (const rule of [
  { type: "domain-suffix", value: "https://example.com", action: "proxy" },
  { type: "domain-suffix", value: "example.com,DIRECT", action: "proxy" },
  { type: "domain-keyword", value: "", action: "reject" },
  { type: "ip-cidr", value: "999.0.0.0/8", action: "direct" },
  { type: "ip-cidr", value: "192.168.0.0/33", action: "direct" },
  { type: "ip-cidr", value: "fc00::/129", action: "direct" },
  { type: "domain-suffix", value: "example.com", action: "unknown" },
]) assert.throws(() => sandbox.cleanCustomRules([rule]), /第 1 条规则/);
assert.throws(() => sandbox.cleanCustomRules(Array(201).fill(customRules[0])), /200/);
assert.deepEqual(sandbox.cleanCustomRules(undefined), []);
const preflight = methods.get("proxyConsole:subscriptionPreflight")({ subscriptionId: "test-mixed" }); assert.equal(preflight.formats.length, 5); assert(preflight.formats.every((item) => item.bytes > 0)); assert(preflight.formats.find((item) => item.format === "mihomo").skipped >= 1); assert.equal(preflight.formats.find((item) => item.format === "loon").skipped, 0); assert(!JSON.stringify(preflight).includes("sample-key"));
for (const result of preflight.formats) {
  assert.equal(result.nodes.filter((node) => node.included).length, result.included);
  assert.equal(result.nodes.filter((node) => !node.included).length, result.skipped);
  assert(result.nodes.every((node) => !node.uri && !node.token && typeof node.name === "string"));
  assert(result.nodes.filter((node) => !node.included).every((node) => node.reason));
}
const stats = methods.get("proxyConsole:getAccessStats")(); assert(stats["test-mixed"].total >= 7); assert(stats["test-mixed"].formats.mihomo >= 2); assert(!JSON.stringify(stats).includes("Anywhere/1.0")); assert(!JSON.stringify(stats).includes("a".repeat(48)));

const cyclic = JSON.parse(JSON.stringify(state)); cyclic.subscriptions[0].groups = [
  { id: "a", name: "A", type: "select", entries: [{ kind: "group", id: "b" }] },
  { id: "b", name: "B", type: "select", entries: [{ kind: "group", id: "a" }] },
];
assert.throws(() => methods.get("proxyConsole:saveState")({ state: cyclic }), /循环引用/);

const token = methods.get("proxyConsole:newToken")().token; assert(/^[a-f0-9]{48}$/.test(token));
let quotaState = JSON.parse(JSON.stringify(methods.get("proxyConsole:getState")()));
quotaState.subscriptions.find((item) => item.id === "test-mixed").quota = { mode: "manual", upload: 1073741824, download: 2147483648, total: 10737418240, expire: 0, sourceId: "", clientId: "" };
state = methods.get("proxyConsole:saveState")({ state: quotaState });
const quotaResponse = requestDetailed("raw");
assert.equal(quotaResponse.headers["Subscription-Userinfo"], "upload=1073741824; download=2147483648; total=10737418240; expire=0");
const quotaHistory = methods.get("proxyConsole:getSubscriptionHistory")({ subscriptionId: "test-mixed" });
assert(quotaHistory.length && quotaHistory.every((entry) => entry.snapshot.quota && entry.snapshot.quota.mode), "subscription history must preserve quota snapshots");
const quotaPreview = methods.get("proxyConsole:previewSubscriptionChange")({ subscription: { ...state.subscriptions.find((item) => item.id === "test-mixed"), quota: { mode: "none" } } });
assert(quotaPreview.fields.some((item) => item.startsWith("流量额度：")), "subscription change preview must disclose quota changes");
const exhaustedInput = JSON.parse(JSON.stringify(state)); exhaustedInput.subscriptions.find((item) => item.id === "test-mixed").quota.download = 9663676416;
const exhaustedState = methods.get("proxyConsole:saveState")({ state: exhaustedInput });
let exhaustedStatus = 0; routes.get("GET /proxy/sub/:token")({ url: `/proxy/sub/${"a".repeat(48)}`, query: {}, headers: {} }, { statusCode: 200, headers: {}, setHeader() {}, end() { exhaustedStatus = this.statusCode; } }); assert.equal(exhaustedStatus, 404); assert(exhaustedState.nodes.some((item) => item.id === nowhere.id && item.enabled), "quota exhaustion must not disable nodes");
state = methods.get("proxyConsole:getState")();
const status = methods.get("proxyConsole:statusCommand")(); assert(status.command.includes("python3 -c")); assert(status.command.includes("base64 -d"));
const expiringState = JSON.parse(JSON.stringify(methods.get("proxyConsole:getState")())); expiringState.subscriptions.find((item) => item.id === "test-mixed").expiresAt = "2020-01-01T00:00:00.000Z"; const expiredState = methods.get("proxyConsole:saveState")({ state: expiringState });
let expiredStatus = 0; routes.get("GET /proxy/sub/:token")({ url: `/proxy/sub/${"a".repeat(48)}`, query: {}, headers: {} }, { statusCode: 200, headers: {}, setHeader() {}, end() { expiredStatus = this.statusCode; } }); assert.equal(expiredStatus, 404); assert(expiredState.subscriptions.find((item) => item.id === "test-mixed").expiresAt);
const history = methods.get("proxyConsole:getSubscriptionHistory")({ subscriptionId: "test-mixed" }); assert(history.length >= 1); assert(history.some((entry) => entry.snapshot.expiresAt === "")); assert(!Object.hasOwn(history[0].snapshot, "token")); assert(!JSON.stringify(history).includes("sample-key"));
const service = methods.get("proxyConsole:serviceCommand"); assert.equal(service({ service: "nowhere", action: "restart" }).command, "/usr/bin/systemctl restart nowhere.service"); assert.throws(() => service({ service: "ssh", action: "restart" })); assert.throws(() => service({ service: "sing-box", action: "cat /etc/shadow" }));
const exactUri = 'vless://id@EXAMPLE.com:443?type=ws&path=%2fkeep&future=%2b%20#old';
assert.equal(sandbox.rewriteNodeName({ protocol: 'vless', uri: exactUri, name: 'New' }), exactUri.split('#')[0] + '#New');
assert.equal(sandbox.render([{ protocol: 'vless', uri: exactUri }], {}, 'raw').body, exactUri + '\n');
for (const format of ['mihomo', 'sing-box', 'surge']) assert.equal(sandbox.canRenderNode(format, { protocol: 'vless', uri: exactUri }), false);
assert.equal(sandbox.parseNode({ protocol: 'https', uri: 'https://user:pass@example.com:443' }).port, 443);
assert.match(sandbox.renderSurge([vmess], { groups: [] }), /skip-cert-verify=false/);
assert.throws(() => sandbox.validateGeneratedOutput('surge', '[Proxy]\nA = http, example.com, 80\n[Proxy Group]\nA = select, A\n[Rule]\nFINAL,A\n'), /名称重复/);
const cycleGroups = [{ id: 'a', name: 'A', type: 'select', entries: [{ kind: 'node', id: vmess.id }, { kind: 'group', id: 'b' }] }, { id: 'b', name: 'B', type: 'select', entries: [{ kind: 'group', id: 'a' }] }];
assert.throws(() => sandbox.render([vmess], { groups: cycleGroups }, 'mihomo'), /循环/);
assert.throws(() => sandbox.render([vmess], { groups: [{ id: 'a', name: 'A', type: 'fallback', entries: [{ kind: 'node', id: vmess.id }] }] }, 'sing-box'), /代理组类型/);
assert.equal(sandbox.parseNodeUris({ text: 'sudoku://' + 'x'.repeat(8192) }).errors.length, 1);
console.log("plugin tests passed");
