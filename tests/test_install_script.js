const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const http = require("node:http");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "install.sh");
const source = fs.readFileSync(filename, "utf8");
const syntax = spawnSync("bash", ["-n", filename], { encoding: "utf8" });

assert.equal(syntax.status, 0, syntax.stderr || "install.sh must pass bash -n");
assert.match(source, /SHA256 verified/, "installer must verify the release checksum");
assert.match(source, /read -r -s/, "administrator password must be entered silently");
assert.doesNotMatch(source, /--password\b/, "installer must not accept passwords as command-line arguments");
assert.match(source, /node, allowRoutes and allowSystemRPC/, "installer must disclose requested permissions");
assert.match(source, /https:\/\/\*\|http:\/\/127\.0\.0\.1/, "remote installations must require HTTPS");
assert.match(source, /trap cleanup EXIT/, "temporary credentials must be cleaned on exit");

console.log("guided installer safety and syntax tests passed");

async function integration() {
  const archive = Buffer.from("synthetic Wherever Station release");
  const checksum = crypto.createHash("sha256").update(archive).digest("hex");
  let running = false;
  const server = http.createServer((request, response) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (request.method === "GET" && request.url === "/releases/latest") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ tag_name: "v0.66.11", assets: [
        { name: "wherever-station-0.66.11.zip", browser_download_url: `${base}/release.zip` },
        { name: "SHA256SUMS", browser_download_url: `${base}/SHA256SUMS` },
      ] }));
      return;
    }
    if (request.method === "GET" && request.url === "/release.zip") { response.end(archive); return; }
    if (request.method === "GET" && request.url === "/SHA256SUMS") {
      response.end(`${checksum}  wherever-station-0.66.11.zip\n`); return;
    }
    if (request.method === "POST" && request.url === "/api/login") { response.end("{}"); return; }
    if (request.method === "POST" && request.url === "/api/admin/upload/init") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: { upload_id: "synthetic-upload", chunk_size: 8 } }));
      return;
    }
    if (request.method === "POST" && ["/api/admin/upload/chunk", "/api/admin/upload/merge"].includes(request.url)) {
      response.end("{}"); return;
    }
    if (request.method === "POST" && request.url === "/api/rpc2") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        let result = {};
        if (body.method === "admin:listPlugins") result = [{ short: "proxy-console", version: "0.66.11", enabled: running, running }];
        if (body.method === "admin:setPluginEnabled") {
          if (body.params.enabled && !body.params.approved) result = { requires_approval: true };
          else { running = Boolean(body.params.enabled); result = { enabled: running }; }
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      });
      return;
    }
    response.statusCode = 404; response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn("bash", [filename, "--komari", `http://127.0.0.1:${port}`, "--username", "admin", "--yes"], {
        cwd: root,
        env: { ...process.env, KOMARI_PASSWORD: "synthetic-password", WHEREVER_RELEASE_API_BASE: `http://127.0.0.1:${port}/releases` },
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout)));
    });
    assert.match(output, /SHA256 verified/);
    assert.match(output, /0\.66\.11 is installed and running/);
    assert.equal(running, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

integration().then(() => console.log("guided installer integration test passed"));
