const assert = require('node:assert/strict');
const { assertConversion, assertClashFields } = require('../tools/conversion-contract');
const { CONVERTED_PROTOCOLS } = require('../tools/protocol-capabilities');
const examples = {
  vless: 'vless://id@example.com:443?security=tls',
  trojan: 'trojan://secret@example.com:443',
  hysteria2: 'hysteria2://secret@example.com:443',
  anytls: 'anytls://secret@example.com:443',
  tuic: 'tuic://id:secret@example.com:443',
  ss: 'ss://aes-128-gcm:secret@example.com:443',
  socks: 'socks://user:secret@example.com:1080',
  socks5: 'socks5://user:secret@example.com:1080',
  http: 'http://user:secret@example.com:8080',
  https: 'https://user:secret@example.com:8443',
};
let mutations = 0;
for (const [format, protocols] of Object.entries(CONVERTED_PROTOCOLS)) {
  for (const protocol of protocols.filter(p => p !== 'vmess')) {
    const node = { name: 'Test', protocol, uri: examples[protocol] };
    assert.doesNotThrow(() => assertConversion(format, node));
    for (const key of ['future-option', 'plugin', 'obfs-password', 'packetEncoding', 'dialer-proxy']) {
      const url = new URL(node.uri); url.searchParams.set(key, 'private-value');
      assert.throws(() => assertConversion(format, { ...node, uri: url.href }), error => !error.message.includes('private-value'));
      mutations++;
    }
  }
  const value = { v: '2', ps: 'VMess', add: 'example.com', port: '443', id: 'id', aid: 0, net: 'tcp', tls: 'tls' };
  const vmess = data => ({ protocol: 'vmess', name: 'VMess', uri: 'vmess://' + Buffer.from(JSON.stringify(data)).toString('base64') });
  assert.doesNotThrow(() => assertConversion(format, vmess(value)));
  for (const change of [{ future: true }, { scy: 'none' }, { allowInsecure: true }, { net: 'grpc' }]) assert.throws(() => assertConversion(format, vmess({ ...value, ...change })));
}
assert.throws(() => assertConversion('mihomo', { protocol: 'trojan', uri: 'trojan://secret@example.com:443?insecure=0&insecure=1' }));
assert.throws(() => assertConversion('surge', { protocol: 'http', name: 'Injected\nline', uri: examples.http }));
const yaml = { type: 'vless', name: 'Test', server: 'example.com', port: 443, uuid: 'id' };
assert.doesNotThrow(() => assertClashFields(yaml));
for (const extra of [{ 'dialer-proxy': 'other' }, { udp: false }, { 'skip-cert-verify': true }, { network: 'ws', 'ws-opts': { headers: { Authorization: 'secret' } } }, { 'reality-opts': { 'public-key': 'key', future: true } }]) assert.throws(() => assertClashFields({ ...yaml, ...extra }));
console.log(`conversion contract passed (${mutations} unknown-parameter mutations plus nested YAML/TLS checks)`);
