// Explicit client settings; selecting one never changes the remote server.
export const AJSON_PRESETS = [
  { id: 'nowhere_fade', protocol: 'nowhere', name: 'Nowhere · Fade Prelude', hint: '将 morphPrelude 设为 fade，服务端需支持该 Prelude。', settings: { morphPrelude: 'fade' } },
  { id: 'nowhere_full8', protocol: 'nowhere', name: 'Nowhere · Full8 Prelude', hint: '将 morphPrelude 设为 full8，需与服务端一致。', settings: { morphPrelude: 'full8' } },
  { id: 'nowhere_low7', protocol: 'nowhere', name: 'Nowhere · Low7 Prelude', hint: '将 morphPrelude 设为 low7，需与服务端一致。', settings: { morphPrelude: 'low7' } },
  { id: 'vless_xhttp', protocol: 'vless', name: 'VLESS · XHTTP', hint: '使用 XHTTP auto 模式、路径 /x。请按服务端调整路径和传输参数。', settings: { transport: { type: 'xhttp', mode: 'auto', path: '/x' } } },
  { id: 'vless_ws', protocol: 'vless', name: 'VLESS · WebSocket', hint: '使用 WebSocket、路径 /。请按服务端填写路径和 Host。', settings: { transport: { type: 'ws', path: '/' } } },
  { id: 'hysteria_bbr', protocol: 'hysteria2', name: 'Hysteria2 · BBR', hint: '使用 BBR 拥塞控制，不指定固定上下行带宽。', settings: { congestion: 'bbr' } },
  { id: 'hysteria_brutal', protocol: 'hysteria2', name: 'Hysteria2 · Brutal', hint: '使用 Brutal，上行 50、下行 200 Mbps。请按实际带宽调整。', settings: { congestion: 'brutal', upMbps: 50, downMbps: 200 } },
  { id: 'anytls_sessions', protocol: 'anytls', name: 'AnyTLS · 会话保活', hint: '检查间隔和空闲超时设为 30 秒，最少空闲会话为 0。', settings: { idleCheckInterval: 30, idleTimeout: 30, minIdleSession: 0 } },
  { id: 'sudoku_mux', protocol: 'sudoku', name: 'Sudoku · 自动复用', hint: '将 multiplex 设为 auto，其他 Sudoku 参数沿用节点。', settings: { multiplex: 'auto' } },
  { id: 'trojan_chrome', protocol: 'trojan', name: 'Trojan · Chrome 指纹', hint: '使用 TLS 和 Chrome 指纹，保留节点原有 SNI。', settings: { security: { type: 'tls', fingerprint: 'chrome' } } },
];
export function presetsFor(protocol) {
  return AJSON_PRESETS.filter(item => item.protocol === ({ hy2: 'hysteria2' }[protocol] || protocol));
}
