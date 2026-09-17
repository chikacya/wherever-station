// Deterministic visual contract for the Command Grid across core pages.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
  const base = option('--url');
  const screenshotDir = option('--screenshot-dir');
  const readmeDir = option('--readme-dir');
  if (!base.startsWith('http://127.0.0.1:')) throw new Error('Supply --url http://127.0.0.1:PORT');
  if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
  if (readmeDir) fs.mkdirSync(readmeDir, { recursive: true });

  const places = [
    ['jp', 'Oracle 东京', 'Oracle', '日本', 'JP', '东京'],
    ['us', 'GCP 美西', 'Google Cloud', '美国', 'US', '美西'],
    ['sg', 'Oracle 新加坡', 'Oracle', '新加坡', 'SG', '新加坡'],
    ['my', 'Evoxt 马来西亚', 'Evoxt', '马来西亚', 'MY', '吉隆坡'],
    ['hk', 'VMISS 香港', 'VMISS', '香港', 'HK', '香港'],
    ['cn', '阿里云 北京', '阿里云', '中国', 'CN', '北京'],
  ];
  const machines = places.map(([id, name, provider, country, countryCode, region], index) => ({ id: `server-${id}`, name, provider, country, countryCode, region, tags: id === 'jp' ? ['主控'] : ['自用'], monitorClientId: `agent-${id}`, trafficPlan: index < 3 ? { enabled: true, limitBytes: (80 + index * 40) * 1024 ** 3, accounting: index === 2 ? 'max' : 'sum', resetDay: index + 1, warningLevels: [70, 90, 100] } : { enabled: false, limitBytes: 0, accounting: 'sum', resetDay: 1, warningLevels: [70, 90, 100] } }));
  const clients = Object.fromEntries(places.map(([id, name], index) => [`agent-${id}`, { uuid: `agent-${id}`, name, ipv4: `203.0.113.${10 + index}`, mem_total: 2 * 1024 ** 3, disk_total: 40 * 1024 ** 3, traffic_limit: index < 3 ? (80 + index * 40) * 1024 ** 3 : 0, traffic_limit_type: index === 2 ? 'max' : 'sum' }]));
  const statuses = Object.fromEntries(places.map(([id], index) => [`agent-${id}`, { online: id !== 'cn', cpu: 8 + index * 7.3, ram: (420 + index * 120) * 1024 ** 2, ram_total: 2 * 1024 ** 3, disk: (7 + index * 3) * 1024 ** 3, disk_total: 40 * 1024 ** 3, net_in: 26000 + index * 12500, net_out: 12000 + index * 9100, net_total_down: (9 + index * 4) * 1024 ** 3, net_total_up: (4 + index * 3) * 1024 ** 3 }]));
  const nodes = [...places.flatMap(([id], index) => Array.from({ length: index % 3 + 1 }, (_, nodeIndex) => ({ id: `node-${id}-${nodeIndex}`, name: `${id.toUpperCase()} ${nodeIndex + 1}`, protocol: nodeIndex % 2 ? 'nowhere' : 'vless', machineId: `server-${id}`, uri: `vless://id@203.0.113.${10 + index}:${20000 + nodeIndex}#node`, enabled: true, tags: [], source: 'manual', sourceId: '' }))), { id: 'node-external-nl', name: '🇳🇱 Amsterdam Premium 01', protocol: 'vless', machineId: '', uri: 'vless://id@nl1.example.com:443#Amsterdam', enabled: true, tags: [], source: 'external', sourceId: 'source-main' }];
  const managedInstances = [
    { id: 'managed-nowhere', kind: 'nowhere', name: '日本 · Nowhere', machineId: 'server-jp', nodeId: nodes[0].id, publicHost: '203.0.113.10', port: 2078, version: 'v1.8.3', network: 'mix', listenHost: '0.0.0.0', status: 'running', updatedAt: '2026-09-12T10:00:00Z', certificateId: 'cert-visual000000001', certificateMode: 'managed' },
    { id: 'managed-sing', kind: 'sing-box', name: '美国 · Reality', machineId: 'server-us', nodeId: nodes[1].id, publicHost: '203.0.113.11', port: 20888, version: '1.12.0', protocol: 'vless-reality', listenHost: '0.0.0.0', status: 'stopped', updatedAt: '2026-09-12T10:00:00Z' },
  ];
  const subscriptions = [{ id: 'sub-main', name: '日常节点', token: 'visual-token', nodeIds: nodes.slice(0, 5).map(item => item.id), groups: [], ruleSetIds: [], devices: [], enabled: true, expiresAt: '', policyMode: 'proxy-all', customRules: [] }];
  const externalSources = [{ id: 'source-main', name: '机场订阅', url: 'https://example.com/subscription/token', nodeIds: nodes.slice(5, 8).map(item => item.id), refreshIntervalHours: 24, enabled: true, lastSyncAt: '2026-09-12T10:00:00Z', traffic: { upload: 8 * 1024 ** 2, download: 174 * 1024 ** 2, total: 512 * 1024 ** 3, expire: 1799596800 } }];
  const providers = [{ id: 'provider-main', name: 'GCP 2S-UI', type: '2s-ui', baseUrl: 'https://panel.example.com', enabled: true, inboundCount: 2, clientCount: 2, lastSuccessAt: '2026-09-12T10:00:00Z', lastSyncAt: '2026-09-12T10:00:00Z', clients: [] }];
  const certificates = [{ id: 'cert-visual000000001', name: '日本 · 稳定证书', machineId: 'server-jp', mode: 'instance', certificatePath: '/var/lib/proxy-console/instances/managed-nowhere/server.crt', privateKeyPath: '/var/lib/proxy-console/instances/managed-nowhere/server.key', subjectName: 'jp.example.com', sans: ['jp.example.com'], status: 'valid', fingerprintSha256: 'a'.repeat(64), publicKeySha256: Buffer.alloc(32, 1).toString('base64'), validFrom: '2026-01-01T00:00:00Z', expiresAt: '2028-01-01T00:00:00Z', checkedAt: '2026-09-12T10:00:00Z' }];
  const state = { version: 14, revision: 1, settings: { publicBaseUrl: '', monitoring: { cpuPercent: 85, memoryPercent: 90, diskPercent: 90 } }, machines, nodes, nodeDrafts: [], subscriptions, externalSources, ruleSets: [], serviceBindings: [], deploymentPresets: [], providers, managedInstances, certificates };
  const instanceStates = [
    { instanceId: 'managed-nowhere', machineId: 'server-jp', state: 'active', pid: 2314, observedAt: new Date().toISOString(), telemetry: { source: 'ipc', lifecycle: 'READY', upBytesPerSecond: 18432, downBytesPerSecond: 32768, cpuPercent: 1.2, rssBytes: 52 * 1024 ** 2 } },
    { instanceId: 'managed-sing', machineId: 'server-us', state: 'inactive', observedAt: new Date().toISOString(), telemetry: { source: 'systemd' } },
  ];
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('**/api/rpc2', async route => {
      const request = route.request().postDataJSON();
      let result = {};
      if (request.method === 'proxyConsole:getState') result = state;
      else if (request.method === 'common:getNodes') result = clients;
      else if (request.method === 'common:getNodesLatestStatus') result = statuses;
      else if (request.method === 'public:getMe') result = { two_factor_enabled: false };
      else if (request.method === 'public:queryMetrics') {
        const keys = request.params?.metric_keys || [];
        const ids = request.params?.entity_ids || [];
        result = { series: ids.flatMap((id, entityIndex) => keys.map((metric_key, metricIndex) => ({ entity_id: id, metric_key, retention_days: 30, points: Array.from({ length: 24 }, (_, index) => ({ timestamp: Date.now() - (23 - index) * 3600000, value: metric_key === 'cpu.usage' ? 6 + entityIndex * 3 + Math.sin(index / 2) * 3 : (metricIndex + 1) * 9000 + index * 720 + Math.sin(index) * 2300 })) }))) };
      }
      else if (request.method === 'proxyConsole:listManagedTasks') result = [];
      else if (request.method === 'proxyConsole:listInstanceStates') result = instanceStates;
      else if (request.method === 'proxyConsole:statusCommand') result = { command: 'true' };
      else if (request.method === 'admin:exec') result = { task_id: 'visual-status' };
      else if (request.method === 'admin:getSpecificTaskResult') result = { exit_code: 0, result: 'PCSTATES\t1\teyJzdGF0ZXMiOltdfQ==' };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
    });
    await page.goto(`${base}/admin.html`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '基础设施控制台' }).waitFor();
    if (await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme) !== 'light') throw new Error('Standalone auto theme should follow the light OS test context');
    const guidanceBounds = await page.locator('.page-head p').evaluateAll(elements => elements.map(element => element.getBoundingClientRect()).map(rect => ({ width: rect.width, height: rect.height })));
    if (guidanceBounds.some(rect => rect.width > 1 || rect.height > 1)) throw new Error(`Page guidance should remain visually hidden: ${JSON.stringify(guidanceBounds)}`);
    const routeMotion = await page.locator('.route-view').evaluate(element => getComputedStyle(element).animationName);
    if (routeMotion !== 'route-enter') throw new Error(`Route transition is missing: ${routeMotion}`);
    const overviewMotion = await page.locator('.fleet-hero-grid > article').evaluateAll(elements => elements.map(element => ({ name: getComputedStyle(element).animationName, delay: getComputedStyle(element).animationDelay })));
    if (overviewMotion.some(item => item.name !== 'bento-reveal')) throw new Error(`Overview Bento reveal is missing: ${JSON.stringify(overviewMotion)}`);
    if (new Set(overviewMotion.map(item => item.delay)).size !== overviewMotion.length) throw new Error(`Overview Bento reveal is not staggered: ${JSON.stringify(overviewMotion)}`);
    await page.locator('.selected-server-trend').waitFor();
    if (await page.locator('.selected-trend-grid .spark').count() !== 3) throw new Error('Selected server history should contain download, upload and CPU trends');
    await page.locator('.traffic-plan-glance').click();
    const trafficPlanDialog = page.locator('dialog[open]').filter({ hasText: '流量计划' });
    await trafficPlanDialog.waitFor();
    if (!(await trafficPlanDialog.getByText('已同步', { exact: true }).count())) throw new Error('Komari traffic limit sync state is missing');
    for (const width of [1440, 375, 280]) {
      await page.setViewportSize({ width, height: 820 }); await page.waitForTimeout(40);
      const layout = await page.locator('html').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      if (layout.scrollWidth > layout.clientWidth) throw new Error(`Traffic plan dialog has horizontal overflow at ${width}px`);
      if (screenshotDir && [1440, 375].includes(width)) await page.screenshot({ path: path.join(screenshotDir, `traffic-plan-light-${width}.png`), fullPage: true });
    }
    await trafficPlanDialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.waitForTimeout(240);
    if (readmeDir) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: path.join(readmeDir, 'overview-light.png') });
    }
    const results = [];
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 900 }, { width: 375, height: 812 }, { width: 320, height: 720 }, { width: 280, height: 720 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(80);
      const layout = await page.locator('html').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      if (layout.scrollWidth > layout.clientWidth) throw new Error(`Horizontal overflow at ${viewport.width}px`);
      const cards = await page.locator('.server-index-list > button').count();
      if (cards !== machines.length) throw new Error(`Expected ${machines.length} server index rows, received ${cards}`);
      if (await page.locator('.selected-server-card').count() !== 1) throw new Error('Selected server workspace is missing');
      if (await page.locator('.service-observatory').count() !== 2) throw new Error('Paired service observatory cards are missing');
      if (await page.locator('.fleet-hero-grid').count() !== 1) throw new Error('Fleet hero layout is missing');
      const summary = await page.locator('.summary').evaluateAll(elements => elements.map(element => ({ width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height) })));
      if (summary.some(item => item.width < 120 || item.height < 64)) throw new Error(`Collapsed summary module at ${viewport.width}px: ${JSON.stringify(summary)}`);
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `dashboard-light-${viewport.width}.png`), fullPage: true });
      results.push({ viewport: viewport.width, summary, cards });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.server-index-list > button').nth(1).click();
    await page.locator('.selected-server-title').getByText('GCP 美西', { exact: true }).waitFor();
    const themeButton = page.getByRole('button', { name: /切换主题/ });
    await themeButton.click();
    await themeButton.click();
    await page.waitForTimeout(180);
    if (await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme) !== 'dark') throw new Error('Explicit dark theme was not applied');
    const darkColors = await page.locator('.server-index-list > button[aria-pressed="true"]').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color, primarySoft: getComputedStyle(element).getPropertyValue('--primary-soft'), rootClass: document.documentElement.className, shellClass: document.querySelector('.app-shell').className }));
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'dashboard-dark-1440.png'), fullPage: true });
    if (readmeDir) await page.screenshot({ path: path.join(readmeDir, 'overview-dark.png') });
    await page.setViewportSize({ width: 375, height: 812 });
    const darkLayout = await page.locator('html').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    if (darkLayout.scrollWidth > darkLayout.clientWidth) throw new Error('Dark mobile theme has horizontal overflow');
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'dashboard-dark-375.png'), fullPage: true });
    await themeButton.click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const pages = [
      ['节点', '.node-library'],
      ['订阅', '.station-card-grid .sub-card'],
      ['订阅源', '.station-card-grid .source-card'],
      ['部署节点', '.managed-card'],
      ['外部面板', '.provider-card'],
    ];
    const pageResults = [];
    for (const [label, selector] of pages) {
      await page.locator('.nav').getByRole('button', { name: label, exact: true }).click();
      await page.locator(selector).first().waitFor();
      for (const width of [1440, 375, 280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(50);
        const layout = await page.locator('html').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
        if (layout.scrollWidth > layout.clientWidth) throw new Error(`${label} has horizontal overflow at ${width}px`);
        if (screenshotDir && width === 280) await page.screenshot({ path: path.join(screenshotDir, `${label}-light-280.png`), fullPage: true });
      }
      if (screenshotDir) {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: path.join(screenshotDir, `${label}-light-1440.png`), fullPage: true });
      }
      if (readmeDir && (label === '节点' || label === '部署节点')) {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: path.join(readmeDir, label === '节点' ? 'nodes-light.png' : 'deploy-light.png') });
      }
      pageResults.push(label);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.nav').getByRole('button', { name: '订阅', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const subscriptionDialog = page.locator('dialog[open]').filter({ hasText: '编辑订阅' });
    await subscriptionDialog.waitFor();
    await page.waitForTimeout(340);
    const dragSource = subscriptionDialog.locator('.palette-node').first();
    const dragBox = await dragSource.locator('.drag-handle').boundingBox();
    if (!dragBox) throw new Error('Subscription drag source is missing');
    const pointer = { x: dragBox.x + dragBox.width / 2 - 80, y: dragBox.y + dragBox.height / 2 - 30 };
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(pointer.x, pointer.y, { steps: 4 });
    await page.locator('.drag-overlay').waitFor();
    const overlayBox = await page.locator('.drag-overlay').boundingBox();
    if (!overlayBox || Math.hypot(pointer.x - (overlayBox.x + overlayBox.width / 2), pointer.y - (overlayBox.y + overlayBox.height / 2)) > 150) throw new Error(`Drag overlay is detached from pointer: ${JSON.stringify({ pointer, overlayBox })}`);
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(240);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const groupDialog = page.locator('dialog[open]').filter({ hasText: '编辑订阅' });
    await groupDialog.waitFor();
    await groupDialog.getByRole('button', { name: '🇳🇱 NL', exact: true }).click();
    await groupDialog.locator('.editor-tabs button').nth(1).click();
    await groupDialog.getByRole('button', { name: '按国家生成', exact: true }).click();
    if (!(await groupDialog.locator('.group-card input').evaluateAll(elements => elements.some(element => element.value === '🇳🇱 NL')))) throw new Error('External subscription country was not included in generated proxy groups');
    await groupDialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.waitForTimeout(240);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.nav').getByRole('button', { name: '部署节点', exact: true }).click();
    await page.locator('.nowhere-launch').waitFor();
    if (await page.locator('.deploy-launch-card').count() !== 5) throw new Error('Deploy launch Bento is incomplete');
    const deployMotion = await page.locator('.deploy-launch-card').evaluateAll(elements => elements.map(element => ({ name: getComputedStyle(element).animationName, delay: getComputedStyle(element).animationDelay })));
    if (deployMotion.some(item => item.name !== 'bento-reveal')) throw new Error(`Deploy Bento reveal is missing: ${JSON.stringify(deployMotion)}`);
    if (new Set(deployMotion.map(item => item.delay)).size < 3) throw new Error(`Deploy Bento reveal is not progressively staged: ${JSON.stringify(deployMotion)}`);
    if ((await page.locator('.nowhere-launch').getAttribute('disabled')) !== null) throw new Error('Nowhere primary deployment path is unexpectedly disabled');
    await page.locator('.certificate-launch').click();
    const certificateDialog = page.locator('dialog[open]').filter({ hasText: '证书工作台' });
    await certificateDialog.waitFor();
    if (await certificateDialog.locator('.certificate-card').count() !== 1) throw new Error('Certificate asset card is missing');
    for (const width of [1440, 375, 280]) {
      await page.setViewportSize({ width, height: 850 }); await page.waitForTimeout(40);
      const layout = await page.locator('html').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      if (layout.scrollWidth > layout.clientWidth) throw new Error(`Certificate workbench has horizontal overflow at ${width}px`);
      if (screenshotDir && [1440, 375].includes(width)) await page.screenshot({ path: path.join(screenshotDir, `certificate-workbench-light-${width}.png`), fullPage: true });
    }
    await certificateDialog.getByRole('button', { name: '关闭', exact: true }).last().click();
    await page.waitForTimeout(240); await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '管理预设', exact: true }).click();
    const presetDialog = page.locator('dialog[open]').filter({ hasText: '快捷预设' });
    await presetDialog.waitFor();
    const enterDuration = await presetDialog.evaluate(element => getComputedStyle(element).animationDuration);
    if (enterDuration !== '0.3s') throw new Error(`Dialog enter duration is not calibrated: ${enterDuration}`);
    await presetDialog.getByRole('button', { name: '关闭', exact: true }).click();
    if (!(await presetDialog.evaluate(element => element.classList.contains('closing')))) throw new Error('Dialog exit state was not applied');
    await page.waitForTimeout(100);
    if (!(await presetDialog.evaluate(element => element.open))) throw new Error('Dialog closed before its exit motion completed');
    await page.waitForTimeout(140);
    if (await page.locator('dialog[open]').count()) throw new Error('Dialog remained open after its exit motion');
    console.log(JSON.stringify({ ok: true, themes: ['light', 'dark'], darkColors, modules: machines.length + 8, results, pages: pageResults }));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
