const fs = require("fs");
const path = require("path");
const PREFIX = "PCIPPROFILE\t2\t";

function buildIpProfileCommand() {
  const code = Buffer.from(fs.readFileSync(path.join(__dirname, "ip-profile-check.py"), "utf8")).toString("base64");
  return `python3 -c "$(printf '%s' '${code}' | base64 -d)"`;
}

function parseIpProfileOutput(output) {
  const line = String(output || "").split(/\r?\n/).find((item) => item.startsWith(PREFIX));
  if (!line) return { ok: false, error: "检测脚本没有返回结构化结果" };
  try {
    const value = JSON.parse(Buffer.from(line.slice(PREFIX.length), "base64").toString("utf8"));
    if (value.error) return { ok: false, error: String(value.error).slice(0, 240) };
    const cleanObject = (input, keys, limit = 160) => Object.fromEntries(keys.map((key) => [key, String(input?.[key] ?? "").slice(0, limit)]));
    const latitude = value.location?.latitude;
    const longitude = value.location?.longitude;
    const location = {
      ...cleanObject(value.location, ["countryCode", "country", "region", "city", "timezone", "continent", "postalCode"]),
      latitude: latitude !== null && latitude !== "" && Number.isFinite(Number(latitude)) ? Number(latitude) : null,
      longitude: longitude !== null && longitude !== "" && Number.isFinite(Number(longitude)) ? Number(longitude) : null,
    };
    const network = cleanObject(value.network, ["asn", "organization", "isp", "domain", "type", "range", "ipVersion"]);
    const risk = {
      score: Number.isFinite(Number(value.risk?.score)) ? Number(value.risk.score) : null,
      level: ["low", "medium", "high", "unknown"].includes(value.risk?.level) ? value.risk.level : "unknown",
      proxy: String(value.risk?.proxy || "unknown").slice(0, 16), residential: typeof value.risk?.residential === "boolean" ? value.risk.residential : null,
    };
    const attributes = Array.isArray(value.attributes) ? value.attributes.slice(0, 12).map((item) => ({ label: String(item.label || "").slice(0, 32), value: String(item.value || "").slice(0, 80) })) : [];
    const signals = Array.isArray(value.signals) ? value.signals.slice(0, 12).map((item) => ({ label: String(item.label || "").slice(0, 32), value: typeof item.value === "boolean" ? item.value : null, state: ["good", "warning", "danger", "neutral", "unknown"].includes(item.state) ? item.state : "unknown", detail: String(item.detail || "").slice(0, 80) })) : [];
    const observations = Array.isArray(value.observations) ? value.observations.slice(0, 8).map((item) => ({ source: String(item.source || "").slice(0, 32), ip: String(item.ip || "").slice(0, 64), countryCode: String(item.countryCode || "").slice(0, 8).toUpperCase(), city: String(item.city || "").slice(0, 80), latencyMs: Math.max(0, Number(item.latencyMs) || 0), matched: item.matched === true })) : [];
    const services = Array.isArray(value.services) ? value.services.slice(0, 16).map((item) => ({ name: String(item.name || "").slice(0, 80), status: String(item.status || "UNKNOWN").slice(0, 24), region: String(item.region || "").slice(0, 16), detail: String(item.detail || "").slice(0, 120), latencyMs: Math.max(0, Number(item.latency_ms ?? item.latencyMs) || 0) })) : [];
    return { ok: true, version: String(value.version || "").slice(0, 32), publicIp: String(value.public_ip || "").slice(0, 64), elapsedMs: Math.max(0, Number(value.elapsed_ms) || 0), location, network, risk, attributes, signals, observations, services };
  } catch (_) { return { ok: false, error: "检测脚本返回的数据无法解析" }; }
}

module.exports = { buildIpProfileCommand, parseIpProfileOutput, PREFIX };
