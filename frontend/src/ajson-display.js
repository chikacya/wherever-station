export function mergeSettings(base, patch) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key]) ? mergeSettings(result[key], value) : value;
  }
  return result;
}
export function effectiveRows(proxy, templates = {}) {
  if (!proxy || proxy.link) return [];
  const p = mergeSettings(templates[proxy.use] || {}, proxy);
  const layer = value => typeof value === 'string' ? value : value?.type;
  const rows = [['协议', { nowhere: 'Nowhere', vless: 'VLESS', hysteria: 'Hysteria2', sudoku: 'Sudoku', anytls: 'AnyTLS', trojan: 'Trojan', shadowsocks: 'Shadowsocks', socks5: 'SOCKS5', rfc: 'RFC' }[p.protocol] || p.protocol]];
  if (p.protocol === 'vless') {
    rows.push(['传输方式', { raw: 'TCP', ws: 'WebSocket', grpc: 'gRPC', httpupgrade: 'HTTP Upgrade', xhttp: 'XHTTP' }[layer(p.transport) || 'raw']]);
    rows.push(['连接安全', { none: '无', tls: 'TLS', reality: 'Reality' }[layer(p.security) || 'none']]);
    for (const [key, label] of [['path','路径'],['host','Host'],['serviceName','gRPC 服务名'],['mode','XHTTP 模式']]) if (p.transport?.[key] != null) rows.push([label,p.transport[key]]);
  }
  if (p.protocol === 'nowhere') rows.push(['网络',(p.network || 'tcp').toUpperCase()],['Morph',p.morph === false ? '关闭' : '开启'],['Prelude',p.morphPrelude || 'fade']);
  if (p.protocol === 'hysteria') rows.push(['拥塞控制',p.congestion || (p.upMbps != null || p.downMbps != null ? 'brutal' : 'bbr')]);
  for (const [key,label,unit] of [['upMbps','上行带宽',' Mbps'],['downMbps','下行带宽',' Mbps'],['idleCheckInterval','会话检查间隔',' 秒'],['idleTimeout','空闲超时',' 秒'],['minIdleSession','最少空闲会话',''],['multiplex','连接复用','']]) if(p[key]!=null) rows.push([label,String(p[key])+unit]);
  if (p.security?.fingerprint) rows.push(['TLS 指纹',p.security.fingerprint]);
  if (p.security?.ech != null) rows.push(['ECH',p.security.ech === false ? '关闭' : '开启']);
  if (p.obfs?.type) rows.push(['混淆方式',p.obfs.type]);
  if (p.flow) rows.push(['Flow',p.flow]);
  if (p.security?.sni || p.sni) rows.push(['SNI',p.security?.sni || p.sni]);
  return rows;
}

export function iconDataUrl(value) {
  if (!value) return '';
  const type = value.startsWith('iVBOR') ? 'png' : value.startsWith('/9j/') ? 'jpeg' : 'webp';
  return `data:image/${type};base64,${value}`;
}
