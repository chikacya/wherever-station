// Verify key rotation UI with intercepted RPCs only; never connects to an Agent.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { planManagedNowhere } = require('./managed-nowhere');
const { decodeNowhereConfig } = require('./nowhere-config');
const args = process.argv.slice(2);
const base = args[args.indexOf('--url') + 1];
if (!base?.startsWith('http://127.0.0.1:')) throw Error('Supply a local --url');
const oldKey = 'a'.repeat(24), newKey = 'b'.repeat(32);
const plan = planManagedNowhere({ id: 'nw-key-test01', version: 'v2.1.0', publicHost: 'example.com', port: 2077, key: oldKey });
const configuration = decodeNowhereConfig(Object.fromEntries(plan.environment.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), JSON.parse(line.slice(i + 1))]; })));
const state = {
  version: 14, revision: 1, settings: { monitoring: {} },
  machines: [{ id: 'machine', name: 'Test server', monitorClientId: 'agent' }],
  nodes: [{ id: 'node', name: 'Old Nowhere', protocol: 'nowhere', machineId: 'machine', uri: plan.clientLink, enabled: true }],
  managedInstances: [{ id: plan.id, nodeId: 'node', machineId: 'machine', kind: 'nowhere', status: 'running', version: 'v2.1.0', name: 'Old Nowhere', publicHost: 'example.com', port: 2077, tcpPort: 2077, udpPort: 2077, certificateMode: 'ephemeral' }],
  subscriptions: [], externalSources: [], serviceBindings: [], deploymentPresets: [], providers: [], certificates: [],
};
(async () => {
  const browser = await chromium.launch();
  const prepared = new Map(); const errors = []; let savedKey = '';
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://api.github.com/repos/NodePassProject/Nowhere/releases?**', route => route.fulfill({ json: [{ tag_name: 'v2.2.1' }, { tag_name: 'v2.2.0' }, { tag_name: 'v2.1.0' }] }));
    await page.route('https://api.github.com/repos/SagerNet/sing-box/releases?**', route => route.fulfill({ json: [] }));
    await page.route('**/api/rpc2', async route => {
      const { method, params, id } = route.request().postDataJSON(); let result = {};
      if (method === 'proxyConsole:getState') result = state;
      else if (method === 'common:getNodes') result = { agent: { uuid: 'agent', name: 'Test server' } };
      else if (method === 'common:getNodesLatestStatus') result = { agent: { online: true } };
      else if (method === 'public:getMe') result = { two_factor_enabled: false };
      else if (method === 'proxyConsole:listInstanceStates' || method === 'proxyConsole:listManagedTasks') result = [];
      else if (method === 'public:queryMetrics') result = { series: [] };
      else if (method === 'proxyConsole:newManagedNowhereValues') result = { key: newKey };
      else if (method === 'admin:exec') result = { task_id: 'mock' };
      else if (method === 'admin:getSpecificTaskResult') result = { exit_code: 0, result: 'PCSTATES\t1\t' + Buffer.from('{"states":[]}').toString('base64') };
      else if (method === 'proxyConsole:prepareManagedNowhereAction' || method === 'proxyConsole:prepareManagedNowhereUpdate') {
        const action = method.endsWith('Update') ? 'update' : params.action;
        assert.notEqual(action, 'upgrade', 'UI submitted upgrade before client synchronization');
        const operationId = 'operation-' + prepared.size;
        prepared.set(operationId, { action, params });
        result = { operationId, clientId: 'agent', deduplicated: true };
      } else if (method === 'proxyConsole:getManagedTask') {
        const operation = prepared.get(params.operationId);
        const value = { ok: true, state: 'active', installed: true, binaryVersion: 'v2.1.0' };
        if (operation.action === 'read-config') value.configuration = configuration;
        if (operation.action === 'update') {
          savedKey = operation.params.changes.key;
          const uri = new URL(state.nodes[0].uri); uri.username = savedKey; state.nodes[0].uri = uri.toString(); state.revision++;
        }
        result = { state, task: { phase: 'completed', result: value } };
      }
      await route.fulfill({ json: { jsonrpc: '2.0', id, result } });
    });
    await page.goto(base + '/admin.html');
    await page.locator('.nav').getByRole('button', { name: '部署节点', exact: true }).click();
    await page.getByRole('button', { name: '版本与证书', exact: true }).click();
    let dialog = page.locator('dialog[open]');
    await dialog.getByText('升级前需要更新共享密钥', { exact: true }).waitFor();
    assert(await dialog.getByRole('button', { name: '切换此实例', exact: true }).isDisabled());
    await dialog.getByRole('button', { name: '更新密钥', exact: true }).click();
    dialog = page.locator('dialog[open]');
    const input = dialog.locator('label').filter({ hasText: /^共享密钥/ }).locator('input');
    await input.waitFor(); assert.equal(await input.inputValue(), oldKey);
    await dialog.getByRole('button', { name: '生成 32 位密钥', exact: true }).click();
    await dialog.getByText(/保存后旧客户端链接将失效/).waitFor();
    assert.equal(await input.inputValue(), newKey);
    assert.equal(savedKey, '', 'generating a key applied it before Save');
    await dialog.getByRole('button', { name: '保存并应用', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '切换此实例', exact: true }).waitFor();
    assert.equal(savedKey, newKey);
    assert(!(await page.locator('dialog[open]').getByRole('button', { name: '切换此实例', exact: true }).isDisabled()));
    assert.equal(await page.locator('select[aria-label="目标版本"]').inputValue(), 'v2.2.1');
    assert.equal(state.managedInstances[0].version, 'v2.1.0', 'saving a key upgraded the kernel automatically');
    assert.equal(await page.locator('select[aria-label="目标版本"] option[value="v2.2.0"]').count(), 0);
    await page.locator('dialog[open]').getByRole('button', { name: '关闭', exact: true }).last().click();
    await page.getByRole('button', { name: '版本与证书', exact: true }).click();
    await page.locator('dialog[open]').getByRole('button', { name: '切换此实例', exact: true }).waitFor();
    assert.equal(await page.locator('dialog[open]').getByRole('button', { name: '更新密钥', exact: true }).count(), 0, '32-character key was still blocked');
    assert(!(await page.locator('dialog[open]').getByRole('button', { name: '切换此实例', exact: true }).isDisabled()));

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, oldKeyBlocked: true, explicitGeneration: true, savePublishesLink: true, upgradeTargetPreserved: true, noAutomaticUpgrade: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
