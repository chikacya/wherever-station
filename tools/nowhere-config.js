const { URL } = require('node:url');

// Decode our managed EnvironmentFile metadata, not a client share URI.
const fields = {
  role: 'ROLE', out: 'OUT', version: 'VERSION', publicHost: 'PUBLIC_HOST', listenHost: 'LISTEN_HOST',
  port: 'PORT', key: 'KEY', network: 'NET', client: 'CLIENT', alpn: 'ALPN', tls: 'TLS',
  tcpPort: 'TCP_PORT', udpPort: 'UDP_PORT', tcpCarrier: 'TCP_CARRIER', udpCarrier: 'UDP_CARRIER',
  certificatePath: 'CRT', privateKeyPath: 'TLS_KEY', rate: 'RATE', etar: 'ETAR',
  dial4: 'DIAL4', dial6: 'DIAL6', dial: 'DIAL', socks: 'SOCKS', log: 'LOG', telemetryInterval: 'TELEMETRY_INTERVAL',
  vectorSocks: 'VECTOR_SOCKS', vectorSni: 'VECTOR_SNI', vectorPin: 'VECTOR_PIN',
  vectorMux: 'VECTOR_MUX',
  morph: 'MORPH', grade: 'GRADE', cipher: 'CIPHER', transportMemoryProfile: 'TRANSPORT_MEMORY_PROFILE',
  certificateMode: 'CERTIFICATE_MODE', certificateHost: 'CERTIFICATE_HOST',
  certificateDays: 'CERTIFICATE_DAYS',
};
function decodeNowhereConfig(values) {
  if (!values || typeof values !== 'object') throw new Error('缺少当前托管配置');
  const input = {};
  const optional = new Set(['role', 'out', 'dial4', 'dial6', 'certificateMode', 'certificateHost', 'certificateDays', 'tcpPort', 'udpPort', 'tcpCarrier', 'udpCarrier', 'morph', 'grade', 'cipher', 'transportMemoryProfile']);
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
  try { input.nativeNext = new URL(values.NOWHERE_PORTAL).searchParams.get('next') || ''; } catch (_) { input.nativeNext = ''; }
  input.role ||= 'portal';
  input.out ||= 'direct';
  if (!/^v?3\./.test(input.version)) throw new Error('Wherever Station 仅管理 NW3 实例');
  input.tcpPort ??= input.network === 'udp' ? '0' : input.port;
  input.udpPort ??= input.network === 'tcp' ? '0' : input.port;
  input.tcpCarrier ||= 'tcp';
  input.udpCarrier ||= 'udp';
  input.dial4 ||= '';
  input.dial6 ||= '';
  input.morph ||= '0';
  const portalQuery = new URL(values.NOWHERE_PORTAL || 'portal://localhost').searchParams;
  input.cipher = portalQuery.get('cipher') || input.cipher || 'chacha';
  input.grade = portalQuery.get('grade') || input.grade || 'full';
  input.transportMemoryProfile ||= 'throughput';
  for (const field of ['port', 'tcpPort', 'udpPort', 'tls', 'rate', 'etar', 'vectorMux', 'morph', 'certificateDays']) input[field] = Number(input[field]);
  const managedNames = new Set(Object.values(fields).map((suffix) => 'NOWHERE_' + suffix + '_VALUE'));
  input.morphPrelude = values.NOW_MORPH_TCP_PRELUDE || "";
  input.extensionEnvironment = Object.fromEntries(Object.entries(values).filter(([key]) => /^NOW(?:HERE)?_[A-Z0-9_]+$/.test(key) && !managedNames.has(key) && key !== 'NOWHERE_PORTAL'));
  return input;
}
// Anywhere share links encode Core as morph=2. The native CLI uses grade=core.
function parseNowhereMorph(query) {
  const mode = query.get('morph') ?? '1';
  const explicitGrade = query.get('grade');
  const grade = explicitGrade ?? (mode === '2' ? 'core' : 'full');
  if (!['0', '1', '2'].includes(mode) || !['full', 'core'].includes(grade)
      || (grade === 'core' && mode === '0') || (grade === 'full' && mode === '2')) {
    throw new Error('Nowhere Morph 档位无效');
  }
  return { morph: mode === '0' ? 0 : 1, grade };
}

function anywhereNowhereUri(uri) {
  if (!String(uri).startsWith('nowhere://')) return uri;
  try {
    const parsed = new URL(uri);
    if (parseNowhereMorph(parsed.searchParams).grade !== 'core') return uri;
    if (parsed.searchParams.get('morph') === '2' && !parsed.searchParams.has('grade')) return uri;
    parsed.searchParams.set('morph', '2');
    parsed.searchParams.delete('grade');
    return parsed.toString();
  } catch (_) {
    return uri;
  }
}

module.exports = { decodeNowhereConfig, parseNowhereMorph, anywhereNowhereUri };
