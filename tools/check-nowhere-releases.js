const fs = require("node:fs");
const { nowhereCapabilities } = require("./nowhere-capabilities");

function stableReleaseTags(input) {
  return [...new Set((Array.isArray(input) ? input : [])
    .filter((release) => release && release.draft !== true && release.prerelease !== true)
    .map((release) => String(release.tag_name || "").trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .filter((tag) => Number(tag.slice(1).split(".")[0]) >= 2))]
    .sort((left, right) => {
      const a = left.slice(1).split(".").map(Number);
      const b = right.slice(1).split(".").map(Number);
      return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
    });
}

function compatibilityReport(releases) {
  const entries = stableReleaseTags(releases).map((tag) => {
    const capabilities = nowhereCapabilities(tag);
    return { tag, adapter: capabilities.adapter, generation: capabilities.protocolGeneration, status: capabilities.verified ? "verified" : capabilities.supported ? "compatible-range" : "unknown-adapter" };
  });
  return { entries, pending: entries.filter((entry) => entry.status !== "verified") };
}

async function main() {
  const inputPath = process.argv.find((argument) => argument.startsWith("--input="))?.slice(8);
  const strict = process.argv.includes("--strict");
  const releases = inputPath
    ? JSON.parse(fs.readFileSync(inputPath, "utf8"))
    : await fetch("https://api.github.com/repos/NodePassProject/Nowhere/releases?per_page=50", { headers: { Accept: "application/vnd.github+json", "User-Agent": "wherever-station-compatibility-monitor" } }).then((response) => {
      if (!response.ok) throw new Error(`GitHub release request failed: ${response.status}`);
      return response.json();
    });
  const report = compatibilityReport(releases);
  const lines = ["## Nowhere compatibility report", "", "| Release | Adapter | Generation | Status |", "| --- | --- | ---: | --- |", ...report.entries.map((entry) => `| ${entry.tag} | ${entry.adapter || "—"} | ${entry.generation || "—"} | ${entry.status} |`)];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  if (strict && report.pending.length) {
    console.error(`Found ${report.pending.length} stable release(s) that require adapter verification.`);
    process.exitCode = 1;
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { compatibilityReport, stableReleaseTags };
