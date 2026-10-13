// Verify key rotation UI with intercepted RPCs only; never connects to an Agent.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { planManagedNowhere } = require('./managed-nowhere');
const { decodeNowhereConfig } = require('./nowhere-config');
const args = process.argv.slice(2);
const base = args[args.indexOf('--url') + 1];
if (!base?.startsWith('http://127.0.0.1:')) throw Error('Supply a local --url');
const oldKey = 'a'.repeat(64), newKey = 'b'.repeat(32);
const plan = planManagedNowhere({ id: 'nw-key-test01', version: 'v2.2.1', publicHost: 'example.com', port: 2077, key: oldKey });
const configuration = decodeNowhereConfig(Object.fromEntries(plan.environment.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), JSON.parse(line.slice(i + 1))]; })));
const state = {
  version: 14, revision: 1, settings: { monitoring: {} },
  machines: [{ id: 'machine', name: 'Test server', monitorClientId: 'agent' }],
  nodes: [{ id: 'node', name: 'Old Nowhere', protocol: 'nowhere', machineId: 'machine', uri: plan.clientLink, enabled: true }],
  managedInstances: [{ id: plan.id, nodeId: 'node', machineId: 'machine', kind: 'nowhere', status: 'running', version: 'v2.2.1', name: 'Old Nowhere', publicHost: 'example.com', port: 2077, tcpPort: 2077, udpPort: 2077, certificateMode: 'ephemeral' }],
  subscriptions: [], externalSources: [], serviceBindings: [], deploymentPresets: [], providers: [], certificates: [],
};
(async () => {
  const browser = await chromium.launch();
  const prepared = new Map(); const errors = []; let savedKey = '';
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://api.github.com/repos/NodePassProject/Nowhere/releases?**', route => route.fulfill({ json: [{ tag_name: 'v3.0.0' }, { tag_name: 'v2.2.1' }, { tag_name: 'v2.2.0' }, { tag_name: 'v2.2.1' }] }));
    await page.route('https://api.github.com/repos/SagerNet/sing-box/releases?**', route => route.fulfill({ json: [] }));
    await page.route('**/api/rpc2', async route => {
      const { method, params, id } = route.request().postDataJSON(); let result = {};
      if (method === 'proxyConsole:getState') result = state;
      else if (method === 'common:getNodes') result = { agent: { uuid: 'agent', name: 'Test server' } };
      else if (method === 'common:getNodesLatestStatus') result = { agent: { online: true } };
      else if (method === 'public:getMe') result = { two_factor_enabled: false };
      else if (method === 'proxyConsole:listInstanceStates' || method === 'proxyConsole:listManagedTasks') result = [];
      else if (method === 'public:queryMetrics') result = { series: [] };
      else if (method === 'proxyConsole:newManagedNowhereValues') result = { id:'nw3-ui-test01', key: newKey, version:'v3.0.0', role:'portal', out:'direct', morph:1, port:2077, tcpPort:2077, udpPort:2077 };
      else if (method === 'proxyConsole:previewManagedNowhere') { const p=planManagedNowhere(params.input); result={summary:p.summary,links:p.links}; }
      else if (method === 'proxyConsole:previewNowhereMigration') { const migration=require('./nowhere-migration').planNowhereMigration(configuration,{instanceId:'nw-key-test01',name:'Migration',targetVersion:params.targetVersion,key:params.key}); result={changes:migration.changes,summary:migration.plan.summary,links:migration.plan.links}; }
      else if (method === 'admin:exec') result = { task_id: 'mock' };
      else if (method === 'admin:getSpecificTaskResult') result = { exit_code: 0, result: 'PCSTATES\t1\t' + Buffer.from('{"states":[]}').toString('base64') };
      else if (method === 'proxyConsole:prepareManagedNowhereAction' || method === 'proxyConsole:prepareManagedNowhereUpdate' || method === 'proxyConsole:prepareNowhereMigration') {
        const action = method.endsWith('Update') ? 'update' : method.endsWith('Migration') ? 'migrate' : params.action;
        assert.notEqual(action, 'upgrade', 'UI submitted upgrade before client synchronization');
        const operationId = 'operation-' + prepared.size;
        prepared.set(operationId, { action, params });
        result = { operationId, clientId: 'agent', deduplicated: true };
      } else if (method === 'proxyConsole:getManagedTask') {
        const operation = prepared.get(params.operationId);
        const value = { ok: true, state: 'active', installed: true, binaryVersion: 'v2.2.1' };
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
    await dialog.locator('select[aria-label="目标版本"]').waitFor();
    assert.equal(await dialog.getByRole('button', { name: '更新密钥', exact: true }).count(), 0);
    assert.equal(await dialog.locator('select[aria-label="目标版本"] option[value="v3.0.0"]').count(), 1);
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
    await page.getByRole('button', { name: '编辑运行配置', exact: true }).click();
    dialog = page.locator('dialog[open]');
    const input = dialog.locator('label').filter({ hasText: /^共享密钥/ }).locator('input');
    await input.waitFor(); assert.equal(await input.inputValue(), oldKey);
    await dialog.getByRole('button', { name: '生成 32 位密钥', exact: true }).click();
    await dialog.getByText(/保存后旧客户端链接将失效/).waitFor();
    assert.equal(await input.inputValue(), newKey);
    assert.equal(savedKey, '', 'generating a key applied it before Save');
    await dialog.getByRole('button', { name: '保存并应用', exact: true }).click();
    await dialog.waitFor({state:'hidden'});
    await page.getByRole('button', { name: '编辑运行配置', exact: true }).waitFor();
    assert.equal(savedKey, newKey);
    assert.equal(state.managedInstances[0].version, 'v2.2.1', 'saving a key upgraded the kernel automatically');
    await page.getByRole('button', { name: '版本与证书', exact: true }).click();
    await page.locator('dialog[open]').getByRole('button', { name: '切换此实例', exact: true }).waitFor();
    assert.equal(await page.locator('dialog[open]').getByRole('button', { name: '更新密钥', exact: true }).count(), 0, '32-character key was still blocked');

    await page.locator('dialog[open]').getByRole('button', { name: '关闭', exact: true }).last().click();
    await page.getByRole('button', { name: /部署 Nowhere/ }).click();
    dialog=page.locator('dialog[open]');
    assert.equal(await dialog.locator('select[aria-label="Nowhere 内核版本"]').inputValue(),'v3.0.0');
    await dialog.locator('label').filter({hasText:/^公网域名或 IP/}).locator('input').fill('localhost');
    await dialog.locator('summary').filter({hasText:'高级运行参数'}).click();
    assert.equal(await dialog.locator('label').filter({hasText:'Vector Mux'}).count(),0);
    await dialog.locator('select[aria-label="Nowhere 内核版本"]').selectOption('v2.2.1');
    assert.equal(await dialog.locator('label').filter({hasText:'Vector Mux'}).count(),1);
    await dialog.locator('select[aria-label="Nowhere 内核版本"]').selectOption('v3.0.0');
    await dialog.locator('label').filter({hasText:/^角色/}).locator('select').selectOption('egress');
    assert(await dialog.locator('label').filter({hasText:/^TCP Carrier 端口/}).locator('input').isDisabled());
    await dialog.locator('label').filter({hasText:/^远端 Portal 地址/}).locator('input').fill('localhost');
    await dialog.getByRole('button',{name:'预览',exact:true}).click();
    await dialog.getByText('参数可生成 · NW3',{exact:true}).waitFor();
    await page.screenshot({path:require('node:path').join(__dirname,'../artifacts/nowhere-v3.0.0/egress-ui.png')});
    await dialog.getByRole('button', {name:'取消',exact:true}).click();
    await page.getByRole('button', {name:'版本与证书',exact:true}).click();dialog=page.locator('dialog[open]');
    await dialog.locator('select[aria-label="目标版本"]').selectOption('v3.0.0');
    await dialog.getByRole('button', {name:'迁移到 NW3…',exact:true}).click();dialog=page.locator('dialog[open]');
    await dialog.getByText(/NW3 与 NW2 不互通/).waitFor();
    assert(await dialog.getByRole('button',{name:'执行 NW3 升级迁移',exact:true}).isDisabled());
    await dialog.locator('label').filter({hasText:/^NW3 共享密钥/}).locator('input').fill(newKey);
    await dialog.getByRole('button',{name:'预览转换',exact:true}).click();
    await dialog.getByText('移除 split up/down 与 TLS Mux，每条客户端连接只选择一种 carrier',{exact:true}).waitFor();
    assert(await dialog.getByRole('button',{name:'执行 NW3 升级迁移',exact:true}).isDisabled());
    await dialog.getByRole('checkbox').check();
    await page.screenshot({path:require('node:path').join(__dirname,'../artifacts/nowhere-migration/preview.png')});
    await dialog.getByRole('button',{name:'执行 NW3 升级迁移',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    const migrated=[...prepared.values()].find(op=>op.action==='migrate');assert(migrated);assert.equal(migrated.params.confirmation,'nw3-clients-coordinated');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, compliantNW2KeyRetained: true, explicitGeneration: true, savePublishesLink: true, generationBoundaryPreserved: true, noAutomaticUpgrade: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
