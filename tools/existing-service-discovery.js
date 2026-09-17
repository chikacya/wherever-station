const fs = require("node:fs");
const path = require("node:path");

const PREFIX = "PCDISCOVERY\t1\t";

function buildExistingServiceDiscoveryCommand(input = {}) {
  const script = fs.readFileSync(path.join(__dirname, "existing-service-scan.py"), "utf8");
  const code = Buffer.from(script, "utf8").toString("base64");
  const payload = Buffer.from(JSON.stringify({
    publicHost: String(input.publicHost || "").trim().slice(0, 253),
    machineName: String(input.machineName || "VPS").trim().slice(0, 120),
  }), "utf8").toString("base64");
  return `python3 -c "$(printf '%s' '${code}' | base64 -d)" '${payload}'`;
}

function parseExistingServiceDiscoveryOutput(output) {
  const line = String(output || "").split(/\r?\n/).find((item) => item.startsWith(PREFIX));
  if (!line) return { ok: false, error: "远端没有返回可识别的发现结果" };
  try {
    const value = JSON.parse(Buffer.from(line.slice(PREFIX.length), "base64").toString("utf8"));
    if (!value || typeof value !== "object") throw new Error("invalid");
    return value;
  } catch (_) {
    return { ok: false, error: "远端发现结果无法解析" };
  }
}

module.exports = { buildExistingServiceDiscoveryCommand, parseExistingServiceDiscoveryOutput };
