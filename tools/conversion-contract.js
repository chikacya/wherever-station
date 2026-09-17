// Fail closed: fields not represented by an emitter must not disappear silently.
const { URL } = require('node:url');
const { CONVERTED_PROTOCOLS } = require('./protocol-capabilities');

function assertConversion(format, node) {
  if (!CONVERTED_PROTOCOLS[format]?.includes(node.protocol)) throw new Error('目标格式不支持此协议');
  const deny = () => { throw new Error('包含目标适配器尚不能无损表达的参数'); };
  if (node.certificate?.fingerprintSha256 || node.certificate?.publicKeySha256) {
    if (format !== 'sing-box' || !node.certificate.publicKeySha256 || !['vless', 'hysteria2', 'tuic', 'anytls'].includes(node.protocol)) deny();
  }
  if (node.protocol === 'vmess') {
    const value = JSON.parse(Buffer.from(node.uri.slice(8), 'base64').toString('utf8'));
    const allowed = new Set(['v', 'ps', 'add', 'port', 'id', 'aid', 'net', 'host', 'path', 'tls', 'sni', 'type', 'scy']);
    if (Object.keys(value).some(key => !allowed.has(key))) deny();
    if (Object.entries(value).some(([key, v]) => !(['v', 'port', 'aid'].includes(key) ? ['string', 'number'] : ['string']).includes(typeof v))) deny();
    if (value.v != null && String(value.v) !== '2') deny();
    if (value.type && value.type !== 'none') deny();
    if (value.scy && value.scy !== 'auto') deny();
    if (!Number.isInteger(Number(value.aid || 0)) || Number(value.aid || 0) < 0) deny();
    if (value.tls && value.tls !== 'tls') deny();
    if (value.net && !['tcp', 'ws'].includes(value.net)) deny();
    if ((!value.net || value.net === 'tcp') && ((value.path && value.path !== '/') || value.host)) deny();
    if (value.sni && value.tls !== 'tls') deny();
    if (format === 'surge' && Number(value.aid || 0) !== 0) deny();
    if (format === 'surge' && [value.add, value.id, value.host, value.path, value.sni].some(v => /[,\r\n=|"#]/.test(String(v || '')))) deny();
  } else {
    const url = new URL(node.uri);
    if (url.pathname && url.pathname !== '/') deny();
    const p = node.protocol;
    const keys = p === 'vless' ? ['security', 'type', 'flow', 'sni', 'fp', 'pbk', 'sid', 'host', 'path', 'encryption']
      : p === 'trojan' ? ['type', 'sni', 'peer', 'insecure', 'allowInsecure']
      : ['hysteria2', 'anytls'].includes(p) ? ['sni', 'insecure']
      : p === 'tuic' ? ['sni', 'insecure', 'congestion_control', 'udp_relay_mode'] : [];
    if (format === 'sing-box' && ['vless', 'hysteria2', 'anytls', 'tuic'].includes(p)) keys.push('alpn');
    const seen = new Set();
    for (const [key, value] of url.searchParams) {
      if (!keys.includes(key) || seen.has(key) || !value) deny();
      seen.add(key);
      if (['insecure', 'allowInsecure'].includes(key) && !['0', '1'].includes(value)) deny();
    }
    const q = key => url.searchParams.get(key);
    if (q('sni') && q('peer') && q('sni') !== q('peer')) deny();
    if (q('insecure') && q('allowInsecure') && q('insecure') !== q('allowInsecure')) deny();
    if (q('type') && !['tcp', ...(p === 'vless' ? ['ws'] : [])].includes(q('type'))) deny();
    if (['host', 'path'].some(key => q(key)) && q('type') !== 'ws') deny();
    if (p === 'vless') {
      if (node.certificate?.publicKeySha256 && !['tls', 'reality'].includes(q('security'))) deny();
      if (q('encryption') && q('encryption') !== 'none') deny();
      if (q('security') && !['none', 'tls', 'reality'].includes(q('security'))) deny();
      if (['pbk', 'sid'].some(key => q(key)) && q('security') !== 'reality') deny();
      if (q('security') === 'reality' && !q('pbk')) deny();
      if (q('flow') && q('flow') !== 'xtls-rprx-vision') deny();
      if (q('flow') && (q('type') === 'ws' || !['tls', 'reality'].includes(q('security')))) deny();
      if (['sni', 'fp', 'alpn'].some(key => q(key)) && !['tls', 'reality'].includes(q('security'))) deny();
      if (q('fp') && format === 'mihomo' && q('security') !== 'reality') deny();
      if (q('fp')?.startsWith('chrome_') && format === 'sing-box') deny();
    }
    if (p === 'tuic' && format === 'surge' && (q('congestion_control') || q('udp_relay_mode'))) deny();
    if (q('congestion_control') && !['bbr', 'cubic', 'new_reno'].includes(q('congestion_control'))) deny();
    if (q('udp_relay_mode') && !['native', 'quic'].includes(q('udp_relay_mode'))) deny();
    if (!['socks', 'socks5', 'http', 'https', 'ss', 'tuic'].includes(p) && url.password) deny();
    if (format === 'surge' && [url.hostname, decodeURIComponent(url.username), decodeURIComponent(url.password), ...url.searchParams.values()].some(value => /[,\r\n=|"#]/.test(value))) deny();
  }
  if (format === 'surge' && /[,=\r\n\[\]]/.test(node.name || '')) deny();
}

function assertClashFields(proxy) {
  // URI import is deliberately narrower than the source schema.
  const common = ['name', 'type', 'server', 'port'];
  const fields = {
    ss: ['cipher', 'password'], vmess: ['uuid', 'alterId', 'network', 'tls', 'servername', 'sni', 'ws-opts'],
    vless: ['uuid', 'network', 'tls', 'flow', 'client-fingerprint', 'reality-opts', 'ws-opts', 'servername', 'sni'],
    trojan: ['password', 'servername', 'sni', 'skip-cert-verify'],
    hysteria2: ['password', 'sni', 'skip-cert-verify', 'alpn'],
    tuic: ['uuid', 'password', 'sni', 'skip-cert-verify', 'alpn', 'congestion-controller', 'udp-relay-mode'],
    anytls: ['password', 'sni', 'skip-cert-verify', 'alpn'],
    socks5: ['username', 'password'], http: ['username', 'password'], https: ['username', 'password'],
  };
  const check = (object, allowed) => {
    if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).some(key => !allowed.includes(key))) throw new Error('包含尚不能无损导入的 YAML 字段');
  };
  check(proxy, [...common, ...(fields[proxy.type] || [])]);
  for (const [key, value] of Object.entries(proxy)) {
    if (['ws-opts', 'reality-opts', 'alpn'].includes(key)) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('YAML 字段类型无效');
    if (typeof value === 'string' && value !== value.trim()) throw new Error('YAML 字段包含不能保留的首尾空白');
    const limit = { name: 160, type: 24, server: 255, network: 24, servername: 255, sni: 255, cipher: 80, uuid: proxy.type === 'vmess' ? 128 : 2048, password: 2048, username: 2048 }[key];
    if (limit && String(value).length > limit) throw new Error('YAML 字段过长，无法完整导入');
  }
  if (proxy.sni && proxy.servername && proxy.sni !== proxy.servername) throw new Error('SNI 字段冲突');
  for (const key of ['tls', 'skip-cert-verify']) if (proxy[key] != null && typeof proxy[key] !== 'boolean') throw new Error('TLS 开关必须为布尔值');
  if (proxy.alpn != null && (!Array.isArray(proxy.alpn) || proxy.alpn.some(value => typeof value !== 'string' || !value || value.includes(',')))) throw new Error('ALPN 必须为字符串列表');
  if (proxy['ws-opts']) { check(proxy['ws-opts'], ['path', 'headers']); if (proxy['ws-opts'].path != null && typeof proxy['ws-opts'].path !== 'string') throw new Error('WebSocket path 必须为字符串'); if (proxy['ws-opts'].headers) { check(proxy['ws-opts'].headers, ['Host', 'host']); const h = proxy['ws-opts'].headers; if (Object.values(h).some(v => typeof v !== 'string')) throw new Error('WebSocket Host 必须为字符串'); if (h.Host && h.host && h.Host !== h.host) throw new Error('WebSocket Host 冲突'); } if (proxy.network !== 'ws') throw new Error('WebSocket 参数缺少对应传输'); }
  if (proxy['reality-opts']) { check(proxy['reality-opts'], ['public-key', 'short-id']); if (!proxy['reality-opts']['public-key']) throw new Error('Reality 缺少公钥'); }
  const ws = proxy['ws-opts'];
  for (const [value, limit] of [[ws?.path, 2048], [ws?.headers?.Host, 255], [ws?.headers?.host, 255]]) if (value != null && (value !== value.trim() || value.length > limit)) throw new Error('WebSocket 字段无法完整导入');
  if (proxy['reality-opts'] && proxy.tls === false) throw new Error('Reality 与 TLS 开关冲突');
}

module.exports = { assertConversion, assertClashFields };
