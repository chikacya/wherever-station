// Authenticated, read-only page measurements. Reports contain timings and counts only.
const fs = require('node:fs');
const path = require('node:path');
const { request, chromium } = require('playwright');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
const base = option('--url').replace(/\/$/, '');
const credentials = option('--credentials');
const output = option('--output');
if (!base.startsWith('https://') || !credentials || !output) throw Error('Supply --url HTTPS_URL --credentials FILE --output JSON');
async function main() {
  const text = fs.readFileSync(credentials, 'utf8');
  const value = name => text.split(/\r?\n/).find(line => line.startsWith(name))?.replace(/^[^:：]*[:：]\s*/, '').trim();
  const api = await request.newContext({ baseURL: base });
  let browser;
  try {
    const login = await api.post('/api/login', { data: { username: value('用户名'), password: value('密码'), '2fa_code': '' } });
    if (!login.ok()) throw Error('Login failed: ' + login.status());
    browser = await chromium.launch();
    const storage = await api.storageState();
    const results = [];
    for (const profile of ['normal', 'constrained']) {
      const context = await browser.newContext({ storageState: storage });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      if (profile === 'constrained') {
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      }
      await page.addInitScript(() => {
        window.__pageMeasure = { longTasks: [], lcp: 0 };
        new PerformanceObserver(list => { for (const e of list.getEntries()) window.__pageMeasure.longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: true });
        new PerformanceObserver(list => { for (const e of list.getEntries()) window.__pageMeasure.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      });
      let bytes = 0;
      const cachedRequests = new Set();
      const resources = new Map();
      cdp.on('Network.responseReceived', ({ requestId, type, response }) => {
        resources.set(requestId, { type, cached: response.fromDiskCache || response.fromServiceWorker });
        if (response.fromDiskCache || response.fromServiceWorker) cachedRequests.add(requestId);
      });
      cdp.on('Network.requestServedFromCache', ({ requestId }) => cachedRequests.add(requestId));
      cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => { if (['Script','Stylesheet'].includes(resources.get(requestId)?.type)) bytes += encodedDataLength; });
      for (let iteration = 0; iteration < 4; iteration++) {
        bytes = 0; cachedRequests.clear(); resources.clear();
        if (iteration % 2 === 0) await cdp.send('Network.clearBrowserCache');
        const started = performance.now();
        await page.goto(base + '/api/admin/plugin/proxy-console/pages/admin.html', { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: '基础设施控制台' }).waitFor();
        await page.locator('.selected-server-card').first().waitFor();
        const readyMs = performance.now() - started;
        await page.waitForTimeout(350);
        const data = await page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          const paint = performance.getEntriesByName('first-contentful-paint')[0];
          const tasks = window.__pageMeasure.longTasks;
          return { ttfbMs: nav.responseStart, fcpMs: paint?.startTime || null, lcpMs: window.__pageMeasure.lcp,
            longTaskCount: tasks.length, longestTaskMs: Math.max(0, ...tasks), blockingTimeMs: tasks.reduce((sum,n)=>sum+Math.max(0,n-50),0),
            rpc: performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname==='/api/rpc2').map(e=>({ durationMs:e.duration, responseWaitMs:e.responseStart-e.requestStart })) };
        });
        const switched = performance.now();
        await page.locator('.nav').getByRole('button', { name: '节点', exact: true }).click();
        await page.getByRole('button', { name: '导入节点', exact: true }).waitFor();
        results.push({ profile, cache: iteration % 2 ? 'warm' : 'cold', iteration, readyMs: Math.round(readyMs), nodeNavigationMs: Math.round(performance.now()-switched), assetTransferBytes: Math.round(bytes), assetCacheHits: [...cachedRequests].filter(id => ["Script", "Stylesheet"].includes(resources.get(id)?.type)).length, ...data });
      }
      await context.close();
    }
    const html = await api.get('/api/admin/plugin/proxy-console/pages/admin.html');
    const body = await html.text();
    const script = body.match(/src="\.\/([^\"]+\.js)"/)?.[1];
    const asset = await api.get('/api/admin/plugin/proxy-console/pages/' + script);
    const header = asset.headers();
    const report = { measuredAt: new Date().toISOString(), note: 'Asset bytes and cache hits include default-page assets and the first navigation to Nodes. Ready means the default heading and first server card are visible; this is not a standardized TTI score. Constrained uses 1.6 Mbps, 100ms latency and 4x CPU slowdown.', assetHeaders: { cacheControl: header['cache-control'], encoding: header['content-encoding'] }, samples: results };
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)+'\n');
    console.log(JSON.stringify({ ok: true, output, samples: results.map(({rpc,...row})=>row), assetHeaders: report.assetHeaders }));
  } finally { if (browser) await browser.close(); await api.dispose(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
