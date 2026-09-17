const path = require("node:path");
const { URLSearchParams } = require("node:url");
const { VERSION_PATTERN, nowhereCapabilities } = require("./nowhere-capabilities");

const INSTANCE_ROOT = "/var/lib/proxy-console/instances";
const UNIT_PREFIX = "proxy-console-nowhere@";
const MANAGED_STATES = new Set(["draft", "validated", "stopped", "running", "failed"]);

function cleanInstanceId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{7,47}$/.test(id)) throw new Error("Invalid managed Nowhere instance id");
  return id;
}

function integer(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Invalid ${label}`);
  return number;
}

function optionalPort(value, label) {
  if (value === undefined || value === null || value === "" || Number(value) === 0) return 0;
  return integer(value, label, 1024, 65535);
}

function text(value, label, max = 255, allowEmpty = false) {
  const result = String(value == null ? "" : value).trim();
  if ((!allowEmpty && !result) || result.length > max || /[\r\n\0]/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function oneOf(value, values, fallback, label) {
  const result = value === undefined || value === "" ? fallback : String(value);
  if (!values.includes(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function quoteEnvironment(value) {
  return `"${String(value).replace(/[\r\n\0]/g, "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function hostForUrl(value) {
  const host = text(value, "public host", 253).replace(/^\[|\]$/g, "");
  return host.includes(":") ? `[${host}]` : host;
}

function listenHostForUrl(value) {
  const host = text(value, "listen host", 253, true).replace(/^\[|\]$/g, "");
  return host.includes(":") ? `[${host}]` : host;
}

function carrierName(value, family, fallback) {
  const explicit = String(value || "").trim();
  if (explicit) return oneOf(explicit, fallback === "tcp" ? ["tcp", "tcp4", "tcp6"] : ["udp", "udp4", "udp6"], fallback, `${fallback} carrier`);
  const normalized = oneOf(family, ["any", "ipv4", "ipv6"], "any", `${fallback} address family`);
  return `${fallback}${normalized === "ipv4" ? "4" : normalized === "ipv6" ? "6" : ""}`;
}

function buildNowhereEndpoint(host, input = {}) {
  const formatted = hostForUrl(host);
  const tcpPort = optionalPort(input.tcpPort, "TCP carrier port");
  const udpPort = optionalPort(input.udpPort, "UDP carrier port");
  if (!tcpPort && !udpPort) throw new Error("Nowhere V2 requires at least one carrier");
  const tcpCarrier = carrierName(input.tcpCarrier, input.tcpFamily, "tcp");
  const udpCarrier = carrierName(input.udpCarrier, input.udpFamily, "udp");
  if (tcpPort && udpPort && tcpPort === udpPort && tcpCarrier === "tcp" && udpCarrier === "udp") return `${formatted}:${tcpPort}`;
  return `${formatted}/${[tcpPort ? `${tcpCarrier}:${tcpPort}` : "", udpPort ? `${udpCarrier}:${udpPort}` : ""].filter(Boolean).join("/")}`;
}

function versionAtLeast(version, major, minor, patch) {
  const capabilities = nowhereCapabilities(version);
  if (!capabilities.known) return false;
  const current = capabilities.version.match(/\d+/g).slice(0, 3).map(Number);
  const target = [major, minor, patch];
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== target[index]) return current[index] > target[index];
  }
  return true;
}

function validateAbsoluteFile(value, label) {
  const result = text(value, label, 512);
  if (!result.startsWith("/") || result.split("/").includes("..")) throw new Error(`Invalid ${label}`);
  return result;
}

function buildAnywhereLink(input) {
  const capabilities = nowhereCapabilities(input.version || "v1.8.0");
  const host = capabilities.isV2
    ? buildNowhereEndpoint(input.publicHost, input)
    : `${hostForUrl(input.publicHost)}:${integer(input.port, "port", 1, 65535)}`;
  const key = encodeURIComponent(text(input.key, "shared key"));
  const up = oneOf(input.up, ["tcp", "udp"], "udp", "upload transport");
  const down = oneOf(input.down, ["tcp", "udp"], "udp", "download transport");
  const version = text(input.version || "v1.8.0", "version", 64);
  const name = encodeURIComponent(text(input.name || "Nowhere", "display name", 160));
  const query = new URLSearchParams({ up, down });
  if (capabilities.isV2) {
    query.set("morph", oneOf(String(input.morph ?? 0), ["0", "1"], "0", "morph"));
    query.set("mux", oneOf(String(input.vectorMux ?? 0), ["0", "1"], "0", "vector mux"));
  } else {
    if (capabilities.legacyPool && up === "tcp" && down === "tcp") query.set("pool", String(integer(input.pool ?? 5, "pool", 0, 9)));
    if (input.alpn && input.alpn !== "now/1") query.set("alpn", text(input.alpn, "ALPN"));
  }
  return `nowhere://${key}@${host}?${query.toString()}#${name}`;
}

