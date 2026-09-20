// Decode our managed EnvironmentFile metadata, not a client share URI.
const fields = {
  version: 'VERSION', publicHost: 'PUBLIC_HOST', listenHost: 'LISTEN_HOST',
  port: 'PORT', key: 'KEY', network: 'NET', client: 'CLIENT', alpn: 'ALPN', tls: 'TLS',
  tcpPort: 'TCP_PORT', udpPort: 'UDP_PORT', tcpCarrier: 'TCP_CARRIER', udpCarrier: 'UDP_CARRIER',
  certificatePath: 'CRT', privateKeyPath: 'TLS_KEY', rate: 'RATE', etar: 'ETAR',
  dial: 'DIAL', socks: 'SOCKS', log: 'LOG', telemetryInterval: 'TELEMETRY_INTERVAL',
  vectorSocks: 'VECTOR_SOCKS', vectorSni: 'VECTOR_SNI', vectorPin: 'VECTOR_PIN',
  vectorMux: 'VECTOR_MUX',
  morph: 'MORPH', transportMemoryProfile: 'TRANSPORT_MEMORY_PROFILE',
  certificateMode: 'CERTIFICATE_MODE', certificateHost: 'CERTIFICATE_HOST',
  certificateDays: 'CERTIFICATE_DAYS',
};
function decodeNowhereConfig(values) {
  if (!values || typeof values !== 'object') throw new Error('缺少当前托管配置');
  const input = {};
  const optional = new Set(['certificateMode', 'certificateHost', 'certificateDays', 'tcpPort', 'udpPort', 'tcpCarrier', 'udpCarrier', 'morph', 'transportMemoryProfile']);
  for (const [field, suffix] of Object.entries(fields)) {
    const value = values['NOWHERE_' + suffix + '_VALUE'];
    if (typeof value !== 'string') {
      if (optional.has(field)) continue;
      throw new Error('当前配置缺少字段：' + field);
    }
    input[field] = value;
  }
  input.certificateMode ||= Number(input.tls) === 2 ? 'existing' : 'ephemeral';
  input.certificateHost ||= input.publicHost;
  input.certificateDays ||= '825';
  if (!/^v?2\./.test(input.version)) throw new Error('Wherever Station 仅管理 Nowhere 2.x 实例');
  input.tcpPort ??= input.network === 'udp' ? '0' : input.port;
  input.udpPort ??= input.network === 'tcp' ? '0' : input.port;
  input.tcpCarrier ||= 'tcp';
  input.udpCarrier ||= 'udp';
  input.morph ||= '0';
  input.transportMemoryProfile ||= 'throughput';
  for (const field of ['port', 'tcpPort', 'udpPort', 'tls', 'rate', 'etar', 'vectorMux', 'morph', 'certificateDays']) input[field] = Number(input[field]);
  const managedNames = new Set(Object.values(fields).map((suffix) => 'NOWHERE_' + suffix + '_VALUE'));
  input.extensionEnvironment = Object.fromEntries(Object.entries(values).filter(([key]) => /^NOW(?:HERE)?_[A-Z0-9_]+$/.test(key) && !managedNames.has(key) && key !== 'NOWHERE_PORTAL'));
  return input;
}
module.exports = { decodeNowhereConfig };
