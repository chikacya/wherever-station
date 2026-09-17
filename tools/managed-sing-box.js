const path = require("node:path");
const crypto = require("node:crypto");
const { isIP } = require("node:net");
const { URLSearchParams } = require("node:url");

const INSTANCE_ROOT = "/var/lib/proxy-console/instances";
const UNIT_PREFIX = "proxy-console-singbox@";
const SS_METHODS = new Set(["2022-blake3-aes-128-gcm", "2022-blake3-aes-256-gcm", "2022-blake3-chacha20-poly1305", "aes-128-gcm", "aes-192-gcm", "aes-256-gcm", "chacha20-ietf-poly1305", "xchacha20-ietf-poly1305"]);

function text(value, label, max = 255) {
  const result = String(value == null ? "" : value).trim();
  if (!result || result.length > max || /[\r\n\0]/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}
function id(value) {
  const result = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{7,47}$/.test(result)) throw new Error("Invalid managed sing-box instance id");
  return result;
}
function port(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1024 || result > 65535) throw new Error("Invalid listen port");
  return result;
}
function host(value, label) {
  const result = text(value, label, 253).replace(/^\[|\]$/g, "");
  if (!isIP(result) && (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(result) || result.split(".").some((part) => part.length > 63))) throw new Error(`Invalid ${label}`);
  return result;
}
function uuid(value) {
  const result = text(value, "UUID", 36).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)) throw new Error("Invalid UUID");
  return result;
}
function absoluteFile(value, label) {
  const result = text(value, label, 512);
  if (!result.startsWith("/") || result.split("/").includes("..")) throw new Error(`Invalid ${label}`);
  return result;
}
function urlHost(value) { return value.includes(":") ? `[${value}]` : value; }
function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function certificatePins(input) {
  const fingerprintSha256 = String(input.certificateFingerprintSha256 || "").trim().toLowerCase();
  const publicKeySha256 = String(input.certificatePublicKeySha256 || "").trim();
  if (fingerprintSha256 && !/^[a-f0-9]{64}$/.test(fingerprintSha256)) throw new Error("Invalid certificate SHA256 fingerprint");
  if (publicKeySha256 && !/^[A-Za-z0-9+/]{43}=$/.test(publicKeySha256)) throw new Error("Invalid certificate public key SHA256 pin");
  return { fingerprintSha256, publicKeySha256 };
}
function randomCredentials() {
  return {
    uuid: crypto.randomUUID(),
    password: base64Url(crypto.randomBytes(24)),
    shadowsocks128: crypto.randomBytes(16).toString("base64"),
    shadowsocks256: crypto.randomBytes(32).toString("base64"),
    shortId: crypto.randomBytes(8).toString("hex"),
    realityPrivateKey: "",
    realityPublicKey: "",
  };
}
function planManagedSingBox(input = {}) {
  const instanceId = id(input.id);
  const name = text(input.name, "display name", 160);
  const protocol = String(input.protocol || "");
  if (!["vless-reality", "vmess", "shadowsocks", "trojan", "hysteria2", "tuic", "anytls"].includes(protocol)) throw new Error("Unsupported managed sing-box protocol");
  const publicHost = host(input.publicHost, "public host");
  const listenHost = String(input.listenHost || "0.0.0.0");
  if (!isIP(listenHost)) throw new Error("Invalid listen host");
  const listenPort = port(input.port);
  const tag = text(input.tag || instanceId, "inbound tag", 128);
  const directory = path.posix.join(INSTANCE_ROOT, instanceId);
  const binaryPath = path.posix.join(directory, "bin", "sing-box");
  const configPath = path.posix.join(directory, "config.json");
  const unitName = `${UNIT_PREFIX}${instanceId}.service`;
  const unitPath = path.posix.join("/etc/systemd/system", unitName);
  let inbound; let uri; let label; let certificate = null;
  if (protocol === "vless-reality") {
    const userId = uuid(input.uuid); const serverName = host(input.serverName, "Reality server name"); const handshakeServer = host(input.handshakeServer, "Reality handshake server"); const handshakePort = Number(input.handshakePort || 443);
    const privateKey = text(input.realityPrivateKey, "Reality private key", 64); const publicKey = text(input.realityPublicKey, "Reality public key", 64); const shortId = text(input.shortId, "Reality short ID", 16).toLowerCase();
    if (!/^[A-Za-z0-9_-]{43}$/.test(privateKey) || !/^[A-Za-z0-9_-]{43}$/.test(publicKey)) throw new Error("Invalid Reality keypair");
    if (!/^(?:[0-9a-f]{2}){1,8}$/.test(shortId) || !Number.isInteger(handshakePort) || handshakePort < 1 || handshakePort > 65535) throw new Error("Invalid Reality handshake settings");
    const flow = input.flow === "" ? "" : "xtls-rprx-vision";
    inbound = { type: "vless", tag, listen: listenHost, listen_port: listenPort, users: [{ uuid: userId, ...(flow ? { flow } : {}) }], tls: { enabled: true, server_name: serverName, reality: { enabled: true, handshake: { server: handshakeServer, server_port: handshakePort }, private_key: privateKey, short_id: [shortId] } } };
    const query = new URLSearchParams({ encryption: "none", security: "reality", sni: serverName, fp: "chrome", pbk: publicKey, sid: shortId, type: "tcp" }); if (flow) query.set("flow", flow);
    uri = `vless://${userId}@${urlHost(publicHost)}:${listenPort}?${query.toString()}#${encodeURIComponent(name)}`; label = "VLESS Reality";
  } else if (protocol === "vmess") {
    const userId = uuid(input.uuid); const transport = input.transport === "ws" ? "ws" : "tcp"; const wsPath = transport === "ws" ? text(input.wsPath || "/", "WebSocket path", 2048) : "";
    inbound = { type: "vmess", tag, listen: listenHost, listen_port: listenPort, users: [{ uuid: userId, alterId: 0 }], ...(transport === "ws" ? { transport: { type: "ws", path: wsPath } } : {}) };
    uri = `vmess://${Buffer.from(JSON.stringify({ v: "2", ps: name, add: publicHost, port: String(listenPort), id: userId, aid: "0", net: transport, type: "none", host: "", path: wsPath, tls: "" })).toString("base64")}`; label = `VMess ${transport === "ws" ? "WebSocket" : "TCP"}`;
  } else if (protocol === "shadowsocks") {
    const method = text(input.method || "2022-blake3-aes-128-gcm", "Shadowsocks method", 64); const password = text(input.password, "Shadowsocks password", 2048);
    if (!SS_METHODS.has(method)) throw new Error("Unsupported Shadowsocks method");
    if (method.startsWith("2022-")) {
      const required = method === "2022-blake3-aes-128-gcm" ? 16 : 32;
      if (Buffer.from(password, "base64").length !== required) throw new Error(`Shadowsocks 2022 密钥需要 ${required} 字节的 Base64 编码`);
    }
    inbound = { type: "shadowsocks", tag, listen: listenHost, listen_port: listenPort, method, password };
    uri = `ss://${base64Url(`${method}:${password}`)}@${urlHost(publicHost)}:${listenPort}#${encodeURIComponent(name)}`; label = "Shadowsocks";
  } else {
    const generatedCertificate = ["self-signed", "managed-self-signed"].includes(input.certificateMode);
    const privateCertificate = generatedCertificate || input.certificateSelfSigned === true;
    const pins = certificatePins(input);
    const certificatePath = generatedCertificate ? path.posix.join(directory, "server.crt") : absoluteFile(input.certificatePath, "certificate path"); const keyPath = generatedCertificate ? path.posix.join(directory, "server.key") : absoluteFile(input.privateKeyPath, "private key path"); const serverName = host(input.serverName, "TLS server name");
    const tls = { enabled: true, server_name: serverName, certificate_path: certificatePath, key_path: keyPath };
    if (protocol === "tuic") {
      const userId = uuid(input.uuid); const password = text(input.password, "TUIC password", 2048); inbound = { type: "tuic", tag, listen: listenHost, listen_port: listenPort, users: [{ uuid: userId, password }], tls }; uri = `tuic://${userId}:${encodeURIComponent(password)}@${urlHost(publicHost)}:${listenPort}?${new URLSearchParams({ congestion_control: "bbr", udp_relay_mode: "native", alpn: "h3", sni: serverName }).toString()}#${encodeURIComponent(name)}`;
    } else {
      const password = text(input.password, `${protocol} password`, 2048); inbound = { type: protocol, tag, listen: listenHost, listen_port: listenPort, users: [{ password }], tls };
      const query = new URLSearchParams({ sni: serverName }); if (protocol === "hysteria2") { query.set("alpn", "h3"); if (pins.fingerprintSha256) query.set("pinSHA256", pins.fingerprintSha256); } uri = `${protocol}://${encodeURIComponent(password)}@${urlHost(publicHost)}:${listenPort}?${query.toString()}#${encodeURIComponent(name)}`;
    }
    label = `${protocol.toUpperCase()} TLS`;
    if (privateCertificate && !(protocol === "hysteria2" && pins.fingerprintSha256)) uri = uri.replace("#", "&insecure=1#");
    certificate = { assetId: String(input.certificateAssetId || ""), selfSigned: privateCertificate, ...pins, expiresAt: String(input.certificateExpiresAt || "") };
  }
  const config = { log: { level: ["debug", "info", "warn", "error"].includes(input.log) ? input.log : "info", timestamp: true }, inbounds: [inbound], outbounds: [{ type: "direct", tag: "direct" }], route: { final: "direct" } };
  const unit = `[Unit]\nDescription=Wherever Station managed sing-box ${instanceId}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=${binaryPath} run -c ${configPath}\nRestart=on-failure\nRestartSec=3\nLimitNOFILE=1048576\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=full\nProtectHome=read-only\n\n[Install]\nWantedBy=multi-user.target\n`;
  return { schema: 1, kind: "managed-sing-box", id: instanceId, name, protocol, directory, binaryPath, configPath, unitName, unitPath, selfSigned: input.certificateMode === "self-signed" && !!inbound.tls?.certificate_path, certificate, config: JSON.stringify(config, null, 2) + "\n", unit, clientUri: uri, summary: { name, protocol, label, publicHost, listenHost, port: listenPort, unitName, ...(inbound.tls ? { serverName: inbound.tls.server_name } : {}) }, safeguards: ["create-new-directory", "copy-private-binary", "kernel-check-before-unit", "managed-unit-prefix-only", "never-touch-existing-sing-box-service"] };
}

module.exports = { INSTANCE_ROOT, UNIT_PREFIX, base64Url, planManagedSingBox, randomCredentials };
