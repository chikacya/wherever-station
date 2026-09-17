// Read-only Wherever Station Provider acceptance against an isolated 2S-UI.
// The target panel is prepared separately; this script never writes to it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const args = process.argv.slice(2);
  const opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
  const baseUrl = opt('--url');
  const tokenFile = opt('--token-file');
  if (!/^https?:\/\//.test(baseUrl) || (!process.env.TWO_S_UI_TOKEN && (!tokenFile || !fs.existsSync(tokenFile)))) throw new Error('Supply --url and either --token-file or TWO_S_UI_TOKEN');
  const token = String(process.env.TWO_S_UI_TOKEN || fs.readFileSync(tokenFile, 'utf8')).trim();
  if (!token) throw new Error('2S-UI token file is empty');

  const root = path.resolve(__dirname, '..');
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'wherever-2s-ui-e2e-'));
  const methods = new Map();
  const fakeServer = { route() {}, registerRPC(name, handler) { methods.set(name, handler); } };
  const sandbox = {
    console, Buffer, URL, AbortController, setTimeout, clearTimeout,
    __storageDir__: storage, __dirname: root,
    require(name) { return name === 'server' ? fakeServer : require(name); },
  };
  try {
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8'), sandbox, { filename: 'script.js' });
    sandbox.load();
    const operate = async (action, input) => {
      const started = methods.get('proxyConsole:startProviderOperation')({ action, input });
      for (let attempt = 0; attempt < 200; attempt++) {
        const operation = methods.get('proxyConsole:getProviderOperation')({ operationId: started.operationId });
        if (operation.phase === 'completed') return operation.result;
        if (operation.phase === 'failed') throw new Error(operation.error);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`2S-UI ${action} timed out`);
    };

    const saved = methods.get('proxyConsole:saveProvider')({ provider: { name: '2S-UI acceptance', type: '2s-ui', baseUrl }, token });
    assert.equal(saved.state.providers[0].type, '2s-ui');
    assert.equal(JSON.stringify(saved.state).includes(token), false, 'API token leaked into public state');
    const providerId = saved.providerId;
    const tested = await operate('test', { providerId });
    assert.equal(tested.ok, true);
    assert.equal(tested.status.running, true);
    assert.equal(tested.inbounds, 1);
    assert.equal(tested.clients, 1);
    assert.equal(tested.links, 1);
    assert.equal(tested.clientRecords[0].upload, 1048576);
    assert.equal(tested.clientRecords[0].download, 2097152);
    assert.equal(tested.clientRecords[0].total, 10737418240);
    assert(tested.clientRecords[0].expire > Math.floor(Date.now() / 1000));

    const preview = await operate('preview', { providerId });
    assert.equal(JSON.stringify(preview.summary), JSON.stringify({ create: 1, update: 0, unchanged: 0, pending: 0, missing: 0, unsupported: 0 }));
    const applied = await operate('apply', { providerId, remoteIds: preview.candidates.map(item => item.remoteId) });
    assert.equal(applied.created, 1);
    const node = applied.state.nodes.find(item => item.sourceId === providerId);
    assert(node && node.protocol === 'vmess');
    assert.equal(node.machineId, '', 'Provider node must not require a VPS host');
    const provider = applied.state.providers.find(item => item.id === providerId);
    assert.match(provider.status, /^running:/);
    assert.equal(provider.clients[0].download, 2097152);
    console.log(JSON.stringify({ stage: '2s-ui-provider', ok: true, status: provider.status, candidates: preview.candidates.length, created: applied.created, quotaFields: true, hostIndependent: true }));
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(JSON.stringify({ stage: '2s-ui-provider', ok: false, error: error.message })); process.exitCode = 1; });
