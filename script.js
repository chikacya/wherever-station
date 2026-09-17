const server = require("server");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("node:url");
const yaml = require("js-yaml");
const { isIP } = require("net");
const { cleanManagedState, planManagedNowhere } = require(path.join(__dirname, "tools/managed-nowhere"));
const { compatibilityCatalog, nowhereCapabilities } = require(path.join(__dirname, "tools/nowhere-capabilities"));
const { CONVERTED_PROTOCOLS, NAME_REWRITE_PROTOCOLS, SEMANTIC_PROTOCOLS, protocolCapability, protocolCatalog } = require(path.join(__dirname, "tools/protocol-capabilities"));
const { assertConversion, assertClashFields } = require(path.join(__dirname, "tools/conversion-contract"));
const { buildManagedNowhereCommand } = require(path.join(__dirname, "tools/managed-nowhere-remote"));
const { planManagedSingBox, randomCredentials: randomSingBoxCredentials } = require(path.join(__dirname, "tools/managed-sing-box"));
const { buildManagedSingBoxCommand } = require(path.join(__dirname, "tools/managed-sing-box-remote"));
const { managedSingBoxInput } = require(path.join(__dirname, "tools/managed-sing-box-config"));
const { buildCertificateCommand, certificateId: newCertificateId, planCertificateAsset } = require(path.join(__dirname, "tools/certificate-manager"));
const { operationStore } = require(path.join(__dirname, "tools/operation-store"));
const { managedTaskTracker } = require(path.join(__dirname, "tools/managed-task-tracker"));
const { decodeNowhereConfig } = require(path.join(__dirname, "tools/nowhere-config"));
const { buildInstanceStatus, buildServiceStatus } = require(path.join(__dirname, "tools/instance-status"));
const { buildConnectivityCommand, parseConnectivityOutput } = require(path.join(__dirname, "tools/connectivity-check"));
const { createSuiProvider, normalizeSuiBaseUrl } = require(path.join(__dirname, "tools/provider-s-ui"));
const { buildExistingServiceDiscoveryCommand, parseExistingServiceDiscoveryOutput } = require(path.join(__dirname, "tools/existing-service-discovery"));
const { parseRuleSetText } = require(path.join(__dirname, "tools/rule-set"));
const STATUS_CACHE = require(path.join(__dirname, "tools/instance-status-cache")).instanceStatusCache();
const PROVIDER_OPERATIONS = new Map();
const SOURCE_OPERATIONS = new Map();

