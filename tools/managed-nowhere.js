const path = require("node:path");
const { isIP } = require("node:net");
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
  const capabilities = nowhereCapabilities(input.version || "v2.1.0");
  if (!capabilities.supported) throw new Error("Nowhere 2.x or newer is required");
  const host = buildNowhereEndpoint(input.publicHost, input);
  const key = encodeURIComponent(text(input.key, "shared key"));
  const up = oneOf(input.up, ["tcp", "udp"], "udp", "upload transport");
  const down = oneOf(input.down, ["tcp", "udp"], "udp", "download transport");
  const name = encodeURIComponent(text(input.name || "Nowhere", "display name", 160));
  const query = new URLSearchParams({ up, down });
  query.set("morph", oneOf(String(input.morph ?? 0), ["0", "1"], "0", "morph"));
  query.set("mux", oneOf(String(input.vectorMux ?? 0), ["0", "1"], "0", "vector mux"));
  if (input.vectorSni && input.vectorSni !== "none") query.set("sni", text(input.vectorSni, "server name", 253));
  return `nowhere://${key}@${host}?${query.toString()}#${name}`;
}

function buildVectorLink(input) {
  const capabilities = nowhereCapabilities(input.version || "v2.1.0");
  if (!capabilities.supported) throw new Error("Nowhere 2.x or newer is required");
  const host = buildNowhereEndpoint(input.publicHost, input);
  const key = encodeURIComponent(text(input.key, "shared key"));
  const up = oneOf(input.up, ["tcp", "udp"], "udp", "upload transport");
  const down = oneOf(input.down, ["tcp", "udp"], "udp", "download transport");
  const query = new URLSearchParams({ up, down });
  query.set("mux", oneOf(String(input.vectorMux ?? 0), ["0", "1"], "0", "vector mux"));
  query.set("morph", oneOf(String(input.morph ?? 0), ["0", "1"], "0", "morph"));
  query.set("sni", text(input.vectorSni || "none", "vector SNI"));
  query.set("pin", text(input.vectorPin || "none", "vector pin"));
  query.set("socks", text(input.vectorSocks || "127.0.0.1:1080", "vector SOCKS"));
  return `vector://${key}@${host}?${query.toString()}`;
}

