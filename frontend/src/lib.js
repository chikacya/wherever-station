import nowhereCompatibility from "../../tools/nowhere-compatibility.json";

export function flag(code) {
  const value = String(code || "").toUpperCase();
  return /^[A-Z]{2}$/.test(value)
    ? [...value]
        .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
        .join("")
    : "";
}

const COUNTRY_ALIASES = Object.freeze([
  ["HK", /(?:香港|hong\s*kong|\bhk(?:\d+)?\b)/i],
  ["TW", /(?:台湾|臺灣|台北|taiwan|taipei|\btw(?:\d+)?\b)/i],
  ["JP", /(?:日本|东京|東京|大阪|japan|tokyo|osaka|\bjp(?:\d+)?\b)/i],
  ["SG", /(?:新加坡|狮城|獅城|singapore|\bsg(?:\d+)?\b)/i],
  ["KR", /(?:韩国|韓國|首尔|首爾|korea|seoul|\bkr(?:\d+)?\b)/i],
  ["MY", /(?:马来西亚|馬來西亞|吉隆坡|malaysia|kuala\s*lumpur|\bmy(?:\d+)?\b)/i],
  ["US", /(?:美国|美國|美西|美东|美東|洛杉矶|洛杉磯|西雅图|西雅圖|圣何塞|聖何塞|纽约|紐約|united\s*states|america|los\s*angeles|seattle|san\s*jose|new\s*york|\bus(?:a|\d+)?\b)/i],
  ["CA", /(?:加拿大|canada|toronto|vancouver|\bca(?:\d+)?\b)/i],
  ["GB", /(?:英国|英國|伦敦|倫敦|united\s*kingdom|britain|london|\buk(?:\d+)?\b)/i],
  ["DE", /(?:德国|德國|法兰克福|法蘭克福|germany|frankfurt|\bde(?:\d+)?\b)/i],
  ["FR", /(?:法国|法國|巴黎|france|paris|\bfr(?:\d+)?\b)/i],
  ["NL", /(?:荷兰|荷蘭|阿姆斯特丹|netherlands|amsterdam|\bnl(?:\d+)?\b)/i],
  ["AU", /(?:澳大利亚|澳大利亞|澳洲|悉尼|australia|sydney|\bau(?:\d+)?\b)/i],
  ["RU", /(?:俄罗斯|俄羅斯|莫斯科|russia|moscow|\bru(?:\d+)?\b)/i],
  ["IN", /(?:印度|孟买|孟買|india|mumbai|\bin(?:\d+)?\b)/i],
  ["TH", /(?:泰国|泰國|曼谷|thailand|bangkok|\bth(?:\d+)?\b)/i],
  ["VN", /(?:越南|河内|河內|胡志明|vietnam|hanoi|\bvn(?:\d+)?\b)/i],
  ["ID", /(?:印度尼西亚|印度尼西亞|印尼|雅加达|雅加達|indonesia|jakarta|\bid(?:\d+)?\b)/i],
  ["PH", /(?:菲律宾|菲律賓|马尼拉|馬尼拉|philippines|manila|\bph(?:\d+)?\b)/i],
  ["CN", /(?:中国|中國|北京|上海|广州|廣州|深圳|china|beijing|shanghai|\bcn(?:\d+)?\b)/i],
]);

function decodeLoose(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (_) {
    return text;
  }
}

