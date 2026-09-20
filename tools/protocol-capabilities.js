const CONVERTED_PROTOCOLS = Object.freeze({
  mihomo: Object.freeze(["vless", "vmess", "hysteria2", "tuic", "anytls", "trojan", "ss", "socks5", "socks", "http", "https"]),
  "sing-box": Object.freeze(["vless", "vmess", "hysteria2", "tuic", "anytls", "trojan", "ss", "socks5", "socks", "http", "https"]),
  surge: Object.freeze(["vmess", "hysteria2", "tuic", "anytls", "trojan", "ss", "socks5", "socks", "http", "https"]),
});

const PASSTHROUGH_FORMATS = Object.freeze(["raw", "base64", "anywhere", "loon"]);

// This list describes client-native URI schemes only. Passthrough feeds never
// reject an unknown scheme: an unknown value remains byte-for-byte intact so a
// newer client can consume it before Wherever Station gains a semantic adapter.
const CLIENT_URI_PROTOCOLS = Object.freeze({
  anywhere: Object.freeze(["nowhere", "vless", "hysteria2", "hy2", "trojan", "anytls", "ss", "socks5", "socks", "sudoku", "http", "https", "quic", "naive"]),
  // Keep this list aligned with Loon's documented URI subscription schemes.
  // Other proxy types require Loon's native key/value syntax rather than a
  // byte-for-byte URI passthrough, so they must not be claimed here.
  loon: Object.freeze(["ss", "ssr", "vmess", "vless", "trojan", "hysteria2", "hy2", "anytls"]),
});

// Rewriting a fragment is a protocol operation. Unknown schemes remain byte-for-byte
// unchanged so new protocols can travel through Wherever Station before an adapter exists.
const NAME_REWRITE_PROTOCOLS = Object.freeze([
  "anytls", "hysteria2", "nowhere", "socks", "socks5", "ss", "trojan", "tuic", "vless", "vmess", "http", "https",
]);
const SEMANTIC_PROTOCOLS = Object.freeze([...NAME_REWRITE_PROTOCOLS]);

function protocolCapability(format, protocol) {
  const target = String(format || "").toLowerCase();
  const scheme = String(protocol || "").toLowerCase();
  if (PASSTHROUGH_FORMATS.includes(target)) {
    const native = CLIENT_URI_PROTOCOLS[target];
    return {
      supported: true,
      mode: "passthrough",
      clientSupport: native ? (native.includes(scheme) ? "native" : "unknown") : "not-applicable",
    };
  }
  if ((CONVERTED_PROTOCOLS[target] || []).includes(scheme)) return { supported: true, mode: "converted", clientSupport: "native" };
  return { supported: false, mode: "unsupported", clientSupport: "unsupported" };
}

function protocolCatalog() {
  return {
    converted: Object.fromEntries(Object.entries(CONVERTED_PROTOCOLS).map(([key, value]) => [key, [...value]])),
    passthrough: [...PASSTHROUGH_FORMATS],
    clientNativeUri: Object.fromEntries(Object.entries(CLIENT_URI_PROTOCOLS).map(([key, value]) => [key, [...value]])),
    semantic: [...SEMANTIC_PROTOCOLS],
    safeNameRewrite: [...NAME_REWRITE_PROTOCOLS],
  };
}

module.exports = {
  CONVERTED_PROTOCOLS,
  CLIENT_URI_PROTOCOLS,
  NAME_REWRITE_PROTOCOLS,
  PASSTHROUGH_FORMATS,
  SEMANTIC_PROTOCOLS,
  protocolCapability,
  protocolCatalog,
};
