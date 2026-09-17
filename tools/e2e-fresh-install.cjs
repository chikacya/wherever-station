// Opt-in destructive test scoped to /var/lib/wherever-station-e2e and two
// transient systemd units. It never controls the host's sing-box/nowhere units.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { chromium, request } = require('playwright');

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback = '') => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const gcloud = opt('--gcloud');
  const instance = opt('--instance');
  const zone = opt('--zone');
  const pluginZip = path.resolve(opt('--plugin'));
  const expectedVersion = require(path.join(__dirname, '..', 'komari-plugin.json')).version;
  const tunnelPort = Number(opt('--tunnel-port', '26774'));
  if (!gcloud || !instance || !zone || !fs.existsSync(pluginZip) || !Number.isInteger(tunnelPort)) throw new Error('Supply --gcloud, --instance, --zone and --plugin');
  const base = `http://127.0.0.1:${tunnelPort}`;
  const root = '/var/lib/wherever-station-e2e';
  const runRemote = (command, timeout = 120000) => {
    const result = spawnSync(gcloud, ['compute', 'ssh', instance, `--zone=${zone}`, '--quiet', `--command=${command}`], { encoding: 'utf8', timeout });
    if (result.status !== 0) throw new Error(`Remote command failed: ${(result.stderr || result.stdout || '').trim()}`);
    return result.stdout;
  };
  const stopRemote = () => runRemote(`sudo systemctl stop wherever-e2e-agent.service wherever-e2e-komari.service 2>/dev/null || true; sudo systemctl reset-failed wherever-e2e-agent.service wherever-e2e-komari.service 2>/dev/null || true; sudo rm -rf '${root}'`, 30000);
  let tunnel;
  let browser;
  let api;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wherever-fresh-e2e-'));
  try {
    stopRemote();
    runRemote(`sudo install -d -m 0700 '${root}/server'; sudo curl -fsSL -o '${root}/komari' 'https://github.com/komari-monitor/komari/releases/download/1.4.3/komari-linux-amd64'; sudo curl -fsSL -o '${root}/komari-agent' 'https://github.com/komari-monitor/komari-agent/releases/download/1.2.60/komari-agent-linux-amd64'; sudo chmod 0755 '${root}/komari' '${root}/komari-agent'; sudo systemd-run --unit=wherever-e2e-komari --property=Restart=always --property=RestartSec=1s --property=WorkingDirectory='${root}/server' '${root}/komari' server -l 127.0.0.1:26774 -d data/komari.db`, 120000);
    tunnel = spawn(gcloud, ['compute', 'ssh', instance, `--zone=${zone}`, '--quiet', '--', '-N', '-L', `${tunnelPort}:127.0.0.1:26774`], { stdio: ['ignore', 'ignore', 'pipe'] });
    api = await request.newContext({ baseURL: base });
    let online = false;
    online = false;
    for (let i = 0; i < 60; i++) {
      try { const response = await api.get('/api/install/status'); if (response.ok()) { online = true; break; } } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!online) throw new Error('Fresh Komari did not become reachable through the tunnel');
    const username = 'owner';
    const password = `Fresh-${crypto.randomBytes(12).toString('hex')}aA1`;
    const installed = await api.post('/api/install/complete', { data: { username, password, sitename: 'Wherever fresh E2E', description: 'Ephemeral isolated test', metric_dsn: 'file:data/metrics.db?mode=rwc' } });
    if (!installed.ok()) throw new Error(`Komari installation failed: ${await installed.text()}`);
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try { const response = await api.post('/api/login', { data: { username, password, '2fa_code': '' } }); if (response.ok()) { online = true; break; } } catch (_) { online = false; }
    }
    if (!online) throw new Error('Fresh Komari did not restart into normal mode');
    const archive = fs.readFileSync(pluginZip);
    const init = await api.post('/api/admin/upload/init', { data: { purpose: 'plugin', size: archive.length, filename: path.basename(pluginZip) } });
    if (!init.ok()) throw new Error(`Plugin upload init failed: ${await init.text()}`);
    const initBody = await init.json();
    const uploadId = initBody.data.upload_id;
    const chunkSize = initBody.data.chunk_size;
    for (let offset = 0, index = 0; offset < archive.length; offset += chunkSize, index++) {
      const chunk = await api.post('/api/admin/upload/chunk', { multipart: { upload_id: uploadId, chunk_index: String(index), chunk_data: { name: `chunk-${index}`, mimeType: 'application/octet-stream', buffer: archive.subarray(offset, Math.min(offset + chunkSize, archive.length)) } } });
      if (!chunk.ok()) throw new Error(`Plugin upload chunk failed: ${await chunk.text()}`);
    }
    const merged = await api.post('/api/admin/upload/merge', { data: { upload_id: uploadId } });
    if (!merged.ok()) throw new Error(`Plugin installation failed: ${await merged.text()}`);
    const rpc = async (method, params = {}) => {
      const response = await api.post('/api/rpc2', { data: { jsonrpc: '2.0', id: Date.now(), method, params } });
      const body = await response.json();
      if (body.error) throw new Error(body.error.message);
      return body.result;
    };
    const firstEnable = await rpc('admin:setPluginEnabled', { short: 'proxy-console', enabled: true });
    if (firstEnable?.requires_approval) await rpc('admin:setPluginEnabled', { short: 'proxy-console', enabled: true, approved: true });
    const plugins = await rpc('admin:listPlugins');
    const plugin = plugins.find(item => item.short === 'proxy-console');
    if (!plugin?.enabled || !plugin?.running || plugin.version !== expectedVersion) throw new Error(`Uploaded plugin is not running as ${expectedVersion}`);
    const discoveryKey = `fresh-${crypto.randomBytes(18).toString('hex')}`;
    await rpc('admin:editSettings', { auto_discovery_key: discoveryKey });
    const beforeAgents = await rpc('common:getNodes');
    runRemote(`sudo systemd-run --unit=wherever-e2e-agent --property=Restart=always --property=RestartSec=1s --property=WorkingDirectory='${root}' '${root}/komari-agent' --endpoint 'http://127.0.0.1:26774' --auto-discovery '${discoveryKey}' --disable-auto-update`, 30000);
    let connected;
    let agent;
    for (let i = 0; i < 80; i++) {
      const clients = await rpc('common:getNodes');
      agent = Object.values(clients || {}).find(item => item?.uuid && !beforeAgents?.[item.uuid]);
      connected = agent?.uuid ? clients[agent.uuid] : null;
      if (connected?.uuid) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!connected) throw new Error('Fresh Agent did not register through auto-discovery');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const login = await page.request.post(`${base}/api/login`, { data: { username, password, '2fa_code': '' } });
    if (!login.ok()) throw new Error('Browser login failed');
    await page.goto(`${base}/admin/plugin-page?short=proxy-console&file=pages%2Fadmin.html`);
    const legalDialog = page.locator('[role="dialog"]').filter({ hasText: /法律声明与合规指引/ });
    const legalVisible = await legalDialog.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    if (legalVisible) {
      const checkbox = legalDialog.locator('input[type="checkbox"]');
      if (await checkbox.count()) await checkbox.first().check({ force: true });
      const accept = legalDialog.getByRole('button', { name: /同意|接受|确认|继续|已阅读/ }).last();
      if (await accept.count()) await accept.click();
      else await legalDialog.getByRole('button').last().click();
      await legalDialog.waitFor({ state: 'hidden', timeout: 10000 });
    }
    await page.locator('iframe').waitFor({ timeout: 30000 });
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: '节点宿主', exact: true }).click();
    await frame.getByText(/发现 1 台尚未加入的 Komari Agent/).waitFor();
    await frame.getByRole('button', { name: `添加 ${agent.name}`, exact: true }).click();
    const hostDialog = frame.locator('dialog[open]');
    const displayName = hostDialog.getByLabel('展示名称', { exact: true });
    await displayName.waitFor();
    let onboardingName = '';
    for (let i = 0; i < 20; i++) {
      onboardingName = await displayName.inputValue();
      if (onboardingName === agent.name) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (onboardingName !== agent.name) throw new Error(`Agent onboarding did not prefill the host name (received ${JSON.stringify(onboardingName)})`);
    await hostDialog.getByLabel('国家/地区', { exact: true }).fill('测试环境');
    await hostDialog.getByLabel('国家代码', { exact: true }).fill('US');
    await hostDialog.getByLabel('城市/区域', { exact: true }).fill('Fresh');
    await hostDialog.getByRole('button', { name: '保存', exact: true }).click();
    await hostDialog.waitFor({ state: 'hidden' });
    const blank = await rpc('proxyConsole:getState');
    if (blank.nodes.length || blank.subscriptions.length || blank.managedInstances.length || blank.machines.length !== 1 || blank.machines[0].monitorClientId !== agent.uuid) throw new Error('Seed-free auto-discovery did not produce the expected single bound host');
    await browser.close(); browser = null;
    const credentials = path.join(temp, 'credentials.txt');
    fs.writeFileSync(credentials, `用户名: ${username}\n密码: ${password}\n`, { mode: 0o600 });
    const runner = path.join(__dirname, 'e2e-managed.cjs');
    const common = [runner, '--url', base, '--credentials', credentials, '--machine', agent.name, '--download', '--ui-connectivity', '--add-subscription', '--status'];
    const sing = spawnSync(process.execPath, [...common, '--port', '62120', '--kind', 'sing-box', '--protocol', 'vless-reality', '--binary', '/opt/homebrew/bin/sing-box'], { encoding: 'utf8', timeout: 240000 });
    process.stdout.write(sing.stdout || ''); process.stderr.write(sing.stderr || '');
    if (sing.status !== 0) throw new Error('Fresh sing-box UI lifecycle failed');
    const vectorBinary = opt('--vector-binary');
    if (!vectorBinary) throw new Error('Supply --vector-binary for the external Nowhere client probe');
    const nowhere = spawnSync(process.execPath, [...common, '--port', '62121', '--kind', 'nowhere', '--network', 'tcp', '--binary', vectorBinary], { encoding: 'utf8', timeout: 240000 });
    process.stdout.write(nowhere.stdout || ''); process.stderr.write(nowhere.stderr || '');
    if (nowhere.status !== 0) throw new Error('Fresh Nowhere UI lifecycle failed');
    console.log(JSON.stringify({ stage: 'fresh-install-complete', ok: true, emptyState: true, agentAutoDiscovery: true, downloadedKernels: ['sing-box', 'nowhere'], pluginVersion: plugin.version }));
    await api.dispose(); api = null;
  } finally {
    if (browser) await browser.close();
    if (api) await api.dispose();
    if (tunnel?.exitCode === null) { tunnel.kill('SIGTERM'); await Promise.race([new Promise(resolve => tunnel.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]); }
    try { stopRemote(); } catch (error) { console.error(JSON.stringify({ stage: 'fresh-cleanup', ok: false, error: error.message })); process.exitCode = 1; }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(JSON.stringify({ stage: 'fresh-install', ok: false, error: error.message })); process.exitCode = 1; });
