// Configuration checks only: never starts a proxy or contacts a VPS.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wherever-output-check-'));
const binary = process.env.SING_BOX_BINARY || 'sing-box';
try {
  const sandbox = { console, Buffer, __dirname: root, __storageDir__: temporary, require: name => name === 'server' ? { route() {}, registerRPC() {} } : require(name) };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8'), sandbox);
  const uuid = '00000000-0000-4000-8000-000000000001';
  const uris = [
    `vless://${uuid}@example.com:443?security=tls&sni=example.com`,
    `vless://${uuid}@example.com:443?security=tls&type=ws&host=example.com&path=%2Fws`,
    'trojan://secret@example.com:443?sni=example.com',
    'hysteria2://secret@example.com:443?sni=example.com',
    `tuic://${uuid}:secret@example.com:443?sni=example.com`,
    'anytls://secret@example.com:443?sni=example.com',
    'ss://aes-128-gcm:secret@example.com:443',
    'socks5://user:secret@example.com:1080',
    'http://user:secret@example.com:8080',
    'https://user:secret@example.com:8443',
    'vmess://' + Buffer.from(JSON.stringify({ v: '2', add: 'example.com', port: 443, id: uuid, aid: 0, net: 'ws', path: '/ws', tls: 'tls', sni: 'example.com' })).toString('base64'),
  ];
  const nodes = uris.map((uri, i) => ({ id: `n${i}`, name: `Node ${i}`, protocol: uri.split(':')[0], uri }));
  const body = sandbox.render(nodes, { groups: [], policyMode: 'proxy-all' }, 'sing-box').body;
  const config = JSON.parse(body);
  if (config.outbounds.filter(n => n.server).length !== nodes.length) throw new Error('Core fixture unexpectedly skipped a protocol');
  const file = path.join(temporary, 'config.json');
  fs.writeFileSync(file, body, { mode: 0o600 });
  execFileSync(binary, ['check', '-c', file], { stdio: 'pipe', timeout: 30000 });
  console.log(`sing-box config check passed (${nodes.length} protocol/transport fixtures)`);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