const STATE_FILE = path.join(__storageDir__, "state.json");
const ACCESS_FILE = path.join(__storageDir__, "subscription-access.json");
const SUBSCRIPTION_HISTORY_FILE = path.join(__storageDir__, "subscription-history.json");
const PROVIDER_SECRETS_FILE = path.join(__storageDir__, "provider-secrets.json");
const RULE_SET_CACHE_FILE = path.join(__storageDir__, "rule-set-cache.json");
const CONNECTIVITY_HISTORY_FILE = path.join(__storageDir__, "connectivity-history.json");
const SERVICE_UNITS = Object.freeze({ "sing-box": "sing-box.service", nowhere: "nowhere.service" });
const SERVICE_ACTIONS = new Set(["start", "stop", "restart"]);
const GROUP_TYPES = new Set(["select", "url-test", "fallback", "load-balance"]);
const POLICY_MODES = new Set(["proxy-all", "private-direct", "cn-direct"]);
const SUPPORT = Object.freeze(Object.fromEntries(Object.entries(CONVERTED_PROTOCOLS).map(([format, protocols]) => [format, new Set(protocols)])));
const SEMANTIC_PROTOCOL_SET = new Set(SEMANTIC_PROTOCOLS);
const NAME_REWRITE_PROTOCOL_SET = new Set(NAME_REWRITE_PROTOCOLS);
const DEFAULT_TEST_URL = "https://www.gstatic.com/generate_204";
const SING_BOX_PROTOCOLS = new Set(["vless-reality", "vmess", "shadowsocks", "trojan", "hysteria2", "tuic", "anytls"]);
const DEFAULT_DEPLOYMENT_PRESETS = Object.freeze([
  { id: "builtin-vless-reality", name: "VLESS Reality", suffix: "Reality", tier: "recommended", summary: "无需自有域名或 PEM 证书；Reality 仍使用 TLS 握手、密钥与 SNI", badges: [], origin: "builtin", hidden: false, values: { protocol: "vless-reality", serverName: "www.apple.com", handshakeServer: "www.apple.com", handshakePort: 443, flow: "xtls-rprx-vision" } },
  { id: "builtin-shadowsocks", name: "Shadowsocks 2022", suffix: "SS 2022", tier: "recommended", summary: "TCP/UDP · 无 TLS 证书参数", badges: [], origin: "builtin", hidden: false, values: { protocol: "shadowsocks", method: "2022-blake3-aes-128-gcm" } },
  { id: "builtin-hysteria2", name: "Hysteria2", suffix: "Hysteria2", tier: "recommended", summary: "UDP · 需要可信证书或客户端明确接受私有自签证书", badges: [], origin: "builtin", hidden: false, values: { protocol: "hysteria2", certificateMode: "self-signed" } },
  { id: "builtin-anytls", name: "AnyTLS", suffix: "AnyTLS", tier: "advanced", summary: "TLS over TCP · 需要可信证书或客户端明确接受私有自签证书", badges: [], origin: "builtin", hidden: false, values: { protocol: "anytls", certificateMode: "self-signed" } },
  { id: "builtin-tuic", name: "TUIC", suffix: "TUIC", tier: "advanced", summary: "QUIC/UDP · 需要可信证书或客户端明确接受私有自签证书", badges: [], origin: "builtin", hidden: false, values: { protocol: "tuic", certificateMode: "self-signed" } },
  { id: "builtin-trojan", name: "Trojan TLS", suffix: "Trojan", tier: "advanced", summary: "TLS over TCP · 需要可信证书或客户端明确接受私有自签证书", badges: [], origin: "builtin", hidden: false, values: { protocol: "trojan", certificateMode: "self-signed" } },
  { id: "builtin-vmess", name: "VMess WebSocket", suffix: "VMess WS", tier: "advanced", summary: "WebSocket 兼容模板 · 不自动配置反向代理或可信证书", badges: [], origin: "builtin", hidden: false, values: { protocol: "vmess", transport: "ws", wsPath: "/" } },
]);
const MANAGED_OPERATIONS = operationStore(path.join(__storageDir__, "nowhere-operations.json"));
const MANAGED_SINGBOX_OPERATIONS = operationStore(path.join(__storageDir__, "singbox-operations.json"));
const CERTIFICATE_OPERATIONS = operationStore(path.join(__storageDir__, "certificate-operations.json"));
const MANAGED_OPERATION_TTL_MS = 24 * 60 * 60 * 1000;
const MANAGED_TASKS = managedTaskTracker({
  store: operationStore(path.join(__storageDir__, "managed-tasks.json")),
  call: (method, params) => server.call(method, params),
  complete: (kind, operationId, result) => kind === "nowhere"
    ? recordManagedNowhereResult({ operationId, result })
    : kind === "certificate"
      ? recordCertificateResult({ operationId, result })
      : recordManagedSingBoxResult({ operationId, result }),
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanText(value, max = 160) { return String(value == null ? "" : value).trim().slice(0, max); }
function cleanTags(value) { return Array.isArray(value) ? [...new Set(value.map((x) => cleanText(x, 32)).filter(Boolean))].slice(0, 20) : []; }
function cleanByteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number)) : 0;
}
function cleanTrafficPlan(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const limitBytes = cleanByteCount(input.limitBytes);
  const accounting = ["sum", "max", "up", "down"].includes(input.accounting) ? input.accounting : "sum";
  const resetDay = Math.min(31, Math.max(1, Math.floor(Number(input.resetDay) || 1)));
  let warningLevels = Array.isArray(input.warningLevels) ? input.warningLevels.map((item) => Math.min(100, Math.max(1, Math.round(Number(item) || 0)))).sort((a, b) => a - b) : [];
  if (warningLevels.length !== 3 || new Set(warningLevels).size !== 3) warningLevels = [70, 90, 100];
  return { enabled: input.enabled === true && limitBytes > 0, limitBytes, accounting, resetDay, warningLevels };
}
function cleanTrafficMetadata(value) {
  if (!value || typeof value !== "object") return null;
  const traffic = {
    upload: cleanByteCount(value.upload),
    download: cleanByteCount(value.download),
    total: cleanByteCount(value.total),
    expire: cleanByteCount(value.expire),
    observedAt: /^\d{4}-\d\d-\d\dT/.test(String(value.observedAt || "")) ? String(value.observedAt) : "",
  };
  return traffic.upload || traffic.download || traffic.total || traffic.expire ? traffic : null;
}
function parseSubscriptionUserinfo(value, observedAt = new Date().toISOString()) {
  const fields = {};
  for (const part of String(value || "").split(";")) {
    const match = part.trim().match(/^([a-z]+)\s*=\s*(\d+)$/i);
    if (match && ["upload", "download", "total", "expire"].includes(match[1].toLowerCase())) fields[match[1].toLowerCase()] = cleanByteCount(match[2]);
  }
  return cleanTrafficMetadata({ ...fields, observedAt });
}
function randomId() { return crypto.randomBytes(12).toString("hex"); }
function requestOperationId(params) {
  const requestId = cleanText(params && params.requestId, 128);
  if (!requestId) return randomId();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error("requestId 格式无效");
  return crypto.createHash("sha256").update("proxy-console-request:" + requestId).digest("hex").slice(0, 24);
}
function retainOperation(store, operationId, pending) {
  const existing = store.get(operationId);
  if (existing) {
    if (existing.action !== pending.action || existing.instanceId !== pending.instanceId || existing.machineId !== pending.machineId) throw new Error("requestId 已用于其他操作");
    return existing;
  }
  store.set(operationId, pending);
  return pending;
}
function cleanCustomRules(input, limit = 200) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > limit) throw new Error(`规则最多 ${limit} 条`);
  return input.map((item, index) => {
    const type = item && item.type; const action = item && item.action; let value = String(item && item.value || "").trim();
    const invalid = (message) => { throw new Error(`第 ${index + 1} 条规则：${message}`); };
    if (!["domain-suffix", "domain-keyword", "ip-cidr"].includes(type)) invalid("不支持的匹配条件");
    if (!["proxy", "direct", "reject"].includes(action)) invalid("请选择代理、直连或拒绝");
    if (!value || value.length > 253 || /[\s,#;\r\n]/.test(value)) invalid("匹配值不能为空，也不能包含空白或规则分隔符");
    if (type === "domain-suffix") {
      value = value.replace(/^\./, "").replace(/\.$/, "").toLowerCase();
      if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) || value.split(".").some((label) => label.length > 63)) invalid("请输入域名，如 example.com；不含协议、路径或通配符");
    } else if (type === "domain-keyword") {
      value = value.toLowerCase(); if (!/^[a-z0-9._-]+$/.test(value)) invalid("关键词只支持字母、数字、点、下划线和连字符");
    } else {
      const parts = value.split("/"); const family = isIP(parts[0]);
      if (parts.length !== 2 || !family || !/^\d{1,3}$/.test(parts[1]) || Number(parts[1]) > (family === 4 ? 32 : 128)) invalid("请输入有效 IPv4/IPv6 CIDR，如 192.168.0.0/16 或 fc00::/7");
    }
    return { id: cleanText(item.id, 64) || `rule-${index + 1}`, type, value, action };
  });
}
function policyRules(format, subscription, finalGroup) {
  const custom = [...cleanCustomRules(subscription.customRules), ...cleanCustomRules(subscription.cachedRules || [], 5000)];
  if (format === "sing-box") {
    const rules = custom.map((rule) => ({ [rule.type.replaceAll("-", "_")]: [rule.value], ...(rule.action === "reject" ? { action: "reject" } : { action: "route", outbound: rule.action === "direct" ? "DIRECT" : finalGroup }) }));
    if (subscription.policyMode === "private-direct") rules.push({ ip_is_private: true, action: "route", outbound: "DIRECT" });
    return rules;
  }
  const rules = custom.map((rule) => `${rule.type === "ip-cidr" && rule.value.includes(":") ? "IP-CIDR6" : rule.type.toUpperCase()},${rule.value},${rule.action === "proxy" ? finalGroup : rule.action.toUpperCase()}${rule.type === "ip-cidr" ? ",no-resolve" : ""}`);
  if (subscription.policyMode === "private-direct") rules.push(...(format === "mihomo" ? ["GEOSITE,private,DIRECT", "GEOIP,private,DIRECT,no-resolve"] : ["IP-CIDR,10.0.0.0/8,DIRECT,no-resolve", "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve", "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve"]));
  if (subscription.policyMode === "cn-direct") rules.push(...(format === "mihomo" ? ["GEOSITE,cn,DIRECT", "GEOIP,CN,DIRECT,no-resolve"] : ["GEOIP,CN,DIRECT,no-resolve"]));
  rules.push(`${format === "mihomo" ? "MATCH" : "FINAL"},${finalGroup}`);
  return rules;
}
function previewPolicy(params) {
  const subscription = { policyMode: POLICY_MODES.has(params && params.policyMode) ? params.policyMode : "proxy-all", customRules: cleanCustomRules(params && params.customRules) };
  return { formats: ["mihomo", "sing-box", "surge"].map((format) => ({ format, content: format === "sing-box" ? JSON.stringify({ rules: policyRules(format, subscription, "默认代理组"), final: "默认代理组" }, null, 2) : policyRules(format, subscription, "默认代理组").join("\n") })) };
}
function cleanDeploymentPreset(item) {
  const values = item && item.values && typeof item.values === "object" ? item.values : {};
  const protocol = SING_BOX_PROTOCOLS.has(values.protocol) ? values.protocol : "";
  if (!protocol) return null;
  const cleanedValues = { protocol };
  if (protocol === "vless-reality") Object.assign(cleanedValues, { serverName: cleanText(values.serverName, 253) || "www.apple.com", handshakeServer: cleanText(values.handshakeServer, 253) || "www.apple.com", handshakePort: Math.min(65535, Math.max(1, Number(values.handshakePort) || 443)), flow: values.flow === "" ? "" : "xtls-rprx-vision" });
  if (protocol === "vmess") Object.assign(cleanedValues, { transport: values.transport === "tcp" ? "tcp" : "ws", wsPath: cleanText(values.wsPath, 256) || "/" });
  if (protocol === "shadowsocks") Object.assign(cleanedValues, { method: ["2022-blake3-aes-128-gcm", "2022-blake3-aes-256-gcm", "chacha20-ietf-poly1305", "aes-128-gcm"].includes(values.method) ? values.method : "2022-blake3-aes-128-gcm" });
  if (["trojan", "hysteria2", "tuic", "anytls"].includes(protocol)) Object.assign(cleanedValues, { serverName: cleanText(values.serverName, 253), certificateMode: values.certificateMode === "existing" ? "existing" : "self-signed" });
  return { id: cleanText(item.id, 64), name: cleanText(item.name, 80), suffix: cleanText(item.suffix, 40), tier: item.tier === "recommended" ? "recommended" : "advanced", summary: cleanText(item.summary, 180), badges: cleanTags(item.badges).slice(0, 4), origin: item.origin === "builtin" ? "builtin" : "user", hidden: item.hidden === true, values: cleanedValues };
}
function cleanProvider(item) {
  let baseUrl = "";
  try { baseUrl = normalizeSuiBaseUrl(item && item.baseUrl); } catch (_) {}
  const type = ["s-ui", "2s-ui"].includes(item && item.type) ? item.type : "";
  const clients = (Array.isArray(item && item.clients) ? item.clients : []).map((client) => ({
    id: cleanText(client && client.id, 64), name: cleanText(client && client.name, 160), enabled: client && client.enabled !== false,
    upload: cleanByteCount(client && client.upload), download: cleanByteCount(client && client.download), total: cleanByteCount(client && client.total), expire: cleanByteCount(client && client.expire),
  })).filter((client) => client.id && client.name).slice(0, 1000);
  return { id: cleanText(item && item.id, 64), name: cleanText(item && item.name, 80), type, baseUrl, enabled: item && item.enabled !== false, hasToken: item && item.hasToken === true, lastTestAt: cleanText(item && item.lastTestAt, 64), lastSyncAt: cleanText(item && item.lastSyncAt, 64), lastSuccessAt: cleanText(item && item.lastSuccessAt, 64), lastError: cleanText(item && item.lastError, 240), status: cleanText(item && item.status, 48), inboundCount: Math.max(0, Number(item && item.inboundCount) || 0), clientCount: Math.max(0, Number(item && item.clientCount) || 0), linkCount: Math.max(0, Number(item && item.linkCount) || 0), clients };
}
function defaultState() {
  return { version: 14, revision: 0, settings: { publicBaseUrl: "", monitoring: { cpuPercent: 85, memoryPercent: 90, diskPercent: 90 } }, machines: [], nodes: [], nodeDrafts: [], subscriptions: [], externalSources: [], ruleSets: [], serviceBindings: [], managedInstances: [], certificates: [], deploymentPresets: clone(DEFAULT_DEPLOYMENT_PRESETS), providers: [] };
}
function cleanHttpUrl(value, allowEmpty = true) {
  const raw = cleanText(value, 2048);
  if (!raw && allowEmpty) return "";
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("只支持不含账号密码的 HTTP/HTTPS 地址");
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
function cleanGroup(item, nodeIds, groupIds) {
  const id = cleanText(item && item.id, 64);
  const entries = (Array.isArray(item && item.entries) ? item.entries : []).map((entry) => ({ kind: entry && entry.kind === "group" ? "group" : "node", id: cleanText(entry && entry.id, 64) }))
    .filter((entry) => entry.id && (entry.kind === "node" ? nodeIds.has(entry.id) : groupIds.has(entry.id)) && entry.id !== id);
  return { id, name: cleanText(item && item.name, 80), type: GROUP_TYPES.has(item && item.type) ? item.type : "select", entries: entries.filter((entry, index) => entries.findIndex((other) => other.kind === entry.kind && other.id === entry.id) === index), url: cleanHttpUrl((item && item.url) || DEFAULT_TEST_URL), interval: Math.min(86400, Math.max(60, Number(item && item.interval) || 3600)) };
}
function assertAcyclicGroups(groups) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error("订阅代理组存在循环引用");
    if (visited.has(id)) return;
    visiting.add(id);
    const group = byId.get(id);
    if (group) group.entries.filter((entry) => entry.kind === "group").forEach((entry) => visit(entry.id));
    visiting.delete(id);
    visited.add(id);
  }
  groups.forEach((group) => visit(group.id));
}
function cleanConnectivity(value) {
  if (!value || typeof value !== "object") return null;
  const status = ["passed", "failed"].includes(value.status) ? value.status : "";
  const observedAt = /^\d{4}-\d\d-\d\dT/.test(String(value.observedAt || "")) ? String(value.observedAt) : "";
  if (!status || !observedAt) return null;
  return { status, observedAt, sourceMachineId: cleanText(value.sourceMachineId, 64), sourceName: cleanText(value.sourceName, 160), sourceKind: value.sourceKind === "target" ? "target" : "remote", clientVersion: cleanText(value.clientVersion, 160), actualIp: cleanText(value.actualIp, 64), exitIpMatches: value.exitIpMatches === true ? true : value.exitIpMatches === false ? false : null, error: cleanText(value.error, 160) };
}
function cleanDeviceProfiles(input) {
  const clients = new Set(["anywhere-ios", "anywhere-android", "mihomo", "surge", "sing-box", "loon", "generic"]);
  return (Array.isArray(input) ? input : []).map((item) => ({
    id: cleanText(item && item.id, 64), name: cleanText(item && item.name, 80), client: clients.has(item && item.client) ? item.client : "generic", notes: cleanText(item && item.notes, 160),
  })).filter((item) => item.id && item.name).slice(0, 20);
}
function cleanRuleSet(item) {
  let url = ""; try { url = cleanHttpUrl(item && item.url, false); } catch (_) {}
  return { id: cleanText(item && item.id, 64), name: cleanText(item && item.name, 80), url, action: ["proxy", "direct", "reject"].includes(item && item.action) ? item.action : "proxy", enabled: item && item.enabled !== false, lastSyncAt: cleanText(item && item.lastSyncAt, 64), lastSuccessAt: cleanText(item && item.lastSuccessAt, 64), lastError: cleanText(item && item.lastError, 240), version: cleanText(item && item.version, 64), entryCount: Math.max(0, Number(item && item.entryCount) || 0) };
}
function cleanNowhereExtensions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => /^NOW(?:HERE)?_[A-Z0-9_]{1,80}$/.test(key)).slice(0, 32).map(([key, item]) => [key, cleanText(item, 4096)]));
}
function cleanNowhereMigration(value) {
  if (!value || typeof value !== "object" || !value.previous || typeof value.previous !== "object") return null;
  const previous = value.previous;
  const migratedAt = /^\d{4}-\d\d-\d\dT/.test(String(value.migratedAt || "")) ? String(value.migratedAt) : "";
  const backupDirectory = cleanText(value.backupDirectory, 512);
  if (!migratedAt || !backupDirectory.startsWith("/var/lib/proxy-console/instances/")) return null;
  return {
    fromVersion: cleanText(value.fromVersion, 64), toVersion: cleanText(value.toVersion, 64),
    backupDirectory, migratedAt, previousUri: cleanText(value.previousUri, 8192),
    previous: {
      version: cleanText(previous.version, 64), publicHost: cleanText(previous.publicHost, 253), listenHost: cleanText(previous.listenHost, 253),
      port: Math.min(65535, Math.max(1024, Number(previous.port) || 2077)), client: ["anywhere", "vector", "both"].includes(previous.client) ? previous.client : "anywhere",
      network: ["mix", "tcp", "udp"].includes(previous.network) ? previous.network : "mix", tls: Number(previous.tls) === 2 ? 2 : 1,
      alpn: cleanText(previous.alpn, 64) || "now/1", rate: Math.min(1000000, Math.max(0, Number(previous.rate) || 0)), etar: Math.min(1000000, Math.max(0, Number(previous.etar) || 0)),
      dial: cleanText(previous.dial, 253) || "auto", socks: cleanText(previous.socks, 512) || "none", log: ["none", "debug", "info", "warn", "error", "event"].includes(previous.log) ? previous.log : "info",
      telemetryInterval: cleanText(previous.telemetryInterval, 16) || "1s", pool: Math.min(256, Math.max(0, Number(previous.pool) || 0)),
      vectorSocks: cleanText(previous.vectorSocks, 512) || "127.0.0.1:1080", vectorSni: cleanText(previous.vectorSni, 253) || "none", vectorPin: cleanText(previous.vectorPin, 64) || "none",
      vectorMux: Number(previous.vectorMux) === 1 ? 1 : 0, quicMemoryProfile: ["memory", "balanced", "throughput"].includes(previous.quicMemoryProfile) ? previous.quicMemoryProfile : "balanced",
      certificateMode: ["ephemeral", "managed", "existing"].includes(previous.certificateMode) ? previous.certificateMode : "ephemeral",
      certificatePath: cleanText(previous.certificatePath, 512), privateKeyPath: cleanText(previous.privateKeyPath, 512), certificateHost: cleanText(previous.certificateHost, 253),
      certificateDays: Math.min(3650, Math.max(1, Number(previous.certificateDays) || 825)), extensionEnvironment: cleanNowhereExtensions(previous.extensionEnvironment),
    },
  };
}
function cleanIsoDate(value) {
  const raw = String(value || "");
  return /^\d{4}-\d\d-\d\dT/.test(raw) && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : "";
}
function certificateHealth(value) {
  if (["invalid", "missing"].includes(value && value.status)) return value.status;
  const expiresAt = cleanIsoDate(value && value.expiresAt);
  if (!expiresAt) return value && value.checkedAt ? "invalid" : "unchecked";
  const remaining = Date.parse(expiresAt) - Date.now();
  return remaining <= 0 ? "expired" : remaining <= 30 * 86400000 ? "warning" : "valid";
}
function cleanCertificateReference(value) {
  if (!value || typeof value !== "object") return null;
  const fingerprintSha256 = cleanText(value.fingerprintSha256, 64).toLowerCase();
  const publicKeySha256 = cleanText(value.publicKeySha256, 64);
  const assetId = cleanText(value.assetId, 64);
  const expiresAt = cleanIsoDate(value.expiresAt);
  if (!assetId && !fingerprintSha256 && !publicKeySha256 && !expiresAt) return null;
  return {
    assetId,
    selfSigned: value.selfSigned === true,
    fingerprintSha256: /^[a-f0-9]{64}$/.test(fingerprintSha256) ? fingerprintSha256 : "",
    publicKeySha256: /^[A-Za-z0-9+/]{43}=$/.test(publicKeySha256) ? publicKeySha256 : "",
    expiresAt,
  };
}
function cleanCertificateAsset(item, machineIds) {
  const id = cleanText(item && item.id, 64);
  const machineId = cleanText(item && item.machineId, 64);
  const mode = item && ["existing", "instance"].includes(item.mode) ? item.mode : "managed";
  const certificatePath = cleanText(item && item.certificatePath, 512);
  const privateKeyPath = cleanText(item && item.privateKeyPath, 512);
  if (!/^[a-z0-9][a-z0-9_-]{7,63}$/i.test(id) || !machineIds.has(machineId) || !certificatePath.startsWith("/") || !privateKeyPath.startsWith("/")) return null;
  const fingerprintSha256 = cleanText(item && item.fingerprintSha256, 64).toLowerCase();
  const publicKeySha256 = cleanText(item && item.publicKeySha256, 64);
  const checkedAt = cleanIsoDate(item && item.checkedAt);
  const expiresAt = cleanIsoDate(item && item.expiresAt);
  const value = {
    id, name: cleanText(item && item.name, 120) || "未命名证书", machineId, mode,
    certificatePath, privateKeyPath, subjectName: cleanText(item && item.subjectName, 253),
    subject: cleanText(item && item.subject, 512), issuer: cleanText(item && item.issuer, 512), serialNumber: cleanText(item && item.serialNumber, 160),
    sans: (Array.isArray(item && item.sans) ? item.sans : []).map((entry) => cleanText(entry, 253)).filter(Boolean).slice(0, 32),
    fingerprintSha256: /^[a-f0-9]{64}$/.test(fingerprintSha256) ? fingerprintSha256 : "",
    publicKeySha256: /^[A-Za-z0-9+/]{43}=$/.test(publicKeySha256) ? publicKeySha256 : "",
    validFrom: cleanIsoDate(item && item.validFrom), expiresAt, checkedAt,
    createdAt: cleanIsoDate(item && item.createdAt) || new Date().toISOString(), updatedAt: cleanIsoDate(item && item.updatedAt) || new Date().toISOString(),
    lastError: cleanText(item && item.lastError, 160), status: "unchecked",
  };
  value.status = certificateHealth({ ...value, status: ["invalid", "missing"].includes(item && item.status) ? item.status : "" });
  return value;
}
function cleanState(input) {
  if (!input || typeof input !== "object") throw new Error("无效的数据");
  const legacyTrafficGB = Number(input.settings && input.settings.monitoring && input.settings.monitoring.monthlyTrafficGB) || 0;
  const legacyTrafficPlan = Number(input.version || 0) < 14 && legacyTrafficGB > 0
    ? { enabled: true, limitBytes: Math.round(legacyTrafficGB * 1024 ** 3), accounting: "sum", resetDay: 1, warningLevels: [70, 90, 100] }
    : null;
  const machines = (Array.isArray(input.machines) ? input.machines : []).map((item) => ({
    id: cleanText(item.id, 64), name: cleanText(item.name), provider: cleanText(item.provider, 80), region: cleanText(item.region || item.city, 80), country: cleanText(item.country, 80), countryCode: cleanText(item.countryCode || (String(item.region || "").length === 2 ? item.region : ""), 8).toUpperCase(), tags: cleanTags(item.tags), monitorClientId: cleanText(item.monitorClientId, 64), trafficPlan: cleanTrafficPlan(item.trafficPlan || legacyTrafficPlan),
  })).filter((item) => item.id && item.name);
  const machineIds = new Set(machines.map((item) => item.id));
  const certificates = (Array.isArray(input.certificates) ? input.certificates : []).map((item) => cleanCertificateAsset(item, machineIds)).filter(Boolean);
  const providers = (Array.isArray(input.providers) ? input.providers : []).map(cleanProvider).filter((item) => item.id && item.name && item.type && item.baseUrl);
  const providerIds = new Set(providers.map((item) => item.id));
  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).map((item) => ({
    id: cleanText(item.id, 64), name: normalizeNodeName(item.name), protocol: cleanText(item.protocol || String(item.uri || "").split(":", 1)[0], 24).toLowerCase(), machineId: cleanText(item.machineId, 64), uri: cleanText(item.uri, 8192), enabled: item.enabled !== false, tags: cleanTags(item.tags), source: ["manual", "import", "external", "provider"].includes(item.source) ? item.source : "manual", sourceId: cleanText(item.sourceId, 64), remoteId: cleanText(item.remoteId, 240), remoteName: normalizeNodeName(item.remoteName), remoteClientName: cleanText(item.remoteClientName, 160), remoteInboundName: cleanText(item.remoteInboundName, 160), providerMissing: item.providerMissing === true, connectivity: cleanConnectivity(item.connectivity), certificate: cleanCertificateReference(item.certificate),
  })).filter((item) => item.id && item.name && /^[a-z][a-z0-9+.-]*:\/\//i.test(item.uri) && (!item.machineId || machineIds.has(item.machineId)));
  const nodeDrafts = (Array.isArray(input.nodeDrafts) ? input.nodeDrafts : []).map((item) => {
    const rawRepair = item && item.repair && typeof item.repair === "object" ? item.repair : {};
    return {
      id: cleanText(item && item.id, 64), name: normalizeNodeName(item && item.name) || "待修复节点", protocol: cleanText(item && item.protocol, 24).toLowerCase() || "unknown",
      machineId: cleanText(item && item.machineId, 64), kind: item && item.kind === "nowhere" ? "nowhere" : "sing-box", source: cleanText(item && item.source, 512), reason: cleanText(item && item.reason, 240), evidence: (Array.isArray(item && item.evidence) ? item.evidence : []).map((value) => cleanText(value, 240)).filter(Boolean).slice(0, 12),
      repair: { publicHost: cleanText(rawRepair.publicHost, 253), port: Math.min(65535, Math.max(0, Number(rawRepair.port) || 0)), sni: cleanText(rawRepair.sni, 253), reality: rawRepair.reality === true, userNames: (Array.isArray(rawRepair.userNames) ? rawRepair.userNames : []).slice(0, 32).map((value) => cleanText(value, 120)).filter(Boolean), certificate: rawRepair.certificate && typeof rawRepair.certificate === "object" ? { path: cleanText(rawRepair.certificate.path, 512), keyPath: cleanText(rawRepair.certificate.keyPath, 512), validTo: cleanText(rawRepair.certificate.validTo, 80), sans: (Array.isArray(rawRepair.certificate.sans) ? rawRepair.certificate.sans : []).slice(0, 64).map((value) => cleanText(value, 253)).filter(Boolean), keyMatch: rawRepair.certificate.keyMatch === true ? true : rawRepair.certificate.keyMatch === false ? false : null, readable: rawRepair.certificate.readable === true } : null },
      createdAt: /^\d{4}-\d\d-\d\dT/.test(String(item && item.createdAt || "")) ? String(item.createdAt) : new Date().toISOString(),
    };
  }).filter((item) => item.id && item.name && (!item.machineId || machineIds.has(item.machineId))).slice(0, 500);
  const nodeIds = new Set(nodes.map((item) => item.id));
  const managedInstances = (Array.isArray(input.managedInstances) ? input.managedInstances : []).map((item) => ({
    id: cleanText(item && item.id, 64), kind: item && item.kind === "nowhere" ? "nowhere" : item && item.kind === "sing-box" ? "sing-box" : "",
    protocol: ["vless-reality", "vmess", "shadowsocks", "trojan", "hysteria2", "tuic", "anytls"].includes(item && item.protocol) ? item.protocol : "",
    name: cleanText(item && item.name, 160), machineId: cleanText(item && item.machineId, 64), nodeId: cleanText(item && item.nodeId, 64), certificateId: cleanText(item && item.certificateId, 64),
    status: cleanManagedState(item && item.status), version: cleanText(item && item.version, 160), publicHost: cleanText(item && item.publicHost, 253),
    listenHost: cleanText(item && item.listenHost, 253), port: Math.min(65535, Math.max(1024, Number(item && item.port) || 2077)),
    tcpPort: Math.min(65535, Math.max(0, Number(item && item.tcpPort) || 0)), udpPort: Math.min(65535, Math.max(0, Number(item && item.udpPort) || 0)),
    tcpCarrier: ["tcp", "tcp4", "tcp6"].includes(item && item.tcpCarrier) ? item.tcpCarrier : "tcp",
    udpCarrier: ["udp", "udp4", "udp6"].includes(item && item.udpCarrier) ? item.udpCarrier : "udp",
    client: ["anywhere", "vector", "both"].includes(item && item.client) ? item.client : "anywhere",
    network: ["mix", "tcp", "udp"].includes(item && item.network) ? item.network : "mix", tls: Number(item && item.tls) === 2 ? 2 : 1,
    alpn: cleanText(item && item.alpn, 64) || "now/1", rate: Math.min(1000000, Math.max(0, Number(item && item.rate) || 0)),
    etar: Math.min(1000000, Math.max(0, Number(item && item.etar) || 0)), dial: cleanText(item && item.dial, 253) || "auto",
    socks: cleanText(item && item.socks, 512) || "none", log: ["none", "debug", "info", "warn", "error", "event"].includes(item && item.log) ? item.log : "info",
    telemetryInterval: cleanText(item && item.telemetryInterval, 16) || "1s", pool: Math.min(256, Math.max(0, Number(item && item.pool) || 0)),
    vectorSocks: cleanText(item && item.vectorSocks, 512) || "127.0.0.1:1080", vectorSni: cleanText(item && item.vectorSni, 253) || "none",
    vectorPin: cleanText(item && item.vectorPin, 64) || "none", vectorMux: Number(item && item.vectorMux) === 1 ? 1 : 0,
    quicMemoryProfile: ["memory", "balanced", "throughput"].includes(item && item.quicMemoryProfile) ? item.quicMemoryProfile : "balanced",
    morph: Number(item && item.morph) === 1 ? 1 : 0,
    transportMemoryProfile: ["memory", "balanced", "throughput"].includes(item && item.transportMemoryProfile) ? item.transportMemoryProfile : "throughput",
    certificateMode: ["ephemeral", "managed", "existing"].includes(item && item.certificateMode) ? item.certificateMode : Number(item && item.tls) === 2 ? "existing" : "ephemeral",
    certificatePath: cleanText(item && item.certificatePath, 512), privateKeyPath: cleanText(item && item.privateKeyPath, 512),
    certificateHost: cleanText(item && item.certificateHost, 253) || cleanText(item && item.publicHost, 253), certificateDays: Math.min(3650, Math.max(1, Number(item && item.certificateDays) || 825)),
    extensionEnvironment: cleanNowhereExtensions(item && item.extensionEnvironment), binarySource: item && item.binarySource === "download" ? "download" : "copy",
    createdAt: /^\d{4}-\d\d-\d\dT/.test(String(item && item.createdAt || "")) ? String(item.createdAt) : new Date().toISOString(),
    updatedAt: /^\d{4}-\d\d-\d\dT/.test(String(item && item.updatedAt || "")) ? String(item.updatedAt) : new Date().toISOString(),
    lastError: cleanText(item && item.lastError, 160), lastOperationId: cleanText(item && item.lastOperationId, 64),
    migration: item && item.kind === "nowhere" ? cleanNowhereMigration(item.migration) : null, connectivity: cleanConnectivity(item && item.connectivity),
  })).filter((item) => item.id && item.kind && item.name && machineIds.has(item.machineId) && nodeIds.has(item.nodeId));
  if (Number(input.version || 0) < 13 && certificates.length === 0) {
    for (const instance of managedInstances) {
      let mode = instance.certificateMode; let certificatePath = instance.certificatePath; let privateKeyPath = instance.privateKeyPath;
      if (instance.kind === "sing-box" && ["trojan", "hysteria2", "tuic", "anytls"].includes(instance.protocol)) {
        mode = "instance"; certificatePath = `/var/lib/proxy-console/instances/${instance.id}/server.crt`; privateKeyPath = `/var/lib/proxy-console/instances/${instance.id}/server.key`;
      }
      if (mode === "ephemeral" || !certificatePath || !privateKeyPath) continue;
      const id = newCertificateId(`${instance.machineId}:${certificatePath}`);
      const asset = cleanCertificateAsset({ id, name: `${instance.name} · 证书`, machineId: instance.machineId, mode: mode === "existing" ? "existing" : "instance", certificatePath, privateKeyPath, subjectName: instance.certificateHost || instance.publicHost }, machineIds);
      if (asset && !certificates.some((item) => item.id === asset.id)) certificates.push(asset);
      instance.certificateId = asset ? asset.id : "";
    }
  }
  const certificateIds = new Set(certificates.map((item) => item.id));
  managedInstances.forEach((item) => { if (item.certificateId && !certificateIds.has(item.certificateId)) item.certificateId = ""; });
  nodes.forEach((item) => { if (item.certificate?.assetId && !certificateIds.has(item.certificate.assetId)) item.certificate.assetId = ""; });
  const ruleSets = (Array.isArray(input.ruleSets) ? input.ruleSets : []).map(cleanRuleSet).filter((item) => item.id && item.name && item.url);
  const ruleSetIds = new Set(ruleSets.map((item) => item.id));
  const subscriptions = (Array.isArray(input.subscriptions) ? input.subscriptions : []).map((item) => {
    const rawGroups = Array.isArray(item.groups) ? item.groups : [];
    const groupIds = new Set(rawGroups.map((group) => cleanText(group && group.id, 64)).filter(Boolean));
    const groups = rawGroups.map((group) => cleanGroup(group, nodeIds, groupIds)).filter((group) => group.id && group.name);
    assertAcyclicGroups(groups);
    const expiresAt = /^\d{4}-\d\d-\d\dT/.test(String(item.expiresAt || "")) && Number.isFinite(Date.parse(item.expiresAt)) ? new Date(item.expiresAt).toISOString() : "";
    const rawQuota = item.quota && typeof item.quota === "object" ? item.quota : {};
    const quotaMode = ["none", "manual", "external", "provider"].includes(rawQuota.mode) ? rawQuota.mode : "none";
    const quota = { mode: quotaMode, upload: cleanByteCount(rawQuota.upload), download: cleanByteCount(rawQuota.download), total: cleanByteCount(rawQuota.total), expire: cleanByteCount(rawQuota.expire), sourceId: cleanText(rawQuota.sourceId, 64), clientId: cleanText(rawQuota.clientId, 64) };
    return { id: cleanText(item.id, 64), name: cleanText(item.name), token: cleanText(item.token, 128), nodeIds: Array.isArray(item.nodeIds) ? [...new Set(item.nodeIds.map((id) => cleanText(id, 64)).filter((id) => nodeIds.has(id)))] : [], groups, enabled: item.enabled !== false, expiresAt, quota, policyMode: POLICY_MODES.has(item.policyMode) ? item.policyMode : "proxy-all", customRules: cleanCustomRules(item.customRules), ruleSetIds: Array.isArray(item.ruleSetIds) ? [...new Set(item.ruleSetIds.map((id) => cleanText(id, 64)).filter((id) => ruleSetIds.has(id)))] : [], devices: cleanDeviceProfiles(item.devices) };
  }).filter((item) => item.id && item.name && /^[A-Za-z0-9_-]{24,128}$/.test(item.token));
  const externalSources = (Array.isArray(input.externalSources) ? input.externalSources : []).map((item) => ({
    id: cleanText(item.id, 64), name: cleanText(item.name, 80), url: cleanHttpUrl(item.url, false), machineId: cleanText(item.machineId, 64), tags: cleanTags(item.tags), enabled: item.enabled !== false, refreshIntervalHours: Math.min(168, Math.max(1, Number(item.refreshIntervalHours) || 24)), lastSyncAt: cleanText(item.lastSyncAt, 64), lastError: cleanText(item.lastError, 240), traffic: cleanTrafficMetadata(item.traffic), nodeIds: Array.isArray(item.nodeIds) ? [...new Set(item.nodeIds.map((id) => cleanText(id, 64)).filter((id) => nodeIds.has(id)))] : [],
  })).filter((item) => item.id && item.name && item.url && (!item.machineId || machineIds.has(item.machineId)));
  const sourceIds = new Set(externalSources.map((item) => item.id));
  nodes.forEach((node) => {
    if (node.source === "external" && node.sourceId && !sourceIds.has(node.sourceId)) node.sourceId = "";
    if (node.source === "provider" && node.sourceId && !providerIds.has(node.sourceId)) { node.sourceId = ""; node.providerMissing = true; node.enabled = false; }
  });
  const shouldSeedPresets = Number(input.version || 0) < 7 && !Array.isArray(input.deploymentPresets);
  let rawPresets = shouldSeedPresets ? clone(DEFAULT_DEPLOYMENT_PRESETS) : Array.isArray(input.deploymentPresets) ? input.deploymentPresets : [];
  if (Number(input.version || 0) < 11) {
    const canonical = new Map(DEFAULT_DEPLOYMENT_PRESETS.map((item) => [item.id, item]));
    rawPresets = rawPresets.map((item) => canonical.has(item && item.id)
      ? { ...item, name: canonical.get(item.id).name, suffix: canonical.get(item.id).suffix, summary: canonical.get(item.id).summary, badges: [], origin: "builtin" }
      : item);
  }
  const deploymentPresets = rawPresets.map(cleanDeploymentPreset).filter((item) => item && item.id && item.name);
  const serviceBindings = (Array.isArray(input.serviceBindings) ? input.serviceBindings : []).map((item) => ({ clientId: cleanText(item.clientId, 64), name: cleanText(item.name), machineId: cleanText(item.machineId, 64) })).filter((item) => item.clientId && item.name);
  let publicBaseUrl = "";
  try { publicBaseUrl = cleanHttpUrl(input.settings && input.settings.publicBaseUrl); } catch (_) {}
  const threshold = (value, fallback, min = 0, max = 1000000) => { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; };
  const rawMonitoring = input.settings && input.settings.monitoring || {};
  const monitoring = { cpuPercent: threshold(rawMonitoring.cpuPercent, 85, 1, 100), memoryPercent: threshold(rawMonitoring.memoryPercent, 90, 1, 100), diskPercent: threshold(rawMonitoring.diskPercent, 90, 1, 100) };
  return { version: 14, revision: Math.max(0, Number(input.revision || 0)), settings: { publicBaseUrl, monitoring }, machines, nodes, nodeDrafts, subscriptions, externalSources, ruleSets, serviceBindings, managedInstances, certificates, deploymentPresets, providers };
}
function writeState(state) {
  const temporary = STATE_FILE + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, STATE_FILE);
  fs.chmodSync(STATE_FILE, 0o600);
}
function subscriptionSnapshot(subscription) {
  return { name: subscription.name, nodeIds: clone(subscription.nodeIds || []), groups: clone(subscription.groups || []), enabled: subscription.enabled !== false, expiresAt: subscription.expiresAt || "", quota: clone(subscription.quota || { mode: "none" }), policyMode: subscription.policyMode || "proxy-all", customRules: clone(subscription.customRules || []), ruleSetIds: clone(subscription.ruleSetIds || []), devices: clone(subscription.devices || []) };
}
function readSubscriptionHistory() { try { const value = JSON.parse(fs.readFileSync(SUBSCRIPTION_HISTORY_FILE, "utf8")); return Array.isArray(value) ? value : []; } catch (_) { return []; } }
function writeSubscriptionHistory(entries) { const temporary = SUBSCRIPTION_HISTORY_FILE + ".tmp"; fs.writeFileSync(temporary, JSON.stringify(entries.slice(-100), null, 2) + "\n", { mode: 0o600 }); fs.renameSync(temporary, SUBSCRIPTION_HISTORY_FILE); fs.chmodSync(SUBSCRIPTION_HISTORY_FILE, 0o600); }
function recordSubscriptionChanges(current, incoming) {
  try {
    const nextById = new Map(incoming.subscriptions.map((subscription) => [subscription.id, subscription])); const entries = readSubscriptionHistory();
    for (const subscription of current.subscriptions) { const next = nextById.get(subscription.id); if (next && JSON.stringify(subscriptionSnapshot(subscription)) === JSON.stringify(subscriptionSnapshot(next))) continue; entries.push({ id: randomId(), subscriptionId: subscription.id, savedAt: new Date().toISOString(), reason: next ? "更新前" : "删除前", snapshot: subscriptionSnapshot(subscription) }); }
    writeSubscriptionHistory(entries);
  } catch (error) { console.error("subscription history write failed", error); }
}
function subscriptionHistory(params) {
  const subscriptionId = cleanText(params && params.subscriptionId, 64); return readSubscriptionHistory().filter((entry) => entry && entry.subscriptionId === subscriptionId && entry.snapshot && typeof entry.snapshot === "object").slice(-20).reverse().map((entry) => { const quota = entry.snapshot.quota && typeof entry.snapshot.quota === "object" ? entry.snapshot.quota : {}; return { id: cleanText(entry.id, 64), subscriptionId, savedAt: cleanText(entry.savedAt, 64), reason: entry.reason === "删除前" ? "删除前" : "更新前", snapshot: { name: cleanText(entry.snapshot.name), nodeIds: Array.isArray(entry.snapshot.nodeIds) ? entry.snapshot.nodeIds.map((id) => cleanText(id, 64)).filter(Boolean) : [], groups: Array.isArray(entry.snapshot.groups) ? clone(entry.snapshot.groups) : [], enabled: entry.snapshot.enabled !== false, expiresAt: cleanText(entry.snapshot.expiresAt, 64), quota: { mode: ["none", "manual", "external", "provider"].includes(quota.mode) ? quota.mode : "none", upload: cleanByteCount(quota.upload), download: cleanByteCount(quota.download), total: cleanByteCount(quota.total), expire: cleanByteCount(quota.expire), sourceId: cleanText(quota.sourceId, 64), clientId: cleanText(quota.clientId, 64) }, policyMode: POLICY_MODES.has(entry.snapshot.policyMode) ? entry.snapshot.policyMode : "proxy-all", customRules: cleanCustomRules(entry.snapshot.customRules), ruleSetIds: Array.isArray(entry.snapshot.ruleSetIds) ? entry.snapshot.ruleSetIds.map((id) => cleanText(id, 64)).filter(Boolean) : [], devices: cleanDeviceProfiles(entry.snapshot.devices) } }; });
}
function subscriptionChangePreview(params) {
  const state = readState(); const candidate = params && params.subscription;
  if (!candidate || typeof candidate !== "object") throw new Error("缺少订阅草稿");
  const cleanedState = cleanState({ ...state, subscriptions: [{ ...candidate, token: candidate.token || "x".repeat(24) }] });
  const next = cleanedState.subscriptions[0]; if (!next) throw new Error("订阅草稿无效");
  const current = state.subscriptions.find((item) => item.id === next.id);
  const before = current ? subscriptionSnapshot(current) : { name: "", nodeIds: [], groups: [], enabled: true, expiresAt: "", quota: { mode: "none" }, policyMode: "proxy-all", customRules: [], ruleSetIds: [], devices: [] };
  const after = subscriptionSnapshot(next); const added = after.nodeIds.filter((id) => !before.nodeIds.includes(id)); const removed = before.nodeIds.filter((id) => !after.nodeIds.includes(id));
  const groupChanges = after.groups.filter((group) => JSON.stringify(before.groups.find((item) => item.id === group.id)) !== JSON.stringify(group)).length + before.groups.filter((group) => !after.groups.some((item) => item.id === group.id)).length;
  const fields = [];
  if (!current) fields.push("创建新订阅"); else if (before.name !== after.name) fields.push(`名称：${before.name} → ${after.name}`);
  if (added.length || removed.length) fields.push(`节点：+${added.length} / -${removed.length}`);
  if (groupChanges) fields.push(`代理组：${groupChanges} 处变化`);
  if (JSON.stringify(before.customRules) !== JSON.stringify(after.customRules)) fields.push(`手写规则：${before.customRules.length} → ${after.customRules.length}`);
  if (JSON.stringify(before.ruleSetIds) !== JSON.stringify(after.ruleSetIds)) fields.push(`规则集：${before.ruleSetIds.length} → ${after.ruleSetIds.length}`);
  if (JSON.stringify(before.devices) !== JSON.stringify(after.devices)) fields.push(`设备档案：${before.devices.length} → ${after.devices.length}`);
  if (before.enabled !== after.enabled) fields.push(`订阅链接：${after.enabled ? "启用" : "停用"}`);
  if (before.expiresAt !== after.expiresAt) fields.push(after.expiresAt ? `有效期：${after.expiresAt.slice(0, 10)}` : "有效期：长期");
  if (JSON.stringify(before.quota) !== JSON.stringify(after.quota)) fields.push(`流量额度：${{ none: "无限制", manual: "手动", external: "外部订阅源", provider: "外部面板客户端" }[after.quota.mode] || "无限制"}`);
  return { changed: !current || JSON.stringify(before) !== JSON.stringify(after), fields, addedNodes: state.nodes.filter((node) => added.includes(node.id)).map((node) => node.name), removedNodes: state.nodes.filter((node) => removed.includes(node.id)).map((node) => node.name), before: { nodes: before.nodeIds.length, groups: before.groups.length, rules: before.customRules.length + before.ruleSetIds.length, devices: before.devices.length }, after: { nodes: after.nodeIds.length, groups: after.groups.length, rules: after.customRules.length + after.ruleSetIds.length, devices: after.devices.length } };
}
function readRuleSetCache() { try { const value = JSON.parse(fs.readFileSync(RULE_SET_CACHE_FILE, "utf8")); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch (_) { return {}; } }
function writeRuleSetCache(value) { const temporary = RULE_SET_CACHE_FILE + ".tmp"; fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); fs.renameSync(temporary, RULE_SET_CACHE_FILE); fs.chmodSync(RULE_SET_CACHE_FILE, 0o600); }
function withCachedRuleSets(subscription, state) {
  const cache = readRuleSetCache(); const cachedRules = [];
  for (const id of subscription.ruleSetIds || []) { const source = state.ruleSets.find((item) => item.id === id && item.enabled); const item = source && cache[id]; if (!source || !item || !Array.isArray(item.rules)) continue; cachedRules.push(...item.rules.map((rule, index) => ({ ...rule, id: `${id}-${index}`, action: source.action }))); }
  return { ...subscription, cachedRules };
}
function readState() {
  if (!fs.existsSync(STATE_FILE)) {
    writeState(defaultState());
  }
  const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const state = cleanState(raw);
  if (raw.version !== 14) writeState(state);
  return state;
}
const PORTABLE_BACKUP_SCHEMA = 1;
const PORTABLE_BACKUP_MAX_BYTES = 8 * 1024 * 1024;
const PORTABLE_COLLECTIONS = ["machines", "nodes", "nodeDrafts", "subscriptions", "externalSources", "ruleSets", "serviceBindings", "managedInstances", "certificates", "deploymentPresets", "providers"];
function portableCounts(state) {
  return Object.fromEntries(PORTABLE_COLLECTIONS.map((key) => [key, state[key].length]));
}
function exportPortableBackup() {
  const state = readState();
  const providerIds = new Set(state.providers.map((item) => item.id));
  const ruleSetIds = new Set(state.ruleSets.map((item) => item.id));
  return {
    format: "wherever-station-backup", schema: PORTABLE_BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    state,
    providerSecrets: Object.fromEntries(Object.entries(readProviderSecrets()).filter(([id]) => providerIds.has(id))),
    ruleSetCache: Object.fromEntries(Object.entries(readRuleSetCache()).filter(([id]) => ruleSetIds.has(id))),
  };
}
const PORTABLE_DOWNLOAD_TTL_MS = 60 * 1000;
const portableDownloads = new Map();
function preparePortableBackupDownload() {
  const now = Date.now();
  for (const [token, item] of portableDownloads) if (item.expiresAt <= now) portableDownloads.delete(token);
  if (portableDownloads.size >= 4) portableDownloads.delete(portableDownloads.keys().next().value);
  const body = JSON.stringify(exportPortableBackup(), null, 2) + "\n";
  if (Buffer.from(body, "utf8").length > PORTABLE_BACKUP_MAX_BYTES) throw new Error("备份超过 8 MB，请检查数据");
  const token = crypto.randomBytes(32).toString("hex");
  const filename = `wherever-station-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
  const expiresAt = now + PORTABLE_DOWNLOAD_TTL_MS;
  portableDownloads.set(token, { body, filename, expiresAt });
  return { url: `/proxy/backup/${token}`, filename, expiresAt: new Date(expiresAt).toISOString() };
}
function downloadPortableBackup(req, res) {
  const pathname = String(req.url || "").split("?", 1)[0];
  const token = pathname.slice(pathname.lastIndexOf("/") + 1);
  const item = /^[a-f0-9]{64}$/.test(token) ? portableDownloads.get(token) : null;
  if (!item || item.expiresAt <= Date.now()) {
    if (item) portableDownloads.delete(token);
    res.statusCode = 404; res.end("not found"); return;
  }
  portableDownloads.delete(token);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${item.filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(item.body);
}
function preparePortableBackup(value) {
  if (!value || value.format !== "wherever-station-backup" || value.schema !== PORTABLE_BACKUP_SCHEMA) throw new Error("不是受支持的 Wherever Station 备份");
  if (Buffer.from(JSON.stringify(value), "utf8").length > PORTABLE_BACKUP_MAX_BYTES) throw new Error("备份超过 8 MB，请检查文件内容");
  const raw = value.state;
  if (!raw || !Number.isInteger(raw.version) || raw.version < 1 || raw.version > defaultState().version || PORTABLE_COLLECTIONS.some((key) => !Array.isArray(raw[key]))) throw new Error("备份状态不完整或来自较新版本");
  if (!value.providerSecrets || typeof value.providerSecrets !== "object" || Array.isArray(value.providerSecrets) || !value.ruleSetCache || typeof value.ruleSetCache !== "object" || Array.isArray(value.ruleSetCache)) throw new Error("备份凭据或规则缓存不完整");
  const state = cleanState(raw);
  if (PORTABLE_COLLECTIONS.some((key) => state[key].length !== raw[key].length)) throw new Error("备份存在无效记录，未执行恢复");
  const providerIds = new Set(state.providers.map((item) => item.id));
  const ruleSetIds = new Set(state.ruleSets.map((item) => item.id));
  const providerSecrets = {};
  for (const [id, secret] of Object.entries(value.providerSecrets)) {
    if (!providerIds.has(id) || !secret || typeof secret.token !== "string" || !secret.token || secret.token.length > 2048) throw new Error("备份中的面板凭据无效");
    providerSecrets[id] = { token: secret.token };
  }
  const ruleSetCache = {};
  for (const [id, entry] of Object.entries(value.ruleSetCache)) {
    if (!ruleSetIds.has(id) || !entry || typeof entry !== "object" || !Array.isArray(entry.rules)) throw new Error("备份中的规则缓存无效");
    ruleSetCache[id] = entry;
  }
  return { state, providerSecrets, ruleSetCache };
}
function previewPortableBackup(params) {
  const backup = preparePortableBackup(params && params.backup);
  return { exportedAt: params.backup.exportedAt, current: portableCounts(readState()), incoming: portableCounts(backup.state), providerTokens: Object.keys(backup.providerSecrets).length, ruleCaches: Object.keys(backup.ruleSetCache).length, boundAgents: backup.state.machines.filter((item) => item.monitorClientId).length };
}
function restorePortableBackup(params) {
  const backup = preparePortableBackup(params && params.backup);
  const current = readState();
  if (Number(params && params.expectedRevision) !== current.revision) throw new Error("数据已变化，请重新预览备份后再恢复");
  const previousSecrets = readProviderSecrets();
  const previousCache = readRuleSetCache();
  backup.state.revision = current.revision + 1;
  try {
    writeProviderSecrets(backup.providerSecrets);
    writeRuleSetCache(backup.ruleSetCache);
    writeState(backup.state);
  } catch (error) {
    writeProviderSecrets(previousSecrets);
    writeRuleSetCache(previousCache);
    throw error;
  }
  return readState();
}
function saveState(input) {
  const current = readState();
  const incoming = cleanState(input);
  if (incoming.revision !== current.revision) throw new Error("数据已在其他页面更新，请刷新后重试");
  // Node metadata is the single display-name source. Renaming never submits a
  // remote task; service parameters remain in the managed deployment flow.
  for (const instance of incoming.managedInstances) {
    const node = incoming.nodes.find(item => item.id === instance.nodeId);
    if (node) instance.name = node.name;
  }
  incoming.revision += 1;
  writeState(incoming);
  recordSubscriptionChanges(current, incoming);
  return incoming;
}

async function saveMachineTrafficPlan(params) {
  const state = readState();
  const machineId = cleanText(params && params.machineId, 64);
  const machine = state.machines.find((item) => item.id === machineId);
  if (!machine) throw new Error("服务器已经不存在");
  if (Number(params && params.revision) !== state.revision) throw new Error("数据已在其他页面更新，请刷新后重试");
  const plan = cleanTrafficPlan(params && params.plan);
  if (params && params.plan && params.plan.enabled === true && !plan.enabled) throw new Error("启用流量计划前请填写大于 0 的额度");
  if (machine.monitorClientId) {
    await server.call("admin:editClient", {
      uuid: machine.monitorClientId,
      traffic_limit: plan.enabled ? plan.limitBytes : 0,
      traffic_limit_type: plan.accounting,
    });
  }
  machine.trafficPlan = plan;
  state.revision += 1;
  writeState(cleanState(state));
  return { state: readState(), sync: { komari: Boolean(machine.monitorClientId), clientId: machine.monitorClientId } };
}

function secureTokenMatch(left, right) { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function readAccessLog() { try { const value = JSON.parse(fs.readFileSync(ACCESS_FILE, "utf8")); return Array.isArray(value) ? value : []; } catch (_) { return []; } }
function accessClient(userAgent) { const ua = String(userAgent || "").toLowerCase(); if (ua.includes("anywhere")) return "Anywhere"; if (ua.includes("mihomo") || ua.includes("clash")) return "Mihomo/Clash"; if (ua.includes("surge")) return "Surge"; if (ua.includes("loon")) return "Loon"; if (ua.includes("sing-box") || ua.includes("karing")) return "sing-box"; return "其它"; }
function recordSubscriptionAccess(subscriptionId, format, userAgent) { try { const events = readAccessLog(); events.push({ subscriptionId: cleanText(subscriptionId, 64), at: new Date().toISOString(), format: cleanText(format, 24), client: accessClient(userAgent) }); const next = events.slice(-500); const temporary = ACCESS_FILE + ".tmp"; fs.writeFileSync(temporary, JSON.stringify(next) + "\n", { mode: 0o600 }); fs.renameSync(temporary, ACCESS_FILE); fs.chmodSync(ACCESS_FILE, 0o600); } catch (error) { console.error("subscription access log failed", error); } }
function accessStats() { const events = readAccessLog(); const result = Object.create(null); for (const event of events) { const id = cleanText(event.subscriptionId, 64); if (!id) continue; const item = result[id] || { total: 0, lastAccessAt: "", formats: Object.create(null), clients: Object.create(null) }; item.total += 1; if (event.at > item.lastAccessAt) item.lastAccessAt = event.at; const format = cleanText(event.format, 24) || "unknown"; const client = cleanText(event.client, 40) || "其它"; item.formats[format] = (item.formats[format] || 0) + 1; item.clients[client] = (item.clients[client] || 0) + 1; result[id] = item; } return result; }
function subscriptionPreflight(params) {
  const state = readState(); const storedSubscription = state.subscriptions.find((item) => item.id === cleanText(params && params.subscriptionId, 64)); if (!storedSubscription) throw new Error("订阅不存在"); const subscription = withCachedRuleSets(storedSubscription, state);
  const selectedRuleSets = (storedSubscription.ruleSetIds || []).map((id) => state.ruleSets.find((item) => item.id === id)).filter(Boolean); const cache = readRuleSetCache();
  const nodes = uniqueNodes(subscription, state); const formats = ["anywhere", "mihomo", "sing-box", "surge", "loon"].map((format) => {
    const supported = SUPPORT[format]; const included = supported ? nodes.filter((node) => canRenderNode(format, node)) : nodes; const skipped = supported ? nodes.filter((node) => !canRenderNode(format, node)) : [];
    const isStructured = Boolean(supported); const warnings = []; if (!included.length) warnings.push("没有可输出的兼容节点"); if (isStructured && !(subscription.groups || []).length) warnings.push("未配置代理组，将生成默认 PROXY/AUTO"); if (!isStructured && ((subscription.groups || []).length || (subscription.ruleSetIds || []).length || (subscription.customRules || []).length)) warnings.push("URI 订阅只输出节点；代理组和规则由客户端或结构化格式处理"); if (subscription.policyMode === "cn-direct" && format === "sing-box") warnings.push("中国大陆直连未绑定规则集，sing-box 输出将拒绝此未绑定规则集的策略"); if (skipped.length) warnings.push(`跳过不兼容或无法无损转换的节点：${[...new Set(skipped.map((node) => node.protocol))].join("、")}`); if (isStructured) { const missing = selectedRuleSets.filter((source) => !cache[source.id]); if (missing.length) warnings.push(`规则集尚无可用缓存：${missing.map((source) => source.name).join("、")}`); const stale = selectedRuleSets.filter((source) => source.lastError && cache[source.id]); if (stale.length) warnings.push(`规则集最近刷新失败，正在沿用旧缓存：${stale.map((source) => source.name).join("、")}`); }
    const includedIds = new Set(included.map((node) => node.id));
    const nodeResults = nodes.map((node) => { const capability = protocolCapability(format, node.protocol); return { id: node.id, name: node.name, protocol: node.protocol, included: includedIds.has(node.id), delivery: includedIds.has(node.id) ? capability.mode : "unsupported", clientSupport: capability.clientSupport, reason: includedIds.has(node.id) ? (capability.mode === "passthrough" ? capability.clientSupport === "unknown" ? "原始 URI 已保留；目标客户端是否支持需由客户端确认" : "原始 URI 无损透传" : "由协议适配器转换") : !supported || !supported.has(node.protocol) ? "目标格式不支持此协议" : conversionFailure(format, node) }; });
    try { const output = render(nodes, subscription, format); validateGeneratedOutput(format, output.body); return { format, ok: included.length > 0, included: included.length, skipped: skipped.length, bytes: Buffer.from(output.body, "utf8").length, warnings, nodes: nodeResults }; } catch (error) { return { format, ok: false, included: 0, skipped: nodes.length, bytes: 0, warnings: [...warnings, cleanText(error.message, 160)], nodes: nodeResults.map((node) => ({ ...node, included: false, reason: "整体结构检查未通过" })) }; }
  });
  return { subscriptionId: subscription.id, checkedAt: new Date().toISOString(), totalNodes: nodes.length, policyMode: subscription.policyMode, formats };
}
function validateGeneratedOutput(format, body) {
  let names = []; let references = []; let builtins = [];
  if (format === "mihomo") {
    let config; try { config = yaml.load(body, { schema: yaml.JSON_SCHEMA }); } catch (error) { const location = error && error.mark ? `（第 ${error.mark.line + 1} 行，第 ${error.mark.column + 1} 列）` : ""; throw new Error(`Mihomo YAML 结构无效${location}，已隐藏含凭据的配置片段`); } const groups = config["proxy-groups"] || [];
    names = [...(config.proxies || []).map((node) => node.name), ...groups.map((group) => group.name)]; builtins = ["DIRECT", "REJECT"];
    for (const group of groups) { if (!Array.isArray(group.proxies) || !group.proxies.length) throw new Error("存在空代理组"); references.push(...group.proxies); }
    for (const rule of config.rules || []) if (String(rule).startsWith("MATCH,")) references.push(String(rule).slice(6));
  } else if (format === "sing-box") {
    const config = JSON.parse(body); names = (config.outbounds || []).map((outbound) => outbound.tag);
    for (const outbound of config.outbounds || []) if (["selector", "urltest"].includes(outbound.type)) { if (!Array.isArray(outbound.outbounds) || !outbound.outbounds.length) throw new Error("存在空代理组"); references.push(...outbound.outbounds); }
    if (config.route && config.route.final) references.push(config.route.final);
  } else if (format === "surge") {
    builtins = ['DIRECT', 'REJECT']; let section = '';
    for (const line of body.split('\n')) {
      if (line.startsWith('[')) { section = line; continue; }
      if (!line.trim()) continue;
      if (section === '[Proxy]' || section === '[Proxy Group]') {
        const split = line.indexOf(' = '); if (split < 1) throw new Error('Surge 条目格式无效');
        names.push(line.slice(0, split));
        if (section === '[Proxy Group]') { const members = line.slice(split + 3).split(',').slice(1).map(v => v.trim()).filter(v => !v.includes('=')); if (!members.length || members.some(v => !v)) throw new Error('存在空代理组'); references.push(...members); }
      }
      if (section === '[Rule]' && line.startsWith('FINAL,')) references.push(line.slice(6));
    }
  } else return;
  const available = new Set(builtins);
  for (const name of names) { if (!name || available.has(name)) throw new Error("节点或代理组名称重复、为空或占用保留名称"); available.add(name); }
  if (references.some((name) => !available.has(name))) throw new Error("代理组或默认出口引用了未输出的节点/代理组");
}
function machineFor(node, state) { return state.machines.find((machine) => machine.id === node.machineId) || {}; }
function normalizeNodeName(value) { const name = cleanText(value); if (!/(?:%[0-9a-f]{2}){2,}/i.test(name)) return name; try { return decodeURIComponent(name); } catch (_) { return name; } }
function rewriteNodeName(node) {
  if (!NAME_REWRITE_PROTOCOL_SET.has(node.protocol)) return node.uri;
  if (node.protocol === "vmess") {
    try { let raw = node.uri.slice(8).trim(); raw += "=".repeat((4 - raw.length % 4) % 4); const value = JSON.parse(Buffer.from(raw, "base64").toString("utf8")); value.ps = node.name; return "vmess://" + Buffer.from(JSON.stringify(value), "utf8").toString("base64"); } catch (_) { return node.uri; }
  }
  // URL.hash preserves '%' and '#', so encode exactly once before assignment.
  // Anywhere decodes the URI fragment once when importing the subscription.
  return String(node.uri).split('#', 1)[0] + '#' + encodeURIComponent(node.name);
}
function selectedNodeIds(subscription) {
  const result = []; const seen = new Set();
  const add = (id) => { if (id && !seen.has(id)) { seen.add(id); result.push(id); } };
  for (const id of subscription.nodeIds || []) add(id);
  for (const group of subscription.groups || []) for (const entry of group.entries || []) if (entry.kind === "node") add(entry.id);
  return result;
}
function uniqueNodes(subscription, state) {
  const nodeById = new Map(state.nodes.map((node) => [node.id, node])); const used = new Set();
  return selectedNodeIds(subscription).map((id) => nodeById.get(id)).filter((node) => node && node.enabled).map((node) => {
    const item = { ...clone(node), machine: machineFor(node, state) }; const base = normalizeNodeName(item.name) || `${item.protocol.toUpperCase()} 节点`; let name = base; let suffix = 2;
    while (used.has(name)) name = `${base} (${suffix++})`;
    used.add(name); item.name = name; item.uri = rewriteNodeName(item); return item;
  });
}
function parseNode(node) {
  if (node.protocol === "vmess") {
    let encoded = node.uri.slice(8).trim(); encoded += "=".repeat((4 - encoded.length % 4) % 4); const value = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    return { ...node, host: value.add, port: Number(value.port), uuid: value.id, alterId: Number(value.aid || 0), transport: value.net || "tcp", wsHost: value.host || "", path: value.path || "/", tls: value.tls === "tls", sni: value.sni || value.host || "" };
  }
  const url = new URL(node.uri); const query = (key, fallback = "") => url.searchParams.get(key) || fallback; const decodedUser = decodeURIComponent(url.username || "");
  if (node.protocol === "nowhere") {
    const up = query("up", "udp").toLowerCase(); const down = query("down", "udp").toLowerCase();
    if (!["udp", "tcp"].includes(up) || !["udp", "tcp"].includes(down)) throw new Error("Nowhere up/down 仅支持 udp 或 tcp");
    if (!decodedUser || !url.hostname || !Number(url.port)) throw new Error("Nowhere 链接缺少密钥、地址或端口");
    return { ...node, key: decodedUser, host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port), up, down, mux: ["1", "true"].includes(query("mux").toLowerCase()), sni: query("sni"), alpn: query("alpn") };
  }
  if (node.protocol === "ss") { let credentials = url.password ? `${decodedUser}:${decodeURIComponent(url.password)}` : decodedUser; if (!url.password) { try { let raw = credentials.replace(/-/g, "+").replace(/_/g, "/"); raw += "=".repeat((4 - raw.length % 4) % 4); const decoded = Buffer.from(raw, "base64").toString("utf8"); if (decoded.includes(":")) credentials = decoded; } catch (_) {} } const split = credentials.indexOf(":"); if (split < 1) throw new Error("Shadowsocks 链接缺少加密方式或密码"); return { ...node, host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port), cipher: credentials.slice(0, split), password: credentials.slice(split + 1) }; }
  if (node.protocol === "trojan") return { ...node, host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port), password: decodedUser, transport: query("type", "tcp"), sni: query("sni") || query("peer"), insecure: query("allowInsecure") === "1" || query("insecure") === "1" };
  if (node.protocol === "socks" || node.protocol === "socks5") return { ...node, host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port), username: decodedUser, password: decodeURIComponent(url.password || "") };
  if (node.protocol === "http" || node.protocol === "https") return { ...node, host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port || (node.protocol === "https" ? 443 : 80)), username: decodedUser, password: decodeURIComponent(url.password || ""), tls: node.protocol === "https" };
  return { ...node, host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port), uuid: decodedUser, password: decodeURIComponent(url.password || ""), security: query("security"), flow: query("flow"), transport: query("type", "tcp"), sni: query("sni"), fingerprint: query("fp", query("security") === "reality" ? "chrome" : ""), publicKey: query("pbk"), shortId: query("sid"), wsHost: query("host"), path: query("path", "/"), insecure: query("insecure", "0") === "1", alpn: query("alpn"), congestion: query("congestion_control", "bbr"), udpRelay: query("udp_relay_mode", "native"), certificateFingerprintSha256: query("pinSHA256") || node.certificate?.fingerprintSha256 || "", certificatePublicKeySha256: node.certificate?.publicKeySha256 || "" };
}
function validateNode(params) {
  const protocol = cleanText(params && params.protocol, 24).toLowerCase(); const uri = cleanText(params && params.uri, 8192);
  if (!protocol || !uri.toLowerCase().startsWith(protocol + "://")) throw new Error("协议与分享链接不匹配");
  if (!SEMANTIC_PROTOCOL_SET.has(protocol)) return { valid: true, protocol, opaque: true };
  const parsed = parseNode({ protocol, uri }); if (!parsed.host || !Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) throw new Error("节点缺少有效地址或端口"); return { valid: true, protocol, opaque: false };
}
function conversionFailure(format, node) {
  try { assertConversion(format, node); } catch (_) { return "包含尚不能无损转换或存在冲突的参数；可使用原始 URI 输出"; }
  return "节点地址、凭据或传输参数无法转换";
}
function canRenderNode(format, node) {
  const supported = SUPPORT[format]; if (!supported || !supported.has(node.protocol)) return false;
  try {
    assertConversion(format, node);
    const n = parseNode(node); if (!n.host || !Number.isInteger(n.port) || n.port < 1 || n.port > 65535) return false;
    if (format === 'surge' && [n.name, n.host, n.password, n.uuid, n.username, n.path, n.wsHost, n.sni, n.cipher].some(value => /[,\r\n=|"#]/.test(String(value || '')))) return false;
    if (format === 'surge' && n.password && !n.username && ['http', 'https', 'socks', 'socks5'].includes(n.protocol)) return false;
    if (["vless", "vmess"].includes(n.protocol) && (!n.uuid || !["tcp", "ws"].includes(n.transport))) return false;
    if (n.protocol === "trojan" && (!n.password || n.transport !== "tcp")) return false;
    if (n.protocol === "ss" && (!n.cipher || !n.password || new URL(n.uri).searchParams.has("plugin"))) return false;
    if (["hysteria2", "anytls"].includes(n.protocol) && !n.uuid) return false;
    if (n.protocol === "tuic" && (!n.uuid || !n.password)) return false;
    return true;
  } catch (_) { return false; }
}
function decodedNodeName(protocol, uri) {
  if (protocol === "vmess") { try { let raw = uri.slice(8).trim(); raw += "=".repeat((4 - raw.length % 4) % 4); return cleanText(JSON.parse(Buffer.from(raw, "base64").toString("utf8")).ps) || "VMess 节点"; } catch (_) { return "VMess 节点"; } }
  try { return cleanText(decodeURIComponent(new URL(uri).hash.replace(/^#/, ""))) || `${protocol.toUpperCase()} 节点`; } catch (_) { return `${protocol.toUpperCase()} 节点`; }
}
function nodeFingerprint(node) {
  try {
    if (node.protocol === "vmess") { let raw = node.uri.slice(8).trim(); raw += "=".repeat((4 - raw.length % 4) % 4); const value = JSON.parse(Buffer.from(raw, "base64").toString("utf8")); delete value.ps; return `vmess:${JSON.stringify(value)}`; }
    const url = new URL(node.uri); url.hash = ""; return url.toString();
  } catch (_) { return String(node.uri || "").replace(/#.*$/, ""); }
}
function clashProxyUri(proxy) {
  if (!proxy || typeof proxy !== "object") throw new Error("节点不是对象"); const type = cleanText(proxy.type, 24).toLowerCase(); const host = cleanText(proxy.server, 255); const port = Number(proxy.port); const name = cleanText(proxy.name) || `${type.toUpperCase()} 节点`; const serverHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("节点缺少有效地址或端口");
  const transport = cleanText(proxy.network || "tcp", 24); if (!["tcp", "ws"].includes(transport)) throw new Error(`暂不支持 ${transport} 传输，未导入以避免参数丢失`);
  if (proxy.plugin) throw new Error("暂不支持 Shadowsocks 插件参数，未导入以避免参数丢失");
  if (type === "vmess") { const ws = proxy["ws-opts"] || {}; return "vmess://" + Buffer.from(JSON.stringify({ v: "2", ps: name, add: host, port: String(port), id: cleanText(proxy.uuid, 128), aid: Number(proxy.alterId || 0), net: transport, host: cleanText(ws.headers && (ws.headers.Host || ws.headers.host), 255), path: cleanText(ws.path || "/", 2048), tls: proxy.tls ? "tls" : "", sni: cleanText(proxy.servername || proxy.sni, 255) }), "utf8").toString("base64"); }
  if (type === "ss") { const cipher = cleanText(proxy.cipher, 80); const password = cleanText(proxy.password, 2048); if (!cipher || !password) throw new Error("Shadowsocks 缺少加密方式或密码"); return `ss://${Buffer.from(`${cipher}:${password}`, "utf8").toString("base64")}@${serverHost}:${port}#${encodeURIComponent(name)}`; }
  if (!["vless", "trojan", "hysteria2", "tuic", "anytls", "socks5", "http", "https"].includes(type)) throw new Error(`暂不支持 ${type || "未知"} 协议`);
  if (type !== "vless" && transport !== "tcp") throw new Error(`${type} 暂不支持 ${transport} 传输导入`);
  const user = type === "vless" || type === "tuic" ? cleanText(proxy.uuid, 2048) : ["socks5", "http", "https"].includes(type) ? cleanText(proxy.username, 2048) : cleanText(proxy.password, 2048);
  const password = type === "tuic" || ["socks5", "http", "https"].includes(type) ? cleanText(proxy.password, 2048) : "";
  const url = new URL(`${type}://${encodeURIComponent(user)}${password ? `:${encodeURIComponent(password)}` : ""}@${serverHost}:${port}`);
  const set = (key, value) => { if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key, String(value)); };
  if (type === "vless") { set("type", transport); set("security", proxy["reality-opts"] ? "reality" : proxy.tls ? "tls" : "none"); set("flow", proxy.flow); set("fp", proxy["client-fingerprint"]); const reality = proxy["reality-opts"] || {}; set("pbk", reality["public-key"]); set("sid", reality["short-id"]); const ws = proxy["ws-opts"] || {}; set("path", ws.path); set("host", ws.headers && (ws.headers.Host || ws.headers.host)); }
  set("sni", proxy.servername || proxy.sni); if (proxy["skip-cert-verify"]) set("insecure", "1"); if (Array.isArray(proxy.alpn)) set("alpn", proxy.alpn.join(",")); set("congestion_control", proxy["congestion-controller"]); set("udp_relay_mode", proxy["udp-relay-mode"]); url.hash = encodeURIComponent(name); return url.toString();
}
function assertClashProxyShape(proxy) {
  assertClashFields(proxy);
  if (!proxy || typeof proxy !== "object" || Array.isArray(proxy)) throw new Error("节点不是对象");
  const scalarKeys = ["name", "type", "server", "port", "uuid", "password", "username", "cipher", "network", "servername", "sni", "flow", "client-fingerprint", "congestion-controller", "udp-relay-mode"];
  for (const key of scalarKeys) if (proxy[key] != null && !["string", "number", "boolean"].includes(typeof proxy[key])) throw new Error(`${key} 字段类型无效`);
  if (proxy.alpn != null && !Array.isArray(proxy.alpn) && typeof proxy.alpn !== "string") throw new Error("alpn 字段类型无效");
  for (const key of ["ws-opts", "reality-opts"]) if (proxy[key] != null && (typeof proxy[key] !== "object" || Array.isArray(proxy[key]))) throw new Error(`${key} 字段类型无效`);
}
function parseClashSubscription(text) {
  const document = yaml.load(text, { schema: yaml.JSON_SCHEMA }); if (!document || !Array.isArray(document.proxies)) throw new Error("Clash YAML 缺少 proxies 列表"); if (document.proxies.length > 2000) throw new Error("订阅节点超过 2000 个限制");
  const uris = []; const errors = []; document.proxies.forEach((proxy, index) => { try { assertClashProxyShape(proxy); uris.push(clashProxyUri(proxy)); } catch (error) { errors.push({ line: index + 1, message: cleanText(error.message, 160) }); } }); const parsed = parseNodeUris({ text: uris.join("\n") }); return { nodes: parsed.nodes, errors: [...errors, ...parsed.errors] };
}
function parseNodeUris(params) {
  if (String(params && params.text || '').length > 1048576) throw new Error('导入内容超过大小限制，未截断导入');
  let text = cleanText(params && params.text, 1048576);
  if (/^\s*proxies\s*:/m.test(text) || /^\s*\{[\s\S]*"proxies"\s*:/.test(text)) return parseClashSubscription(text);
  if (!text.includes("://") && /^[A-Za-z0-9+/_=\s-]+$/.test(text)) { try { const decoded = Buffer.from(text.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); if (decoded.includes("://") || /^\s*proxies\s*:/m.test(decoded)) text = decoded; } catch (_) {} }
  if (/^\s*proxies\s*:/m.test(text) || /^\s*\{[\s\S]*"proxies"\s*:/.test(text)) return parseClashSubscription(text);
  const seen = new Set(); const nodes = []; const errors = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const uri = raw.trim(); if (!uri || uri.startsWith("#")) continue; const protocol = cleanText(uri.split(":", 1)[0], 24).toLowerCase();
    if (uri.length > 8192) { errors.push({ line: index + 1, message: 'URI 过长，未截断导入' }); continue; }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) { errors.push({ line: index + 1, message: "不是有效的 URI" }); continue; }
    try { validateNode({ protocol, uri }); const item = { protocol, uri, name: decodedNodeName(protocol, uri) }; const key = nodeFingerprint(item); if (seen.has(key)) continue; seen.add(key); nodes.push(item); }
    catch (error) { errors.push({ line: index + 1, message: cleanText(error.message, 160) }); }
  }
  return { nodes, errors };
}

