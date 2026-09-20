const PINNED_COMMIT = "a4cddbb57103c1e948bf281fd15c73af1fc04334";
const PINNED_SHA256 = "9b677b5ea06e1aabc9bc4757161ed2e2510b74df4581fa958c07e87da5435558";
const PREFIX = "PCIPPROFILE\t1\t";

function buildIpProfileCommand() {
  const url = `https://raw.githubusercontent.com/dy0422/ipcheck-plus/${PINNED_COMMIT}/ipcheck-plus.sh`;
  return [
    "set -eu",
    "work=$(mktemp -d /tmp/wherever-ipcheck.XXXXXX)",
    "trap 'rm -rf \"$work\"' EXIT",
    `curl -fsSL --connect-timeout 8 --max-time 20 '${url}' -o \"$work/check.sh\"`,
    `printf '%s  %s\\n' '${PINNED_SHA256}' \"$work/check.sh\" | sha256sum -c - >/dev/null`,
    "bash \"$work/check.sh\" -4 --timeout 6 --json \"$work/report.json\" --no-color >/dev/null",
    "printf 'PCIPPROFILE\\t1\\t'",
    "base64 -w0 \"$work/report.json\"",
    "printf '\\n'",
  ].join("\n");
}

function parseIpProfileOutput(output) {
  const line = String(output || "").split(/\r?\n/).find((item) => item.startsWith(PREFIX));
  if (!line) return { ok: false, error: "检测脚本没有返回结构化结果" };
  try {
    const value = JSON.parse(Buffer.from(line.slice(PREFIX.length), "base64").toString("utf8"));
    const results = Array.isArray(value.results) ? value.results.slice(0, 80).map((item) => ({
      category: String(item.category || "").slice(0, 24), name: String(item.name || "").slice(0, 80),
      status: String(item.status || "UNKNOWN").slice(0, 24), region: String(item.region || "").slice(0, 24),
      detail: String(item.detail || "").slice(0, 160),
    })) : [];
    return { ok: true, version: String(value.version || "").slice(0, 32), publicIp: String(value.public_ip || "").slice(0, 64), geo: String(value.geo || "").slice(0, 240), risk: String(value.risk || "").slice(0, 240), results };
  } catch (_) { return { ok: false, error: "检测脚本返回的数据无法解析" }; }
}

module.exports = { buildIpProfileCommand, parseIpProfileOutput, PINNED_COMMIT, PINNED_SHA256 };
