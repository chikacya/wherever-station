// Opt-in live UI test: creates only a uniquely named test instance, then deletes it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback = '') => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  if (args.includes('--help')) return console.log('node tools/e2e-managed.cjs --url HTTPS_URL --credentials FILE --machine NAME --port PORT [--kind sing-box|nowhere] [--network tcp|udp|mix] [--protocol vless-reality|vmess|shadowsocks|trojan|hysteria2|tuic|anytls] [--binary CLIENT_BINARY] [--download] [--detach-on-start] [--edit [--rollback]] [--ui-connectivity]');
  const base = opt('--url');
  const credentialPath = opt('--credentials');
  const machine = opt('--machine');
  const port = Number(opt('--port'));
  const kind = opt('--kind', 'sing-box');
  const protocol = opt('--protocol', 'vless-reality');
  const detachCreate = args.includes('--detach-create');
  if (detachCreate && kind !== 'sing-box') throw new Error('Detached create test currently targets single-step sing-box creation');
  if (!['vless-reality', 'vmess', 'shadowsocks', 'trojan', 'hysteria2', 'tuic', 'anytls'].includes(protocol)) throw new Error('Unsupported protocol in this client test');
  if (!['sing-box', 'nowhere'].includes(kind)) throw new Error('Unsupported test kind');
  const testHttp = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(base);
  if (!(base.startsWith('https://') || testHttp) || !credentialPath || !machine || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Supply HTTPS URL (or localhost HTTP), credentials file, machine name, and test port');
  const credentials = fs.readFileSync(credentialPath, 'utf8');
  const readCredential = name => credentials.split('\n').find(line => line.startsWith(name))?.replace(/^[^:：]*[:：]\s*/, '').trim();
  const testName = `e2e-${kind}-${Date.now()}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wherever-ui-e2e-'));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let frame;
  let created = false;
  let stage = 'login';
  let cleanupError;
  let page;
  let clientId;
  let baseline;
  const rpc = async (method, params = {}) => {
    const response = await page.request.post(`${base}/api/rpc2`, { data: { jsonrpc: '2.0', id: Date.now(), method, params } });
    const value = await response.json();
    if (value.error) throw new Error(value.error.message);
    return value.result;
  };
  const serviceSnapshot = async () => {
    const command = 'systemctl show sing-box.service nowhere.service -p Id -p MainPID -p ActiveState -p ExecMainStartTimestamp; if test -f /etc/s-box/sb.json; then sha256sum /etc/s-box/sb.json; fi';
    const job = await rpc('admin:exec', { command, clients: [clientId], two_factor_code: '' });
    for (let attempt = 0; attempt < 40; attempt++) {
      await page.waitForTimeout(500);
      const result = await rpc('admin:getSpecificTaskResult', { task_id: job.task_id, uuid: clientId });
      if (result.exit_code !== null && result.exit_code !== undefined) {
        if (result.exit_code !== 0 || !String(result.result).includes('MainPID=')) throw new Error('Cannot read existing service baseline');
        return result.result;
      }
    }
    throw new Error('Service baseline command timed out');
  };
  try {
    page = await browser.newPage();
    page.on('dialog', async dialog => {
      if (dialog.type() === 'confirm' && dialog.message().includes(testName)) await dialog.accept();
      else await dialog.dismiss();
    });
    const loginResponse = await page.request.post(`${base}/api/login`, { data: { username: readCredential('用户名'), password: readCredential('密码'), '2fa_code': '' } });
    if (!loginResponse.ok()) throw new Error(`Komari login failed: HTTP ${loginResponse.status()}`);
    await page.goto(`${base}/admin/plugin-page?short=proxy-console&file=pages%2Fadmin.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const legalDialog = page.locator('[role="dialog"]').filter({ hasText: /法律声明与合规指引/ });
    if (await legalDialog.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)) {
      const checkbox = legalDialog.locator('input[type="checkbox"]');
      if (await checkbox.count()) await checkbox.first().check({ force: true });
      const accept = legalDialog.getByRole('button', { name: /同意|接受|确认|继续|已阅读/ }).last();
      if (await accept.count()) await accept.click();
      else await legalDialog.getByRole('button').last().click();
      await legalDialog.waitFor({ state: 'hidden', timeout: 10000 });
    }
    await page.locator('iframe').waitFor({ timeout: 30000 });
    frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: '部署节点', exact: true }).click();
    console.log(JSON.stringify({ stage, ok: true }));
    stage = 'create';
    await frame.getByRole('button', { name: kind === 'nowhere' ? /部署 Nowhere/ : /sing-box 快捷部署/ }).click();
    let dialog = frame.locator('dialog[open]');
    await dialog.getByLabel('节点名称', { exact: true }).fill(testName);
    const hostSelect = dialog.locator('label').filter({ hasText: /^(节点宿主|服务器)/ }).locator('select');
    await hostSelect.locator('option').first().waitFor({ state: 'attached' });
    const options = await hostSelect.locator('option').allTextContents();
    const matches = options.filter(label => label.toLowerCase().includes(machine.toLowerCase()));
    if (matches.length !== 1) throw new Error(`Machine name must match exactly one bound host. Available: ${options.join(', ')}`);
    await hostSelect.selectOption({ label: matches[0] });
    const state = await rpc('proxyConsole:getState');
    const machineId = await hostSelect.inputValue();
    clientId = state.machines.find(item => item.id === machineId)?.monitorClientId;
    if (!clientId) throw new Error('Selected host has no bound agent');
    baseline = await serviceSnapshot();
    if (kind === 'sing-box') {
      await dialog.getByLabel('监听端口', { exact: true }).fill(String(port));
      const preset = state.deploymentPresets.find(item => !item.hidden && item.values?.protocol === protocol);
      if (!preset) throw new Error(`No visible quick preset for ${protocol}`);
      await dialog.locator('label').filter({ hasText: /^快捷预设/ }).locator('select').selectOption(preset.id);
      await dialog.getByLabel('节点名称', { exact: true }).fill(testName);
    }
    if (kind === 'sing-box' && protocol === 'vmess' && opt('--transport') === 'ws') {
      await dialog.locator('label').filter({ hasText: /^传输/ }).locator('select').selectOption('ws');
      await dialog.getByLabel('WebSocket 路径', { exact: true }).fill('/wherever-e2e');
    }
    if (protocol === 'shadowsocks' && opt('--method')) await dialog.locator('label').filter({ hasText: /^加密方式/ }).locator('select').selectOption(opt('--method'));
    if (['trojan', 'hysteria2', 'tuic', 'anytls'].includes(protocol)) {
      await dialog.locator('label').filter({ hasText: /^证书方式/ }).locator('select').selectOption('self-signed');
    }
    if (args.includes('--download')) {
      if (kind === 'nowhere') await dialog.getByText('高级参数', { exact: true }).click();
      await dialog.locator('label').filter({ hasText: /^内核来源/ }).locator('select').selectOption('download');
      if (kind === 'sing-box') await dialog.locator('label').filter({ hasText: /^下载版本/ }).locator('input').fill('1.13.11');
      else await dialog.locator('label').filter({ hasText: /^下载版本/ }).locator('select').selectOption('v2.0.2');
    }
    if (kind === 'nowhere') {
      const network = opt('--network', 'tcp');
      if (!['tcp', 'udp', 'mix'].includes(network)) throw new Error('Nowhere network must be tcp, udp, or mix');
      await dialog.locator('label').filter({ hasText: /^TCP Carrier 端口/ }).locator('input').fill(network === 'udp' ? '0' : String(port));
      await dialog.locator('label').filter({ hasText: /^UDP Carrier 端口/ }).locator('input').fill(network === 'tcp' ? '0' : String(port));
      await dialog.locator('label').filter({ hasText: /^客户端输出/ }).locator('select').selectOption('both');
    }
    const expectedIp = await dialog.getByLabel('公网域名或 IP', { exact: false }).inputValue();
    const specPromise = page.waitForResponse(response => {
      try { return response.request().postDataJSON()?.method === (kind === 'nowhere' ? 'proxyConsole:createManagedNowhereDraft' : 'proxyConsole:prepareManagedSingBoxCreate'); } catch { return false; }
    }, { timeout: 30000 });
    let signalDetached;
    const detachedSubmission = new Promise(resolve => { signalDetached = resolve; });
    if (detachCreate) await page.route('**/api/rpc2', async route => {
      const request = route.request().postDataJSON();
      if (request?.method === 'proxyConsole:bindManagedTask') {
        await route.abort(); signalDetached();
      } else await route.continue();
    });
    const restartAfterBind = args.includes('--restart-controller-after-bind');
    const boundCreate = restartAfterBind ? page.waitForResponse(response => {
      try { return response.request().postDataJSON()?.method === 'proxyConsole:bindManagedTask'; } catch { return false; }
    }, { timeout: 30000 }) : null;
    await dialog.getByRole('button', { name: kind === 'nowhere' ? '检查并创建（不启动）' : '校验并创建（不启动）', exact: true }).click();
    const specResponse = await specPromise;
    const spec = await specResponse.json();
    if (spec.error) throw new Error(`Create planning failed: ${spec.error.message}`);
    let activePlan = spec.result.plan;
    if (args.includes('--dedup-create')) {
      const request = specResponse.request().postDataJSON();
      const duplicate = await rpc(request.method, request.params);
      if (duplicate.operationId !== spec.result.operationId || duplicate.deduplicated !== true || duplicate.command) throw new Error('Duplicate requestId was not deduplicated');
      console.log(JSON.stringify({ stage: 'request-id-dedup', ok: true }));
    }
    if (restartAfterBind) {
      await boundCreate;
      const controllerHost = opt('--controller-host');
      const controllerKey = opt('--controller-key');
      if (!controllerHost || !controllerKey) throw new Error('Controller restart test requires --controller-host and --controller-key');
      const restarted = spawnSync('ssh', ['-i', controllerKey, '-o', 'BatchMode=yes', `ubuntu@${controllerHost}`, 'sudo systemctl restart komari && sudo systemctl is-active komari'], { encoding: 'utf8', timeout: 30000 });
      if (restarted.status !== 0 || !restarted.stdout.includes('active')) throw new Error('Controller restart failed');
      const deadline = Date.now() + 90000;
      let recovered;
      while (Date.now() < deadline) {
        try {
          const value = await rpc('proxyConsole:getManagedTask', { operationId: spec.result.operationId });
          if (value.task.phase === 'completed') { recovered = value; break; }
          if (['rejected', 'needs-review'].includes(value.task.phase)) throw new Error(value.task.error);
        } catch (_) { /* Komari may still be accepting connections after systemd reports active. */ }
        await page.waitForTimeout(1000);
      }
      if (!recovered?.task?.result?.ok) throw new Error('Controller did not recover the bound creation task');
      await page.goto(`${base}/admin/plugin-page?short=proxy-console&file=pages%2Fadmin.html`);
      await page.locator('iframe').waitFor({ timeout: 30000 });
      frame = page.frameLocator('iframe');
      await frame.getByRole('button', { name: '部署节点', exact: true }).click();
      dialog = frame.locator('dialog[open]');
      console.log(JSON.stringify({ stage: 'controller-restart-recovery', ok: true }));
    }
    if (detachCreate) {
      await Promise.race([detachedSubmission, page.waitForTimeout(30000).then(() => { throw new Error('No creation submission to detach'); })]);
      await page.goto('about:blank');
      await page.unroute('**/api/rpc2');
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const snapshot = await rpc('proxyConsole:getState');
        if (snapshot.managedInstances.some(item => item.id === spec.result.instanceId)) { created = true; break; }
        await page.waitForTimeout(2000);
      }
      if (!created) throw new Error('Backend failed to discover and register unbound creation task');
      await page.goto(`${base}/admin/plugin-page?short=proxy-console&file=pages%2Fadmin.html`);
      await page.locator('iframe').waitFor({ timeout: 30000 });
      frame = page.frameLocator('iframe');
      await frame.getByRole('button', { name: '部署节点', exact: true }).click();
      console.log(JSON.stringify({ stage: 'unbound-create-recovery', ok: true }));
    }
    const card = frame.locator('article.managed-card').filter({ hasText: testName });
    await card.waitFor({ timeout: 45000 });
    created = true;
    await dialog.waitFor({ state: 'hidden' });
    console.log(JSON.stringify({ stage, ok: true, testName }));
    if (args.includes('--add-subscription')) {
      stage = 'add-subscription';
      await card.getByRole('button', { name: '加入订阅', exact: true }).click();
      const subscriptionDialog = frame.locator('dialog[open]');
      const nameField = subscriptionDialog.getByLabel('新订阅名称', { exact: true });
      if (await nameField.count()) await nameField.fill(`e2e-sub-${Date.now()}`);
      await subscriptionDialog.getByRole('button', { name: '确认加入', exact: true }).click();
      await subscriptionDialog.waitFor({ state: 'hidden', timeout: 30000 });
      const subscribed = await rpc('proxyConsole:getState');
      const instance = subscribed.managedInstances.find(item => item.name === testName);
      if (!subscribed.subscriptions.some(item => item.nodeIds.includes(instance?.nodeId))) throw new Error('Managed node was not added to a subscription');
      console.log(JSON.stringify({ stage, ok: true }));
    }
    if (kind === 'nowhere' && args.includes('--edit-stopped')) {
      stage = 'stopped-edit';
      await card.getByRole('button', { name: '编辑运行配置', exact: true }).click();
      const editor = frame.locator('dialog[open]');
      await editor.getByLabel('监听端口', { exact: true }).fill(String(port + 1));
      const updatePromise = page.waitForResponse(response => {
        try { return response.request().postDataJSON()?.method === 'proxyConsole:prepareManagedNowhereUpdate'; } catch { return false; }
      });
      await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
      const updated = await (await updatePromise).json();
      if (updated.error) throw new Error(updated.error.message);
      await editor.waitFor({ state: 'hidden', timeout: 45000 });
      const latest = await rpc('proxyConsole:getState');
      const instance = latest.managedInstances.find(item => item.name === testName);
      if (instance?.port !== port + 1 || instance.status !== 'stopped') throw new Error('Stopped edit did not preserve stopped state');
      activePlan = updated.result.plan;
      console.log(JSON.stringify({ stage: 'stopped-edit-validated', ok: true }));
    }
    if (kind === 'nowhere' && args.includes('--recover-interrupted-update')) {
      stage = 'interrupted-update-recovery';
      const root = activePlan.directory;
      const recoverySetup = `import base64,json,os,shutil,sys\nP=json.loads(base64.b64decode(sys.argv[1]).decode())\nenv=os.path.join(P["root"],"nowhere.env")\nshutil.copy2(env,env+".rollback")\nwith open(env+".transaction","w",encoding="utf-8") as h: json.dump({"schema":1,"wasRunning":False},h)\nos.chmod(env+".transaction",0o600)\nwith open(env,"w",encoding="utf-8") as h: h.write("INTERRUPTED=1\\n")\nos.chmod(env,0o600)\n`;
      const command = `python3 -c "$(printf '%s' '${Buffer.from(recoverySetup).toString('base64')}' | base64 -d)" '${Buffer.from(JSON.stringify({ root })).toString('base64')}'`;
      const job = await rpc('admin:exec', { command, clients: [clientId], two_factor_code: '' });
      let setupDone = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        await page.waitForTimeout(250);
        const result = await rpc('admin:getSpecificTaskResult', { task_id: job.task_id, uuid: clientId });
        if (result.exit_code !== null && result.exit_code !== undefined) { setupDone = result.exit_code === 0; break; }
      }
      if (!setupDone) throw new Error('Could not stage interrupted test transaction');
      await card.getByRole('button', { name: '编辑运行配置', exact: true }).click();
      const editor = frame.locator('dialog[open]');
      await editor.getByLabel('监听端口', { exact: true }).waitFor({ timeout: 30000 });
      if (Number(await editor.getByLabel('监听端口', { exact: true }).inputValue()) !== activePlan.summary.port) throw new Error('Interrupted configuration was not restored before read');
      await editor.getByRole('button', { name: '取消', exact: true }).click();
      console.log(JSON.stringify({ stage: 'interrupted-update-recovery', ok: true }));
    }
    stage = 'start';
    const detached = args.includes('--detach-on-start');
    const boundPromise = detached ? page.waitForResponse(response => {
      try { return response.request().postDataJSON()?.method === 'proxyConsole:bindManagedTask'; } catch { return false; }
    }, { timeout: 30000 }) : null;
    await card.getByRole('button', { name: '启动', exact: true }).click();
    if (detached) {
      await boundPromise;
      await page.goto('about:blank');
      // Do not call plugin task polling while detached: its cron must complete
      // the already-authorized operation without a browser coordinator.
      const deadline = Date.now() + 90000;
      let recovered = false;
      while (Date.now() < deadline) {
        const snapshot = await rpc('proxyConsole:getState');
        if (snapshot.managedInstances.some(item => item.name === testName && item.status === 'running')) { recovered = true; break; }
        await page.waitForTimeout(2000);
      }
      if (!recovered) throw new Error('Detached start was not registered by backend');
      await page.goto(`${base}/admin/plugin-page?short=proxy-console&file=pages%2Fadmin.html`);
      await page.locator('iframe').waitFor({ timeout: 30000 });
      frame = page.frameLocator('iframe');
      await frame.getByRole('button', { name: '部署节点', exact: true }).click();
      console.log(JSON.stringify({ stage: 'detached-backend-recovery', ok: true }));
    }
    await card.getByText('运行中', { exact: true }).waitFor({ timeout: 30000 });
    console.log(JSON.stringify({ stage, ok: true }));
    if (args.includes('--ui-connectivity')) {
      stage = 'ui-connectivity';
      await card.getByRole('button', { name: '测试连接', exact: true }).click();
      await card.getByText(/^连接：通过/).waitFor({ timeout: 50000 });
      const latest = await rpc('proxyConsole:getState');
      const instance = latest.managedInstances.find(item => item.name === testName);
      if (instance?.connectivity?.status !== 'passed') throw new Error('UI connection check was not persisted');
      if (latest.machines.some(item => item.monitorClientId && item.id !== instance.machineId) && instance.connectivity.sourceKind !== 'remote') throw new Error('UI did not prefer a remote Agent for connection checking');
      console.log(JSON.stringify({ stage, ok: true, sourceKind: instance.connectivity.sourceKind, actualIpPresent: Boolean(instance.connectivity.actualIp) }));
    }
    stage = 'proxy';
    if (args.includes('--status')) {
      const began = Date.now();
      const snapshot = await rpc('proxyConsole:getState');
      const instance = snapshot.managedInstances.find(item => item.name === testName);
      let sample;
      while (Date.now() - began < 30000) {
        const rows = await rpc('proxyConsole:listInstanceStates');
        sample = rows.find(item => item.instanceId === instance.id && item.state === 'active' && !item.stale);
        if (sample) break;
        await page.waitForTimeout(500);
      }
      if (!sample) throw new Error('Visible-page sampling did not report active instance');
      if (kind === 'nowhere') {
        if (sample.telemetry?.source !== 'local') throw new Error(`Nowhere 2.0.2 did not expose local telemetry (${sample.telemetry?.source || 'missing'})`);
        if (!/^v?2\.0\.2$/.test(sample.telemetry.version || '')) throw new Error(`Unexpected Nowhere telemetry version: ${sample.telemetry?.version || 'missing'}`);
        if (sample.telemetry.lifecycle !== 'READY') throw new Error(`Nowhere telemetry lifecycle is not ready: ${sample.telemetry.lifecycle || 'missing'}`);
      }
      console.log(JSON.stringify({ stage: 'automatic-state-sample', ok: true, elapsedMs: Date.now() - began, pidPresent: sample.pid > 0, telemetrySource: sample.telemetry?.source || '', telemetryVersion: sample.telemetry?.version || '' }));
    }
    let outbound;
    if (kind === 'nowhere') {
      const links = activePlan.links.vector;
      outbound = typeof links === 'string' ? links : (links[0]?.uri || links[0]);
      if (!outbound?.startsWith('vector://')) throw new Error('No Vector client URI generated');
    } else if (protocol === 'vmess') {
      const value = JSON.parse(Buffer.from(spec.result.plan.clientUri.slice('vmess://'.length), 'base64').toString());
      outbound = { type: 'vmess', tag: 'test', server: value.add, server_port: Number(value.port), uuid: value.id, security: 'auto', alter_id: Number(value.aid || 0) };
      if (value.net === 'ws') outbound.transport = { type: 'ws', path: value.path || '/' };
    } else if (protocol === 'shadowsocks') {
      const value = new URL(spec.result.plan.clientUri);
      const user = Buffer.from(decodeURIComponent(value.username), 'base64').toString();
      const split = user.indexOf(':');
      outbound = { type: 'shadowsocks', tag: 'test', server: value.hostname, server_port: Number(value.port), method: user.slice(0, split), password: user.slice(split + 1) };
    } else if (protocol === 'vless-reality') {
      const uri = new URL(spec.result.plan.clientUri);
      outbound = {
      type: 'vless', tag: 'test', server: uri.hostname, server_port: Number(uri.port),
      uuid: decodeURIComponent(uri.username), flow: uri.searchParams.get('flow') || '',
      tls: { enabled: true, server_name: uri.searchParams.get('sni'),
        utls: { enabled: true, fingerprint: uri.searchParams.get('fp') || 'chrome' },
        reality: { enabled: true, public_key: uri.searchParams.get('pbk'), short_id: uri.searchParams.get('sid') } },
      };
    } else {
      const uri = new URL(spec.result.plan.clientUri);
      const tls = { enabled: true, server_name: uri.searchParams.get('sni'), insecure: uri.searchParams.get('insecure') === '1' };
      if (protocol === 'tuic') {
        outbound = { type: 'tuic', tag: 'test', server: uri.hostname, server_port: Number(uri.port), uuid: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password), congestion_control: uri.searchParams.get('congestion_control') || 'bbr', tls };
      } else {
        outbound = { type: protocol, tag: 'test', server: uri.hostname, server_port: Number(uri.port), password: decodeURIComponent(uri.username), tls };
      }
    }
    const input = path.join(directory, 'outbound.json');
    fs.writeFileSync(input, kind === 'nowhere' ? outbound : JSON.stringify(outbound), { mode: 0o600 });
    const probeArgs = [path.join(__dirname, 'probe-client.cjs'), '--input', input, '--expected-ip', expectedIp, '--kind', kind === 'nowhere' ? 'vector' : 'sing-box'];
    if (opt('--binary')) probeArgs.push('--binary', opt('--binary'));
    const probe = spawnSync(process.execPath, probeArgs, { encoding: 'utf8', timeout: 45000 });
    if (probe.status !== 0) throw new Error(`Client probe failed: ${(probe.stderr || '').trim()}`);
    console.log(probe.stdout.trim());
    if (kind === 'nowhere' && args.includes('--edit') && !args.includes('--edit-stopped')) {
      stage = 'edit';
      await card.getByRole('button', { name: '编辑运行配置', exact: true }).click();
      const editor = frame.locator('dialog[open]');
      await editor.getByLabel('监听端口', { exact: true }).fill(String(port + 1));
      const updatePromise = page.waitForResponse(response => {
        try { return response.request().postDataJSON()?.method === 'proxyConsole:prepareManagedNowhereUpdate'; } catch { return false; }
      });
      await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
      const updated = await (await updatePromise).json();
      if (updated.error) throw new Error(updated.error.message);
      await editor.waitFor({ state: 'hidden', timeout: 45000 });
      const latest = await rpc('proxyConsole:getState');
      const instance = latest.managedInstances.find(item => item.name === testName);
      const node = latest.nodes.find(item => item.id === instance?.nodeId);
      if (instance?.port !== port + 1 || Number(new URL(node.uri).port) !== port + 1) throw new Error('Edited endpoint and published node differ');
      fs.writeFileSync(input, updated.result.plan.links.vector[0].uri, { mode: 0o600 });
      const checked = spawnSync(process.execPath, probeArgs, { encoding: 'utf8', timeout: 45000 });
      if (checked.status !== 0) throw new Error('Edited client connection failed: ' + checked.stderr.trim());
      console.log(JSON.stringify({ stage: 'edit-and-reconnect', ok: true }));
      if (args.includes('--rollback')) {
        stage = 'rollback';
        await card.getByRole('button', { name: '编辑运行配置', exact: true }).click();
        await editor.getByLabel('监听地址', { exact: true }).fill('192.0.2.123');
        await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
        await editor.getByRole('alert').filter({ hasText: '已恢复旧配置' }).waitFor({ timeout: 45000 });
        const restored = await rpc('proxyConsole:getState');
        if (restored.nodes.find(item => item.id === node.id)?.uri !== node.uri) throw new Error('Failed update changed published URI');
        if (restored.managedInstances.find(item => item.id === instance.id)?.listenHost !== instance.listenHost) throw new Error('Failed update changed recorded listener');
        const rechecked = spawnSync(process.execPath, probeArgs, { encoding: 'utf8', timeout: 45000 });
        if (rechecked.status !== 0) throw new Error('Rollback did not restore client connectivity');
        await editor.getByRole('button', { name: '取消', exact: true }).click();
        console.log(JSON.stringify({ stage: 'rollback-and-reconnect', ok: true }));
      }
    }
    if (kind === 'sing-box' && args.includes('--edit')) {
      if (protocol !== 'vless-reality') throw new Error('Automated sing-box edit validation currently uses Reality');
      stage = 'edit';
      await card.getByRole('button', { name: '编辑运行配置', exact: true }).click();
      const editor = frame.locator('dialog[open]');
      await editor.getByLabel('监听端口', { exact: true }).fill(String(port + 1));
      const updatePromise = page.waitForResponse(response => {
        try { return response.request().postDataJSON()?.method === 'proxyConsole:prepareManagedSingBoxUpdate'; } catch { return false; }
      });
      await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
      const updated = await (await updatePromise).json();
      if (updated.error) throw new Error(updated.error.message);
      await editor.waitFor({ state: 'hidden', timeout: 45000 });
      const latest = await rpc('proxyConsole:getState');
      const instance = latest.managedInstances.find(item => item.name === testName);
      const node = latest.nodes.find(item => item.id === instance?.nodeId);
      if (instance?.port !== port + 1 || Number(new URL(node.uri).port) !== port + 1) throw new Error('Edited sing-box endpoint and published node differ');
      const uri = new URL(updated.result.plan.clientUri);
      const editedOutbound = {
        type: 'vless', tag: 'test', server: uri.hostname, server_port: Number(uri.port),
        uuid: decodeURIComponent(uri.username), flow: uri.searchParams.get('flow') || '',
        tls: { enabled: true, server_name: uri.searchParams.get('sni'), utls: { enabled: true, fingerprint: uri.searchParams.get('fp') || 'chrome' }, reality: { enabled: true, public_key: uri.searchParams.get('pbk'), short_id: uri.searchParams.get('sid') } },
      };
      fs.writeFileSync(input, JSON.stringify(editedOutbound), { mode: 0o600 });
      const checked = spawnSync(process.execPath, probeArgs, { encoding: 'utf8', timeout: 45000 });
      if (checked.status !== 0) throw new Error('Edited sing-box client connection failed: ' + checked.stderr.trim());
      console.log(JSON.stringify({ stage: 'sing-box-edit-and-reconnect', ok: true }));
      if (args.includes('--rollback')) {
        stage = 'rollback';
        await card.getByRole('button', { name: '编辑运行配置', exact: true }).click();
        await editor.getByLabel('监听地址', { exact: true }).fill('192.0.2.123');
        await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
        await editor.getByRole('alert').filter({ hasText: '已恢复旧配置' }).waitFor({ timeout: 45000 });
        const restored = await rpc('proxyConsole:getState');
        if (restored.nodes.find(item => item.id === node.id)?.uri !== node.uri) throw new Error('Failed sing-box update changed published URI');
        if (restored.managedInstances.find(item => item.id === instance.id)?.listenHost !== instance.listenHost) throw new Error('Failed sing-box update changed recorded listener');
        const rechecked = spawnSync(process.execPath, probeArgs, { encoding: 'utf8', timeout: 45000 });
        if (rechecked.status !== 0) throw new Error('Sing-box rollback did not restore client connectivity');
        await editor.getByRole('button', { name: '取消', exact: true }).click();
        console.log(JSON.stringify({ stage: 'sing-box-rollback-and-reconnect', ok: true }));
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ stage, ok: false, error: error.message }));
    if (frame) console.error(JSON.stringify({ visibleFormLabels: await frame.locator('dialog[open] label > span').allTextContents() }));
    process.exitCode = 1;
  } finally {
    if (created) {
      try {
        const modal = frame.locator('dialog[open]');
        if (await modal.count()) await modal.getByRole('button', { name: '取消', exact: true }).click();
        const card = frame.locator('article.managed-card').filter({ hasText: testName });
        const stop = card.getByRole('button', { name: '停止', exact: true });
        if (await stop.count() && await stop.isEnabled()) {
          await stop.click();
          await card.getByRole('button', { name: '启动', exact: true }).waitFor({ timeout: 30000 });
          await card.getByRole('button', { name: '启动', exact: true }).click({ trial: true, timeout: 30000 });
        }
        await card.getByRole('button', { name: '删除托管实例', exact: true }).click();
        await card.waitFor({ state: 'detached', timeout: 30000 });
        console.log(JSON.stringify({ stage: 'cleanup', ok: true }));
      } catch (error) { cleanupError = error; }
    }
    if (baseline) {
      try {
        if (await serviceSnapshot() !== baseline) throw new Error('Existing service PID, start time, state, or configuration changed during test');
        console.log(JSON.stringify({ stage: 'existing-services-unchanged', ok: true }));
      } catch (error) { console.error(JSON.stringify({ stage: 'existing-services-unchanged', ok: false, error: error.message })); process.exitCode = 1; }
    }
    await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
    if (cleanupError) { console.error(JSON.stringify({ stage: 'cleanup', ok: false, testName, error: cleanupError.message })); process.exitCode = 1; }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