function yamlString(value) { return JSON.stringify(String(value == null ? "" : value)); }
function mihomoProxy(node) {
  if (!canRenderNode("mihomo", node)) return ""; const n = parseNode(node); const lines = ["  - name: " + yamlString(n.name)]; const add = (key, value, quote = false) => lines.push(`    ${key}: ${quote ? yamlString(value) : value}`);
  if (n.protocol === "vless") { add("type", "vless"); add("server", n.host, true); add("port", n.port); add("uuid", n.uuid, true); add("udp", "true"); if (n.flow) add("flow", n.flow, true); if (n.security === "tls" || n.security === "reality") { add("tls", "true"); if (n.sni) add("servername", n.sni, true); } if (n.security === "reality") { add("client-fingerprint", n.fingerprint, true); lines.push("    reality-opts:", `      public-key: ${yamlString(n.publicKey)}`, `      short-id: ${yamlString(n.shortId)}`); } if (n.transport === "ws") { add("network", "ws"); lines.push("    ws-opts:", `      path: ${yamlString(n.path || "/")}`, "      headers:", `        Host: ${yamlString(n.wsHost)}`); } }
  else if (n.protocol === "vmess") { add("type", "vmess"); add("server", n.host, true); add("port", n.port); add("uuid", n.uuid, true); add("alterId", n.alterId); add("cipher", "auto"); add("udp", "true"); if (n.tls) { add("tls", "true"); if (n.sni) add("servername", n.sni, true); } if (n.transport === "ws") { add("network", "ws"); lines.push("    ws-opts:", `      path: ${yamlString(n.path || "/")}`, "      headers:", `        Host: ${yamlString(n.wsHost)}`); } }
  else if (n.protocol === "hysteria2") { add("type", "hysteria2"); add("server", n.host, true); add("port", n.port); add("password", n.uuid, true); add("skip-cert-verify", n.insecure ? "true" : "false"); if (n.sni) add("sni", n.sni, true); }
  else if (n.protocol === "tuic") { add("type", "tuic"); add("server", n.host, true); add("port", n.port); add("uuid", n.uuid, true); add("password", n.password, true); add("congestion-controller", n.congestion); add("udp-relay-mode", n.udpRelay); add("skip-cert-verify", n.insecure ? "true" : "false"); if (n.sni) add("sni", n.sni, true); }
  else if (n.protocol === "anytls") { add("type", "anytls"); add("server", n.host, true); add("port", n.port); add("password", n.uuid, true); add("skip-cert-verify", n.insecure ? "true" : "false"); if (n.sni) add("sni", n.sni, true); }
  else if (n.protocol === "trojan") { add("type", "trojan"); add("server", n.host, true); add("port", n.port); add("password", n.password, true); add("udp", "true"); if (n.sni) add("sni", n.sni, true); add("skip-cert-verify", n.insecure ? "true" : "false"); }
  else if (n.protocol === "ss") { add("type", "ss"); add("server", n.host, true); add("port", n.port); add("cipher", n.cipher, true); add("password", n.password, true); add("udp", "true"); }
  else if (n.protocol === "socks" || n.protocol === "socks5") { add("type", "socks5"); add("server", n.host, true); add("port", n.port); if (n.username) add("username", n.username, true); if (n.password) add("password", n.password, true); add("udp", "true"); }
  else if (n.protocol === "http" || n.protocol === "https") { add("type", "http"); add("server", n.host, true); add("port", n.port); if (n.username) add("username", n.username, true); if (n.password) add("password", n.password, true); if (n.tls) add("tls", "true"); }
  return lines.join("\n");
}
function groupNames(group, subscription, nodes, supported) {
  const nodeById = new Map(nodes.map((node) => [node.id, node])); const groupById = new Map((subscription.groups || []).map((item) => [item.id, item]));
  const memo = new Map(); const visiting = new Set();
  const viable = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) throw new Error("订阅代理组存在循环引用");
    visiting.add(id); const candidate = groupById.get(id);
    const result = !!candidate && (candidate.entries || []).some((entry) => entry.kind === "group" ? viable(entry.id) : nodeById.has(entry.id) && supported.has(nodeById.get(entry.id).protocol));
    visiting.delete(id); memo.set(id, result); return result;
  };
  return (group.entries || []).map((entry) => entry.kind === "group" ? (viable(entry.id) ? groupById.get(entry.id).name : "") : ((nodeById.get(entry.id) && supported.has(nodeById.get(entry.id).protocol)) ? nodeById.get(entry.id).name : "")).filter(Boolean);
}
function renderMihomo(nodes, subscription) {
  const supportedNodes = nodes.filter((node) => canRenderNode("mihomo", node)); const blocks = supportedNodes.map(mihomoProxy).filter(Boolean); const groupLines = [];
  for (const group of subscription.groups || []) { const names = groupNames(group, subscription, supportedNodes, SUPPORT.mihomo); if (!names.length) continue; groupLines.push(`  - name: ${yamlString(group.name)}`, `    type: ${group.type}`, "    proxies:", ...names.map((name) => `      - ${yamlString(name)}`)); if (group.type !== "select") groupLines.push(`    url: ${yamlString(group.url || DEFAULT_TEST_URL)}`, `    interval: ${group.interval || 3600}`); }
  if (!groupLines.length) { const names = supportedNodes.map((node) => node.name); groupLines.push("  - name: PROXY", "    type: select", "    proxies:", "      - AUTO", ...names.map((name) => `      - ${yamlString(name)}`), "  - name: AUTO", "    type: url-test", `    url: ${yamlString(DEFAULT_TEST_URL)}`, "    interval: 3600", "    proxies:", ...names.map((name) => `      - ${yamlString(name)}`)); }
  const finalGroup = (subscription.groups || []).find((group) => groupLines.includes(`  - name: ${yamlString(group.name)}`))?.name || "PROXY";
  const rules = policyRules("mihomo", subscription, finalGroup).map((rule) => `  - ${yamlString(rule)}`);
  return ["mixed-port: 7890", "allow-lan: false", "mode: rule", "log-level: warning", "proxies:", ...blocks, "proxy-groups:", ...groupLines, "rules:", ...rules, ""].join("\n");
}
function tls(n) { const result = { enabled: true }; if (n.sni) result.server_name = n.sni; if (n.certificatePublicKeySha256) result.certificate_public_key_sha256 = [n.certificatePublicKeySha256]; else if (n.insecure) result.insecure = true; if (n.fingerprint) result.utls = { enabled: true, fingerprint: n.fingerprint.startsWith("chrome_") ? "chrome" : n.fingerprint }; if (n.security === "reality") result.reality = { enabled: true, public_key: n.publicKey, short_id: n.shortId }; if (n.alpn) result.alpn = n.alpn.split(",").map((item) => item.trim()).filter(Boolean); return result; }
function singBoxOutbound(node) {
  if (!canRenderNode("sing-box", node)) return null; const n = parseNode(node); const outbound = { tag: n.name, server: n.host, server_port: n.port };
  if (n.protocol === "vless") { Object.assign(outbound, { type: "vless", uuid: n.uuid }); if (n.flow) outbound.flow = n.flow; if (n.security === "reality" || n.security === "tls") outbound.tls = tls(n); if (n.transport === "ws") outbound.transport = { type: "ws", path: n.path || "/", ...(n.wsHost ? { headers: { Host: n.wsHost } } : {}) }; }
  else if (n.protocol === "vmess") { Object.assign(outbound, { type: "vmess", uuid: n.uuid, alter_id: n.alterId, security: "auto" }); if (n.tls) { n.security = "tls"; outbound.tls = tls(n); } if (n.transport === "ws") outbound.transport = { type: "ws", path: n.path || "/", ...(n.wsHost ? { headers: { Host: n.wsHost } } : {}) }; }
  else if (n.protocol === "hysteria2") Object.assign(outbound, { type: "hysteria2", password: n.uuid, tls: tls(n) });
  else if (n.protocol === "tuic") Object.assign(outbound, { type: "tuic", uuid: n.uuid, password: n.password, congestion_control: n.congestion, udp_relay_mode: n.udpRelay, tls: tls(n) });
  else if (n.protocol === "anytls") Object.assign(outbound, { type: "anytls", password: n.uuid, tls: tls(n) });
  else if (n.protocol === "trojan") Object.assign(outbound, { type: "trojan", password: n.password, tls: tls({ ...n, security: "tls" }) });
  else if (n.protocol === "ss") Object.assign(outbound, { type: "shadowsocks", method: n.cipher, password: n.password });
  else if (n.protocol === "socks" || n.protocol === "socks5") Object.assign(outbound, { type: "socks", version: "5", username: n.username || undefined, password: n.password || undefined });
  else if (n.protocol === "http" || n.protocol === "https") Object.assign(outbound, { type: "http", username: n.username || undefined, password: n.password || undefined, ...(n.tls ? { tls: { enabled: true } } : {}) });
  return outbound;
}
function renderSingBox(nodes, subscription) {
  if ((subscription.groups || []).some(group => !['select', 'url-test'].includes(group.type))) throw new Error('sing-box 不支持无损转换此代理组类型');
  if (subscription.policyMode === 'cn-direct') throw new Error('sing-box 中国大陆直连需要显式规则，不能隐式转换');
  const supportedNodes = nodes.filter((node) => canRenderNode("sing-box", node)); const outbounds = supportedNodes.map(singBoxOutbound).filter(Boolean); const groups = [];
  for (const group of subscription.groups || []) { const names = groupNames(group, subscription, supportedNodes, SUPPORT["sing-box"]); if (!names.length) continue; if (group.type === "url-test") groups.push({ type: "urltest", tag: group.name, outbounds: names, url: group.url || DEFAULT_TEST_URL, interval: `${group.interval || 3600}s` }); else groups.push({ type: "selector", tag: group.name, outbounds: names }); }
  if (!groups.length) { const tags = outbounds.map((outbound) => outbound.tag); groups.push({ type: "selector", tag: "PROXY", outbounds: ["AUTO", ...tags] }, { type: "urltest", tag: "AUTO", outbounds: tags, url: DEFAULT_TEST_URL, interval: "3600s" }); }
  const rules = policyRules("sing-box", subscription, groups[0]?.tag || "DIRECT");
  return JSON.stringify({ log: { level: "warn", timestamp: true }, inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }], outbounds: [...outbounds, ...groups, { type: "direct", tag: "DIRECT" }], route: { auto_detect_interface: true, rules, final: groups[0]?.tag || "DIRECT" } }, null, 2) + "\n";
}
function renderSurge(nodes, subscription) {
  if ((subscription.groups || []).some(group => !['select', 'url-test'].includes(group.type) || /[,=\r\n\[\]]/.test(group.name) || /[,\r\n]/.test(group.url || ''))) throw new Error('Surge 代理组参数不能无损转换');
  const lines = [];
  const supportedNodes = nodes.filter((item) => canRenderNode("surge", item));
  for (const node of supportedNodes) { const n = parseNode(node); const common = `${n.name} = `; if (n.protocol === "vmess") lines.push(`${common}vmess, ${n.host}, ${n.port}, username=${n.uuid}, ws=${n.transport === "ws"}, ws-path=${n.path || "/"}, ws-headers=Host:${n.wsHost}, tls=${n.tls}, sni=${n.sni}, skip-cert-verify=false`); else if (n.protocol === "hysteria2") lines.push(`${common}hysteria2, ${n.host}, ${n.port}, password=${n.uuid}, sni=${n.sni}, skip-cert-verify=${n.insecure}`); else if (n.protocol === "tuic") lines.push(`${common}tuic-v5, ${n.host}, ${n.port}, uuid=${n.uuid}, password=${n.password}, sni=${n.sni}, skip-cert-verify=${n.insecure}`); else if (n.protocol === "anytls") lines.push(`${common}anytls, ${n.host}, ${n.port}, password=${n.uuid}, sni=${n.sni}, skip-cert-verify=${n.insecure}`); else if (n.protocol === "trojan") lines.push(`${common}trojan, ${n.host}, ${n.port}, password=${n.password}, sni=${n.sni}, skip-cert-verify=${n.insecure}`); else if (n.protocol === "ss") lines.push(`${common}ss, ${n.host}, ${n.port}, encrypt-method=${n.cipher}, password=${n.password}, udp-relay=true`); else if (n.protocol === "socks" || n.protocol === "socks5") lines.push(`${common}socks5, ${n.host}, ${n.port}${n.username ? `, username=${n.username}, password=${n.password}` : ""}, udp-relay=true`); else if (n.protocol === "http" || n.protocol === "https") lines.push(`${common}${n.protocol}, ${n.host}, ${n.port}${n.username ? `, username=${n.username}, password=${n.password}` : ""}`); }
  const groupLines = [];
  for (const group of subscription.groups || []) { const names = groupNames(group, subscription, supportedNodes, SUPPORT.surge); if (!names.length) continue; const type = group.type === "url-test" ? "url-test" : group.type; groupLines.push(`${group.name} = ${type}, ${names.join(", ")}${type === "url-test" ? `, url=${group.url || DEFAULT_TEST_URL}, interval=${group.interval || 3600}` : ""}`); }
  if (!groupLines.length) groupLines.push(`PROXY = select, ${lines.map((line) => line.split(" = ")[0]).join(", ")}`);
  const rules = policyRules("surge", subscription, groupLines[0].split(" = ")[0]);
  return `[General]\nloglevel = notify\n\n[Proxy]\n${lines.join("\n")}\n\n[Proxy Group]\n${groupLines.join("\n")}\n\n[Rule]\n${rules.join("\n")}\n`;
}
function render(nodes, subscription, format) {
  if (SUPPORT[format]) {
    const groups = subscription.groups || []; const byId = new Map(groups.map(group => [group.id, group]));
    const visiting = new Set(); const visited = new Set();
    function visit(group) {
      if (visiting.has(group.id)) throw new Error('订阅代理组存在循环引用');
      if (visited.has(group.id)) return;
      if (!['select', 'url-test', 'fallback', 'load-balance'].includes(group.type)) throw new Error('未知代理组类型');
      if (/[,\r\n]/.test(group.name)) throw new Error('代理组名称包含规则格式无法表达的分隔符');
      visiting.add(group.id);
      for (const entry of group.entries || []) if (entry.kind === 'group') { const target = byId.get(entry.id); if (!target) throw new Error('代理组引用不存在'); visit(target); }
      visiting.delete(group.id); visited.add(group.id);
    }
    for (const group of groups) visit(group);
  }
  const raw = nodes.map((node) => node.uri).join("\n") + "\n";
  if (format === "raw") return { body: raw, type: "text/plain; charset=utf-8" };
  if (["base64", "anywhere", "loon"].includes(format)) return { body: Buffer.from(raw, "utf8").toString("base64"), type: "text/plain; charset=utf-8" };
  if (format === "mihomo") return { body: renderMihomo(nodes, subscription), type: "text/yaml; charset=utf-8" };
  if (format === "sing-box") return { body: renderSingBox(nodes, subscription), type: "application/json; charset=utf-8" };
  if (format === "surge") return { body: renderSurge(nodes, subscription), type: "text/plain; charset=utf-8" };
  throw new Error("未知订阅格式");
}
function requestedFormat(req) {
  const explicit = String(req.query.format || "").toLowerCase();
  if (["raw", "base64", "anywhere", "mihomo", "sing-box", "surge", "loon"].includes(explicit)) return explicit;
  const ua = String(req.headers["user-agent"] || "").toLowerCase();
  if (ua.includes("anywhere")) return "anywhere"; if (ua.includes("clash") || ua.includes("mihomo")) return "mihomo"; if (ua.includes("surge")) return "surge"; if (ua.includes("loon")) return "loon"; if (ua.includes("sing-box") || ua.includes("karing")) return "sing-box"; return "base64";
}
function subscriptionTraffic(state, subscription) {
  const quota = subscription && subscription.quota || { mode: "none" };
  let traffic = null;
  if (quota.mode === "manual") traffic = cleanTrafficMetadata(quota);
  if (quota.mode === "external") traffic = cleanTrafficMetadata(state.externalSources.find((item) => item.id === quota.sourceId)?.traffic);
  if (quota.mode === "provider") {
    const provider = state.providers.find((item) => item.id === quota.sourceId);
    const client = provider && provider.clients.find((item) => item.id === quota.clientId);
    traffic = client ? cleanTrafficMetadata(client) : null;
  }
  if (!traffic) traffic = { upload: 0, download: 0, total: 0, expire: 0, observedAt: "" };
  const configuredExpire = subscription.expiresAt ? Math.floor(Date.parse(subscription.expiresAt) / 1000) : 0;
  if (configuredExpire && (!traffic.expire || configuredExpire < traffic.expire)) traffic = { ...traffic, expire: configuredExpire };
  return traffic;
}
function subscriptionAvailability(state, subscription, now = Date.now()) {
  if (!subscription || subscription.enabled === false) return { available: false, reason: "disabled", traffic: null };
  const traffic = subscriptionTraffic(state, subscription);
  if (traffic.expire && traffic.expire * 1000 <= now) return { available: false, reason: "expired", traffic };
  if (traffic.total && traffic.upload + traffic.download >= traffic.total) return { available: false, reason: "exhausted", traffic };
  return { available: true, reason: "", traffic };
}
function subscriptionUserinfo(traffic) {
  if (!traffic || !(traffic.upload || traffic.download || traffic.total || traffic.expire)) return "";
  return `upload=${cleanByteCount(traffic.upload)}; download=${cleanByteCount(traffic.download)}; total=${cleanByteCount(traffic.total)}; expire=${cleanByteCount(traffic.expire)}`;
}
function publicSubscription(req, res) {
  try {
    const pathname = String(req.url || "").split("?", 1)[0]; const token = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1)); const state = readState(); const subscription = state.subscriptions.find((item) => secureTokenMatch(item.token, token));
    const availability = subscriptionAvailability(state, subscription);
    if (!availability.available) { res.statusCode = 404; res.end("not found"); return; }
    const nodes = uniqueNodes(subscription, state); const format = requestedFormat(req); const output = render(nodes, withCachedRuleSets(subscription, state), format); validateGeneratedOutput(format, output.body);
    res.setHeader("Content-Type", output.type); res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Profile-Update-Interval", "24");
    res.setHeader("Profile-Title", "base64:" + Buffer.from(subscription.name, "utf8").toString("base64"));
    const userinfo = subscriptionUserinfo(availability.traffic); if (userinfo) res.setHeader("Subscription-Userinfo", userinfo);
    if (SUPPORT[format]) res.setHeader("X-Proxy-Console-Skipped", String(nodes.filter((node) => !canRenderNode(format, node)).length));
    recordSubscriptionAccess(subscription.id, format, req.headers["user-agent"]); res.end(output.body);
  } catch (error) { console.error("subscription render failed", error); res.statusCode = 500; res.end("subscription render failed"); }
}

