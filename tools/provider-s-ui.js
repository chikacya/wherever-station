const crypto = require("crypto");
const { URL } = require("node:url");

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function text(value, max = 160) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normalizeSuiBaseUrl(value) {
  const url = new URL(text(value, 2048));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("S-UI 地址只支持不含账号密码的 HTTP/HTTPS URL");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/apiv2$/i, "");
  return url.toString().replace(/\/$/, "");
}

function parseMaybeJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  try { return JSON.parse(String(value || "")); } catch (_) { return fallback; }
}

function unwrap(envelope, key) {
  if (!envelope || typeof envelope !== "object") throw new Error("S-UI 返回了无效 JSON");
  if (envelope.success !== true) throw new Error(text(envelope.msg, 240) || "S-UI API 请求失败");
  const obj = envelope.obj;
  if (!obj || typeof obj !== "object") return [];
  return Array.isArray(obj[key]) ? obj[key] : [];
}

function fragmentName(uri) {
  try {
    if (uri.startsWith("vmess://")) {
      let raw = uri.slice(8); raw += "=".repeat((4 - raw.length % 4) % 4);
      return text(JSON.parse(Buffer.from(raw, "base64").toString("utf8")).ps, 160);
    }
    const hash = new URL(uri).hash.slice(1);
    try { return text(decodeURIComponent(hash), 160); } catch (_) { return text(hash, 160); }
  } catch (_) { return ""; }
}