function buildVectorLink(input) {
  const capabilities = nowhereCapabilities(input.version || "v1.8.0");
  const host = capabilities.isV2
    ? buildNowhereEndpoint(input.publicHost, input)
    : `${hostForUrl(input.publicHost)}:${integer(input.port, "port", 1, 65535)}`;
  const key = encodeURIComponent(text(input.key, "shared key"));
  const up = oneOf(input.up, ["tcp", "udp"], "udp", "upload transport");
  const down = oneOf(input.down, ["tcp", "udp"], "udp", "download transport");
  const version = text(input.version || "v1.8.0", "version", 64);
  const query = new URLSearchParams({ up, down });
  if (capabilities.vectorMux) query.set("mux", oneOf(String(input.vectorMux ?? 0), ["0", "1"], "0", "vector mux"));
  else if (capabilities.legacyPool && up === "tcp" && down === "tcp") query.set("pool", String(integer(input.pool ?? 5, "pool", 0, 256)));
  if (capabilities.isV2) query.set("morph", oneOf(String(input.morph ?? 0), ["0", "1"], "0", "morph"));
  query.set("sni", text(input.vectorSni || "none", "vector SNI"));
  if (capabilities.vectorPin) query.set("pin", text(input.vectorPin || "none", "vector pin"));
  if (!capabilities.isV2 && input.alpn && input.alpn !== "now/1") query.set("alpn", text(input.alpn, "ALPN"));
  query.set("socks", text(input.vectorSocks || "127.0.0.1:1080", "vector SOCKS"));
  return `vector://${key}@${host}?${query.toString()}`;
}

