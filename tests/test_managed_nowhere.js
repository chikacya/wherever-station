const assert = require("node:assert/strict");
const { INSTANCE_ROOT, buildNowhereEndpoint, buildVectorLink, planManagedNowhere, quoteEnvironment, versionAtLeast } = require("../tools/managed-nowhere");

const plan = planManagedNowhere({
  id: "test-node-0001", version: "v2.0.2", publicHost: "2001:db8::1", listenHost: "127.0.0.1",
  port: 52077, tcpPort: 52077, udpPort: 52077, key: "key with spaces/符号", tls: 1,
  up: "tcp", down: "tcp", name: "🇯🇵 测试节点", client: "both", rate: 20, etar: 80,
});

assert.equal(plan.directory, `${INSTANCE_ROOT}/test-node-0001`);
assert.equal(plan.unitName, "proxy-console-nowhere@test-node-0001.service");
assert(plan.unit.includes("ExecStart=/var/lib/proxy-console/instances/test-node-0001/bin/nowhere ${NOWHERE_PORTAL}"));
assert(plan.clientLink.startsWith("nowhere://"));
assert(plan.clientLink.includes("@[2001:db8::1]:52077"));
assert.equal(plan.links.anywhere.length, 4);
assert.equal(plan.links.vector.length, 4);
assert(plan.links.vector[0].uri.includes("mux=0"));
assert(plan.environment.includes("rate=20"));
assert(!plan.environment.includes("NOW_QUIC_MEMORY_PROFILE"));
assert(!plan.environment.includes("NOWHERE_POOL_VALUE"));
assert(!JSON.stringify(plan.summary).includes("key with spaces"));
assert.equal(quoteEnvironment('a"b\\c'), '"a\\"b\\\\c"');
assert(versionAtLeast("v2.0.2", 2, 0, 0));
assert(!versionAtLeast("v1.8.3", 2, 0, 0));
assert(buildVectorLink({ publicHost: "example.com", tcpPort: 52077, udpPort: 52077, key: "s", version: "v2.0.2" }).startsWith("vector://"));
assert.throws(() => buildVectorLink({ publicHost: "example.com", tcpPort: 52077, udpPort: 52077, key: "s", version: "v1.8.3" }), /2\.x/);

const stable = planManagedNowhere({ id: "stable-cert-01", publicHost: "example.com", port: 52078, key: "secret", certificateMode: "managed", tls: 2 });
assert.equal(stable.summary.certificateMode, "managed");
assert.equal(stable.summary.tls, 2);
assert(stable.environment.includes('NOWHERE_CERTIFICATE_MODE_VALUE="managed"'));
assert(stable.environment.includes('crt=%2Fvar%2Flib%2Fproxy-console%2Finstances%2Fstable-cert-01%2Fcertificates%2Fcertificate.pem'));

const extended = planManagedNowhere({ id: "extended-env-01", publicHost: "example.com", port: 52079, key: "secret", extensionEnvironment: { NOWHERE_FUTURE_VALUE: "kept" } });
assert(extended.environment.includes('NOWHERE_FUTURE_VALUE="kept"'));

const carriers = planManagedNowhere({ id: "v2-test-node", version: "v2.0.2", publicHost: "example.com", listenHost: "0.0.0.0", port: 52080, tcpPort: 52080, udpPort: 52081, key: "secret", name: "V2 test", client: "both", morph: 1, vectorMux: 1, transportMemoryProfile: "memory" });
assert.equal(carriers.summary.protocolGeneration, 2);
assert.equal(carriers.summary.wireProtocol, "nw2");
assert(carriers.environment.includes('NOWHERE_PORTAL="portal://secret@0.0.0.0/tcp:52080/udp:52081?tls=1&morph=1"'));
assert(carriers.environment.includes('NOW_TRANSPORT_MEMORY_PROFILE="memory"'));
assert(carriers.links.anywhere[0].uri.includes('@example.com/tcp:52080/udp:52081?up=tcp&down=tcp&morph=1&mux=1'));
assert.equal(buildNowhereEndpoint("example.com", { tcpPort: 52080, udpPort: 52080 }), "example.com:52080");
assert.equal(buildNowhereEndpoint("2001:db8::1", { tcpPort: 52080, udpPort: 0, tcpCarrier: "tcp6" }), "[2001:db8::1]/tcp6:52080");

const v21 = planManagedNowhere({ id: "v21-test-node", version: "v2.1.0", publicHost: "example.com", port: 52082, key: "secret", morph: 1 });
assert.equal(v21.summary.morphWireGeneration, 2);
assert(v21.environment.includes('NOWHERE_VERSION_VALUE="v2.1.0"'));

assert.throws(() => planManagedNowhere({ id: "valid-id-0001", version: "v1.8.3", publicHost: "example.com", port: 52077, key: "secret" }), /2\.x/);
assert.throws(() => planManagedNowhere({ id: "valid-id-0001", version: "v3.0.0", publicHost: "example.com", port: 52077, key: "secret" }), /adapter/);
assert.throws(() => planManagedNowhere({ id: "valid-id-0001", publicHost: "example.com", port: 443, key: "secret" }), /port/);
assert.throws(() => planManagedNowhere({ id: "valid-id-0001", publicHost: "example.com", port: 52077, key: "secret", telemetryInterval: "249ms" }), /telemetry/);

console.log("managed Nowhere 2.x planning tests passed (pure data; no host operations)");