function stableLinkId(client, link, inbounds, occurrence) {
  const remark = text(link.remark, 160);
  const inbound = inbounds.find((item) => text(item.tag, 160) === remark);
  if (inbound && inbound.id != null) return `client:${client.id}:inbound:${inbound.id}:${occurrence}`;
  const identity = `${text(link.type, 24)}\0${remark}\0${String(link.uri || "").split("#", 1)[0]}`;
  return `client:${client.id}:link:${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

function parseSuiDiscovery(inboundEnvelope, clientEnvelope, detailedClientEnvelope) {
  const inbounds = unwrap(inboundEnvelope, "inbounds");
  const listedClients = unwrap(clientEnvelope, "clients");
  const detailed = detailedClientEnvelope ? unwrap(detailedClientEnvelope, "clients") : [];
  const byId = new Map(detailed.map((client) => [String(client.id), client]));
  const clients = listedClients.map((client) => ({ ...client, ...(byId.get(String(client.id)) || {}) }));
  const candidates = [];
  const unsupported = [];
  for (const client of clients) {
    const links = parseMaybeJson(client.links, []);
    if (!Array.isArray(links) || !links.length) {
      unsupported.push({ remoteId: `client:${client.id}`, name: text(client.remark || client.name, 160) || `Client ${client.id}`, reason: "该客户端没有可读取的分享链接" });
      continue;
    }
    const occurrences = new Map();
    for (const link of links) {
      const uri = text(link && link.uri, 8192);
      const protocol = text(uri.split(":", 1)[0], 24).toLowerCase();
      const remark = text(link && link.remark, 160);
      const occurrence = occurrences.get(remark) || 0;
      occurrences.set(remark, occurrence + 1);
      const remoteId = stableLinkId(client, link || {}, inbounds, occurrence);
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) {
        unsupported.push({ remoteId, name: remark || text(client.remark || client.name, 160), reason: "分享链接格式无法识别" });
        continue;
      }
      const baseName = text(client.remark || client.name, 160) || `Client ${client.id}`;
      candidates.push({
        remoteId,
        remoteName: fragmentName(uri) || [baseName, remark].filter(Boolean).join(" · "),
        clientName: baseName,
        inboundName: remark,
        protocol,
        uri,
        enabled: client.enable !== false,
      });
    }
  }
  const linkCountByTag = new Map();
  for (const candidate of candidates) {
    const tag = text(candidate.inboundName, 160);
    if (tag) linkCountByTag.set(tag, (linkCountByTag.get(tag) || 0) + 1);
  }
  const bindingsByInbound = new Map();
  for (const client of clients) {
    const clientName = text(client.name || client.remark, 160) || `Client ${client.id}`;
    const inboundIds = parseMaybeJson(client.inbounds, []);
    if (!Array.isArray(inboundIds)) continue;
    for (const inboundId of inboundIds) {
      const key = String(inboundId);
      const values = bindingsByInbound.get(key) || [];
      if (!values.includes(clientName)) values.push(clientName);
      bindingsByInbound.set(key, values);
    }
  }
  const normalizedInbounds = inbounds.map((item) => {
    const id = text(item.id, 64);
    const tag = text(item.tag, 160);
    const rawUsers = parseMaybeJson(item.users, []);
    const listedUsers = Array.isArray(rawUsers) ? rawUsers.map((user) => text(typeof user === "string" ? user : user && (user.name || user.username || user.user), 160)).filter(Boolean) : [];
    const clientsForInbound = [...new Set([...listedUsers, ...(bindingsByInbound.get(id) || [])])];
    const linkCount = linkCountByTag.get(tag) || 0;
    const readiness = linkCount > 0 ? "ready" : clientsForInbound.length ? "needs-link" : "needs-client";
    const reason = readiness === "ready"
      ? `${linkCount} 条原生分享链接可同步`
      : readiness === "needs-link"
        ? "已绑定客户端，但面板尚未生成可读取的分享链接"
        : "先在原面板创建或绑定客户端，才会生成分享链接";
    return { id, tag, type: text(item.type, 32), listen: text(item.listen, 253), port: Number(item.listen_port || 0), readiness, reason, linkCount, clients: clientsForInbound };
  });
  return {
    inbounds: normalizedInbounds,
    clients: clients.map((item) => ({ id: text(item.id, 64), name: text(item.name || item.remark, 160) || `Client ${item.id}`, remark: text(item.remark, 160), enabled: item.enable !== false, upload: Math.max(0, Number(item.up || 0)), download: Math.max(0, Number(item.down || 0)), total: Math.max(0, Number(item.volume || 0)), expire: Math.max(0, Number(item.expiry || 0)), nextReset: Math.max(0, Number(item.nextReset || 0)), group: text(item.group, 80) })),
    candidates,
    unsupported,
  };
}

function providerStatus(envelope) {
  if (!envelope || envelope.success !== true || !envelope.obj || typeof envelope.obj !== "object") return null;
  const singBox = envelope.obj.sbd;
  if (!singBox || typeof singBox !== "object") return null;
  return { running: singBox.running === true, version: text(singBox.version, 120), uptime: Math.max(0, Number(singBox.stats && singBox.stats.Uptime || 0)) };
}

function createSuiProvider(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const type = options.type === "2s-ui" ? "2s-ui" : "s-ui";
  if (typeof fetchImpl !== "function") throw new Error("当前运行时不支持 HTTP Provider");
  async function request(baseUrl, token, action, query = {}) {
    const url = new URL(`${normalizeSuiBaseUrl(baseUrl)}/apiv2/${action}`);
    for (const [key, value] of Object.entries(query)) if (value !== "") url.searchParams.set(key, value);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
    try {
      const response = await fetchImpl(url, { method: "GET", redirect: "follow", signal: controller && controller.signal, headers: { Token: text(token, 2048), Accept: "application/json", "User-Agent": "Wherever-Station-SUI-Provider/1" } });
      if (!response.ok) throw new Error(`S-UI 返回 HTTP ${response.status}`);
      const length = Number(response.headers && response.headers.get && response.headers.get("content-length") || 0);
      if (length > MAX_RESPONSE_BYTES) throw new Error("S-UI 响应超过 4 MiB 限制");
      const body = await response.text();
      if (body.length > MAX_RESPONSE_BYTES) throw new Error("S-UI 响应超过 4 MiB 限制");
      try { return JSON.parse(body); } catch (_) { throw new Error("S-UI 返回了无法解析的 JSON"); }
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("连接 S-UI 超时");
      throw error;
    } finally { if (timer) clearTimeout(timer); }
  }
  async function read(baseUrl, token) {
    const requests = [request(baseUrl, token, "inbounds"), request(baseUrl, token, "clients")];
    if (type === "2s-ui") requests.push(request(baseUrl, token, "status", { r: "sbd" }));
    const [inbounds, clients, statusEnvelope] = await Promise.all(requests);
    const listed = unwrap(clients, "clients");
    const ids = listed.map((item) => item && item.id).filter((id) => id != null).slice(0, 500).join(",");
    const detailed = ids ? await request(baseUrl, token, "clients", { id: ids }) : null;
    return { ...parseSuiDiscovery(inbounds, clients, detailed), status: type === "2s-ui" ? providerStatus(statusEnvelope) : null };
  }
  return {
    type,
    async test(config, secret) {
      const discovery = await read(config.baseUrl, secret.token);
      return { ok: true, inbounds: discovery.inbounds.length, clients: discovery.clients.length, links: discovery.candidates.length, pending: discovery.inbounds.filter((item) => item.readiness !== "ready").length, unsupported: discovery.unsupported.length, clientRecords: discovery.clients, status: discovery.status };
    },
    async discover(config, secret) { return read(config.baseUrl, secret.token); },
  };
}

module.exports = { createSuiProvider, normalizeSuiBaseUrl, parseSuiDiscovery, providerStatus };