function planManagedNowhere(input = {}) {
  const id = cleanInstanceId(input.id);
  const name = text(input.name || `Nowhere ${id}`, "display name", 160);
  const version = text(input.version || "v1.8.0", "version", 64);
  if (!VERSION_PATTERN.test(version) || !versionAtLeast(version, 1, 5, 0)) throw new Error("Invalid Nowhere version");
  const capabilities = nowhereCapabilities(version);
  if (!capabilities.supported) throw new Error("Unsupported Nowhere version adapter");
  const publicHost = text(input.publicHost, "public host", 253);
  const listenHost = input.listenHost === undefined ? "127.0.0.1" : text(input.listenHost, "listen host", 253, true);
  const port = integer(input.port, "port", 1024, 65535);
  const key = text(input.key, "shared key");
  const client = oneOf(input.client, ["anywhere", "vector", "both"], "anywhere", "client");
  let network = oneOf(input.network, ["mix", "tcp", "udp"], "mix", "network");
  const hasExplicitV2Ports = Object.hasOwn(input, "tcpPort") || Object.hasOwn(input, "udpPort");
  const tcpPort = capabilities.isV2
    ? optionalPort(hasExplicitV2Ports ? input.tcpPort : network === "udp" ? 0 : port, "TCP carrier port")
    : network === "udp" ? 0 : port;
  const udpPort = capabilities.isV2
    ? optionalPort(hasExplicitV2Ports ? input.udpPort : network === "tcp" ? 0 : port, "UDP carrier port")
    : network === "tcp" ? 0 : port;
  if (capabilities.isV2 && !tcpPort && !udpPort) throw new Error("Nowhere V2 requires at least one carrier");
  if (capabilities.isV2) network = tcpPort && udpPort ? "mix" : tcpPort ? "tcp" : "udp";
  const tcpCarrier = carrierName(input.tcpCarrier, input.tcpFamily, "tcp");
  const udpCarrier = carrierName(input.udpCarrier, input.udpFamily, "udp");
  const requestedTls = integer(input.tls ?? 1, "TLS mode", 1, 2);
  const certificateMode = oneOf(
    input.certificateMode,
    ["ephemeral", "managed", "existing"],
    requestedTls === 1 ? "ephemeral" : "existing",
    "certificate mode",
  );
  const tls = certificateMode === "ephemeral" ? 1 : 2;
  const alpn = capabilities.isV2 ? "nw2" : text(input.alpn || "now/1", "ALPN", 64);
  const rate = integer(input.rate ?? 0, "upload rate", 0, 1_000_000);
  const etar = integer(input.etar ?? 0, "download rate", 0, 1_000_000);
  const dial = text(input.dial || "auto", "dial address", 253);
  const socks = text(input.socks || "none", "SOCKS address", 512);
  const log = oneOf(input.log, ["none", "debug", "info", "warn", "error", "event"], "info", "log level");
  const telemetryInterval = text(input.telemetryInterval || "1s", "telemetry interval", 16);
  const telemetryMatch = telemetryInterval.match(/^(\d+)(ms|s)$/);
  const telemetryMs = telemetryMatch
    ? Number(telemetryMatch[1]) * (telemetryMatch[2] === "s" ? 1000 : 1)
    : 0;
  if (telemetryMs < 250 || telemetryMs > 60_000) throw new Error("Invalid telemetry interval");
  const pool = integer(input.pool ?? 5, "pool", 0, client === "vector" ? 256 : 9);
  const vectorSocks = text(input.vectorSocks || "127.0.0.1:1080", "vector SOCKS", 512);
  const vectorSni = text(input.vectorSni || "none", "vector SNI", 253);
  const vectorPin = text(input.vectorPin || "none", "vector pin", 64);
  if (vectorPin !== "none" && !/^[0-9a-f]{64}$/.test(vectorPin)) throw new Error("Invalid vector pin");
  const vectorMux = integer(input.vectorMux ?? 0, "vector mux", 0, 1);
  const quicMemoryProfile = oneOf(input.quicMemoryProfile, ["memory", "balanced", "throughput"], "balanced", "QUIC memory profile");
  const morph = integer(input.morph ?? 0, "morph", 0, 1);
  const transportMemoryProfile = oneOf(input.transportMemoryProfile, ["memory", "balanced", "throughput"], "throughput", "transport memory profile");
  const directory = path.posix.join(INSTANCE_ROOT, id);
  const binaryPath = path.posix.join(directory, "bin", "nowhere");
  const environmentPath = path.posix.join(directory, "nowhere.env");
  const unitName = `${UNIT_PREFIX}${id}.service`;
  const unitPath = path.posix.join("/etc/systemd/system", unitName);
  const certificatePath = certificateMode === "managed"
    ? path.posix.join(directory, "certificates", "certificate.pem")
    : certificateMode === "existing" ? validateAbsoluteFile(input.certificatePath, "certificate path") : "";
  const privateKeyPath = certificateMode === "managed"
    ? path.posix.join(directory, "certificates", "private-key.pem")
    : certificateMode === "existing" ? validateAbsoluteFile(input.privateKeyPath, "private key path") : "";
  const certificateHost = text(input.certificateHost || publicHost, "certificate host", 253);
  const certificateDays = integer(input.certificateDays ?? 825, "certificate validity", 1, 3650);
  const query = new URLSearchParams({ tls: String(tls) });
  if (capabilities.isV2) query.set("morph", String(morph));
  else {
    if (alpn !== "now/1") query.set("alpn", alpn);
    if (network !== "mix") query.set("net", network);
  }
  if (dial !== "auto") query.set("dial", dial);
  if (socks !== "none") query.set("socks", socks);
  if (rate) query.set("rate", String(rate));
  if (etar) query.set("etar", String(etar));
  if (tls === 2) { query.set("crt", certificatePath); query.set("key", privateKeyPath); }
  if (log !== "info") query.set("log", log);
  const portalEndpoint = capabilities.isV2
    ? buildNowhereEndpoint(listenHost || "*", { tcpPort, udpPort, tcpCarrier, udpCarrier })
    : `${listenHostForUrl(listenHost)}:${port}`;
  const portal = `portal://${encodeURIComponent(key)}@${portalEndpoint}?${query.toString()}`;
  const environmentValues = {
    NOWHERE_PORTAL: portal, NOWHERE_CLIENT_VALUE: client, NOWHERE_VERSION_VALUE: version,
    NOWHERE_PUBLIC_HOST_VALUE: publicHost, NOWHERE_LISTEN_HOST_VALUE: listenHost,
    NOWHERE_PORT_VALUE: port, NOWHERE_KEY_VALUE: key, NOWHERE_NET_VALUE: network,
    NOWHERE_TCP_PORT_VALUE: tcpPort, NOWHERE_UDP_PORT_VALUE: udpPort,
    NOWHERE_TCP_CARRIER_VALUE: tcpCarrier, NOWHERE_UDP_CARRIER_VALUE: udpCarrier,
    NOWHERE_ALPN_VALUE: alpn, NOWHERE_TLS_VALUE: tls, NOWHERE_CRT_VALUE: certificatePath,
    NOWHERE_TLS_KEY_VALUE: privateKeyPath, NOWHERE_RATE_VALUE: rate, NOWHERE_ETAR_VALUE: etar,
    NOWHERE_CERTIFICATE_MODE_VALUE: certificateMode, NOWHERE_CERTIFICATE_HOST_VALUE: certificateHost,
    NOWHERE_CERTIFICATE_DAYS_VALUE: certificateDays,
    NOWHERE_DIAL_VALUE: dial, NOWHERE_SOCKS_VALUE: socks, NOWHERE_LOG_VALUE: log,
    NOWHERE_TELEMETRY_INTERVAL_VALUE: telemetryInterval, NOW_TELEMETRY_INTERVAL: telemetryInterval,
    NOWHERE_VECTOR_SOCKS_VALUE: vectorSocks, NOWHERE_VECTOR_SNI_VALUE: vectorSni,
    NOWHERE_VECTOR_PIN_VALUE: vectorPin, NOWHERE_VECTOR_MUX_VALUE: vectorMux,
    NOWHERE_QUIC_MEMORY_PROFILE_VALUE: quicMemoryProfile, NOW_QUIC_MEMORY_PROFILE: quicMemoryProfile,
    NOWHERE_MORPH_VALUE: morph, NOWHERE_TRANSPORT_MEMORY_PROFILE_VALUE: transportMemoryProfile,
    NOWHERE_POOL_VALUE: pool,
  };
  if (capabilities.isV2) {
    delete environmentValues.NOW_QUIC_MEMORY_PROFILE;
    environmentValues.NOW_TRANSPORT_MEMORY_PROFILE = transportMemoryProfile;
  }
  const extensions = input.extensionEnvironment && typeof input.extensionEnvironment === "object" && !Array.isArray(input.extensionEnvironment)
    ? Object.entries(input.extensionEnvironment) : [];
  if (extensions.length > 32) throw new Error("Too many Nowhere extension settings");
  for (const [keyName, value] of extensions) {
    if (!/^NOW(?:HERE)?_[A-Z0-9_]{1,80}$/.test(keyName) || Object.hasOwn(environmentValues, keyName)) continue;
    environmentValues[keyName] = text(value, `extension ${keyName}`, 4096, true);
  }
  const environment = Object.entries(environmentValues).map(([keyName, value]) => `${keyName}=${quoteEnvironment(value)}`).join("\n") + "\n";
  const unit = `[Unit]\nDescription=Wherever Station managed Nowhere ${id}\nDocumentation=https://github.com/NodePassProject/Nowhere\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nEnvironmentFile=${environmentPath}\nExecStart=${binaryPath} \${NOWHERE_PORTAL}\nRestart=on-failure\nRestartSec=3\nLimitNOFILE=1048576\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=full\nProtectHome=read-only\n\n[Install]\nWantedBy=multi-user.target\n`;
  const linkInput = { publicHost, port, tcpPort, udpPort, tcpCarrier, udpCarrier, key, version, alpn, pool, vectorMux, vectorSni, vectorPin, vectorSocks, morph, name };
  const carriers = network === "tcp" ? [["tcp", "tcp"]] : network === "udp" ? [["udp", "udp"]] : capabilities.isV2 ? [["tcp", "tcp"], ["udp", "udp"], ["tcp", "udp"], ["udp", "tcp"]] : [["udp", "udp"], ["tcp", "tcp"], ["tcp", "udp"], ["udp", "tcp"]];
  const links = {
    anywhere: client === "vector" ? [] : carriers.map(([up, down]) => ({ up, down, uri: buildAnywhereLink({ ...linkInput, up, down }) })),
    vector: client === "anywhere" ? [] : carriers.map(([up, down]) => ({ up, down, uri: buildVectorLink({ ...linkInput, up, down }) })),
  };
  return {
    schema: 3, kind: "managed-nowhere", id, name, version, directory, binaryPath, environmentPath,
    unitName, unitPath, environment, unit, links, certificateMode, certificatePath,
    privateKeyPath, certificateHost, certificateDays,
    clientLink: links.anywhere[0]?.uri || links.vector[0]?.uri || "",
    summary: { name, publicHost, listenHost: listenHost || "全部地址", port, tcpPort, udpPort, tcpCarrier, udpCarrier, client, network, tls, version, protocolGeneration: capabilities.protocolGeneration, wireProtocol: capabilities.wireProtocol, alpn, morph, quicMemoryProfile, transportMemoryProfile, rate, etar, log, unitName, certificateMode, certificateHost, certificateDays },
    safeguards: ["create-new-directory", "copy-or-download-private-binary", "managed-unit-prefix-only", "major-version-migration-required", "never-touch-existing-nowhere-service"],
  };
}

function cleanManagedState(value) {
  const state = String(value || "draft");
  return MANAGED_STATES.has(state) ? state : "draft";
}

module.exports = {
  INSTANCE_ROOT, MANAGED_STATES, UNIT_PREFIX, buildAnywhereLink, buildNowhereEndpoint, buildVectorLink,
  cleanInstanceId, cleanManagedState, planManagedNowhere, quoteEnvironment, versionAtLeast,
};
