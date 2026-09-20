// Local responsive UI check with deterministic read-only RPC fixtures.
const { chromium } = require('playwright');

async function main() {
  const args = process.argv.slice(2);
  const opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
  const base = opt('--url').replace(/\/$/, '');
  if (!base.startsWith('http://127.0.0.1:')) throw new Error('Supply --url http://127.0.0.1:PORT');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(8000);
    const observed = { instanceId: 'nowhere-demo', machineId: 'jp', kind: 'nowhere', state: 'active', observedAt: '2026-09-08T15:00:00.000Z', pid: 202, telemetry: { source: 'local', lifecycle: 'READY', lifecycleReason: 'LISTENING', version: '2.0.2', upBytesPerSecond: 1024, downBytesPerSecond: 2048, tcpLogicalUp: '1048576', tcpLogicalDown: '2097152', udpLogicalUp: '0', udpLogicalDown: '0', tlsPayloadUp: '524288', tlsPayloadDown: '1048576', tcpActive: 2, udpActive: 1, tlsCarriersActive: 1, quicCarriersActive: 0, pingMs: 8, uptimeMs: 86400000, cpuPercent: 1.2, rssBytes: 12582912, openFds: 16 } };
    await page.route('**/api/rpc2', async route => {
      const request = route.request().postDataJSON();
      const results = {
        'proxyConsole:getState': { version: 14, revision: 0, settings: { publicBaseUrl: '', monitoring: {} }, machines: [{ id: 'jp', name: 'Oracle 东京', region: '东京', countryCode: 'JP', monitorClientId: 'oracle' }], nodes: [], subscriptions: [], externalSources: [], serviceBindings: [], managedInstances: [{ id: 'nowhere-demo', kind: 'nowhere', name: '东京 Nowhere', machineId: 'jp', version: 'v2.0.2', tcpPort: 2078, udpPort: 2078 }], deploymentPresets: [], providers: [] },
        'proxyConsole:listInstanceStates': [observed],
        'proxyConsole:listManagedTasks': [],
        'common:getNodes': { oracle: { name: 'Oracle 东京（主控）' } },
        'common:getNodesLatestStatus': {},
        'public:getMe': { two_factor_enabled: true },
      };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result: results[request.method] ?? {} }) });
    });
    await page.goto(`${base}/admin.html`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '部署节点', exact: true }).click();
    const telemetryEntry = page.getByRole('button', { name: '实时遥测', exact: true });
    await telemetryEntry.waitFor();
    await telemetryEntry.click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('.telemetry-refresh-control select').selectOption('5000');
    const results = [];
    for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 375, height: 812 }, { width: 320, height: 720 }]) {
      await page.setViewportSize(viewport);
      await dialog.scrollIntoViewIfNeeded();
      const [layout, bounds, columns] = await Promise.all([
        page.locator('html').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
        dialog.boundingBox(),
        dialog.locator('.telemetry-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length),
      ]);
      if (!bounds || layout.scrollWidth > layout.clientWidth || bounds.x < 0 || bounds.x + bounds.width > viewport.width + 1) {
        const offenders = await page.locator('body *').evaluateAll((elements) => elements.map(element => ({ tag: element.tagName, className: element.className?.baseVal || element.className || '', text: element.textContent?.trim().slice(0, 40), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })).filter(item => item.left < -1 || item.right > innerWidth + 1 || item.scrollWidth > item.clientWidth + 1).slice(-12));
        throw new Error(`Telemetry overflow at ${viewport.width}px: ${JSON.stringify({ layout, bounds, offenders })}`);
      }
      const expected = viewport.width <= 420 ? 1 : viewport.width <= 760 ? 2 : 4;
      if (columns !== expected) throw new Error(`Expected ${expected} telemetry columns at ${viewport.width}px, got ${columns}`);
      results.push({ viewport: viewport.width, dialogWidth: Math.round(bounds.width), columns });
    }
    console.log(JSON.stringify({ ok: true, results }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