export function inferNodeCountryCode(node = {}, machine = {}) {
  const assigned = String(machine.countryCode || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(assigned)) return assigned;
  const text = [node.name, node.remoteName, node.uri, ...(node.tags || [])]
    .map(decodeLoose)
    .join(" ");
  const regional = text.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0];
  if (regional) {
    const code = [...regional]
      .map((char) => String.fromCharCode(char.codePointAt(0) - 127397))
      .join("");
    if (/^[A-Z]{2}$/.test(code)) return code;
  }
  const normalized = text.replace(/[._|/\\-]+/g, " ");
  return COUNTRY_ALIASES.find(([, pattern]) => pattern.test(normalized))?.[0] || "";
}
export function base64UrlBytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export async function generateRealityKeypair(cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error("当前浏览器不支持安全密钥生成");
  const pair = await cryptoApi.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const privatePkcs8 = new Uint8Array(await cryptoApi.subtle.exportKey("pkcs8", pair.privateKey));
  const publicRaw = new Uint8Array(await cryptoApi.subtle.exportKey("raw", pair.publicKey));
  if (privatePkcs8.length < 32 || publicRaw.length !== 32) throw new Error("浏览器返回了无效的 X25519 密钥");
  return {
    realityPrivateKey: base64UrlBytes(privatePkcs8.slice(-32)),
    realityPublicKey: base64UrlBytes(publicRaw),
  };
}
export function preferredPublicHost(client = {}) {
  const ipv4 = String(client.ipv4 || "").trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ipv4)) {
    const parts = ipv4.split(".").map(Number);
    const privateAddress =
      parts.some((part) => part < 0 || part > 255) ||
      parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224;
    if (!privateAddress) return ipv4;
  }
  const ipv6 = String(client.ipv6 || "").trim().replace(/^\[|\]$/g, "");
  if (ipv6.includes(":") && !/^(?:::1|fe[89ab]|f[cd])/i.test(ipv6)) return ipv6;
  return "";
}
function uriHost(value) {
  const host = String(value || "").trim().replace(/^\[|\]$/g, "");
  return host.includes(":") ? `[${host}]` : host;
}
function utf8Base64(value) {
  const data = new TextEncoder().encode(String(value));
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function buildRepairUri(input = {}) {
  const direct = String(input.uri || "").trim();
  if (direct) return direct;
  const protocol = String(input.protocol || "").toLowerCase();
  const host = uriHost(input.publicHost);
  const port = Number(input.port || 0);
  const credential = String(input.credential || "").trim();
  const name = encodeURIComponent(String(input.name || "待修复节点").trim());
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("请补充有效的公网地址和端口，或直接粘贴 URI");
  if (!credential) throw new Error("请补充用户凭据，或直接粘贴 URI");
  const query = new URLSearchParams();
  if (protocol === "vless") {
    query.set("type", "tcp");
    if (input.realityPublicKey) {
      query.set("security", "reality"); query.set("pbk", input.realityPublicKey); query.set("fp", "chrome");
      if (input.shortId) query.set("sid", input.shortId);
    } else if (input.sni) query.set("security", "tls");
    if (input.sni) query.set("sni", input.sni);
    if (input.flow) query.set("flow", input.flow);
    return `vless://${encodeURIComponent(credential)}@${host}:${port}?${query}#${name}`;
  }
  if (protocol === "vmess") return `vmess://${utf8Base64(JSON.stringify({ v: "2", ps: decodeURIComponent(name), add: host.replace(/^\[|\]$/g, ""), port: String(port), id: credential, aid: "0", scy: "auto", net: "tcp", type: "none", host: "", path: "", tls: input.sni ? "tls" : "", sni: String(input.sni || "") }))}`;
  if (["trojan", "hysteria2", "anytls", "nowhere"].includes(protocol)) {
    if (input.sni) query.set("sni", input.sni);
    if (input.insecure) query.set("insecure", "1");
    if (protocol === "nowhere") { query.set("up", "udp"); query.set("down", "udp"); }
    return `${protocol}://${encodeURIComponent(credential)}@${host}:${port}${query.size ? `?${query}` : ""}#${name}`;
  }
  if (["ss", "shadowsocks"].includes(protocol)) {
    const method = String(input.method || "2022-blake3-aes-128-gcm");
    return `ss://${utf8Base64(`${method}:${credential}`).replace(/=+$/g, "")}@${host}:${port}#${name}`;
  }
  throw new Error("此协议需要直接粘贴已确认的客户端 URI");
}
export function normalizeNodeName(value) {
  const name = String(value || "").trim();
  if (!/(?:%[0-9a-f]{2}){2,}/i.test(name)) return name;
  try {
    return decodeURIComponent(name);
  } catch (_) {
    return name;
  }
}
export const NOWHERE_RELEASE_FALLBACK = Object.freeze([
  "v2.0.2",
  "v2.0.1",
  "v2.0.0",
]);
export function normalizeNowhereReleases(input) {
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map((release) => {
      const tag = String(release?.tag_name || "").trim();
      const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
      if (!match || release?.draft === true || release?.prerelease === true)
        return null;
      const parts = match.slice(1).map(Number);
      if (
        parts[0] < 2 ||
        seen.has(tag)
      )
        return null;
      seen.add(tag);
      const publishedAt = /^\d{4}-\d\d-\d\dT/.test(
        String(release?.published_at || ""),
      )
        ? String(release.published_at)
        : "";
      return { tag, parts, publishedAt };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.parts[0] - a.parts[0] ||
        b.parts[1] - a.parts[1] ||
        b.parts[2] - a.parts[2],
    )
    .slice(0, 12)
    .map(({ parts: _parts, ...release }) => release);
}
export const SING_BOX_RELEASE_FALLBACK = Object.freeze([
  "1.13.11",
  "1.13.10",
  "1.13.9",
]);
export function normalizeSingBoxReleases(input) {
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map((release) => {
      const raw = String(release?.tag_name || "").trim();
      const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw);
      if (!match || release?.draft === true || release?.prerelease === true) return null;
      const tag = match.slice(1).join(".");
      if (seen.has(tag)) return null;
      seen.add(tag);
      return { tag, parts: match.slice(1).map(Number), publishedAt: /^\d{4}-\d\d-\d\dT/.test(String(release?.published_at || "")) ? String(release.published_at) : "" };
    })
    .filter(Boolean)
    .sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2])
    .slice(0, 12)
    .map(({ parts: _parts, ...release }) => release);
}
export const NAME_TEMPLATES = [
  [
    "standard",
    "国旗 · 国家 · 服务商 · 协议",
    "{flag} | {country} | {provider} | {protocol} {n}",
  ],
  [
    "region",
    "国旗 · 城市/地区 · 服务商 · 协议",
    "{flag} | {region} | {provider} | {protocol} {n}",
  ],
  ["compact", "简洁：国旗 · 国家 · 协议", "{flag} {country} | {protocol} {n}"],
  ["host", "按宿主：国旗 · 宿主 · 协议", "{flag} | {host} | {protocol} {n}"],
];
export function protocolLabel(node) {
  const label = {
    vmess: "VMess",
    vless: "VLESS",
    hysteria2: "HY2",
    tuic: "TUIC",
    anytls: "AnyTLS",
    ss: "SS",
    trojan: "Trojan",
  }[node.protocol];
  if (node.protocol !== "nowhere")
    return label || String(node.protocol).toUpperCase();
  try {
    const q = new URL(node.uri).searchParams;
    const up = q.get("up") || "udp";
    const down = q.get("down") || "udp";
    return `Nowhere ${up === down ? (up === "udp" ? "QUIC" : "TLS") : `${up.toUpperCase()}→${down.toUpperCase()}`}`;
  } catch (_) {
    return "Nowhere";
  }
}
export function templateNodeNames(
  nodes,
  machines,
  {
    template = NAME_TEMPLATES[0][2],
    start = 1,
    digits = 2,
    numbering = "group",
  } = {},
  sources = [],
) {
  const allowed = new Set([
    "flag",
    "country",
    "region",
    "provider",
    "protocol",
    "host",
    "n",
    "name",
  ]);
  const unknown = [...template.matchAll(/\{([^{}]+)\}/g)].find(
    (match) => !allowed.has(match[1]),
  );
  if (unknown) throw new Error(`未知占位符：${unknown[0]}`);
  if (
    !Number.isInteger(Number(start)) ||
    Number(start) < 1 ||
    Number(start) > 9999
  )
    throw new Error("起始编号需为 1–9999 的整数");
  const counters = new Map();
  const names = new Set();
  return nodes.map((node, index) => {
    const machine = machines.find((item) => item.id === node.machineId) || {};
    const source = sources.find((item) => item.id === node.sourceId);
    const country = machine.country || machine.countryCode || "未分类";
    const provider = machine.provider || source?.name || "自建";
    const protocol = protocolLabel(node);
    const key = JSON.stringify([
      country,
      machine.region || country,
      provider,
      protocol,
      template.includes("{host}") ? node.machineId : "",
    ]);
    const offset = numbering === "global" ? index : counters.get(key) || 0;
    counters.set(key, offset + 1);
    const values = {
      flag: flag(machine.countryCode),
      country,
      region: machine.region || country,
      provider,
      protocol,
      host: machine.name || source?.name || "外部节点",
      n: String(Number(start) + offset).padStart(Number(digits) || 2, "0"),
      name: node.name.replace(/^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u, ""),
    };
    const generated = template
      .replace(/\{([^{}]+)\}/g, (_, token) => values[token])
      .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
      .trim();
    if (!generated) throw new Error("模板生成了空名称");
    if (generated.length > 160)
      throw new Error("名称超过 160 个字符，请精简模板");
    let name = generated;
    let duplicate = 2;
    while (names.has(name)) name = `${generated} (${duplicate++})`;
    names.add(name);
    return { ...node, name };
  });
}
export function splitTags(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[，,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
export function localDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function bytes(value, rate = false) {
  const size = Number(value || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  if (!size) return rate ? "0 B/s" : "0 B";
  const index = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1,
  );
  return `${(size / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}${rate ? "/s" : ""}`;
}
export function hostFromUri(node) {
  try {
    if (node.protocol === "vmess") {
      let raw = node.uri.slice(8);
      raw += "=".repeat((4 - (raw.length % 4)) % 4);
      return JSON.parse(atob(raw)).add || "—";
    }
    return new URL(node.uri).hostname || "—";
  } catch (_) {
    return "—";
  }
}
export function subscriptionUrl(state, subscription, format = "") {
  const configured = String(state.settings?.publicBaseUrl || "").replace(
    /\/$/,
    "",
  );
  const base = configured || window.location.origin;
  return `${base}/proxy/sub/${subscription.token}${format ? `?format=${encodeURIComponent(format)}` : ""}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcMonthBoundary(year, month, requestedDay) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return requestedDay > lastDay
    ? Date.UTC(year, month + 1, 1)
    : Date.UTC(year, month, Math.max(1, requestedDay));
}

export function trafficPlanCycle(resetDay = 1, now = Date.now()) {
  const date = new Date(now);
  const day = Math.min(31, Math.max(1, Number(resetDay) || 1));
  const thisBoundary = utcMonthBoundary(date.getUTCFullYear(), date.getUTCMonth(), day);
  const started = now >= thisBoundary;
  const startMonth = started ? date.getUTCMonth() : date.getUTCMonth() - 1;
  const startYear = date.getUTCFullYear();
  const start = utcMonthBoundary(startYear, startMonth, day);
  const end = utcMonthBoundary(startYear, startMonth + 1, day);
  return { start, end, resetDay: day };
}

export function evaluateTrafficPlan(plan = {}, counters = {}, now = Date.now()) {
  const enabled = plan?.enabled === true && Number(plan?.limitBytes) > 0;
  const up = Math.max(0, Number(counters?.up) || 0);
  const down = Math.max(0, Number(counters?.down) || 0);
  const accounting = ["sum", "max", "up", "down"].includes(plan?.accounting)
    ? plan.accounting
    : "sum";
  const usedBytes = accounting === "max" ? Math.max(up, down) : accounting === "up" ? up : accounting === "down" ? down : up + down;
  const limitBytes = enabled ? Math.max(0, Number(plan.limitBytes) || 0) : 0;
  const warningLevels = Array.isArray(plan?.warningLevels) && plan.warningLevels.length === 3
    ? plan.warningLevels.map(Number).sort((a, b) => a - b)
    : [70, 90, 100];
  const cycle = trafficPlanCycle(plan?.resetDay, now);
  const elapsedMs = Math.max(60 * 60 * 1000, now - cycle.start);
  const durationMs = Math.max(DAY_MS, cycle.end - cycle.start);
  const projectedBytes = usedBytes > 0 ? usedBytes * (durationMs / elapsedMs) : 0;
  const averagePerDay = usedBytes > 0 ? usedBytes / (elapsedMs / DAY_MS) : 0;
  const exhaustionAt = enabled && averagePerDay > 0 ? cycle.start + (limitBytes / averagePerDay) * DAY_MS : 0;
  const percent = enabled ? (usedBytes / limitBytes) * 100 : 0;
  const state = !enabled ? "unconfigured" : percent >= warningLevels[2] ? "exceeded" : percent >= warningLevels[1] ? "critical" : percent >= warningLevels[0] ? "warning" : "healthy";
  return {
    enabled,
    accounting,
    usedBytes,
    limitBytes,
    remainingBytes: enabled ? Math.max(0, limitBytes - usedBytes) : 0,
    percent,
    state,
    warningLevels,
    cycleStart: cycle.start,
    cycleEnd: cycle.end,
    cycleProgress: Math.min(1, Math.max(0, (now - cycle.start) / durationMs)),
    projectedBytes,
    forecastRisk: enabled && projectedBytes > limitBytes && percent < warningLevels[2],
    exhaustionAt: enabled && exhaustionAt > now ? exhaustionAt : 0,
    averagePerDay,
  };
}
export function anywhereLink(state, subscription) {
  return `anywhere://add-proxy?link=${encodeURIComponent(subscriptionUrl(state, subscription, "anywhere"))}`;
}
export function androidAnywhereLink(state, subscription) {
  // Android imports a regular subscription URL instead of the iOS deep link.
  // The Anywhere feed remains a Base64 URI list, preserving new protocols.
  return subscriptionUrl(state, subscription, "anywhere");
}
export function randomId() {
  return (
    globalThis.crypto?.randomUUID?.().replaceAll("-", "") ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  );
}
export function nowhereVersionCapabilities(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[.-][A-Za-z0-9._-]+)?$/);
  if (!match) return { known: false, supported: false, adapter: "", verified: false, compatibility: "invalid", vectorPin: false, vectorMux: false, localTelemetry: false, isV2: false, protocolGeneration: 0, wireProtocol: "", carrierEndpoints: false, morph: false, transportMemoryProfile: false };
  const parts = match.slice(1).map(Number);
  const version = `v${parts.join(".")}`;
  const compare = (target) => {
    const targetParts = String(target).replace(/^v/, "").split(".").map(Number);
    for (let index = 0; index < 3; index += 1) {
      if (parts[index] !== targetParts[index]) return parts[index] > targetParts[index] ? 1 : -1;
    }
    return 0;
  };
  const adapter = nowhereCompatibility.adapters.find((item) => item.major === parts[0] && compare(item.minimumVersion) >= 0 && compare(item.maximumVersion) <= 0);
  if (!adapter) return { version, known: true, supported: false, adapter: "", verified: false, compatibility: "unverified", vectorPin: false, vectorMux: false, localTelemetry: false, isV2: false, protocolGeneration: 0, wireProtocol: "", carrierEndpoints: false, morph: false, transportMemoryProfile: false };
  const atLeast = (major, minor, patch = 0) => {
    const target = [major, minor, patch];
    for (let index = 0; index < 3; index += 1) {
      if (parts[index] !== target[index]) return parts[index] > target[index];
    }
    return true;
  };
  return {
    version,
    known: true,
    supported: true,
    adapter: adapter.id,
    verified: adapter.verifiedVersions.includes(version),
    compatibility: adapter.verifiedVersions.includes(version) ? "verified" : "compatible-range",
    vectorPin: true,
    vectorMux: true,
    localTelemetry: atLeast(2, 0, 2),
    isV2: true,
    protocolGeneration: adapter.generation,
    wireProtocol: "nw2",
    carrierEndpoints: true,
    morph: true,
    transportMemoryProfile: true,
  };
}
export function moveItem(items, from, to) {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
