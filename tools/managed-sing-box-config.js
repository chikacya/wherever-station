const path = require("node:path");
const { URL } = require("node:url");

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function parseVmess(uri) {
  if (!String(uri).startsWith("vmess://")) throw new Error("Invalid managed VMess URI");
  return object(JSON.parse(Buffer.from(String(uri).slice(8), "base64").toString("utf8")), "VMess URI");
}
function managedSingBoxInput(instance, node, configuration) {
  const config = object(configuration, "sing-box configuration");
  if (!Array.isArray(config.inbounds) || config.inbounds.length !== 1) throw new Error("Managed sing-box configuration must contain exactly one inbound");
  const inbound = object(config.inbounds[0], "managed inbound");
  const expected = { "vless-reality": "vless", vmess: "vmess", shadowsocks: "shadowsocks", trojan: "trojan", hysteria2: "hysteria2", tuic: "tuic", anytls: "anytls" }[instance.protocol];
  if (!expected || inbound.type !== expected) throw new Error("Managed sing-box protocol does not match its configuration");
  const input = {
    id: instance.id, name: node.name, protocol: instance.protocol,
    publicHost: instance.publicHost, listenHost: inbound.listen || "0.0.0.0",
    port: inbound.listen_port, tag: inbound.tag || instance.id,
    log: ["debug", "info", "warn", "error"].includes(config.log?.level) ? config.log.level : "info",
  };
  if (instance.protocol === "vless-reality") {
    const uri = new URL(node.uri); const reality = object(inbound.tls?.reality, "Reality settings");
    Object.assign(input, {
      uuid: inbound.users?.[0]?.uuid, flow: inbound.users?.[0]?.flow || "",
      serverName: inbound.tls?.server_name, handshakeServer: reality.handshake?.server,
      handshakePort: reality.handshake?.server_port, realityPrivateKey: reality.private_key,
      realityPublicKey: uri.searchParams.get("pbk"), shortId: reality.short_id?.[0],
    });
  } else if (instance.protocol === "vmess") {
    parseVmess(node.uri);
    Object.assign(input, { uuid: inbound.users?.[0]?.uuid, transport: inbound.transport?.type === "ws" ? "ws" : "tcp", wsPath: inbound.transport?.path || "/" });
  } else if (instance.protocol === "shadowsocks") {
    Object.assign(input, { method: inbound.method, password: inbound.password });
  } else {
    const uri = new URL(node.uri); const managedCertificate = inbound.tls?.certificate_path === path.posix.join(instance.directory || `/var/lib/proxy-console/instances/${instance.id}`, "server.crt");
    Object.assign(input, {
      serverName: inbound.tls?.server_name,
      certificateMode: managedCertificate && uri.searchParams.get("insecure") === "1" ? "managed-self-signed" : "existing",
      certificatePath: inbound.tls?.certificate_path, privateKeyPath: inbound.tls?.key_path,
    });
    if (instance.protocol === "tuic") Object.assign(input, { uuid: inbound.users?.[0]?.uuid, password: inbound.users?.[0]?.password });
    else input.password = inbound.users?.[0]?.password;
  }
  return input;
}

module.exports = { managedSingBoxInput };
