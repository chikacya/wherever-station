// Serve only compiled static assets; acceptance scripts mock every backend call.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../pages');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const name of ['visual-calibration', 'editor-workflows', 'nowhere-migration']) {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, `e2e-${name}.cjs`), '--url', `http://127.0.0.1:${server.address().port}`], { stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${name}: exit ${code}`)));
      });
    }
  } finally { server.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
