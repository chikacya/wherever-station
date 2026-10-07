// Read-only browser checks: every RPC is intercepted, and no Agent task is sent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { chromium } = require('playwright');
const repo = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
const base = option('--url');
const baseline = path.resolve(option('--baseline') || path.join(repo, 'artifacts/performance/baseline/pages'));
if (!base.startsWith('http://127.0.0.1:')) throw new Error('Supply a local --url');
const state = {
  version: 14, revision: 1, settings: { monitoring: {} },
  machines: [{ id: 'machine', name: 'Performance fixture', monitorClientId: 'agent', tags: [] }],
  nodes: [], nodeDrafts: [], subscriptions: [], externalSources: [], ruleSets: [], serviceBindings: [],
  managedInstances: [], certificates: [], deploymentPresets: [], providers: [],
};
async function measure(browser, url, directory, checkBehavior) {
  const page = await browser.newPage();
  const errors = [];
  const calls = [];
  const requestedScripts = new Set();
  page.on("request", request => { const pathname = new URL(request.url()).pathname; if (pathname.endsWith(".js")) requestedScripts.add(pathname); });
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.route('**/api/rpc2', async route => {
    const request = route.request().postDataJSON();
    calls.push(request.method);
    let result = {};
    if (request.method === 'proxyConsole:getState') result = state;
    else if (request.method === 'common:getNodes') result = { agent: { uuid: 'agent', name: 'Performance fixture', ipv4: '192.0.2.1' } };
    else if (request.method === 'common:getNodesLatestStatus') result = { agent: { online: true, cpu: 10 } };
    else if (request.method === 'public:getMe') result = { two_factor_enabled: false };
    else if (request.method === 'public:queryMetrics') result = { series: [] };
    else if (request.method === 'proxyConsole:statusCommand') result = { command: 'fixture-only' };
    else if (request.method === 'admin:exec') result = { task_id: 'mock-task' };
    else if (request.method === 'admin:getSpecificTaskResult') result = { exit_code: 0, result: 'PCSTATES\t1\t' + Buffer.from(JSON.stringify({ states: [] })).toString('base64') };
    else if (request.method === 'proxyConsole:listManagedTasks' || request.method === 'proxyConsole:listInstanceStates') result = [];
    await new Promise(resolve => setTimeout(resolve, 80));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
  });
  await page.goto(url + '/admin.html', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '基础设施控制台' }).waitFor();
  const scripts = [...requestedScripts];
  const bytes = scripts.map(file => fs.readFileSync(path.join(directory, path.basename(path.dirname(file)), path.basename(file))));
  const measurement = {
    scriptFiles: scripts.map(file => path.basename(file)),
    jsBytes: bytes.reduce((sum, value) => sum + value.length, 0),
    gzipJsBytes: bytes.reduce((sum, value) => sum + zlib.gzipSync(value).length, 0),
    initialStatusReads: calls.filter(method => method === 'common:getNodesLatestStatus').length,
  };
  if (checkBehavior) {
    assert(!scripts.some(file => /NodesPage|SubscriptionsPage|DeployPage|SettingsDialog|DiscoveryDialog|drag-drop|table-|qrcode-/.test(file)), 'unused feature code was loaded on the first page');
    assert.equal(measurement.initialStatusReads, 1, 'initial metrics must not be fetched twice');
    await page.evaluate(() => {
      window.__hiddenForTest = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hiddenForTest });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const before = calls.length;
    await page.clock.fastForward(60000);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(calls.length, before, 'hidden pages kept polling');
    await page.evaluate(() => { window.__hiddenForTest = false; document.dispatchEvent(new Event('visibilitychange')); });
    await new Promise(resolve => setTimeout(resolve, 500));
    assert(calls.filter(method => method === 'common:getNodesLatestStatus').length > measurement.initialStatusReads, 'foreground did not refresh');
    await page.locator('.nav').getByRole('button', { name: '节点', exact: true }).click();
    await page.getByRole('button', { name: '导入节点', exact: true }).waitFor();
    const afterSwitch = calls.filter(method => method === 'common:getNodesLatestStatus' || method === 'admin:exec').length;
    await page.clock.fastForward(30000);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(calls.filter(method => method === 'common:getNodesLatestStatus' || method === 'admin:exec').length, afterSwitch, 'server polling continued on the node page');
    const loadedNodes = [...requestedScripts].some(file => file.includes('NodesPage-'));
    assert(loadedNodes, 'node page was not loaded on navigation');
    measurement.hiddenPollingPaused = true;
    measurement.routePollingStopped = true;
    measurement.lazyNavigationPassed = true;
  }
  assert.deepEqual(errors, [], 'browser runtime errors');
  await page.close();
  return measurement;
}
async function main() {
  const browser = await chromium.launch();
  let server;
  try {
    const optimized = await measure(browser, base, path.join(repo, 'pages'), true);
    let previous;
    if (fs.existsSync(path.join(baseline, 'admin.html'))) {
      server = http.createServer((req, res) => {
        const file = path.resolve(baseline, '.' + new URL(req.url, 'http://localhost').pathname);
        if (!file.startsWith(baseline + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      previous = await measure(browser, `http://127.0.0.1:${server.address().port}`, baseline, false);
      assert(optimized.jsBytes < previous.jsBytes * .75, 'initial JavaScript savings below 25%');
    }
    const result = { ok: true, optimized, ...(previous ? { baseline: previous, reductionPercent: Math.round((1 - optimized.jsBytes / previous.jsBytes) * 100) } : {}) };
    fs.mkdirSync(path.join(repo, 'artifacts/performance'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'artifacts/performance/browser-evidence.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { if (server) server.close(); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
