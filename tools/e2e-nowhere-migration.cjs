// Deterministic Nowhere migration UI acceptance; remote lifecycle calls are mocked.
const { chromium } = require('playwright');

async function main() {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
  const base = option('--url');
  const screenshot = option('--screenshot');
  if (!base.startsWith('http://127.0.0.1:')) throw new Error('Supply --url http://127.0.0.1:PORT');
  const now = new Date().toISOString();
  const instance = {
    id: 'nw-migration-001', kind: 'nowhere', name: '🇯🇵 东京 | Nowhere V1', machineId: 'server-jp', nodeId: 'node-nw',
    status: 'running', version: 'v1.8.3', publicHost: '203.0.113.8', listenHost: '0.0.0.0', port: 2077,
    tcpPort: 2077, udpPort: 2077, tcpCarrier: 'tcp', udpCarrier: 'udp', client: 'anywhere', network: 'mix',
    tls: 1, alpn: 'now/1', morph: 0, transportMemoryProfile: 'throughput', certificateMode: 'ephemeral',
    certificateHost: '203.0.113.8', certificateDays: 825, updatedAt: now, createdAt: now, migration: null,
  };
  const state = {
    version: 12, revision: 1, settings: { publicBaseUrl: '', monitoring: {} },
    machines: [{ id: 'server-jp', name: 'Oracle 日本', provider: 'Oracle', country: '日本', countryCode: 'JP', region: '东京', tags: [], monitorClientId: 'agent-jp' }],
    nodes: [{ id: 'node-nw', name: instance.name, protocol: 'nowhere', machineId: 'server-jp', uri: 'nowhere://secret@203.0.113.8:2077?up=udp&down=udp#Tokyo', enabled: true, tags: ['托管'], source: 'manual', sourceId: '' }],
    nodeDrafts: [], subscriptions: [], externalSources: [], ruleSets: [], serviceBindings: [], deploymentPresets: [], providers: [], managedInstances: [instance],
  };
  const clients = { 'agent-jp': { uuid: 'agent-jp', name: 'Oracle 日本', ipv4: '203.0.113.8', mem_total: 1024 ** 3, disk_total: 20 * 1024 ** 3 } };
  const statuses = { 'agent-jp': { online: true, cpu: 3, ram: 256 * 1024 ** 2, ram_total: 1024 ** 3, disk: 4 * 1024 ** 3, disk_total: 20 * 1024 ** 3, net_in: 1000, net_out: 500 } };
  const releases = ['v2.0.0', 'v1.8.3', 'v1.8.2'].map(tag_name => ({ tag_name, draft: false, prerelease: false, published_at: now }));
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('https://api.github.com/repos/NodePassProject/Nowhere/releases?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(releases) }));
    await page.route('**/api/rpc2', async route => {
      const request = route.request().postDataJSON();
      let result = {};
      if (request.method === 'proxyConsole:getState') result = state;
      else if (request.method === 'common:getNodes') result = clients;
      else if (request.method === 'common:getNodesLatestStatus') result = statuses;
      else if (request.method === 'public:getMe') result = { two_factor_enabled: false };
      else if (request.method === 'proxyConsole:listManagedTasks') result = [];
      else if (request.method === 'proxyConsole:listInstanceStates') result = [{ instanceId: instance.id, machineId: instance.machineId, state: 'active', pid: 123, observedAt: now, telemetry: { source: 'ipc', lifecycle: 'READY', upBytesPerSecond: 1000, downBytesPerSecond: 2000 } }];
      else if (request.method === 'proxyConsole:newManagedNowhereValues') result = { id: 'nw-migration-new', key: 'generated-secret', version: 'v2.0.0', port: 2078, tcpPort: 2078, udpPort: 2078, tcpCarrier: 'tcp', udpCarrier: 'udp', morph: 0, transportMemoryProfile: 'throughput' };
      else if (request.method === 'proxyConsole:prepareManagedNowhereAction') result = { operationId: 'operation-status', clientId: 'agent-jp', command: 'managed-status', action: request.params.action };
      else if (request.method === 'admin:exec') result = { task_id: 'task-1' };
      else if (request.method === 'proxyConsole:bindManagedTask') result = {};
      else if (request.method === 'proxyConsole:getManagedTask') result = { state, task: { phase: 'completed', result: { ok: true, state: 'active', installed: true, binaryVersion: 'nowhere 1.8.3', certificate: { mode: 'ephemeral', valid: true, ephemeral: true } } } };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
    });
    await page.goto(`${base}/admin.html`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '部署节点', exact: true }).click();
    await page.locator('.nowhere-launch').click();
    let dialog = page.locator('dialog[open]');
    const generation = dialog.locator('label').filter({ hasText: /^协议代际/ }).locator('select');
    if (await generation.inputValue() !== '2') throw new Error('New instances must default to the V2 protocol generation');
    await dialog.getByText('TCP Carrier 端口', { exact: true }).waitFor();
    await dialog.getByText('UDP Carrier 端口', { exact: true }).waitFor();
    if (await dialog.getByText('监听端口', { exact: true }).count()) throw new Error('V2 form still shows the V1 single-port field');
    await dialog.getByText('高级参数', { exact: true }).click();
    await dialog.locator('input[value="nw2（固定）"]').waitFor();
    await dialog.getByText('Morph', { exact: true }).waitFor();
    await dialog.getByText('Transport 内存策略', { exact: true }).waitFor();
    if (await dialog.getByText('QUIC 内存策略', { exact: true }).count()) throw new Error('V2 form still exposes the V1 QUIC memory setting');
    await assertDialogResponsive(page, dialog, 'v2-create');
    if (screenshot) await page.screenshot({ path: screenshot.replace(/(\.[^.]+)$/, '-create$1'), fullPage: true });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();

    await page.getByRole('button', { name: '版本与证书', exact: true }).click();
    dialog = page.locator('dialog[open]');
    await dialog.getByText('v1.8.3 · V1', { exact: true }).waitFor();
    await dialog.locator('label').filter({ hasText: /^目标版本/ }).locator('select').selectOption('v2.0.0');
    await dialog.getByRole('button', { name: '迁移到 V2', exact: true }).waitFor();
    await dialog.getByText(/V2 与 V1 不互通/).waitFor();
    await assertDialogResponsive(page, dialog, 'v1-to-v2-manager');
    if (screenshot) await page.screenshot({ path: screenshot.replace(/(\.[^.]+)$/, '-migration$1'), fullPage: true });
    console.log(JSON.stringify({ ok: true, defaultGeneration: 2, v2CarrierFields: true, fixedNw2: true, migrationPath: true, responsive: [1280, 768, 375, 320] }));
  } finally {
    await browser.close();
  }
}

async function assertDialogResponsive(page, dialog, label) {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 768, height: 1024 }, { width: 375, height: 812 }, { width: 320, height: 720 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(80);
    const layout = await page.locator('html').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    if (layout.scrollWidth > layout.clientWidth) throw new Error(`${label} horizontal overflow at ${viewport.width}px`);
    const bounds = await dialog.boundingBox();
    if (!bounds || bounds.x < -1 || bounds.x + bounds.width > viewport.width + 1) throw new Error(`${label} dialog overflow at ${viewport.width}px`);
  }
}

main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