function planManagedNowhere(input = {}) {
  const id = cleanInstanceId(input.id);
  const name = text(input.name || `Nowhere ${id}`, "display name", 160);
  const version = text(input.version || "v2.1.0", "version", 64);
  if (!VERSION_PATTERN.test(version) || !versionAtLeast(version, 2, 0, 0)) throw new Error("Nowhere 2.x or newer is required");
  const capabilities = nowhereCapabilities(version);
  if (!capabilities.supported) throw new Error("Unsupported Nowhere version adapter");
  const publicHost = text(input.publicHost, "public host", 253);
  const listenHost = input.listenHost === undefined ? "127.0.0.1" : text(input.listenHost, "listen host", 253, true);
  const port = integer(input.port, "port", 1024, 65535);
  const key = text(input.key, "shared key");
  if (versionAtLeast(version, 2, 2, 0) && !(versionAtLeast(version, 2, 2, 1) ? /^[0-9a-f]{32,64}$/ : /^[0-9a-f]{64}$/).test(key)) throw new Error("共享密钥不符合目标 Nowhere 版本要求：2.2.1 接受 32–64 字符小写十六进制；请同步所有客户端与下一跳");
  const client = oneOf(input.client, ["anywhere", "vector", "both"], "anywhere", "client");
  let network = oneOf(input.network, ["mix", "tcp", "udp"], "mix", "network");
  const hasExplicitV2Ports = Object.hasOwn(input, "tcpPort") || Object.hasOwn(input, "udpPort");
  const tcpPort = optionalPort(hasExplicitV2Ports ? input.tcpPort : network === "udp" ? 0 : port, "TCP carrier port");
  const udpPort = optionalPort(hasExplicitV2Ports ? input.udpPort : network === "tcp" ? 0 : port, "UDP carrier port");
  if (!tcpPort && !udpPort) throw new Error("Nowhere requires at least one carrier");
  network = tcpPort && udpPort ? "mix" : tcpPort ? "tcp" : "udp";
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
  const alpn = "nw2";
  const rate = integer(input.rate ?? 0, "upload rate", 0, 1_000_000);
  const etar = integer(input.etar ?? 0, "download rate", 0, 1_000_000);
  const dial = text(input.dial || "auto", "dial address", 253);
  const dial4 = text(input.dial4 || "", "IPv4 source address", 253, true);
  const dial6 = text(input.dial6 || "", "IPv6 source address", 253, true);
  if ((dial4 || dial6) && !versionAtLeast(version, 2, 2, 0)) throw new Error("dial4/dial6 require Nowhere 2.2.0");
  if ((dial4 && dial4 !== "auto" && isIP(dial4) !== 4) || (dial6 && dial6 !== "auto" && isIP(dial6) !== 6)) throw new Error("Invalid outbound source address family");
  if ((dial4 || dial6) && dial !== "auto") throw new Error("dial 与 dial4/dial6 不能同时设置");
  const socks = text(input.socks || "none", "SOCKS address", 512);
  const log = oneOf(input.log, capabilities.eventLog ? ["none", "debug", "info", "warn", "error", "event"] : ["none", "debug", "info", "warn", "error"], "info", "log level");
  const telemetryInterval = text(input.telemetryInterval || "1s", "telemetry interval", 16);
  const telemetryMatch = telemetryInterval.match(/^(\d+)(ms|s)$/);
  const telemetryMs = telemetryMatch
    ? Number(telemetryMatch[1]) * (telemetryMatch[2] === "s" ? 1000 : 1)
    : 0;
  if (telemetryMs < 250 || telemetryMs > 60_000) throw new Error("Invalid telemetry interval");
  const vectorSocks = text(input.vectorSocks || "127.0.0.1:1080", "vector SOCKS", 512);
  const vectorSni = text(input.vectorSni || "none", "vector SNI", 253);
  const vectorPin = text(input.certificateFingerprintSha256 || input.vectorPin || "none", "vector pin", 64);
  if (vectorSni !== "none" && (!/^[A-Za-z0-9.-]+$/.test(vectorSni) || isIP(vectorSni))) throw new Error("Vector SNI must be an ASCII DNS name");
  if (vectorPin !== "none" && !/^[0-9a-f]{64}$/.test(vectorPin)) throw new Error("Invalid vector pin");
  const vectorMux = integer(input.vectorMux ?? 0, "vector mux", 0, 1);
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
  query.set("morph", String(morph));
  if (dial4) query.set("dial4", dial4);
  if (dial6) query.set("dial6", dial6);
  if (!dial4 && !dial6 && dial !== "auto") query.set("dial", dial);
  if (socks !== "none") query.set("socks", socks);
  if (rate) query.set("rate", String(rate));
  if (etar) query.set("etar", String(etar));
  if (tls === 2) { query.set("crt", certificatePath); query.set("key", privateKeyPath); }
  if (log !== "info") query.set("log", log);
  const portalEndpoint = buildNowhereEndpoint(listenHost || "*", { tcpPort, udpPort, tcpCarrier, udpCarrier });
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
    NOWHERE_DIAL_VALUE: dial, NOWHERE_DIAL4_VALUE: dial4, NOWHERE_DIAL6_VALUE: dial6, NOWHERE_SOCKS_VALUE: socks, NOWHERE_LOG_VALUE: log,
    NOWHERE_TELEMETRY_INTERVAL_VALUE: telemetryInterval, NOW_TELEMETRY_INTERVAL: telemetryInterval,
    NOWHERE_VECTOR_SOCKS_VALUE: vectorSocks, NOWHERE_VECTOR_SNI_VALUE: vectorSni,
    NOWHERE_VECTOR_PIN_VALUE: vectorPin, NOWHERE_VECTOR_MUX_VALUE: vectorMux,
    NOWHERE_MORPH_VALUE: morph, NOWHERE_TRANSPORT_MEMORY_PROFILE_VALUE: transportMemoryProfile,
  };
  environmentValues.NOW_TRANSPORT_MEMORY_PROFILE = transportMemoryProfile;
  const extensions = input.extensionEnvironment && typeof input.extensionEnvironment === "object" && !Array.isArray(input.extensionEnvironment)
    ? Object.entries(input.extensionEnvironment) : [];
  if (extensions.length > 32) throw new Error("Too many Nowhere extension settings");
  for (const [keyName, value] of extensions) {
    if (!/^NOW(?:HERE)?_[A-Z0-9_]{1,80}$/.test(keyName) || Object.hasOwn(environmentValues, keyName)) continue;
    if (!capabilities.eventLog && keyName === "NOW_REPORT_INTERVAL") throw new Error("NOW_REPORT_INTERVAL was removed in Nowhere 2.1.1");
    environmentValues[keyName] = text(value, `extension ${keyName}`, 4096, true);
  }
  const environment = Object.entries(environmentValues).map(([keyName, value]) => `${keyName}=${quoteEnvironment(value)}`).join("\n") + "\n";
  const unit = `[Unit]\nDescription=Wherever Station managed Nowhere ${id}\nDocumentation=https://github.com/NodePassProject/Nowhere\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nEnvironmentFile=${environmentPath}\nExecStart=${binaryPath} \${NOWHERE_PORTAL}\nRestart=on-failure\nRestartSec=3\nLimitNOFILE=1048576\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=full\nProtectHome=read-only\n\n[Install]\nWantedBy=multi-user.target\n`;
  const linkInput = { publicHost, port, tcpPort, udpPort, tcpCarrier, udpCarrier, key, version, alpn, vectorMux, vectorSni, vectorPin, vectorSocks, morph, name };
  const carriers = network === "tcp" ? [["tcp", "tcp"]] : network === "udp" ? [["udp", "udp"]] : [["tcp", "tcp"], ["udp", "udp"], ["tcp", "udp"], ["udp", "tcp"]];
  const links = {
    anywhere: client === "vector" ? [] : carriers.map(([up, down]) => ({ up, down, uri: buildAnywhereLink({ ...linkInput, up, down }) })),
    vector: client === "anywhere" ? [] : carriers.map(([up, down]) => ({ up, down, uri: buildVectorLink({ ...linkInput, up, down }) })),
  };
  return {
    schema: 3, kind: "managed-nowhere", id, name, version, directory, binaryPath, environmentPath,
    unitName, unitPath, environment, unit, links, certificateMode, certificatePath,
    privateKeyPath, certificateHost, certificateDays,
    clientLink: links.anywhere[0]?.uri || links.vector[0]?.uri || "",
    summary: { name, publicHost, listenHost: listenHost || "全部地址", port, tcpPort, udpPort, tcpCarrier, udpCarrier, client, network, tls, version, protocolGeneration: capabilities.protocolGeneration, wireProtocol: capabilities.wireProtocol, morphWireGeneration: capabilities.morphWireGeneration, alpn, morph, transportMemoryProfile, rate, etar, dial4, dial6, log, unitName, certificateMode, certificateHost, certificateDays },
    safeguards: ["create-new-directory", "copy-or-download-private-binary", "managed-unit-prefix-only", "never-touch-existing-nowhere-service"],
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
