// Upload and enable a built plugin through Komari's authenticated chunk API.
const fs = require('node:fs');
const path = require('node:path');
const { request } = require('playwright');

async function main() {
  const args = process.argv.slice(2);
  const opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
  const base = opt('--url').replace(/\/$/, '');
  const archivePath = path.resolve(opt('--plugin'));
  const credentialPath = path.resolve(opt('--credentials'));
  if (!base.startsWith('https://') || !fs.existsSync(archivePath) || !fs.existsSync(credentialPath)) throw new Error('Supply --url HTTPS_URL --plugin ZIP --credentials FILE');
  const text = fs.readFileSync(credentialPath, 'utf8');
  const pluginShort = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'komari-plugin.json'), 'utf8')).short;
  const value = name => text.split(/\r?\n/).find(line => line.startsWith(name))?.replace(/^[^:：]*[:：]\s*/, '').trim();
  const api = await request.newContext({ baseURL: base });
  const expectedVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'komari-plugin.json'), 'utf8')).version;
  try {
    const login = await api.post('/api/login', { data: { username: value('用户名'), password: value('密码'), '2fa_code': '' } });
    if (!login.ok()) throw new Error(`Login failed (${login.status()})`);
    const archive = fs.readFileSync(archivePath);
    const init = await api.post('/api/admin/upload/init', { data: { purpose: 'plugin', size: archive.length, filename: path.basename(archivePath) } });
    if (!init.ok()) throw new Error(`Upload init failed (${init.status()})`);
    const { data } = await init.json();
    for (let offset = 0, index = 0; offset < archive.length; offset += data.chunk_size, index++) {
      const chunk = await api.post('/api/admin/upload/chunk', { multipart: { upload_id: data.upload_id, chunk_index: String(index), chunk_data: { name: `chunk-${index}`, mimeType: 'application/octet-stream', buffer: archive.subarray(offset, Math.min(offset + data.chunk_size, archive.length)) } } });
      if (!chunk.ok()) throw new Error(`Upload chunk ${index} failed (${chunk.status()})`);
    }
    const merged = await api.post('/api/admin/upload/merge', { data: { upload_id: data.upload_id } });
    const mergeResult = await merged.text();
    if (!merged.ok()) throw new Error(`Plugin install failed (${merged.status()}): ${mergeResult.slice(0, 500)}`);
    const rpc = async (method, params = {}) => {
      const response = await api.post('/api/rpc2', { data: { jsonrpc: '2.0', id: Date.now(), method, params } });
      const body = await response.json();
      if (body.error) throw new Error(body.error.message);
      return body.result;
    };
    await new Promise(resolve => setTimeout(resolve, 1000));
    const findPlugin = async () => {
      const matches = (await rpc('admin:listPlugins')).filter(item => item.short === pluginShort);
      return matches.find(item => item.version === expectedVersion) || matches.at(-1);
    };
    let plugin = await findPlugin();
    if (plugin?.enabled && !plugin?.running) {
      await rpc('admin:setPluginEnabled', { short: pluginShort, enabled: false });
      plugin = await findPlugin();
    }
    if (!plugin?.enabled) {
      const enabled = await rpc('admin:setPluginEnabled', { short: pluginShort, enabled: true });
      if (enabled?.requires_approval) await rpc('admin:setPluginEnabled', { short: pluginShort, enabled: true, approved: true });
      plugin = await findPlugin();
    }
    if (!plugin?.running) throw new Error(`Plugin did not start after installation: ${JSON.stringify({ version: plugin?.version, enabled: plugin?.enabled, running: plugin?.running, error: plugin?.error || plugin?.last_error || '', upload: mergeResult.slice(0, 300) })}`);
    console.log(JSON.stringify({ ok: true, short: plugin.short, version: plugin.version, enabled: plugin.enabled, running: plugin.running, icon: plugin.icon || '' }));
  } finally {
    await api.dispose();
  }
}

main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
