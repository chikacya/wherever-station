// Pure EnvironmentFile planning for the local NodePassProject/Nowhere layout.
const MANAGED = new Set([
  "NOWHERE_PORTAL", "NOWHERE_CLIENT_VALUE", "NOWHERE_VERSION_VALUE", "NOWHERE_PUBLIC_HOST_VALUE",
  "NOWHERE_LISTEN_HOST_VALUE", "NOWHERE_PORT_VALUE", "NOWHERE_KEY_VALUE", "NOWHERE_NET_VALUE",
  "NOWHERE_ALPN_VALUE", "NOWHERE_TLS_VALUE", "NOWHERE_CRT_VALUE", "NOWHERE_TLS_KEY_VALUE",
  "NOWHERE_RATE_VALUE", "NOWHERE_ETAR_VALUE", "NOWHERE_DIAL_VALUE", "NOWHERE_SOCKS_VALUE",
  "NOWHERE_LOG_VALUE", "NOWHERE_TELEMETRY_INTERVAL_VALUE", "NOWHERE_VECTOR_SOCKS_VALUE",
  "NOWHERE_VECTOR_SNI_VALUE", "NOWHERE_VECTOR_PIN_VALUE", "NOWHERE_VECTOR_MUX_VALUE",
  "NOWHERE_QUIC_MEMORY_PROFILE_VALUE", "NOW_QUIC_MEMORY_PROFILE", "NOWHERE_POOL_VALUE",
  "NOWHERE_CERTIFICATE_MODE_VALUE", "NOWHERE_CERTIFICATE_HOST_VALUE", "NOWHERE_CERTIFICATE_DAYS_VALUE",
  "NOWHERE_TCP_PORT_VALUE", "NOWHERE_UDP_PORT_VALUE", "NOWHERE_TCP_CARRIER_VALUE", "NOWHERE_UDP_CARRIER_VALUE",
  "NOWHERE_MORPH_VALUE", "NOWHERE_TRANSPORT_MEMORY_PROFILE_VALUE", "NOW_TRANSPORT_MEMORY_PROFILE",
]);
function quote(value) { return `"${String(value).replace(/[\r\n]/g, "").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`; }
function validate(key, value) {
  if (!MANAGED.has(key)) throw new Error(`Unsupported Nowhere setting: ${key}`);
  value = String(value);
  if (value.length > 4096 || /[\r\n\0]/.test(value)) throw new Error(`Invalid value for ${key}`);
  if (key === "NOWHERE_PORT_VALUE" && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)) throw new Error("Invalid Nowhere port");
  if (["NOWHERE_TCP_PORT_VALUE", "NOWHERE_UDP_PORT_VALUE"].includes(key) && (!/^\d+$/.test(value) || Number(value) < 0 || Number(value) > 65535)) throw new Error("Invalid Nowhere carrier port");
  if (key === "NOWHERE_TCP_CARRIER_VALUE" && !["tcp", "tcp4", "tcp6"].includes(value)) throw new Error("Invalid Nowhere TCP carrier");
  if (key === "NOWHERE_UDP_CARRIER_VALUE" && !["udp", "udp4", "udp6"].includes(value)) throw new Error("Invalid Nowhere UDP carrier");
  if (key === "NOWHERE_CLIENT_VALUE" && !["anywhere", "vector", "both"].includes(value)) throw new Error("Invalid Nowhere client mode");
  if (key === "NOWHERE_NET_VALUE" && !["mix", "tcp", "udp"].includes(value)) throw new Error("Invalid Nowhere network mode");
  if (key === "NOWHERE_TLS_VALUE" && !["1", "2"].includes(value)) throw new Error("Invalid Nowhere TLS mode");
  if (key === "NOWHERE_CERTIFICATE_MODE_VALUE" && !["ephemeral", "managed", "existing"].includes(value)) throw new Error("Invalid Nowhere certificate mode");
  if (key === "NOWHERE_LOG_VALUE" && !["none", "debug", "info", "warn", "error", "event"].includes(value)) throw new Error("Invalid Nowhere log level");
  if (key === "NOWHERE_VECTOR_MUX_VALUE" && !["0", "1"].includes(value)) throw new Error("Invalid Nowhere vector mux mode");
  if (key === "NOWHERE_MORPH_VALUE" && !["0", "1"].includes(value)) throw new Error("Invalid Nowhere morph mode");
  if (["NOWHERE_QUIC_MEMORY_PROFILE_VALUE", "NOW_QUIC_MEMORY_PROFILE"].includes(key) && !["memory", "balanced", "throughput"].includes(value)) throw new Error("Invalid Nowhere QUIC memory profile");
  if (["NOWHERE_TRANSPORT_MEMORY_PROFILE_VALUE", "NOW_TRANSPORT_MEMORY_PROFILE"].includes(key) && !["memory", "balanced", "throughput"].includes(value)) throw new Error("Invalid Nowhere transport memory profile");
}
function planNowhereEnvironment(source, patch) {
  if (typeof source !== "string" || !patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Invalid Nowhere environment plan");
  const entries = Object.entries(patch); if (!entries.length) throw new Error("Nowhere plan has no changes");
  entries.forEach(([key, value]) => validate(key, value));
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const found = new Map();
  lines.forEach((line, index) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/); if (!match || !MANAGED.has(match[1])) return;
    if (found.has(match[1])) throw new Error(`Duplicate Nowhere setting: ${match[1]}`); found.set(match[1], index);
  });
  const changedKeys = [];
  for (const [key, value] of entries) {
    const replacement = `${key}=${quote(value)}`;
    if (found.has(key)) {
      if (lines[found.get(key)] === replacement) continue;
      lines[found.get(key)] = replacement;
    } else {
      if (lines.at(-1) === "") lines.splice(lines.length - 1, 0, replacement); else lines.push(replacement);
    }
    changedKeys.push(key);
  }
  return { content: lines.join("\n"), preview: { changedKeys, changed: changedKeys.length > 0, validator: "nowhere --check support must be confirmed before apply" } };
}
module.exports = { planNowhereEnvironment, MANAGED };
