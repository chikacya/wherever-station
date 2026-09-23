const test = require('node:test');
const assert = require('node:assert/strict');
const { subscriptionMachine, cycleStart, serverTraffic } = require('../tools/subscription-traffic');
const machine = { id: 'a', name: 'A', monitorClientId: 'agent' };
test('public downloads survive missing telemetry; fresh traffic is cached', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
  const root = path.resolve(__dirname, '..'), storage = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-traffic-'));
  let calls = 0, fail = false;
  const methods = new Map();
  const server = { route() {}, registerRPC(name, handler) { methods.set(name, handler); }, async call() {
    calls++; if (fail) throw Error('unavailable');
    return { agent: { time: new Date().toISOString(), net_total_up: 200, net_total_down: 300 } };
  } };
  const sandbox = { console, Buffer, setTimeout, clearTimeout, __dirname: root, __storageDir__: storage, require: name => name === 'server' ? server : require(name) };
  try {
    vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8'), sandbox); sandbox.load();
    assert.equal(sandbox.subscriptionUserinfo({ upload: 5, download: 7, total: 100, expire: 1800000000 }), 'upload=5; download=7; total=100; expire=1800000000');
    assert.equal(sandbox.subscriptionUserinfo({ upload: 5, download: 7, total: 0, expire: 0 }), 'upload=5; download=7');
    const state = sandbox.readState(); state.machines = [machine];
    state.nodes = [{ id: 'n', name: 'N', machineId: 'a', protocol: 'ss', uri: 'ss://' + Buffer.from('aes-128-gcm:password').toString('base64') + '@example.com:443', enabled: true }];
    state.subscriptions = [{ id: 's', name: 'S', token: 'a'.repeat(48), nodeIds: ['n'], quota: { mode: 'machine' }, enabled: true }];
    sandbox.saveState(state);
    assert.match((await methods.get('proxyConsole:getSubscriptionTraffic')()).s['machineName'], /A/);
    async function download() {
      const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
      await sandbox.publicSubscription({ url: '/proxy/sub/' + 'a'.repeat(48), query: { format: 'raw' }, headers: {} }, res);
      assert.equal(res.statusCode, 200); assert.match(res.body, /ss:\/\//); return res;
    }
    const userinfo = (await download()).headers['Subscription-Userinfo'];
    assert.equal(userinfo, 'upload=200; download=300');
    const withAllowance = sandbox.readState(); withAllowance.subscriptions[0].quota.totalBytes = 1000; sandbox.saveState(withAllowance);
    assert.equal((await download()).headers['Subscription-Userinfo'], 'upload=200; download=300; total=1000');
    await download(); assert.equal(calls, 2);
    vm.runInContext('SUBSCRIPTION_TRAFFIC_CACHE.clear()', sandbox); fail = true;
    assert.equal((await download()).headers['Subscription-Userinfo'], undefined);
  } finally { fs.rmSync(storage, { recursive: true, force: true }); }
});
test('traffic ownership covers groups, disabled nodes and unassigned nodes', () => {
  const nodes = [{ id: '1', machineId: 'a' }, { id: '2', machineId: 'b' }, { id: '3' }];
  const sub = { nodeIds: ['1'] };
  assert.equal(subscriptionMachine(sub, nodes, [machine]), machine);
  assert.equal(subscriptionMachine({ ...sub, groups: [{ entries: [{ kind: 'node', id: '2' }] }] }, nodes, [machine]), null);
  assert.equal(subscriptionMachine({ nodeIds: ['1', '3'] }, nodes, [machine]), null);
  assert.equal(subscriptionMachine({ nodeIds: [] }, nodes, [machine]), null);
  assert.equal(subscriptionMachine(sub, nodes, [{ ...machine, monitorClientId: '' }]), null);
  assert.equal(subscriptionMachine({ nodeIds: ['1', '2'] }, [nodes[0], { ...nodes[1], enabled: false }], [machine]), machine);
});
test('server counters degrade safely without complete cycle history', () => {
  const now = Date.parse('2026-09-01T00:15:00Z');
  const latest = { time: new Date(now).toISOString(), net_total_up: 150, net_total_down: 280 };
  const planned = { ...machine, trafficPlan: { enabled: true, limitBytes: 1000, resetDay: 1, accounting: 'sum' } };
  assert.equal(serverTraffic(planned, latest, [], now).basis, 'agent');
  assert.equal(serverTraffic(planned, latest, [], now).total, 0);
  assert.equal(serverTraffic(machine, latest, [], now + 121000), null);
  assert.equal(serverTraffic(machine, { ...latest, net_total_up: null }, [], now), null);
  const baseline = { time: '2026-09-01T00:00:00Z', net_total_up: 100, net_total_down: 200 };
  const result = serverTraffic(planned, latest, [baseline], now);
  assert.equal(result.upload, 50); assert.equal(result.download, 80); assert.equal(result.total, 1000);
  for (const [accounting, expected] of [['up', 50], ['down', 80], ['max', 80]]) {
    const traffic = serverTraffic({ ...planned, trafficPlan: { ...planned.trafficPlan, accounting } }, latest, [baseline], now);
    assert.equal(traffic.upload + traffic.download, expected);
  }
  assert.equal(serverTraffic(planned, { ...latest, net_total_up: 20 }, [baseline], now).upload, 20);
  const gap = { ...latest, time: '2026-09-01T01:00:00Z' };
  assert.equal(serverTraffic(planned, gap, [baseline], Date.parse(gap.time)).basis, 'agent');
  assert.equal(cycleStart(31, Date.parse('2026-03-01T00:00:00Z')), Date.parse('2026-02-28T00:00:00Z'));
});
