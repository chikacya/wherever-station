const { isIP } = require("node:net");

function validDomain(value) {
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(value)
    && value.split(".").every((label) => label.length <= 63);
}

function validCidr(value) {
  const [address, prefix, extra] = String(value).split("/");
  const family = isIP(address);
  return !extra && family > 0 && /^\d{1,3}$/.test(prefix || "") && Number(prefix) <= (family === 4 ? 32 : 128);
}

function parseRuleSetText(text, action = "proxy") {
  if (!["proxy", "direct", "reject"].includes(action)) throw new Error("规则集动作无效");
  const input = String(text || "");
  if (Buffer.byteLength(input, "utf8") > 1024 * 1024) throw new Error("规则集超过 1 MiB 限制");
  const rules = [];
  const seen = new Set();
  for (let raw of input.split(/\r?\n/)) {
    raw = raw.trim().replace(/^[-]\s*/, "").replace(/^['"]|['"]$/g, "").trim();
    if (!raw || /^(?:#|;|\/\/|payload\s*:)/i.test(raw)) continue;
    const parts = raw.split(",").map((part) => part.trim());
    let type = ""; let value = "";
    if (/^(?:DOMAIN-SUFFIX|DOMAIN-KEYWORD|IP-CIDR6?|DOMAIN)$/i.test(parts[0]) && parts[1]) {
      type = /^IP-CIDR/i.test(parts[0]) ? "ip-cidr" : /^DOMAIN-KEYWORD$/i.test(parts[0]) ? "domain-keyword" : "domain-suffix";
      value = parts[1];
    } else if (validCidr(raw)) { type = "ip-cidr"; value = raw; }
    else {
      value = raw.replace(/^\+\./, "").replace(/^\./, "").replace(/\.$/, "").toLowerCase();
      if (validDomain(value)) type = "domain-suffix";
    }
    if (!type || (type === "ip-cidr" ? !validCidr(value) : type === "domain-suffix" ? !validDomain(value) : !/^[a-z0-9._-]+$/i.test(value))) continue;
    const key = `${type}:${value.toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); rules.push({ id: `cached-${rules.length + 1}`, type, value, action }); }
    if (rules.length >= 5000) throw new Error("规则集有效条目超过 5000 条");
  }
  if (!rules.length) throw new Error("规则集没有可识别的域名或 CIDR 条目");
  return rules;
}

module.exports = { parseRuleSetText };
