// Read-only live acceptance for a real multi-Agent Komari installation.
// It queries metrics and service status only; it never invokes lifecycle RPCs.
const fs = require('node:fs');
const { request } = require('playwright');

const percentile = (values, ratio) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * ratio))];

async function main() {
  const args = process.argv.slice(2);
  const opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
  const base = opt('--url').replace(/\/$/, '');
  const credential = opt('--credentials');
  const inventory = opt('--inventory');
  if (!base.startsWith('https://') || !fs.existsSync(credential) || !fs.existsSync(inventory)) throw new Error('Supply --url, --credentials and --inventory');
  const text = fs.readFileSync(credential, 'utf8');
  const value = name => text.split(/\r?\n/).find(line => line.startsWith(name))?.replace(/^[^:：]*[:：]\s*/, '').trim();
  const expected = JSON.parse(fs.readFileSync(inventory, 'utf8')).clients;
  const api = await request.newContext({ baseURL: base });
  const rpc = async (method, params = {}) => {
    const started = performance.now();
    const response = await api.post('/api/rpc2', { data: { jsonrpc: '2.0', id: Date.now() + Math.random(), method, params } });
    const body = await response.json();
    if (body.error) throw new Error(body.error.message);
    return { result: body.result, ms: performance.now() - started };
  };
  const waitTask = async (taskId, uuid) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const { result } = await rpc('admin:getSpecificTaskResult', { task_id: taskId, uuid });
        if (result.exit_code !== null && result.exit_code !== undefined) return result;
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('service snapshot timed out');
  };
  try {
    const login = await api.post('/api/login', { data: { username: value('用户名'), password: value('密码'), '2fa_code': '' } });
    if (!login.ok()) throw new Error(`login failed (${login.status()})`);
    const { result: nodes } = await rpc('common:getNodes');
    const offline = expected.filter(item => !nodes[item.uuid]?.uuid).map(item => item.name);
    if (offline.length) throw new Error(`offline Agents: ${offline.join(', ')}`);
    const { result: state } = await rpc('proxyConsole:getState');
    if (state.machines.length !== expected.length) throw new Error(`expected ${expected.length} bound hosts, received ${state.machines.length}`);
    const timings = [];
    for (let round = 0; round < 8; round += 1) {
      const batch = await Promise.all(Array.from({ length: 8 }, (_, index) => rpc(index % 2 ? 'common:getNodesLatestStatus' : 'proxyConsole:getState')));
      timings.push(...batch.map(item => item.ms));
    }
    const { result: spec } = await rpc('proxyConsole:statusCommand');
    const { result: task } = await rpc('admin:exec', { command: spec.command, clients: expected.map(item => item.uuid), two_factor_code: '' });
    const started = performance.now();
    const snapshots = await Promise.all(expected.map(async item => {
      const result = await waitTask(task.task_id, item.uuid);
      if (Number(result.exit_code) !== 0) throw new Error(`${item.name} status command failed`);
      const line = String(result.result || '').split(/\r?\n/).find(row => row.startsWith('PCSTATES\t1\t'));
      if (!line) throw new Error(`${item.name} returned no service snapshot`);
      const payload = JSON.parse(Buffer.from(line.slice('PCSTATES\t1\t'.length), 'base64').toString());
      return { name: item.name, states: payload.states.length };
    }));
    console.log(JSON.stringify({
      ok: true,
      agents: expected.length,
      hosts: state.machines.length,
      samples: timings.length,
      rpcMs: { p50: Math.round(percentile(timings, 0.50)), p95: Math.round(percentile(timings, 0.95)), max: Math.round(Math.max(...timings)) },
      statusBatchMs: Math.round(performance.now() - started),
      statusAgents: snapshots.length,
      rpcErrors: 0,
    }));
  } finally {
    await api.dispose();
  }
}

main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
