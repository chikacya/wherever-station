const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const failures = [];

const forbiddenPaths = [
  /(^|\/)\.deployment\//,
  /(^|\/)all[_-]?vps/i,
  /(^|\/)seed(?:\.|$)/i,
  /(^|\/)(?:credentials?|secrets?)(?:\.|\/|$)/i,
  /\.(?:key|pem|p12|pfx)$/i,
];
const sensitiveContent = [
  [/ghp_[A-Za-z0-9]{20,}/, "GitHub personal access token"],
  [/github_pat_[A-Za-z0-9_]{20,}/, "GitHub fine-grained token"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/, "private key"],
  [/(?:^|\s)sk-[A-Za-z0-9_-]{24,}/, "API key"],
  [/\/(?:Users|home)\/[A-Za-z0-9._-]+\/(?:Downloads|Desktop)\//, "personal absolute path"],
];

for (const filename of tracked) {
  if (forbiddenPaths.some((pattern) => pattern.test(filename))) {
    failures.push(`forbidden tracked path: ${filename}`);
    continue;
  }
  const absolute = path.join(root, filename);
  if (!fs.existsSync(absolute)) continue;
  const buffer = fs.readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  for (const [pattern, label] of sensitiveContent) {
    if (pattern.test(text)) failures.push(`${label} pattern in ${filename}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`public tree check passed (${tracked.length} tracked files)`);
