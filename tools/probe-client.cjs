// Real client probe. Does not modify system proxies or existing client processes.
// Input: a sing-box outbound/full subscription, or a file containing a vector:// URI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node tools/probe-client.cjs --input FILE --expected-ip IP [--tag TAG] [--binary PATH] [--kind sing-box|vector]');
    return;
  }
  const option = (name, fallback = '') => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : args[index + 1];
  };
  const input = option('--input');
  const expected = option('--expected-ip');
  const kind = option('--kind', 'sing-box');
  if (!input || !net.isIP(expected) || !['sing-box', 'vector'].includes(kind)) throw new Error('Provide --input, --expected-ip, and a valid --kind');
  const raw = fs.readFileSync(input, 'utf8').trim();
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wherever-probe-'));
  fs.chmodSync(directory, 0o700);
  let client;
  let closed;
  try {
    let commandArgs;
    const binary = option('--binary', kind === 'vector' ? 'nowhere' : 'sing-box');
    if (kind === 'vector') {
      const uri = new URL(raw);
      if (uri.protocol !== 'vector:') throw new Error('Vector probe requires a vector:// link');
      uri.searchParams.set('socks', `127.0.0.1:${port}`);
      commandArgs = [uri.toString()];
    } else {
      const source = JSON.parse(raw);
      const tag = option('--tag');
      const candidates = source.outbounds || [source];
      const proxies = candidates.filter(item => !['direct', 'block', 'dns', 'selector', 'urltest'].includes(item.type));
      const outbound = tag ? proxies.find(item => item.tag === tag) : proxies.length === 1 ? proxies[0] : null;
      if (!outbound || !outbound.server) throw new Error('Select exactly one proxy with --tag');
      if (outbound.detour) throw new Error('Probe requires a standalone outbound without detour');
      const config = {
        log: { level: 'error' },
        inbounds: [{ type: 'socks', tag: 'probe-in', listen: '127.0.0.1', listen_port: port }],
        outbounds: [{ ...outbound, tag: 'probe-out' }],
        route: { final: 'probe-out' },
      };
      const configPath = path.join(directory, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
      const checked = spawnSync(binary, ['check', '-c', configPath], { timeout: 10000, stdio: 'pipe' });
      if (checked.error || checked.status !== 0) throw new Error('Local client configuration check failed');
      commandArgs = ['run', '-c', configPath];
    }
    client = spawn(binary, commandArgs, { stdio: 'ignore' });
    let launchError;
    client.on('error', error => { launchError = error; });
    closed = new Promise(resolve => client.once('close', resolve));
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (launchError || client.exitCode !== null) throw new Error('Local client failed to start');
      ready = await new Promise(resolve => {
        const socket = net.connect({ host: '127.0.0.1', port });
        const finish = value => { socket.destroy(); resolve(value); };
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.setTimeout(200, () => finish(false));
      });
      if (ready) break;
      await delay(100);
    }
    if (!ready) throw new Error('Local SOCKS listener did not become ready');
    const curl = spawnSync('curl', [
      '--silent', '--show-error', '--fail', '--max-time', '25', '--noproxy', '',
      '--proxy', `socks5h://127.0.0.1:${port}`, 'https://www.cloudflare.com/cdn-cgi/trace',
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 65536 });
    if (curl.error || curl.status !== 0) throw new Error(`Proxy HTTPS request failed (curl status ${curl.status})`);
    const actual = curl.stdout.match(/^ip=(.+)$/m)?.[1]?.trim();
    if (actual !== expected) throw new Error('Proxy exit IP did not match the target VPS');
    console.log(JSON.stringify({ ok: true, client: kind, https: true, exitIpMatches: true }));
  } finally {
    if (client && client.exitCode === null && client.pid) {
      client.kill('SIGTERM');
      await Promise.race([closed, delay(2000)]);
      if (client.exitCode === null && client.signalCode === null) { client.kill('SIGKILL'); await closed; }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
