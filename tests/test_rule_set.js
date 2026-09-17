const assert = require("node:assert/strict");
const { parseRuleSetText } = require("../tools/rule-set");

const rules = parseRuleSetText(`# comment
payload:
  - '+.example.com'
  - DOMAIN-SUFFIX,example.org
  - DOMAIN-KEYWORD,advert
  - IP-CIDR,10.0.0.0/8,no-resolve
  - 2001:db8::/32
invalid value`, "direct");

assert.deepEqual(rules.map((rule) => [rule.type, rule.value, rule.action]), [
  ["domain-suffix", "example.com", "direct"],
  ["domain-suffix", "example.org", "direct"],
  ["domain-keyword", "advert", "direct"],
  ["ip-cidr", "10.0.0.0/8", "direct"],
  ["ip-cidr", "2001:db8::/32", "direct"],
]);
assert.throws(() => parseRuleSetText("nothing usable here", "proxy"), /没有可识别/);
assert.throws(() => parseRuleSetText("example.com", "other"), /动作/);
console.log("rule-set text parser accepts domains and CIDRs without executing remote content");