function readProviderSecrets() {
  try { const value = JSON.parse(fs.readFileSync(PROVIDER_SECRETS_FILE, "utf8")); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch (_) { return {}; }
}
function writeProviderSecrets(value) {
  const temporary = PROVIDER_SECRETS_FILE + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, PROVIDER_SECRETS_FILE); fs.chmodSync(PROVIDER_SECRETS_FILE, 0o600);
}
function providerAdapter(provider) {
  if (["s-ui", "2s-ui"].includes(provider.type)) return createSuiProvider({ type: provider.type });
  throw new Error("暂不支持该外部面板类型");
}
function providerAndSecret(providerId) {
  const state = readState(); const provider = state.providers.find((item) => item.id === cleanText(providerId, 64));
  if (!provider) throw new Error("外部面板不存在");
  const secret = readProviderSecrets()[provider.id];
  if (!secret || !cleanText(secret.token, 2048)) throw new Error("请先保存外部面板 API Token");
  return { state, provider, secret };
}
function saveProvider(params) {
  const input = params && params.provider || {}; const state = readState();
  const id = cleanText(input.id, 64) || `provider-${randomId()}`; const existing = state.providers.find((item) => item.id === id);
  if (!cleanText(input.name, 80)) throw new Error("请填写外部面板名称");
  if (!["s-ui", "2s-ui"].includes(input.type)) throw new Error("请选择支持的外部面板类型");
  const normalizedBaseUrl = normalizeSuiBaseUrl(input.baseUrl);
  const provider = cleanProvider({ ...existing, ...input, id, baseUrl: normalizedBaseUrl, hasToken: Boolean(cleanText(params && params.token, 2048)) || existing?.hasToken === true });
  if (!provider.baseUrl) throw new Error("请输入有效的面板地址");
  const secrets = readProviderSecrets(); const token = cleanText(params && params.token, 2048);
  if (token) secrets[id] = { token }; else if (!secrets[id]) provider.hasToken = false;
  const index = state.providers.findIndex((item) => item.id === id);
  if (index < 0) state.providers.push(provider); else state.providers[index] = provider;
  state.revision += 1; writeProviderSecrets(secrets); writeState(cleanState(state));
  return { state: readState(), providerId: id };
}
function deleteProvider(params) {
  const id = cleanText(params && params.providerId, 64); const state = readState();
  if (!state.providers.some((item) => item.id === id)) throw new Error("外部面板不存在");
  state.providers = state.providers.filter((item) => item.id !== id);
  for (const node of state.nodes.filter((item) => item.source === "provider" && item.sourceId === id)) { node.enabled = false; node.providerMissing = true; node.sourceId = ""; }
  const secrets = readProviderSecrets(); delete secrets[id];
  state.revision += 1; writeProviderSecrets(secrets); writeState(cleanState(state)); return readState();
}
async function testProvider(params) {
  const { provider, secret } = providerAndSecret(params && params.providerId); const checkedAt = new Date().toISOString();
  try {
    const result = await providerAdapter(provider).test(provider, secret); const state = readState(); const current = state.providers.find((item) => item.id === provider.id);
    if (current) { Object.assign(current, { lastTestAt: checkedAt, lastSuccessAt: checkedAt, lastError: "", status: result.status ? (result.status.running ? `running:${result.status.version || "unknown"}` : `stopped:${result.status.version || "unknown"}`) : current.status, inboundCount: result.inbounds, clientCount: result.clients, linkCount: result.links, clients: result.clientRecords || current.clients }); state.revision += 1; writeState(cleanState(state)); }
    return { ...result, checkedAt, state: readState() };
  } catch (error) {
    const state = readState(); const current = state.providers.find((item) => item.id === provider.id);
    if (current) { current.lastTestAt = checkedAt; current.lastError = cleanText(error.message, 240); state.revision += 1; writeState(cleanState(state)); }
    throw error;
  }
}
function providerPreview(state, provider, discovery) {
  const existing = new Map(state.nodes.filter((node) => node.source === "provider" && node.sourceId === provider.id && node.remoteId).map((node) => [node.remoteId, node]));
  const candidates = []; const unsupported = [...discovery.unsupported];
  for (const candidate of discovery.candidates) {
    const parsed = parseNodeUris({ text: candidate.uri }); const incoming = parsed.nodes[0];
    if (!incoming) { unsupported.push({ remoteId: candidate.remoteId, name: candidate.remoteName, reason: parsed.errors[0]?.message || "分享链接无法导入" }); continue; }
    const current = existing.get(candidate.remoteId); const changed = current && (current.uri !== candidate.uri || current.remoteName !== candidate.remoteName || current.providerMissing);
    candidates.push({ ...candidate, protocol: incoming.protocol, action: !current ? "create" : changed ? "update" : "unchanged", localId: current?.id || "", localName: current?.name || "", locallyRenamed: Boolean(current && current.remoteName && current.name !== current.remoteName) });
  }
  const remoteIds = new Set(discovery.candidates.map((item) => item.remoteId));
  const missing = [...existing.values()].filter((node) => !remoteIds.has(node.remoteId)).map((node) => ({ localId: node.id, remoteId: node.remoteId, name: node.name, alreadyMissing: node.providerMissing }));
  return { provider: { id: provider.id, name: provider.name, type: provider.type, baseUrl: provider.baseUrl }, inbounds: discovery.inbounds, clients: discovery.clients, candidates, unsupported, missing, summary: { create: candidates.filter((item) => item.action === "create").length, update: candidates.filter((item) => item.action === "update").length, unchanged: candidates.filter((item) => item.action === "unchanged").length, pending: discovery.inbounds.filter((item) => item.readiness !== "ready").length, missing: missing.length, unsupported: unsupported.length } };
}
async function previewProviderSync(params) {
  const { state, provider, secret } = providerAndSecret(params && params.providerId); const discovery = await providerAdapter(provider).discover(provider, secret); return providerPreview(state, provider, discovery);
}
function uniqueProviderNodeName(state, desired, ownId = "") {
  const used = new Set(state.nodes.filter((node) => node.id !== ownId).map((node) => node.name)); const base = normalizeNodeName(desired) || "S-UI 节点"; let name = base; let index = 2;
  while (used.has(name)) name = `${base} · S-UI ${index++}`;
  return name;
}
async function applyProviderSync(params) {
  const { provider, secret } = providerAndSecret(params && params.providerId); const discovery = await providerAdapter(provider).discover(provider, secret); const state = readState(); const currentProvider = state.providers.find((item) => item.id === provider.id);
  if (!currentProvider || currentProvider.baseUrl !== provider.baseUrl) throw new Error("外部面板已在同步期间变化，请重新预览");
  const preview = providerPreview(state, currentProvider, discovery); const selected = new Set(Array.isArray(params && params.remoteIds) ? params.remoteIds.map((id) => cleanText(id, 240)) : preview.candidates.map((item) => item.remoteId));
  const byRemote = new Map(state.nodes.filter((node) => node.source === "provider" && node.sourceId === provider.id && node.remoteId).map((node) => [node.remoteId, node]));
  const missingActions = params && params.missingActions && typeof params.missingActions === "object" ? params.missingActions : {};
  let created = 0; let updated = 0; let unchanged = 0; let disabled = 0; let deleted = 0; let detached = 0;
  for (const candidate of preview.candidates.filter((item) => selected.has(item.remoteId))) {
    const parsed = parseNodeUris({ text: candidate.uri }); const incoming = parsed.nodes[0]; if (!incoming) continue;
    let node = byRemote.get(candidate.remoteId);
    if (!node) {
      node = { id: randomId(), name: uniqueProviderNodeName(state, candidate.remoteName), protocol: incoming.protocol, machineId: "", uri: candidate.uri, enabled: candidate.enabled, tags: [provider.name, provider.type === "2s-ui" ? "2S-UI" : "S-UI"], source: "provider", sourceId: provider.id, remoteId: candidate.remoteId, remoteName: candidate.remoteName, remoteClientName: candidate.clientName, remoteInboundName: candidate.inboundName, providerMissing: false };
      state.nodes.push(node); byRemote.set(candidate.remoteId, node); created += 1;
    } else {
      const locallyRenamed = node.remoteName && node.name !== node.remoteName; const name = locallyRenamed ? node.name : uniqueProviderNodeName(state, candidate.remoteName, node.id);
      const changed = node.uri !== candidate.uri || node.protocol !== incoming.protocol || node.remoteName !== candidate.remoteName || node.providerMissing || node.enabled !== candidate.enabled;
      Object.assign(node, { name, protocol: incoming.protocol, uri: candidate.uri, enabled: candidate.enabled, source: "provider", sourceId: provider.id, remoteId: candidate.remoteId, remoteName: candidate.remoteName, remoteClientName: candidate.clientName, remoteInboundName: candidate.inboundName, providerMissing: false });
      if (changed) updated += 1; else unchanged += 1;
    }
  }
  const remoteIds = new Set(discovery.candidates.map((item) => item.remoteId));
  const deleteIds = new Set();
  for (const node of byRemote.values()) {
    if (remoteIds.has(node.remoteId)) continue;
    const action = ["retain", "delete", "detach"].includes(missingActions[node.id]) ? missingActions[node.id] : "retain";
    if (action === "delete") { deleteIds.add(node.id); deleted += 1; continue; }
    if (action === "detach") {
      Object.assign(node, { source: "manual", sourceId: "", remoteId: "", remoteName: "", remoteClientName: "", remoteInboundName: "", providerMissing: false });
      detached += 1; continue;
    }
    if (!node.providerMissing || node.enabled) disabled += 1;
    node.providerMissing = true; node.enabled = false;
  }
  if (deleteIds.size) {
    state.nodes = state.nodes.filter((node) => !deleteIds.has(node.id));
    state.subscriptions = state.subscriptions.map((subscription) => ({
      ...subscription,
      nodeIds: (subscription.nodeIds || []).filter((id) => !deleteIds.has(id)),
      groups: (subscription.groups || []).map((group) => ({ ...group, entries: (group.entries || []).filter((entry) => entry.kind !== "node" || !deleteIds.has(entry.id)) })),
    }));
    state.externalSources = state.externalSources.map((source) => ({ ...source, nodeIds: (source.nodeIds || []).filter((id) => !deleteIds.has(id)) }));
  }
  const now = new Date().toISOString(); Object.assign(currentProvider, { lastSyncAt: now, lastSuccessAt: now, lastError: "", status: discovery.status ? (discovery.status.running ? `running:${discovery.status.version || "unknown"}` : `stopped:${discovery.status.version || "unknown"}`) : currentProvider.status, inboundCount: discovery.inbounds.length, clientCount: discovery.clients.length, linkCount: discovery.candidates.length, clients: discovery.clients });
  state.revision += 1; writeState(cleanState(state)); return { state: readState(), created, updated, unchanged, disabled, deleted, detached, unsupported: preview.unsupported.length };
}
function startProviderOperation(params) {
  const action = cleanText(params && params.action, 24); const runners = { test: testProvider, preview: previewProviderSync, apply: applyProviderSync };
  if (!runners[action]) throw new Error("不支持的外部面板操作");
  const input = params && params.input || {}; const signature = crypto.createHash("sha256").update(JSON.stringify({ action, input })).digest("hex").slice(0, 24);
  const operationId = requestOperationId(params); const existing = PROVIDER_OPERATIONS.get(operationId);
  if (existing) { if (existing.signature !== signature) throw new Error("requestId 已用于其他外部面板操作"); return { operationId, phase: existing.phase }; }
  PROVIDER_OPERATIONS.set(operationId, { phase: "running", action, signature, startedAt: new Date().toISOString() });
  Promise.resolve().then(() => runners[action](input)).then((result) => {
    PROVIDER_OPERATIONS.set(operationId, { phase: "completed", action, signature, startedAt: PROVIDER_OPERATIONS.get(operationId)?.startedAt || "", completedAt: new Date().toISOString(), result });
  }).catch((error) => {
    PROVIDER_OPERATIONS.set(operationId, { phase: "failed", action, signature, startedAt: PROVIDER_OPERATIONS.get(operationId)?.startedAt || "", completedAt: new Date().toISOString(), error: cleanText(error && error.message, 240) || "外部面板操作失败" });
  });
  const cleanupTimer = setTimeout(() => PROVIDER_OPERATIONS.delete(operationId), 5 * 60 * 1000);
  if (cleanupTimer && typeof cleanupTimer.unref === "function") cleanupTimer.unref();
  return { operationId, phase: "running" };
}
function getProviderOperation(params) {
  const operationId = cleanText(params && params.operationId, 64); const operation = PROVIDER_OPERATIONS.get(operationId);
  if (!operation) throw new Error("外部面板任务不存在或已过期");
  return clone(operation);
}

