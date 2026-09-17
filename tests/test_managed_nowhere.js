const assert = require("node:assert/strict");
const { INSTANCE_ROOT, buildNowhereEndpoint, buildVectorLink, planManagedNowhere, quoteEnvironment, versionAtLeast } = require("../tools/managed-nowhere");

const plan = planManagedNowhere({
  id: "test-node-0001",
  version: "v1.8.0",
  publicHost: "2001:db8::1",
  listenHost: "127.0.0.1",
  port: 52077,
  key: "key with spaces/符号",
  network: "mix",
  tls: 1,
  up: "udp",
  down: "tcp",
  name: "🇯🇵 测试节点",
  client: "both",
  rate: 20,
  etar: 80,
  quicMemoryProfile: "memory",
});

assert.equal(plan.directory, `${INSTANCE_ROOT}/test-node-0001`);
assert.equal(plan.unitName, "proxy-console-nowhere@test-node-0001.service");
assert(plan.environmentPath.endsWith("/nowhere.env"));
assert(plan.unit.includes("EnvironmentFile=/var/lib/proxy-console/instances/test-node-0001/nowhere.env"));
assert(plan.unit.includes("ExecStart=/var/lib/proxy-console/instances/test-node-0001/bin/nowhere ${NOWHERE_PORTAL}"));
assert(!plan.unit.includes("nowhere.service"));
assert(plan.clientLink.startsWith("nowhere://"));
assert(plan.clientLink.includes("@[2001:db8::1]:52077"));
assert.equal(plan.links.anywhere.length, 4);
assert.equal(plan.links.vector.length, 4);
assert(plan.links.vector[0].uri.includes("mux=0"));
assert(plan.environment.includes("rate=20"));
assert(plan.environment.includes("NOW_QUIC_MEMORY_PROFILE=\"memory\""));
assert(!JSON.stringify(plan.summary).includes("key with spaces"));
assert.equal(quoteEnvironment('a"b\\c'), '"a\\"b\\\\c"');
assert(versionAtLeast("v1.8.0", 1, 8, 0));
assert(!versionAtLeast("v1.7.9", 1, 8, 0));
assert(buildVectorLink({ publicHost: "example.com", port: 52077, key: "s", version: "v1.8.0" }).startsWith("vector://"));

const stable = planManagedNowhere({ id: "stable-cert-01", publicHost: "example.com", port: 52078, key: "secret", certificateMode: "managed", tls: 2 });
assert.equal(stable.summary.certificateMode, "managed");
assert.equal(stable.summary.tls, 2);
assert(stable.environment.includes('NOWHERE_CERTIFICATE_MODE_VALUE="managed"'));
assert(stable.environment.includes('crt=%2Fvar%2Flib%2Fproxy-console%2Finstances%2Fstable-cert-01%2Fcertificates%2Fcertificate.pem'));
assert.equal(stable.summary.certificateHost, "example.com");

const extended = planManagedNowhere({ id: "extended-env-01", publicHost: "example.com", port: 52079, key: "secret", extensionEnvironment: { NOWHERE_FUTURE_VALUE: "kept" } });
assert(extended.environment.includes('NOWHERE_FUTURE_VALUE="kept"'));

const v2 = planManagedNowhere({ id: "v2-test-node", version: "v2.0.0", publicHost: "example.com", listenHost: "0.0.0.0", port: 52080, tcpPort: 52080, udpPort: 52081, key: "secret", name: "V2 test", client: "both", morph: 1, vectorMux: 1, transportMemoryProfile: "memory" });
assert.equal(v2.summary.protocolGeneration, 2);
assert.equal(v2.summary.wireProtocol, "nw2");
assert.equal(v2.summary.tcpPort, 52080);
assert.equal(v2.summary.udpPort, 52081);
assert(v2.environment.includes('NOWHERE_PORTAL="portal://secret@0.0.0.0/tcp:52080/udp:52081?tls=1&morph=1"'));
assert(v2.environment.includes('NOW_TRANSPORT_MEMORY_PROFILE="memory"'));
assert(!v2.environment.includes('\nNOW_QUIC_MEMORY_PROFILE='));
assert(!v2.environment.match(/^NOWHERE_PORTAL=.*(?:alpn|net)=/m));
assert(v2.links.anywhere[0].uri.includes('@example.com/tcp:52080/udp:52081?up=tcp&down=tcp&morph=1&mux=1'));
assert.equal(buildNowhereEndpoint("example.com", { tcpPort: 52080, udpPort: 52080 }), "example.com:52080");
assert.equal(buildNowhereEndpoint("2001:db8::1", { tcpPort: 52080, udpPort: 0, tcpCarrier: "tcp6" }), "[2001:db8::1]/tcp6:52080");

for (const id of ["nowhere", "../escape", "UPPERCASE-ID", "short"]) {
  assert.throws(() => planManagedNowhere({ id, publicHost: "example.com", port: 52077, key: "secret" }));
}
assert.throws(() => planManagedNowhere({ id: "valid-id-0001", publicHost: "example.com", port: 443, key: "secret" }), /port/);
assert.throws(() => planManagedNowhere({ id: "valid-id-0001", publicHost: "example.com", port: 52077, key: "secret", tls: 2 }), /certificate/);
assert.throws(() => planManagedNowhere({ id: "valid-id-0001", publicHost: "example.com", port: 52077, key: "secret", vectorPin: "bad" }), /pin/);
assert.doesNotThrow(() => planManagedNowhere({ id: "valid-id-0001", publicHost: "example.com", port: 52077, key: "secret", telemetryInterval: "250ms" }));
assert.doesNotThrow(() => planManagedNowhere({ id: "valid-id-0001", publicHost: "example.com", port: 52077, key: "secret", telemetryInterval: "60s" }));
assert.throws(() => planManagedNowhere({ id: "valid-id-0001", publicHost: "example.com", port: 52077, key: "secret", telemetryInterval: "249ms" }), /telemetry/);
assert.throws(() => planManagedNowhere({ id: "valid-id-0001", publicHost: "example.com", port: 52077, key: "secret", telemetryInterval: "61s" }), /telemetry/);
assert.throws(() => planManagedNowhere({ id: "valid-id-0001", version: "v3.0.0", publicHost: "example.com", port: 52077, key: "secret" }), /adapter/);

console.log("managed Nowhere planning tests passed (pure data; no host operations)");
