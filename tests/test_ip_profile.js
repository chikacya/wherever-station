const assert = require("node:assert/strict");
const { buildIpProfileCommand, parseIpProfileOutput, PREFIX } = require("../tools/ip-profile-check");

const command = buildIpProfileCommand();
assert(command.startsWith("python3 -c"));
assert(!command.includes("curl "));
assert(!command.includes("raw.githubusercontent.com"));

const report = {
  version: "builtin-2026.09.2", public_ip: "203.0.113.8", addresses: { ipv4: "203.0.113.8", ipv6: "2001:db8::8" }, elapsed_ms: 8421,
  location: { countryCode: "US", country: "United States", region: "California", city: "Los Angeles", timezone: "America/Los_Angeles", continent: "North America", postalCode: "90001", latitude: 34.05, longitude: -118.24 },
  network: { asn: "AS64500", organization: "Example", isp: "Example ISP", domain: "example.test", type: "hosting", range: "203.0.113.0/24", ipVersion: "IPv4" },
  risk: { score: 12, level: "low", proxy: "no", residential: false },
  purity: { score: 88, label: "纯净", confidence: "high", confidenceScore: 100, sourceCount: 3, sources: ["IPPure", "ProxyCheck", "ipapi.is"], networkClass: "机房", proxyDetected: false },
  attributes: [{ label: "网络类型", value: "hosting" }],
  observations: [{ source: "Cloudflare", ip: "203.0.113.8", countryCode: "US", city: "", latencyMs: 81, matched: true }],
  services: [{ name: "Netflix", status: "AVAILABLE", region: "US", detail: "非自制内容可访问", latency_ms: 428 }],
};
const output = `noise\n${PREFIX}${Buffer.from(JSON.stringify(report)).toString("base64")}\n`;
assert.deepEqual(parseIpProfileOutput(output), {
  ok: true, version: "builtin-2026.09.2", publicIp: "203.0.113.8", addresses: report.addresses, elapsedMs: 8421,
  location: report.location, network: report.network, risk: report.risk,
  attributes: report.attributes, purity: report.purity, observations: report.observations,
  services: [{ name: "Netflix", status: "AVAILABLE", region: "US", detail: "非自制内容可访问", latencyMs: 428 }],
});
assert.equal(parseIpProfileOutput("plain output").ok, false);
for (const score of [null, "", false]) {
  const parsed = parseIpProfileOutput(PREFIX + Buffer.from(JSON.stringify({ risk: { score }, purity: { score: null } })).toString("base64"));
  assert.equal(parsed.risk.score, null);
  assert.equal(parsed.purity.score, null);
}
assert.equal(parseIpProfileOutput(`${PREFIX}bad`).ok, false);

const source = Buffer.from([...command.matchAll(/'([^']+)'/g)][1][1], "base64").toString();
assert(source.includes("ThreadPoolExecutor"));
assert(source.includes("proxycheck.io"));
assert(source.includes("my.ippure.com"));
assert(source.includes("ChatGPT"));
assert(source.includes("Netflix"));
assert(source.includes("YouTube Premium"));
console.log("built-in concurrent IP profile tests passed");
