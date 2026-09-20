const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const runtime = readJson("package.json");
const frontend = readJson("frontend/package.json");
const manifest = readJson("komari-plugin.json");
const compatibility = readJson("tools/nowhere-compatibility.json");
const expectedTag = String(process.argv[2] || process.env.RELEASE_TAG || "").trim();

const failures = [];
const fail = (message) => failures.push(message);
const versions = new Set([runtime.version, frontend.version, manifest.version]);
if (versions.size !== 1) fail(`version mismatch: ${[...versions].join(", ")}`);
if (!/^\d+\.\d+\.\d+$/.test(runtime.version)) fail(`invalid semantic version: ${runtime.version}`);
if (expectedTag && expectedTag !== `v${runtime.version}`) fail(`tag ${expectedTag} does not match v${runtime.version}`);
if (runtime.license !== "GPL-3.0-only" || frontend.license !== "GPL-3.0-only") fail("package license must be GPL-3.0-only");

const requiredFiles = [
  "LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.zh-CN.md",
  "README.md", "README.zh-CN.md", "SECURITY.md", "install.sh", "pages/admin.html", "tools/nowhere-compatibility.json",
  ...["QUICKSTART", "DEPLOYMENT", "USER_GUIDE", "CAPABILITIES", "PROTOCOLS", "NOWHERE", "TROUBLESHOOTING", "LICENSING"]
    .flatMap((name) => [`docs/${name}.md`, `docs/${name}.zh-CN.md`]),
];
for (const required of requiredFiles) {
  if (!fs.existsSync(path.join(root, required))) fail(`missing release file: ${required}`);
}
if (fs.existsSync(path.join(root, "LICENSE")) && !fs.readFileSync(path.join(root, "LICENSE"), "utf8").includes("GNU GENERAL PUBLIC LICENSE")) fail("LICENSE is not the GNU GPL text");

const adminHtmlPath = path.join(root, "pages/admin.html");
if (fs.existsSync(adminHtmlPath)) {
  const adminHtml = fs.readFileSync(adminHtmlPath, "utf8");
  const scriptSource = adminHtml.match(/<script[^>]+src=["']\.\/([^"']+\.js)["']/)?.[1];
  if (!scriptSource) fail("built admin page is missing its JavaScript bundle");
  else {
    const scriptPath = path.join(root, "pages", scriptSource);
    if (!fs.existsSync(scriptPath)) fail(`built admin bundle is missing: pages/${scriptSource}`);
    else if (!fs.readFileSync(scriptPath, "utf8").includes(runtime.version)) fail(`built admin bundle does not contain release version ${runtime.version}; rebuild the frontend after bumping versions`);
  }
}

if (compatibility.schemaVersion !== 2 || !Array.isArray(compatibility.adapters) || compatibility.adapters.length < 1) fail("invalid Nowhere compatibility catalog");
const adapterIds = new Set();
const verifiedVersions = new Set();
for (const adapter of compatibility.adapters || []) {
  if (!adapter.id || adapterIds.has(adapter.id)) fail(`duplicate or missing adapter id: ${adapter.id || "(empty)"}`);
  adapterIds.add(adapter.id);
  if (adapter.generation !== 2 || adapter.major !== 2) fail(`invalid generation for ${adapter.id}`);
  if (!Array.isArray(adapter.verifiedVersions) || !adapter.verifiedVersions.length) fail(`empty verified version list for ${adapter.id}`);
  for (const version of adapter.verifiedVersions || []) {
    if (verifiedVersions.has(version)) fail(`version appears in multiple adapters: ${version}`);
    verifiedVersions.add(version);
  }
}

if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exit(1);
}
console.log(`release metadata valid: v${runtime.version} · ${compatibility.adapters.length} Nowhere adapters · GPL-3.0-only`);
