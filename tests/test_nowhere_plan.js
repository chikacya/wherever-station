const assert = require("node:assert/strict");
const { planNowhereEnvironment } = require("../tools/nowhere-plan");
const source = '# retained comment\nNOWHERE_PORT_VALUE="2077"\nNOWHERE_KEY_VALUE="secret-key"\nUNKNOWN_FUTURE="keep me"\n';
const plan = planNowhereEnvironment(source, { NOWHERE_PORT_VALUE: "8443", NOWHERE_LOG_VALUE: "warn" });
assert(plan.content.includes('# retained comment'));
assert(plan.content.includes('NOWHERE_KEY_VALUE="secret-key"'));
assert(plan.content.includes('UNKNOWN_FUTURE="keep me"'));
assert(plan.content.includes('NOWHERE_PORT_VALUE="8443"'));
assert(plan.content.includes('NOWHERE_LOG_VALUE="warn"'));
assert.deepEqual(plan.preview.changedKeys, ["NOWHERE_PORT_VALUE", "NOWHERE_LOG_VALUE"]);
assert(!JSON.stringify(plan.preview).includes("secret-key"));
assert.equal(planNowhereEnvironment(source, { NOWHERE_PORT_VALUE: "2077" }).preview.changed, false);
assert.equal(planNowhereEnvironment(source, { NOWHERE_KEY_VALUE: 'a"b\\c' }).content.match(/NOWHERE_KEY_VALUE=(.*)/)[1], '"a\\"b\\\\c"');
for (const patch of [{ EVIL: "x" }, { NOWHERE_PORT_VALUE: "0" }, { NOWHERE_PORT_VALUE: "65536" }, { NOWHERE_NET_VALUE: "quic" }, { NOWHERE_TLS_VALUE: "3" }, { NOWHERE_LOG_VALUE: "verbose" }, { NOWHERE_KEY_VALUE: "x\ny" }])
  assert.throws(() => planNowhereEnvironment(source, patch));
assert.throws(() => planNowhereEnvironment('NOWHERE_PORT_VALUE="1"\nNOWHERE_PORT_VALUE="2"\n', { NOWHERE_PORT_VALUE: "3" }), /Duplicate/);
console.log("Nowhere environment plan tests passed (pure text; no process invocation)");
