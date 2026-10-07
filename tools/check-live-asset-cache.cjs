// Check authenticated asset caching and exclusions without mutating remote state.
const fs = require('node:fs');
const path = require('node:path');
const { request } = require('playwright');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
async function main() {
  const base = option('--url').replace(/\/$/, '');
  const credentials = fs.readFileSync(option('--credentials'), 'utf8');
  const value = name => credentials.split(/\r?\n/).find(line => line.startsWith(name))?.replace(/^[^:：]*[:：]\s*/, '').trim();
  const api = await request.newContext({ baseURL: base });
  const anonymous = await request.newContext({ baseURL: base });
  try {
    const login = await api.post('/api/login', { data: { username: value('用户名'), password: value('密码'), '2fa_code': '' } });
    if (!login.ok()) throw Error('Login failed');
    const root = '/api/admin/plugin/proxy-console/pages/';
    const html = await api.get(root + 'admin.html');
    const body = await html.text();
    const scripts = [...body.matchAll(/(?:src|href)="\.\/(assets\/[^\"]+\.(?:js|css))"/g)].map(match => match[1]);
    const checks = [];
    const record = (kind, response, expectedCache) => {
      const cacheControl = response.headers()['cache-control'] || '';
      if (expectedCache && (!response.ok() || cacheControl !== 'private, max-age=31536000, immutable')) throw Error(kind + ' cache policy missing');
      if (!expectedCache && cacheControl.includes('immutable')) throw Error(kind + ' was cached as an immutable asset');
      checks.push({ kind, status: response.status(), cacheControl });
    };
    record('html', html, false);
    for (const file of scripts) record(file.endsWith('.css') ? 'css' : 'js', await api.get(root + file), true);
    record('rpc', await api.post('/api/rpc2', { data: { jsonrpc: '2.0', id: 1, method: 'proxyConsole:getCompatibilityCatalog', params: {} } }), false);
    record('missing-hashed-js', await api.get(root + 'assets/missing-00000000.js'), false);
    record('unhashed-js', await api.get(root + 'assets/missing.js'), false);
    const denied = await anonymous.get(root + scripts.find(file => file.endsWith('.js')), { maxRedirects: 0 });
    if (denied.status() === 200 && /javascript/.test(denied.headers()['content-type'] || '')) throw Error('Anonymous access unexpectedly succeeded');
    record('anonymous-js', denied, false);
    const report = { ok: true, checks };
    const output = option('--output');
    if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)+'\n'); }
    console.log(JSON.stringify(report));
  } finally { await api.dispose(); await anonymous.dispose(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