async function fetchDocument(url) {
  const controller = typeof AbortController === "function" ? new AbortController() : null; const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;
  try { const response = await fetch(cleanHttpUrl(url, false), { redirect: "follow", signal: controller && controller.signal, headers: { "User-Agent": "Wherever-Station/0.63" } }); if (!response.ok) throw new Error(`远端内容返回 HTTP ${response.status}`); const length = Number(response.headers.get("content-length") || 0); if (length > 1048576) throw new Error("远端内容超过 1 MiB 限制"); const text = await response.text(); if (text.length > 1048576) throw new Error("远端内容超过 1 MiB 限制"); return { text, subscriptionUserinfo: response.headers.get("subscription-userinfo") || "" }; }
  finally { if (timer) clearTimeout(timer); }
}
async function fetchText(url) { return (await fetchDocument(url)).text; }
async function syncExternalSource(params) {
  const sourceId = cleanText(params && params.sourceId, 64); const initialState = readState(); const initialSource = initialState.externalSources.find((item) => item.id === sourceId); if (!initialSource) throw new Error("订阅源不存在");
  try {
    const fetched = await fetchDocument(initialSource.url); const parsed = parseNodeUris({ text: fetched.text }); if (!parsed.nodes.length) throw new Error(parsed.errors[0]?.message || "订阅源没有可识别的 URI");
    const state = readState(); const source = state.externalSources.find((item) => item.id === sourceId); if (!source) throw new Error("订阅源已被删除"); if (source.url !== initialSource.url) throw new Error("订阅地址已在同步期间变化，请重新同步");
    const existing = state.nodes.filter((node) => node.sourceId === source.id); const byFingerprint = new Map(existing.map((node) => [nodeFingerprint(node), node])); const activeIds = []; let created = 0; let updated = 0;
    for (const incoming of parsed.nodes) { let node = byFingerprint.get(nodeFingerprint(incoming)); if (!node) { node = { id: randomId(), ...incoming, machineId: source.machineId, tags: source.tags, source: "external", sourceId: source.id, enabled: true }; state.nodes.push(node); created += 1; } else { Object.assign(node, { ...incoming, machineId: source.machineId, tags: source.tags, source: "external", sourceId: source.id, enabled: true }); updated += 1; } activeIds.push(node.id); }
    const activeSet = new Set(activeIds); let disabled = 0; for (const node of existing) if (!activeSet.has(node.id) && node.enabled) { node.enabled = false; disabled += 1; }
    source.nodeIds = activeIds; source.lastSyncAt = new Date().toISOString(); source.lastError = ""; source.traffic = parseSubscriptionUserinfo(fetched.subscriptionUserinfo, source.lastSyncAt); state.revision += 1; writeState(cleanState(state)); return { state: readState(), created, updated, disabled, errors: parsed.errors.length, traffic: source.traffic };
  } catch (error) { const state = readState(); const source = state.externalSources.find((item) => item.id === sourceId); if (source) { source.lastError = cleanText(error.message, 240); source.lastSyncAt = new Date().toISOString(); state.revision += 1; writeState(cleanState(state)); } throw error; }
}
function startExternalSourceOperation(params) {
  const input = { sourceId: cleanText(params && params.sourceId, 64) };
  if (!input.sourceId) throw new Error("订阅源不存在");
  const operationId = requestOperationId(params);
  const signature = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);
  const existing = SOURCE_OPERATIONS.get(operationId);
  if (existing) {
    if (existing.signature !== signature) throw new Error("requestId 已用于其他订阅源操作");
    return { operationId, phase: existing.phase };
  }
  SOURCE_OPERATIONS.set(operationId, { phase: "running", signature, startedAt: new Date().toISOString() });
  Promise.resolve().then(() => syncExternalSource(input)).then((result) => {
    SOURCE_OPERATIONS.set(operationId, { phase: "completed", signature, startedAt: SOURCE_OPERATIONS.get(operationId)?.startedAt || "", completedAt: new Date().toISOString(), result });
  }).catch((error) => {
    SOURCE_OPERATIONS.set(operationId, { phase: "failed", signature, startedAt: SOURCE_OPERATIONS.get(operationId)?.startedAt || "", completedAt: new Date().toISOString(), error: cleanText(error && error.message, 240) || "订阅源同步失败" });
  });
  const cleanupTimer = setTimeout(() => SOURCE_OPERATIONS.delete(operationId), 5 * 60 * 1000);
  if (cleanupTimer && typeof cleanupTimer.unref === "function") cleanupTimer.unref();
  return { operationId, phase: "running" };
}
function getExternalSourceOperation(params) {
  const operationId = cleanText(params && params.operationId, 64); const operation = SOURCE_OPERATIONS.get(operationId);
  if (!operation) throw new Error("订阅源任务不存在或已过期");
  return clone(operation);
}
async function syncRuleSet(params) {
  const id = cleanText(params && params.ruleSetId, 64); const initial = readState(); const expected = initial.ruleSets.find((item) => item.id === id); if (!expected) throw new Error("规则集不存在");
  const attemptedAt = new Date().toISOString();
  try {
    const text = await fetchText(expected.url); const rules = parseRuleSetText(text, expected.action); const version = crypto.createHash("sha256").update(JSON.stringify(rules)).digest("hex").slice(0, 12);
    const state = readState(); const source = state.ruleSets.find((item) => item.id === id); if (!source) throw new Error("规则集已被删除"); if (source.url !== expected.url || source.action !== expected.action) throw new Error("规则集地址或动作已变化，请重新刷新");
    const cache = readRuleSetCache(); cache[id] = { version, fetchedAt: attemptedAt, rules }; writeRuleSetCache(cache);
    Object.assign(source, { lastSyncAt: attemptedAt, lastSuccessAt: attemptedAt, lastError: "", version, entryCount: rules.length }); state.revision += 1; writeState(cleanState(state)); return { state: readState(), version, entryCount: rules.length, usingCache: false };
  } catch (error) {
    const state = readState(); const source = state.ruleSets.find((item) => item.id === id); const cache = readRuleSetCache()[id]; if (source) { source.lastSyncAt = attemptedAt; source.lastError = cleanText(error.message, 240); state.revision += 1; writeState(cleanState(state)); }
    const failure = new Error(`${cleanText(error.message, 180)}${cache ? "；已继续使用最后成功缓存" : ""}`); throw failure;
  }
}
function deleteRuleSet(params) {
  const id = cleanText(params && params.ruleSetId, 64); const state = readState(); if (!state.ruleSets.some((item) => item.id === id)) throw new Error("规则集不存在"); const before = clone(state);
  state.ruleSets = state.ruleSets.filter((item) => item.id !== id); state.subscriptions = state.subscriptions.map((sub) => ({ ...sub, ruleSetIds: (sub.ruleSetIds || []).filter((value) => value !== id) })); const cache = readRuleSetCache(); delete cache[id]; writeRuleSetCache(cache); state.revision += 1; const cleaned = cleanState(state); writeState(cleaned); recordSubscriptionChanges(before, cleaned); return readState();
}
async function syncDueSources() {
  const state = readState(); const now = Date.now();
  for (const source of state.externalSources.filter((item) => item.enabled)) { const last = Date.parse(source.lastSyncAt || "") || 0; if (now - last >= source.refreshIntervalHours * 3600000) { try { await syncExternalSource({ sourceId: source.id }); } catch (error) { console.error(`external source ${source.id} sync failed`, error); } } }
  for (const source of state.ruleSets.filter((item) => item.enabled)) { const last = Date.parse(source.lastSyncAt || "") || 0; if (now - last >= 24 * 3600000) { try { await syncRuleSet({ ruleSetId: source.id }); } catch (error) { console.error(`rule set ${source.id} sync failed`, error); } } }
}
function serviceCommand(params) { const service = cleanText(params && params.service, 32); const action = cleanText(params && params.action, 16); if (!SERVICE_UNITS[service] || !SERVICE_ACTIONS.has(action)) throw new Error("服务或操作不在允许列表"); return { command: `/usr/bin/systemctl ${action} ${SERVICE_UNITS[service]}`, service, action }; }
function statusCommand() { return { command: buildServiceStatus() }; }
function prepareExistingServiceDiscovery(params) {
  const state = readState();
  const machine = state.machines.find((item) => item.id === cleanText(params && params.machineId, 64) && item.monitorClientId);
  if (!machine) throw new Error("请选择已绑定 Agent 的服务器");
  const publicHost = cleanText(params && params.publicHost, 253);
  if (publicHost && /[\s/?#@]/.test(publicHost)) throw new Error("公网域名或 IP 格式无效");
  return { clientId: machine.monitorClientId, command: buildExistingServiceDiscoveryCommand({ publicHost, machineName: machine.name }) };
}
function parseExistingServiceDiscovery(params) {
  const result = parseExistingServiceDiscoveryOutput(params && params.output);
  if (!result.ok) throw new Error(cleanText(result.error, 200) || "发现现有服务失败");
  return result;
}
function newManagedNowhereValues() {
  return { id: `nw-${randomId()}`, key: crypto.randomBytes(24).toString("hex"), version: "v2.0.0", port: 2077, tcpPort: 2077, udpPort: 2077, tcpCarrier: "tcp", udpCarrier: "udp", morph: 0, transportMemoryProfile: "throughput" };
}
function managedNowherePorts(value) {
  const port = Number(value && value.port) || 0;
  const capabilities = nowhereCapabilities(value && value.version);
  if (capabilities.isV2) return [
    Number(value && value.tcpPort) ? `tcp:${Number(value.tcpPort)}` : "",
    Number(value && value.udpPort) ? `udp:${Number(value.udpPort)}` : "",
  ].filter(Boolean);
  const network = value && value.network || "mix";
  return [network !== "udp" && port ? `tcp:${port}` : "", network !== "tcp" && port ? `udp:${port}` : ""].filter(Boolean);
}
function hasManagedNowherePortConflict(instances, machineId, candidate, ignoredId = "") {
  const wanted = new Set(managedNowherePorts(candidate));
  return instances.some((item) => item.kind === "nowhere" && item.machineId === machineId && item.id !== ignoredId && item.status !== "failed"
    && managedNowherePorts(item).some((entry) => wanted.has(entry)));
}
function managedNowherePlanInput(instance, node) {
  let parsed;
  try { parsed = new URL(node.uri); } catch (_) { throw new Error("托管实例关联的 Nowhere 节点链接无效"); }
  let key = parsed.username;
  try { key = decodeURIComponent(key); } catch (_) {}
  return { ...instance, id: instance.id, key, name: instance.name };
}
function publicManagedNowherePlan(plan) {
  return {
    schema: plan.schema, id: plan.id, kind: plan.kind, summary: plan.summary,
    capabilities: nowhereCapabilities(plan.version), links: plan.links, directory: plan.directory,
    unitName: plan.unitName, certificate: {
      mode: plan.certificateMode, certificatePath: plan.certificatePath,
      privateKeyPath: plan.privateKeyPath, host: plan.certificateHost, days: plan.certificateDays,
    }, safeguards: plan.safeguards,
  };
}
function previewManagedNowhere(params) {
  let input = params && params.input && typeof params.input === "object" ? params.input : {};
  const state = readState(); input = certificateDeploymentInput(state, input, cleanText(input.machineId, 64), "nowhere");
  if (!nowhereCapabilities(input.version).verified) throw new Error("该 Nowhere 版本尚未通过 Wherever Station 适配验证，只能识别，不能生成配置");
  return publicManagedNowherePlan(planManagedNowhere(input));
}
function createManagedNowhereDraft(params) {
  let input = params && params.input && typeof params.input === "object" ? params.input : {};
  const state = readState();
  const machineId = cleanText(input.machineId, 64);
  const machine = state.machines.find((item) => item.id === machineId && item.monitorClientId);
  if (!machine) throw new Error("请选择已绑定 Komari Agent 的服务器");
  input = certificateDeploymentInput(state, input, machineId, "nowhere");
  if (!nowhereCapabilities(input.version).verified) throw new Error("该 Nowhere 版本尚未通过适配验证，不能创建实例");
  const plan = planManagedNowhere(input);
  if (input.client === "vector") throw new Error("托管节点至少需要生成 Anywhere 链接；可选择 Anywhere 或两者");
  if (state.managedInstances.some((item) => item.id === plan.id)) throw new Error("托管实例编号已经存在");
  if (hasManagedNowherePortConflict(state.managedInstances, machineId, plan.summary)) throw new Error("该宿主已有托管实例使用相同的传输协议与端口");
  const nodeId = randomId(); const now = new Date().toISOString();
  const certificate = input.certificateAssetId ? { assetId: cleanText(input.certificateAssetId, 64), selfSigned: input.certificateSelfSigned === true, fingerprintSha256: cleanText(input.certificateFingerprintSha256, 64), publicKeySha256: cleanText(input.certificatePublicKeySha256, 64), expiresAt: cleanIsoDate(input.certificateExpiresAt) } : null;
  state.nodes.push({ id: nodeId, name: plan.name, protocol: "nowhere", machineId, uri: plan.links.anywhere[0].uri, enabled: true, tags: ["托管", "Nowhere"], source: "manual", sourceId: "", certificate });
  state.managedInstances.push({ id: plan.id, kind: "nowhere", name: plan.name, machineId, nodeId, status: "draft", version: plan.version, publicHost: plan.summary.publicHost, listenHost: input.listenHost === undefined ? "127.0.0.1" : cleanText(input.listenHost, 253), port: plan.summary.port, tcpPort: plan.summary.tcpPort, udpPort: plan.summary.udpPort, tcpCarrier: plan.summary.tcpCarrier, udpCarrier: plan.summary.udpCarrier, client: plan.summary.client, network: plan.summary.network, tls: plan.summary.tls, alpn: plan.summary.alpn, rate: plan.summary.rate, etar: plan.summary.etar, dial: cleanText(input.dial, 253) || "auto", socks: cleanText(input.socks, 512) || "none", log: plan.summary.log, telemetryInterval: cleanText(input.telemetryInterval, 16) || "1s", pool: Number(input.pool) || 5, vectorSocks: cleanText(input.vectorSocks, 512) || "127.0.0.1:1080", vectorSni: cleanText(input.vectorSni, 253) || "none", vectorPin: cleanText(input.vectorPin, 64) || "none", vectorMux: Number(input.vectorMux) === 1 ? 1 : 0, quicMemoryProfile: cleanText(input.quicMemoryProfile, 32) || "balanced", morph: plan.summary.morph, transportMemoryProfile: plan.summary.transportMemoryProfile, certificateId: certificate?.assetId || "", certificateMode: plan.certificateMode, certificatePath: plan.certificatePath, privateKeyPath: plan.privateKeyPath, certificateHost: plan.certificateHost, certificateDays: plan.certificateDays, extensionEnvironment: cleanNowhereExtensions(input.extensionEnvironment), binarySource: input.binarySource === "copy" ? "copy" : "download", migration: null, createdAt: now, updatedAt: now, lastError: "", lastOperationId: "" });
  state.managedInstances[state.managedInstances.length - 1].pool = Number(input.pool ?? 5);
  state.revision += 1; writeState(cleanState(state));
  return { state: readState(), instanceId: plan.id, plan: publicManagedNowherePlan(plan) };
}
function managedNowhereV2Input(instance, node, targetVersion) {
  const source = managedNowherePlanInput(instance, node);
  const network = instance.network || "mix";
  return {
    ...source, version: targetVersion, alpn: "nw2", morph: 0, transportMemoryProfile: "throughput",
    tcpPort: network === "udp" ? 0 : instance.port, udpPort: network === "tcp" ? 0 : instance.port,
    tcpCarrier: "tcp", udpCarrier: "udp",
  };
}
function managedNowhereMetadata(input, plan) {
  return {
    version: plan.version, publicHost: plan.summary.publicHost, listenHost: cleanText(input.listenHost, 253),
    port: plan.summary.port, tcpPort: plan.summary.tcpPort, udpPort: plan.summary.udpPort,
    tcpCarrier: plan.summary.tcpCarrier, udpCarrier: plan.summary.udpCarrier, client: plan.summary.client,
    network: plan.summary.network, tls: plan.summary.tls, alpn: plan.summary.alpn, rate: plan.summary.rate,
    etar: plan.summary.etar, dial: cleanText(input.dial, 253) || "auto", socks: cleanText(input.socks, 512) || "none",
    log: plan.summary.log, telemetryInterval: cleanText(input.telemetryInterval, 16) || "1s", pool: Number(input.pool ?? 5),
    vectorSocks: cleanText(input.vectorSocks, 512) || "127.0.0.1:1080", vectorSni: cleanText(input.vectorSni, 253) || "none",
    vectorPin: cleanText(input.vectorPin, 64) || "none", vectorMux: Number(input.vectorMux) === 1 ? 1 : 0,
    quicMemoryProfile: cleanText(input.quicMemoryProfile, 32) || "balanced", morph: plan.summary.morph,
    transportMemoryProfile: plan.summary.transportMemoryProfile, certificateMode: plan.certificateMode,
    certificatePath: plan.certificatePath, privateKeyPath: plan.privateKeyPath, certificateHost: plan.certificateHost,
    certificateDays: plan.certificateDays, extensionEnvironment: cleanNowhereExtensions(input.extensionEnvironment),
  };
}
function previewManagedNowhereMigration(params) {
  const state = readState();
  const instance = state.managedInstances.find((item) => item.id === cleanText(params && params.instanceId, 64) && item.kind === "nowhere");
  const node = state.nodes.find((item) => item.id === instance?.nodeId && item.protocol === "nowhere");
  if (!instance || !node) throw new Error("托管实例或节点不存在");
  const current = nowhereCapabilities(instance.version);
  const target = nowhereCapabilities(cleanText(params && params.targetVersion, 64));
  if (!current.verified || current.protocolGeneration !== 1 || target.protocolGeneration !== 2 || !target.verified) throw new Error("请选择已验证的 Nowhere V2 版本");
  const input = managedNowhereV2Input(instance, node, target.version);
  const plan = planManagedNowhere(input);
  if (hasManagedNowherePortConflict(state.managedInstances, instance.machineId, plan.summary, instance.id)) throw new Error("迁移后的 Carrier 端口与同宿主托管实例冲突");
  return { from: publicManagedNowherePlan(planManagedNowhere(managedNowherePlanInput(instance, node))), to: publicManagedNowherePlan(plan), wireCompatible: false, rollbackAvailableAfterMigration: true };
}
function prepareManagedNowhereAction(params) {
  const instanceId = cleanText(params && params.instanceId, 64);
  const action = cleanText(params && params.action, 16);
  if (!["preflight", "create", "start", "stop", "restart", "status", "logs", "delete", "read-config", "upgrade", "migrate-v2", "rollback-v1"].includes(action)) throw new Error("不支持的托管实例操作");
  const state = readState(); const instance = state.managedInstances.find((item) => item.id === instanceId && item.kind === "nowhere");
  const machine = state.machines.find((item) => item.id === instance?.machineId && item.monitorClientId);
  const node = state.nodes.find((item) => item.id === instance?.nodeId && item.protocol === "nowhere");
  if (!instance || !machine || !node) throw new Error("托管实例、节点或宿主绑定已经不存在");
  const currentCapabilities = nowhereCapabilities(instance.version);
  if (!currentCapabilities.supported) throw new Error("该实例版本没有可用的适配器，只能保留记录，不能生成远程命令");
  if (!currentCapabilities.verified && !["status", "logs", "read-config", "rollback-v1"].includes(action)) throw new Error("该实例版本尚未通过适配验证，目前仅允许读取状态与配置");
  if (action === "delete" && params.confirmation !== instance.id) throw new Error("删除托管实例需要确认实例编号");
  if (action === "create" && !["draft", "validated", "failed"].includes(instance.status)) throw new Error("该实例已经创建，不能重复下发");
  if (["start", "stop", "restart", "logs", "upgrade", "migrate-v2", "rollback-v1"].includes(action) && ["draft", "validated"].includes(instance.status)) throw new Error("请先创建托管实例");
  let plan = planManagedNowhere(managedNowherePlanInput(instance, node));
  let targetVersion = "";
  let metadata = null;
  let previous = null;
  let previousUri = "";
  if (action === "upgrade") {
    targetVersion = cleanText(params && params.targetVersion, 64);
    const capabilities = nowhereCapabilities(targetVersion);
    if (!capabilities.verified) throw new Error("请选择已通过适配验证的 Nowhere 版本");
    if (capabilities.version === nowhereCapabilities(instance.version).version) throw new Error("实例已经是所选版本");
    if (capabilities.protocolGeneration !== nowhereCapabilities(instance.version).protocolGeneration) throw new Error("跨主版本需要使用迁移流程，不能直接替换二进制");
  } else if (action === "migrate-v2") {
    targetVersion = cleanText(params && params.targetVersion, 64);
    const target = nowhereCapabilities(targetVersion);
    if (!currentCapabilities.verified || currentCapabilities.protocolGeneration !== 1 || target.protocolGeneration !== 2 || !target.verified) throw new Error("只支持在已验证版本间从 Nowhere V1 迁移到 V2");
    const input = managedNowhereV2Input(instance, node, target.version);
    plan = planManagedNowhere(input);
    if (hasManagedNowherePortConflict(state.managedInstances, machine.id, plan.summary, instance.id)) throw new Error("迁移后的 Carrier 端口与同宿主托管实例冲突");
    metadata = managedNowhereMetadata(input, plan);
    previous = clone(instance);
    previousUri = node.uri;
  } else if (action === "rollback-v1") {
    if (nowhereCapabilities(instance.version).protocolGeneration !== 2 || !instance.migration) throw new Error("该实例没有可用的 V1 迁移备份");
    targetVersion = instance.migration.fromVersion;
  }
  const operationId = requestOperationId(params); const expiresAt = Date.now() + MANAGED_OPERATION_TTL_MS;
  retainOperation(MANAGED_OPERATIONS, operationId, { instanceId, machineId: machine.id, action, expiresAt, targetVersion, metadata, previous, previousUri, backupDirectory: instance.migration?.backupDirectory || "", uri: plan.links.anywhere[0]?.uri || "" });
  for (const [id, operation] of MANAGED_OPERATIONS) if (operation.expiresAt < Date.now()) MANAGED_OPERATIONS.delete(id);
  const commandInput = action === "migrate-v2" ? { ...plan, previousVersion: instance.version }
    : action === "rollback-v1" ? { ...plan, backupDirectory: instance.migration.backupDirectory }
      : targetVersion ? { ...plan, targetVersion } : plan;
  return MANAGED_TASKS.prepare("nowhere", { schema: 1, operationId, expiresAt: new Date(expiresAt).toISOString(), instanceId, machineId: machine.id, clientId: machine.monitorClientId, action, command: buildManagedNowhereCommand(action, commandInput, instance.binarySource), plan: publicManagedNowherePlan(plan) });
}
function prepareManagedNowhereUpdate(params) {
  const state = readState();
  const instance = state.managedInstances.find(item => item.id === params.instanceId && item.kind === "nowhere");
  const machine = state.machines.find(item => item.id === instance?.machineId && item.monitorClientId);
  const node = state.nodes.find(item => item.id === instance?.nodeId);
  if (!instance || !machine || !node) throw new Error("托管实例或宿主不存在");
  if (!nowhereCapabilities(instance.version).verified) throw new Error("该实例版本尚未通过适配验证，目前不能修改配置");
  const read = MANAGED_OPERATIONS.get(cleanText(params.readOperationId, 64));
  if (!read || read.instanceId !== instance.id || read.action !== "read-config" || read.expiresAt < Date.now() || !read.completedResult?.ok) throw new Error("请先读取该实例当前配置");
  let input = { ...read.completedResult.configuration };
  const changes = params.changes && typeof params.changes === "object" ? params.changes : {};
  for (const key of Object.keys(input)) if (key !== "version" && Object.hasOwn(changes, key)) input[key] = changes[key];
  for (const key of ["certificateAssetId", "certificateMode", "certificatePath", "privateKeyPath", "certificateHost", "serverName"]) if (Object.hasOwn(changes, key)) input[key] = changes[key];
  if (!Object.hasOwn(changes, "certificateAssetId")) input.certificateAssetId = instance.certificateId || "";
  input.id = instance.id;
  input.name = cleanText(changes.name, 160) || node.name;
  input.machineId = instance.machineId;
  input = certificateDeploymentInput(state, input, machine.id, "nowhere");
  const plan = planManagedNowhere(input);
  if (!plan.links.anywhere.length) throw new Error("托管节点需要保留 Anywhere 输出");
  if (hasManagedNowherePortConflict(state.managedInstances, instance.machineId, plan.summary, instance.id)) throw new Error("该宿主已有托管实例使用相同的传输协议与端口");
  const operationId = requestOperationId(params); const expiresAt = Date.now() + MANAGED_OPERATION_TTL_MS;
  const metadata = { ...input, certificateId: input.certificateAssetId || "" }; delete metadata.key;
  const expectedHash = crypto.createHash("sha256").update(plan.environment).digest("hex");
  retainOperation(MANAGED_OPERATIONS, operationId, { instanceId: instance.id, machineId: machine.id, action: "update", expiresAt, metadata, uri: plan.links.anywhere[0].uri, expectedHash });
  return MANAGED_TASKS.prepare("nowhere", { schema: 1, operationId, instanceId: instance.id, clientId: machine.monitorClientId, action: "update", command: buildManagedNowhereCommand("update", { ...plan, expectedHash: read.completedResult.configurationHash }), plan: publicManagedNowherePlan(plan) });
}
function storeNowhereCertificate(state, instance, result, now) {
  if (result.ok !== true || !result.certificate || result.certificate.mode === "ephemeral" || result.certificate.valid !== true) return;
  const certificate = normalizedCertificateResult({ ok: true, status: "valid", ...result.certificate, fingerprintSha256: result.certificate.fingerprintSha256 || result.certificate.fingerprint });
  certificate.status = certificateHealth(certificate);
  if (!certificate.fingerprintSha256 || !certificate.publicKeySha256) return;
  const assetId = instance.certificateId || newCertificateId(`${instance.machineId}:${instance.certificatePath}`);
  instance.certificateId = assetId;
  const linkedNode = state.nodes.find((item) => item.id === instance.nodeId);
  if (linkedNode) linkedNode.certificate = { assetId, selfSigned: instance.certificateMode === "managed", fingerprintSha256: certificate.fingerprintSha256, publicKeySha256: certificate.publicKeySha256, expiresAt: certificate.expiresAt };
  const asset = state.certificates.find((item) => item.id === assetId);
  const metadata = { ...certificate, id: assetId, name: asset?.name || `${instance.name} · 证书`, machineId: instance.machineId, mode: asset?.mode || (instance.certificateMode === "managed" ? "instance" : "existing"), certificatePath: instance.certificatePath, privateKeyPath: instance.privateKeyPath, subjectName: instance.certificateHost || certificate.sans[0] || "", lastError: "", createdAt: asset?.createdAt || now, updatedAt: now };
  if (asset) Object.assign(asset, metadata); else state.certificates.push(metadata);
}
function recordManagedNowhereResult(params) {
  const operationId = cleanText(params && params.operationId, 64); const pending = MANAGED_OPERATIONS.get(operationId);
  if (!pending || pending.expiresAt < Date.now()) { MANAGED_OPERATIONS.delete(operationId); throw new Error("托管操作已过期，请重新执行"); }
  if (pending.completedResult) return { state: readState(), result: pending.completedResult };
  const state = readState(); const index = state.managedInstances.findIndex((item) => item.id === pending.instanceId && item.machineId === pending.machineId);
  const result = params && params.result && typeof params.result === "object" ? params.result : {};
  if (index < 0 && pending.action === "delete" && result.ok === true && result.state === "deleted") return { state, result: { ok: true, state: "deleted" } };
  if (index < 0) throw new Error("托管实例已经不存在");
  const instance = state.managedInstances[index]; const now = new Date().toISOString();
  if (result.ok !== true && result.error === "update-in-progress") {
    const normalized = { ok: false, error: "该实例正在更新，请稍后重试" };
    MANAGED_OPERATIONS.set(operationId, { ...pending, completedResult: normalized });
    return { state, result: normalized };
  }
  if (pending.action === "update") {
    if (result.ok === true && result.configurationHash !== pending.expectedHash) throw new Error("远端配置指纹不匹配，请核对结果");
    if (result.ok === true) {
      Object.assign(instance, pending.metadata);
      const node = state.nodes.find(item => item.id === instance.nodeId);
      node.name = pending.metadata.name || node.name;
      node.uri = pending.uri;
      if (pending.metadata.certificateAssetId) node.certificate = { assetId: pending.metadata.certificateAssetId, selfSigned: pending.metadata.certificateSelfSigned === true, fingerprintSha256: pending.metadata.certificateFingerprintSha256 || "", publicKeySha256: pending.metadata.certificatePublicKeySha256 || "", expiresAt: pending.metadata.certificateExpiresAt || "" };
      instance.name = node.name;
      instance.status = result.state === "active" ? "running" : "stopped";
      instance.lastError = "";
    } else {
      instance.lastError = cleanText(result.error, 160) || "update-failed";
      if (!result.rolledBack && result.error === "update-failed") instance.status = "failed";
    }
    storeNowhereCertificate(state, instance, result, now);
    instance.updatedAt = now; instance.lastOperationId = operationId;
    state.revision += 1; writeState(cleanState(state));
    const normalized = { ok: result.ok === true, error: cleanText(result.error, 160), state: cleanText(result.state, 24), rolledBack: result.rolledBack === true };
    MANAGED_OPERATIONS.set(operationId, { ...pending, completedResult: normalized });
    return { state: readState(), result: normalized };
  }
  if (pending.action === "read-config") {
    const normalized = result.ok === true
      ? { ok: true, configuration: decodeNowhereConfig(result.configuration), configurationHash: cleanText(result.configurationHash, 64), state: cleanText(result.state, 24) }
      : { ok: false, error: cleanText(result.error, 160) };
    MANAGED_OPERATIONS.set(operationId, { ...pending, completedResult: normalized });
    return { state, result: normalized };
  }
  if (pending.action === "preflight" && result.ok === true && instance.binarySource === "copy" && result.binaryAvailable !== true) { result.ok = false; result.error = "binary-not-found"; }
  if (result.ok === true && pending.action === "delete" && result.state === "deleted") {
    state.managedInstances.splice(index, 1); state.nodes = state.nodes.filter((item) => item.id !== instance.nodeId);
  } else {
    if (result.ok === true) {
      if (pending.action === "preflight") {
        instance.status = "validated";
        if (instance.binarySource === "copy") {
          const detected = String(result.binaryVersion || "").match(/v\d+\.\d+\.\d+(?:[.-][A-Za-z0-9._-]+)?/);
          if (detected) {
            instance.version = detected[0];
            const linkedNode = state.nodes.find((item) => item.id === instance.nodeId);
            if (linkedNode) linkedNode.uri = planManagedNowhere(managedNowherePlanInput(instance, linkedNode)).links.anywhere[0].uri;
          }
        }
      }
      else if (pending.action === "create" || pending.action === "stop") instance.status = "stopped";
      else if (pending.action === "start" || pending.action === "restart") instance.status = result.state === "active" ? "running" : "failed";
      else if (pending.action === "upgrade") {
        instance.version = nowhereCapabilities(pending.targetVersion).version;
        instance.status = result.state === "active" ? "running" : "stopped";
        const linkedNode = state.nodes.find((item) => item.id === instance.nodeId);
        if (linkedNode) linkedNode.uri = planManagedNowhere(managedNowherePlanInput(instance, linkedNode)).links.anywhere[0].uri;
      }
      else if (pending.action === "migrate-v2") {
        if (!result.backupDirectory) throw new Error("远端迁移未返回 V1 备份位置");
        Object.assign(instance, pending.metadata);
        instance.migration = { fromVersion: pending.previous.version, toVersion: instance.version, backupDirectory: cleanText(result.backupDirectory, 512), migratedAt: now, previous: pending.previous, previousUri: pending.previousUri };
        instance.status = result.state === "active" ? "running" : "stopped";
        const linkedNode = state.nodes.find((item) => item.id === instance.nodeId);
        if (linkedNode) linkedNode.uri = pending.uri;
      }
      else if (pending.action === "rollback-v1") {
        const migration = instance.migration;
        Object.assign(instance, migration.previous);
        instance.migration = null;
        instance.status = result.state === "active" ? "running" : "stopped";
        const linkedNode = state.nodes.find((item) => item.id === instance.nodeId);
        if (linkedNode) linkedNode.uri = migration.previousUri;
      }
      else if (pending.action === "status") instance.status = result.state === "active" ? "running" : result.installed === false ? "failed" : "stopped";
      instance.lastError = "";
    } else {
      const recovered = (pending.action === "upgrade" && result.rolledBack === true)
        || (pending.action === "migrate-v2" && result.rolledBack === true)
        || (pending.action === "rollback-v1" && result.restoredV2 === true);
      if (!recovered) instance.status = "failed";
      instance.lastError = cleanText(result.error, 160) || "operation-failed";
    }
    storeNowhereCertificate(state, instance, result, now);
    instance.updatedAt = now; instance.lastOperationId = operationId;
  }
  state.revision += 1; writeState(cleanState(state));
  const normalized = { ok: result.ok === true, state: cleanText(result.state, 24), error: cleanText(result.error, 160), binaryAvailable: result.binaryAvailable === true, binaryVersion: cleanText(result.binaryVersion, 240), portAvailable: result.portAvailable === true, portsAvailable: Array.isArray(result.portsAvailable) ? result.portsAvailable.slice(0, 4) : [], installed: result.installed === true, existingNowhere: cleanText(result.existingNowhere, 24), existingSingBox: cleanText(result.existingSingBox, 24), certificate: result.certificate && typeof result.certificate === "object" ? result.certificate : null, configurationHash: cleanText(result.configurationHash, 64), backupDirectory: cleanText(result.backupDirectory, 512), rolledBack: result.rolledBack === true, restoredV2: result.restoredV2 === true, recoveryPending: result.recoveryPending === true, logs: pending.action === "logs" ? cleanText(result.logs, 24000) : "" };
  MANAGED_OPERATIONS.set(operationId, { ...pending, completedResult: normalized });
  return { state: readState(), result: normalized };
}
function newManagedSingBoxValues() {
  return { id: `sb-${randomId()}`, port: 20888, ...randomSingBoxCredentials() };
}
function certificateDeploymentInput(state, input, machineId, kind) {
  const certificateId = cleanText(input && input.certificateAssetId, 64);
  if (!certificateId) return input;
  const asset = state.certificates.find((item) => item.id === certificateId && item.machineId === machineId);
  if (!asset) throw new Error("所选证书不属于当前宿主，或已经不存在");
  if (!["valid", "warning"].includes(asset.status) || !asset.fingerprintSha256 || !asset.publicKeySha256) throw new Error("请先检查证书，确认有效后再用于部署");
  const serverName = cleanText(input.serverName, 253) || asset.sans.find((item) => !isIP(item)) || asset.subjectName || asset.sans[0];
  if (!serverName) throw new Error("证书缺少可用的 TLS SNI，请手动填写");
  const common = {
    ...input, certificateAssetId: asset.id, certificatePath: asset.certificatePath, privateKeyPath: asset.privateKeyPath,
    certificateSelfSigned: asset.mode !== "existing", certificateFingerprintSha256: asset.fingerprintSha256,
    certificatePublicKeySha256: asset.publicKeySha256, certificateExpiresAt: asset.expiresAt, serverName,
  };
  if (kind === "nowhere") return { ...common, certificateMode: "existing", tls: 2, certificateHost: serverName, vectorPin: asset.fingerprintSha256 };
  return { ...common, certificateMode: "existing" };
}
function publicManagedSingBoxPlan(plan) {
  return { schema: plan.schema, id: plan.id, kind: plan.kind, summary: plan.summary, clientUri: plan.clientUri, directory: plan.directory, unitName: plan.unitName, selfSigned: plan.selfSigned, certificate: plan.certificate, safeguards: plan.safeguards };
}
function previewManagedSingBox(params) {
  const input = params && params.input && typeof params.input === "object" ? params.input : {};
  const state = readState(); const machineId = cleanText(input.machineId, 64);
  return publicManagedSingBoxPlan(planManagedSingBox(certificateDeploymentInput(state, input, machineId, "sing-box")));
}
function prepareManagedSingBoxCreate(params) {
  let input = params && params.input && typeof params.input === "object" ? params.input : {};
  const operationId = requestOperationId(params); const state = readState(); const machineId = cleanText(input.machineId, 64);
  const machine = state.machines.find((item) => item.id === machineId && item.monitorClientId);
  if (!machine) throw new Error("请选择已绑定 Komari Agent 的服务器");
  input = certificateDeploymentInput(state, input, machineId, "sing-box");
  const plan = planManagedSingBox(input);
  const previous = MANAGED_SINGBOX_OPERATIONS.get(operationId);
  if (state.managedInstances.some((item) => item.id === plan.id) && !previous) throw new Error("托管实例编号已经存在");
  if (state.managedInstances.some((item) => item.machineId === machineId && item.port === plan.summary.port && (!previous || item.id !== plan.id))) throw new Error("该宿主已有托管实例使用此端口");
  const expiresAt = Date.now() + MANAGED_OPERATION_TTL_MS; const nodeId = randomId();
  const protocol = plan.protocol === "vless-reality" ? "vless" : plan.protocol === "shadowsocks" ? "ss" : plan.protocol;
  retainOperation(MANAGED_SINGBOX_OPERATIONS, operationId, { action: "create", instanceId: plan.id, machineId, expiresAt, instance: { id: plan.id, kind: "sing-box", protocol: plan.protocol, name: plan.name, machineId, nodeId, status: "stopped", version: "", publicHost: plan.summary.publicHost, listenHost: plan.summary.listenHost, port: plan.summary.port, certificateId: plan.certificate?.assetId || "", certificateMode: plan.certificate ? (plan.selfSigned ? "managed" : "existing") : "ephemeral", certificatePath: input.certificatePath || (plan.selfSigned ? `${plan.directory}/server.crt` : ""), privateKeyPath: input.privateKeyPath || (plan.selfSigned ? `${plan.directory}/server.key` : ""), certificateHost: plan.summary.serverName || "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastError: "", lastOperationId: operationId }, node: { id: nodeId, name: plan.name, protocol, machineId, uri: plan.clientUri, enabled: true, tags: ["托管", "sing-box"], source: "manual", sourceId: "", certificate: plan.certificate } });
  for (const [id, operation] of MANAGED_SINGBOX_OPERATIONS) if (operation.expiresAt < Date.now()) MANAGED_SINGBOX_OPERATIONS.delete(id);
  return MANAGED_TASKS.prepare("sing-box", { schema: 1, operationId, expiresAt: new Date(expiresAt).toISOString(), instanceId: plan.id, machineId, clientId: machine.monitorClientId, action: "create", command: buildManagedSingBoxCommand("create", plan, input.binarySource || "copy", input.downloadVersion || "1.13.11"), plan: publicManagedSingBoxPlan(plan) });
}
function managedSingBoxRemoteTarget(instance) {
  const directory = `/var/lib/proxy-console/instances/${instance.id}`;
  return { kind: "managed-sing-box", id: instance.id, directory, binaryPath: `${directory}/bin/sing-box`, configPath: `${directory}/config.json`, unitName: `proxy-console-singbox@${instance.id}.service`, unitPath: `/etc/systemd/system/proxy-console-singbox@${instance.id}.service`, summary: { port: instance.port } };
}
function prepareManagedSingBoxAction(params) {
  const instanceId = cleanText(params && params.instanceId, 64); const action = cleanText(params && params.action, 16);
  if (!["start", "stop", "restart", "status", "logs", "delete", "read-config"].includes(action)) throw new Error("不支持的托管 sing-box 操作");
  const state = readState(); const instance = state.managedInstances.find((item) => item.id === instanceId && item.kind === "sing-box"); const machine = state.machines.find((item) => item.id === instance?.machineId && item.monitorClientId);
  if (!instance || !machine) throw new Error("托管实例或宿主绑定已经不存在");
  if (action === "delete" && params.confirmation !== instance.id) throw new Error("删除托管实例需要确认实例编号");
  const operationId = requestOperationId(params); const expiresAt = Date.now() + MANAGED_OPERATION_TTL_MS;
  retainOperation(MANAGED_SINGBOX_OPERATIONS, operationId, { action, instanceId, machineId: machine.id, expiresAt });
  return MANAGED_TASKS.prepare("sing-box", { schema: 1, operationId, expiresAt: new Date(expiresAt).toISOString(), instanceId, machineId: machine.id, clientId: machine.monitorClientId, action, command: buildManagedSingBoxCommand(action, managedSingBoxRemoteTarget(instance)) });
}
function prepareManagedSingBoxUpdate(params) {
  const state = readState();
  const instance = state.managedInstances.find(item => item.id === params.instanceId && item.kind === "sing-box");
  const machine = state.machines.find(item => item.id === instance?.machineId && item.monitorClientId);
  const node = state.nodes.find(item => item.id === instance?.nodeId);
  if (!instance || !machine || !node) throw new Error("托管实例或宿主不存在");
  const read = MANAGED_SINGBOX_OPERATIONS.get(cleanText(params.readOperationId, 64));
  if (!read || read.instanceId !== instance.id || read.action !== "read-config" || read.expiresAt < Date.now() || !read.completedResult?.ok) throw new Error("请先读取该实例当前配置");
  let input = { ...read.completedResult.configuration };
  const changes = params.changes && typeof params.changes === "object" ? params.changes : {};
  const allowed = new Set(["name", "publicHost", "listenHost", "port", "log", "uuid", "flow", "serverName", "handshakeServer", "handshakePort", "realityPrivateKey", "realityPublicKey", "shortId", "transport", "wsPath", "method", "password", "certificateAssetId", "certificateMode", "certificatePath", "privateKeyPath"]);
  for (const key of allowed) if (Object.hasOwn(changes, key)) input[key] = changes[key];
  input.id = instance.id; input.name = cleanText(changes.name, 160) || node.name; input.protocol = instance.protocol;
  input.machineId = instance.machineId;
  if (!Object.hasOwn(changes, "certificateAssetId")) input.certificateAssetId = instance.certificateId || "";
  input = certificateDeploymentInput(state, input, machine.id, "sing-box");
  const plan = planManagedSingBox(input);
  if (state.managedInstances.some(item => item.id !== instance.id && item.machineId === instance.machineId && item.port === plan.summary.port)) throw new Error("该宿主已有实例使用此端口");
  const operationId = requestOperationId(params); const expiresAt = Date.now() + MANAGED_OPERATION_TTL_MS;
  const expectedHash = crypto.createHash("sha256").update(plan.config).digest("hex");
  retainOperation(MANAGED_SINGBOX_OPERATIONS, operationId, { action: "update", instanceId: instance.id, machineId: machine.id, expiresAt, expectedHash, metadata: { name: input.name, publicHost: plan.summary.publicHost, listenHost: plan.summary.listenHost, port: plan.summary.port, certificateId: plan.certificate?.assetId || "", certificateMode: plan.certificate ? (plan.selfSigned ? "managed" : "existing") : instance.certificateMode, certificatePath: input.certificatePath || instance.certificatePath, privateKeyPath: input.privateKeyPath || instance.privateKeyPath, certificateHost: plan.summary.serverName || instance.certificateHost }, certificate: plan.certificate, uri: plan.clientUri });
  return MANAGED_TASKS.prepare("sing-box", { schema: 1, operationId, expiresAt: new Date(expiresAt).toISOString(), instanceId: instance.id, machineId: machine.id, clientId: machine.monitorClientId, action: "update", command: buildManagedSingBoxCommand("update", { ...plan, expectedHash: read.completedResult.configurationHash }), plan: publicManagedSingBoxPlan(plan) });
}
function recordManagedSingBoxResult(params) {
  const operationId = cleanText(params && params.operationId, 64); const pending = MANAGED_SINGBOX_OPERATIONS.get(operationId);
  if (!pending || pending.expiresAt < Date.now()) { MANAGED_SINGBOX_OPERATIONS.delete(operationId); throw new Error("托管操作已过期，请重新执行"); }
  if (pending.completedResult) return { state: readState(), result: pending.completedResult };
  const result = params && params.result && typeof params.result === "object" ? params.result : {}; const state = readState();
  const instance = state.managedInstances.find(item => item.id === pending.instanceId && item.machineId === pending.machineId && item.kind === "sing-box");
  const node = state.nodes.find(item => item.id === instance?.nodeId);
  if (result.ok !== true && result.error === "update-in-progress") {
    const normalized = { ok: false, error: "该实例正在更新，请稍后重试" };
    MANAGED_SINGBOX_OPERATIONS.set(operationId, { ...pending, completedResult: normalized });
    return { state, result: normalized };
  }
  if (pending.action === "read-config") {
    let normalized;
    try {
      if (result.ok !== true || !instance || !node || !/^[a-f0-9]{64}$/.test(String(result.configurationHash || ""))) throw new Error("read-failed");
      const configuration = JSON.parse(Buffer.from(String(result.configuration || ""), "base64").toString("utf8"));
      normalized = { ok: true, configuration: managedSingBoxInput({ ...instance, directory: `/var/lib/proxy-console/instances/${instance.id}` }, node, configuration), configurationHash: result.configurationHash, state: cleanText(result.state, 24) };
    } catch (_) { normalized = { ok: false, error: cleanText(result.error, 160) || "configuration-invalid" }; }
    MANAGED_SINGBOX_OPERATIONS.set(operationId, { ...pending, completedResult: normalized });
    return { state, result: normalized };
  }
  if (pending.action === "update") {
    if (!instance || !node) throw new Error("托管实例已经不存在");
    if (result.ok === true && result.configurationHash !== pending.expectedHash) throw new Error("远端配置指纹不匹配，请核对结果");
    if (result.ok === true) {
      Object.assign(instance, pending.metadata); node.name = pending.metadata.name || node.name; node.uri = pending.uri; node.certificate = pending.certificate || null;
      instance.status = result.state === "active" ? "running" : "stopped"; instance.lastError = "";
    } else {
      instance.lastError = cleanText(result.error, 160) || "update-failed";
      if (!result.rolledBack && result.error === "update-failed") instance.status = "failed";
    }
    instance.updatedAt = new Date().toISOString(); instance.lastOperationId = operationId;
    state.revision += 1; writeState(cleanState(state));
    const normalized = { ok: result.ok === true, error: cleanText(result.error, 160), state: cleanText(result.state, 24), rolledBack: result.rolledBack === true };
    MANAGED_SINGBOX_OPERATIONS.set(operationId, { ...pending, completedResult: normalized });
    return { state: readState(), result: normalized };
  }
  if (pending.action === "create") {
    if (result.ok === true && !state.managedInstances.some(item => item.id === pending.instanceId)) {
      if (result.certificate && pending.instance.certificatePath && pending.instance.privateKeyPath) {
        const certificate = normalizedCertificateResult({ ok: true, status: "valid", ...result.certificate });
        if (certificate.fingerprintSha256 && certificate.publicKeySha256) {
          const assetId = pending.instance.certificateId || newCertificateId(`${pending.machineId}:${pending.instance.certificatePath}`);
          pending.instance.certificateId = assetId;
          pending.node.certificate = { assetId, selfSigned: true, fingerprintSha256: certificate.fingerprintSha256, publicKeySha256: certificate.publicKeySha256, expiresAt: certificate.expiresAt };
          if (pending.instance.protocol === "hysteria2") {
            const uri = new URL(pending.node.uri); uri.searchParams.set("pinSHA256", certificate.fingerprintSha256); uri.searchParams.delete("insecure"); pending.node.uri = uri.toString();
          }
          if (!state.certificates.some((item) => item.id === assetId)) state.certificates.push({
            id: assetId, name: `${pending.instance.name} · 证书`, machineId: pending.machineId, mode: "instance",
            certificatePath: pending.instance.certificatePath, privateKeyPath: pending.instance.privateKeyPath,
            subjectName: pending.instance.certificateHost, sans: pending.instance.certificateHost ? [pending.instance.certificateHost] : [],
            ...certificate, lastError: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          });
        }
      }
      pending.instance.version = cleanText(result.binaryVersion, 160); state.nodes.push(pending.node); state.managedInstances.push(pending.instance); state.revision += 1; writeState(cleanState(state));
    }
  } else {
    const index = state.managedInstances.findIndex((item) => item.id === pending.instanceId && item.machineId === pending.machineId && item.kind === "sing-box");
    if (index < 0 && pending.action === "delete" && result.ok === true && result.state === "deleted") return { state, result: { ok: true, state: "deleted" } };
    if (index < 0) throw new Error("托管实例已经不存在"); const instance = state.managedInstances[index];
    if (result.ok === true && pending.action === "delete" && result.state === "deleted") { state.managedInstances.splice(index, 1); state.nodes = state.nodes.filter((item) => item.id !== instance.nodeId); }
    else { if (result.ok === true) { instance.status = result.state === "active" ? "running" : result.installed === false ? "failed" : "stopped"; instance.lastError = ""; } else { instance.status = "failed"; instance.lastError = cleanText(result.error, 160) || "operation-failed"; } instance.updatedAt = new Date().toISOString(); instance.lastOperationId = operationId; }
    state.revision += 1; writeState(cleanState(state));
  }
  const normalized = { ok: result.ok === true, state: cleanText(result.state, 24), error: cleanText(result.error, 160), kernelValid: result.kernelValid === true, binaryVersion: cleanText(result.binaryVersion, 160), installed: result.installed === true, existingNowhere: cleanText(result.existingNowhere, 24), existingSingBox: cleanText(result.existingSingBox, 24), certificate: result.certificate && typeof result.certificate === "object" ? cleanCertificateReference({ ...result.certificate, selfSigned: true }) : null, logs: pending.action === "logs" ? cleanText(result.logs, 24000) : "" };
  MANAGED_SINGBOX_OPERATIONS.set(operationId, { ...pending, completedResult: normalized });
  return { state: readState(), result: normalized };
}
function certificateUsage(state, certificateId) {
  return state.managedInstances.filter((item) => item.certificateId === certificateId).map((item) => ({ id: item.id, name: item.name, kind: item.kind, status: item.status }));
}
function normalizedCertificateResult(result) {
  const value = result && typeof result === "object" ? result : {};
  const fingerprintSha256 = cleanText(value.fingerprintSha256, 64).toLowerCase();
  const publicKeySha256 = cleanText(value.publicKeySha256, 64);
  return {
    ok: value.ok === true,
    error: cleanText(value.error, 160),
    deleted: value.deleted === true,
    status: ["valid", "warning", "expired", "invalid", "missing"].includes(value.status) ? value.status : "invalid",
    subject: cleanText(value.subject, 512), issuer: cleanText(value.issuer, 512), serialNumber: cleanText(value.serialNumber, 160),
    sans: (Array.isArray(value.sans) ? value.sans : []).map((item) => cleanText(item, 253)).filter(Boolean).slice(0, 32),
    fingerprintSha256: /^[a-f0-9]{64}$/.test(fingerprintSha256) ? fingerprintSha256 : "",
    publicKeySha256: /^[A-Za-z0-9+/]{43}=$/.test(publicKeySha256) ? publicKeySha256 : "",
    validFrom: cleanIsoDate(value.validFrom), expiresAt: cleanIsoDate(value.expiresAt), checkedAt: cleanIsoDate(value.checkedAt) || new Date().toISOString(),
  };
}
function prepareCertificateAction(params) {
  const action = cleanText(params && params.action, 16);
  if (!["create", "inspect", "delete"].includes(action)) throw new Error("不支持的证书操作");
  const state = readState(); const operationId = requestOperationId(params); const expiresAt = Date.now() + MANAGED_OPERATION_TTL_MS;
  let asset; let plan; let machine; let remoteAction = action;
  if (action === "create") {
    const input = params && params.input && typeof params.input === "object" ? params.input : {};
    const machineId = cleanText(input.machineId, 64);
    machine = state.machines.find((item) => item.id === machineId && item.monitorClientId);
    if (!machine) throw new Error("请选择已绑定 Komari Agent 的服务器");
    const id = cleanText(input.id, 64) || newCertificateId(`${machineId}:${operationId}`);
    plan = planCertificateAsset({ ...input, id });
    if (state.certificates.some((item) => item.id === plan.id)) throw new Error("证书资产编号已经存在");
    asset = {
      id: plan.id, name: cleanText(input.name, 120) || `${machine.name} · 证书`, machineId, mode: plan.mode,
      certificatePath: plan.certificatePath, privateKeyPath: plan.privateKeyPath, subjectName: plan.subjectName,
      sans: plan.sans, status: "unchecked", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    remoteAction = plan.mode === "existing" ? "inspect" : "create";
  } else {
    const certificateId = cleanText(params && params.certificateId, 64);
    asset = state.certificates.find((item) => item.id === certificateId);
    machine = state.machines.find((item) => item.id === asset?.machineId && item.monitorClientId);
    if (!asset || !machine) throw new Error("证书资产或宿主绑定已经不存在");
    if (action === "delete") {
      const usage = certificateUsage(state, asset.id);
      if (usage.length) throw new Error(`证书仍被 ${usage.length} 个实例引用，请先显式切换实例证书`);
      if (asset.mode !== "managed") throw new Error("已有 PEM 只需取消登记，不允许删除目标机文件");
      if (params.confirmation !== asset.id) throw new Error("删除远端证书需要确认资产编号");
    }
    plan = planCertificateAsset(asset);
  }
  retainOperation(CERTIFICATE_OPERATIONS, operationId, { action, instanceId: asset.id, machineId: machine.id, expiresAt, asset });
  return MANAGED_TASKS.prepare("certificate", {
    schema: 1, operationId, expiresAt: new Date(expiresAt).toISOString(), instanceId: asset.id, certificateId: asset.id,
    machineId: machine.id, clientId: machine.monitorClientId, action,
    command: buildCertificateCommand(remoteAction, plan),
  });
}
function recordCertificateResult(params) {
  const operationId = cleanText(params && params.operationId, 64); const pending = CERTIFICATE_OPERATIONS.get(operationId);
  if (!pending || pending.expiresAt < Date.now()) { CERTIFICATE_OPERATIONS.delete(operationId); throw new Error("证书操作已过期，请重新执行"); }
  if (pending.completedResult) return { state: readState(), result: pending.completedResult };
  const normalized = normalizedCertificateResult(params && params.result); const state = readState();
  const index = state.certificates.findIndex((item) => item.id === pending.instanceId && item.machineId === pending.machineId);
  if (pending.action === "create" && normalized.ok) {
    if (index < 0) state.certificates.push({
      ...pending.asset, ...normalized,
      subjectName: pending.asset.subjectName || normalized.sans[0] || "",
      lastError: "", updatedAt: new Date().toISOString(),
    });
  } else if (pending.action === "inspect") {
    if (index < 0) throw new Error("证书资产已经不存在");
    if (normalized.ok) Object.assign(state.certificates[index], normalized, { subjectName: state.certificates[index].subjectName || normalized.sans[0] || "", lastError: "", updatedAt: new Date().toISOString() });
    else Object.assign(state.certificates[index], { status: normalized.error === "certificate-file-missing" ? "missing" : "invalid", lastError: normalized.error || "certificate-invalid", checkedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  } else if (pending.action === "delete" && normalized.ok && normalized.deleted) {
    if (index >= 0) state.certificates.splice(index, 1);
  }
  if (normalized.ok || pending.action === "inspect") { state.revision += 1; writeState(cleanState(state)); }
  const saved = { ...normalized, usage: certificateUsage(readState(), pending.instanceId) };
  CERTIFICATE_OPERATIONS.set(operationId, { ...pending, completedResult: saved });
  return { state: readState(), result: saved };
}
function removeCertificateRegistration(params) {
  const certificateId = cleanText(params && params.certificateId, 64); const state = readState();
  const index = state.certificates.findIndex((item) => item.id === certificateId);
  if (index < 0) throw new Error("证书资产已经不存在");
  const usage = certificateUsage(state, certificateId);
  if (usage.length) throw new Error(`证书仍被 ${usage.length} 个实例引用，请先显式切换实例证书`);
  if (state.certificates[index].mode === "managed") throw new Error("Wherever Station 生成的证书请使用删除远端资产");
  state.certificates.splice(index, 1); state.revision += 1; writeState(cleanState(state));
  return { state: readState(), removed: true };
}
function prepareConnectivityCheck(params) {
  const state = readState();
  const instance = state.managedInstances.find(item => item.id === cleanText(params && params.instanceId, 64));
  const node = state.nodes.find(item => item.id === instance?.nodeId);
  const source = state.machines.find(item => item.id === cleanText(params && params.sourceMachineId, 64) && item.monitorClientId);
  if (!instance || !node || !source) throw new Error("实例、节点或检测来源不存在");
  const localBinary = source.id === instance.machineId ? `/var/lib/proxy-console/instances/${instance.id}/bin/${instance.kind === "nowhere" ? "nowhere" : "sing-box"}` : "";
  let command;
  if (instance.kind === "nowhere") {
    const plan = planManagedNowhere({ ...managedNowherePlanInput(instance, node), client: "vector" });
    command = buildConnectivityCommand({ kind: "vector", uri: plan.links.vector[0].uri, expectedIp: isIP(instance.publicHost) ? instance.publicHost : "", preferredBinary: localBinary });
  } else {
    const outbound = singBoxOutbound(node);
    if (!outbound) throw new Error("该协议暂不支持自动连接检查");
    command = buildConnectivityCommand({ kind: "sing-box", outbound, expectedIp: isIP(instance.publicHost) ? instance.publicHost : "", preferredBinary: localBinary });
  }
  return { operationId: requestOperationId(params), instanceId: instance.id, sourceMachineId: source.id, clientId: source.monitorClientId, command };
}
function readConnectivityHistory() { try { const value = JSON.parse(fs.readFileSync(CONNECTIVITY_HISTORY_FILE, "utf8")); return Array.isArray(value) ? value : []; } catch (_) { return []; } }
function writeConnectivityHistory(value) { const temporary = CONNECTIVITY_HISTORY_FILE + ".tmp"; fs.writeFileSync(temporary, JSON.stringify(value.slice(-500), null, 2) + "\n", { mode: 0o600 }); fs.renameSync(temporary, CONNECTIVITY_HISTORY_FILE); fs.chmodSync(CONNECTIVITY_HISTORY_FILE, 0o600); }
function appendConnectivityHistory(node, result) { const entries = readConnectivityHistory(); entries.push({ id: randomId(), nodeId: node.id, nodeName: node.name, protocol: node.protocol, ...result }); writeConnectivityHistory(entries); }
function connectivityHistory(params) {
  const ids = new Set((Array.isArray(params && params.nodeIds) ? params.nodeIds : []).map((id) => cleanText(id, 64))); const limit = Math.min(200, Math.max(1, Number(params && params.limit) || 50));
  return readConnectivityHistory().filter((item) => item && (!ids.size || ids.has(item.nodeId))).slice(-limit).reverse().map((item) => ({ id: cleanText(item.id, 64), nodeId: cleanText(item.nodeId, 64), nodeName: cleanText(item.nodeName, 160), protocol: cleanText(item.protocol, 24), ...cleanConnectivity(item) }));
}
function prepareNodeConnectivityCheck(params) {
  const state = readState(); const node = state.nodes.find((item) => item.id === cleanText(params && params.nodeId, 64)); const source = state.machines.find((item) => item.id === cleanText(params && params.sourceMachineId, 64) && item.monitorClientId); if (!node || !source) throw new Error("节点或检测来源不存在");
  let command; let expectedIp = ""; try { const host = new URL(node.uri).hostname.replace(/^\[|\]$/g, ""); expectedIp = isIP(host) ? host : ""; } catch (_) {}
  if (node.protocol === "nowhere") { const url = new URL(node.uri); url.protocol = "vector:"; if (!url.searchParams.has("mux")) url.searchParams.set("mux", "0"); if (!url.searchParams.has("sni")) url.searchParams.set("sni", "none"); if (!url.searchParams.has("pin")) url.searchParams.set("pin", "none"); url.hash = ""; command = buildConnectivityCommand({ kind: "vector", uri: url.toString(), expectedIp }); }
  else { const outbound = singBoxOutbound(node); if (!outbound) throw new Error("该协议暂不支持自动连接检查"); command = buildConnectivityCommand({ kind: "sing-box", outbound, expectedIp }); }
  return { operationId: requestOperationId(params), nodeId: node.id, sourceMachineId: source.id, clientId: source.monitorClientId, command };
}
function saveNodeConnectivityResult(state, node, source, output) {
  const parsed = parseConnectivityOutput(output); const passed = parsed.ok === true && parsed.https === true && parsed.exitIpMatches !== false;
  const result = { status: passed ? "passed" : "failed", observedAt: new Date().toISOString(), sourceMachineId: source.id, sourceName: source.name, sourceKind: source.id === node.machineId ? "target" : "remote", clientVersion: cleanText(parsed.clientVersion, 160), actualIp: cleanText(parsed.actualIp, 64), exitIpMatches: parsed.exitIpMatches === true ? true : parsed.exitIpMatches === false ? false : null, error: passed ? "" : cleanText(parsed.error, 160) || (parsed.exitIpMatches === false ? "exit-ip-mismatch" : "probe-failed") };
  node.connectivity = result; appendConnectivityHistory(node, result); return result;
}
function recordNodeConnectivityCheck(params) {
  const state = readState(); const node = state.nodes.find((item) => item.id === cleanText(params && params.nodeId, 64)); const source = state.machines.find((item) => item.id === cleanText(params && params.sourceMachineId, 64)); if (!node || !source) throw new Error("节点或检测来源不存在");
  const result = saveNodeConnectivityResult(state, node, source, params && params.output); const instance = state.managedInstances.find((item) => item.nodeId === node.id); if (instance) { instance.connectivity = result; instance.updatedAt = result.observedAt; } state.revision += 1; writeState(cleanState(state)); return { state: readState(), result };
}
function recordConnectivityCheck(params) {
  const state = readState();
  const instance = state.managedInstances.find(item => item.id === cleanText(params && params.instanceId, 64));
  const source = state.machines.find(item => item.id === cleanText(params && params.sourceMachineId, 64));
  if (!instance || !source) throw new Error("实例或检测来源不存在");
  const node = state.nodes.find((item) => item.id === instance.nodeId); const result = saveNodeConnectivityResult(state, node, source, params && params.output); instance.connectivity = result;
  instance.updatedAt = new Date().toISOString(); state.revision += 1; writeState(cleanState(state));
  return { state: readState(), result: cleanConnectivity(instance.connectivity) };
}
function load() {
  server.registerRPC("proxyConsole:listInstanceStates", () => {
    const state = readState();
    return state.machines.flatMap(machine => STATUS_CACHE.get(machine.id, state.managedInstances.filter(item => item.machineId === machine.id).map(item => item.id)));
  });
  server.registerRPC("proxyConsole:recordInstanceStates", params => {
    const state = readState();
    const ids = state.managedInstances.filter(item => item.machineId === params.machineId).map(item => item.id);
    STATUS_CACHE.record(params.machineId, ids, params.states);
    return STATUS_CACHE.get(params.machineId, ids);
  });
  server.registerRPC("proxyConsole:prepareInstanceStates", params => {
    const state = readState();
    const machine = state.machines.find(item => item.id === params.machineId && item.monitorClientId);
    if (!machine) throw new Error("请选择已绑定 Agent 的宿主");
    const instances = state.managedInstances.filter(item => item.machineId === machine.id);
    return { clientId: machine.monitorClientId, instanceIds: instances.map(item => item.id), command: buildInstanceStatus(instances) };
  });
  server.registerRPC("proxyConsole:prepareManagedNowhereUpdate", prepareManagedNowhereUpdate);
  server.registerRPC("proxyConsole:prepareConnectivityCheck", prepareConnectivityCheck);
  server.registerRPC("proxyConsole:recordConnectivityCheck", recordConnectivityCheck);
  server.registerRPC("proxyConsole:prepareNodeConnectivityCheck", prepareNodeConnectivityCheck);
  server.registerRPC("proxyConsole:recordNodeConnectivityCheck", recordNodeConnectivityCheck);
  server.registerRPC("proxyConsole:getConnectivityHistory", connectivityHistory);
  server.registerRPC("proxyConsole:prepareCertificateAction", prepareCertificateAction);
  server.registerRPC("proxyConsole:recordCertificateResult", recordCertificateResult);
  server.registerRPC("proxyConsole:removeCertificateRegistration", removeCertificateRegistration);
  server.registerRPC("proxyConsole:prepareExistingServiceDiscovery", prepareExistingServiceDiscovery);
  server.registerRPC("proxyConsole:parseExistingServiceDiscovery", parseExistingServiceDiscovery);
  server.registerRPC("proxyConsole:bindManagedTask", params => MANAGED_TASKS.bind(params));
  server.registerRPC("proxyConsole:getManagedTask", params => { const task = MANAGED_TASKS.get(params.operationId); return { task, ...(task.phase === "completed" ? { state: readState() } : {}) }; });
  server.registerRPC("proxyConsole:listManagedTasks", () => MANAGED_TASKS.list());
  if (typeof server.cron === "function") server.cron("* * * * *", () => MANAGED_TASKS.resume());
  MANAGED_TASKS.resume();
  server.registerRPC("proxyConsole:previewPolicy", previewPolicy);
  server.registerRPC("proxyConsole:saveProvider", saveProvider);
  server.registerRPC("proxyConsole:saveMachineTrafficPlan", saveMachineTrafficPlan);
  server.registerRPC("proxyConsole:deleteProvider", deleteProvider);
  server.registerRPC("proxyConsole:startProviderOperation", startProviderOperation);
  server.registerRPC("proxyConsole:getProviderOperation", getProviderOperation);
readState(); server.route("GET", "/proxy/sub/:token", publicSubscription); server.route("GET", "/proxy/backup/:token", downloadPortableBackup); server.registerRPC("proxyConsole:getState", () => readState()); server.registerRPC("proxyConsole:exportPortableBackup", exportPortableBackup); server.registerRPC("proxyConsole:preparePortableBackupDownload", preparePortableBackupDownload); server.registerRPC("proxyConsole:previewPortableBackup", previewPortableBackup); server.registerRPC("proxyConsole:restorePortableBackup", restorePortableBackup); server.registerRPC("proxyConsole:getCompatibilityCatalog", () => ({ nowhere: compatibilityCatalog(), protocols: protocolCatalog() })); server.registerRPC("proxyConsole:saveState", (params) => saveState(params && params.state)); server.registerRPC("proxyConsole:validateNode", validateNode); server.registerRPC("proxyConsole:parseNodeUris", parseNodeUris); server.registerRPC("proxyConsole:newToken", () => ({ token: crypto.randomBytes(24).toString("hex") })); server.registerRPC("proxyConsole:getAccessStats", accessStats); server.registerRPC("proxyConsole:getSubscriptionHistory", subscriptionHistory); server.registerRPC("proxyConsole:previewSubscriptionChange", subscriptionChangePreview); server.registerRPC("proxyConsole:subscriptionPreflight", subscriptionPreflight); server.registerRPC("proxyConsole:syncExternalSource", syncExternalSource); server.registerRPC("proxyConsole:startExternalSourceOperation", startExternalSourceOperation); server.registerRPC("proxyConsole:getExternalSourceOperation", getExternalSourceOperation); server.registerRPC("proxyConsole:syncRuleSet", syncRuleSet); server.registerRPC("proxyConsole:deleteRuleSet", deleteRuleSet); server.registerRPC("proxyConsole:serviceCommand", serviceCommand); server.registerRPC("proxyConsole:statusCommand", statusCommand); server.registerRPC("proxyConsole:newManagedNowhereValues", newManagedNowhereValues); server.registerRPC("proxyConsole:previewManagedNowhere", previewManagedNowhere); server.registerRPC("proxyConsole:previewManagedNowhereMigration", previewManagedNowhereMigration); server.registerRPC("proxyConsole:createManagedNowhereDraft", createManagedNowhereDraft); server.registerRPC("proxyConsole:prepareManagedNowhereAction", prepareManagedNowhereAction); server.registerRPC("proxyConsole:recordManagedNowhereResult", recordManagedNowhereResult); server.registerRPC("proxyConsole:newManagedSingBoxValues", newManagedSingBoxValues); server.registerRPC("proxyConsole:previewManagedSingBox", previewManagedSingBox); server.registerRPC("proxyConsole:prepareManagedSingBoxCreate", prepareManagedSingBoxCreate); server.registerRPC("proxyConsole:prepareManagedSingBoxAction", prepareManagedSingBoxAction); server.registerRPC("proxyConsole:prepareManagedSingBoxUpdate", prepareManagedSingBoxUpdate); server.registerRPC("proxyConsole:recordManagedSingBoxResult", recordManagedSingBoxResult); if (typeof server.cron === "function") server.cron("17 * * * *", syncDueSources);
}
