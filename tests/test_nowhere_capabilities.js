const assert = require("node:assert/strict");
const {nowhereCapabilities, parseNowhereVersion,compareNowhereVersions}=require('../tools/nowhere-capabilities');
assert.equal(parseNowhereVersion('latest'),null);
assert.equal(compareNowhereVersions('v2.2.1','v2.2.1-beta.1'),1);
for(const v of ['v1.8.3','v2.0.2','v2.1.2','v2.2.0','v4.0.0']) assert.equal(nowhereCapabilities(v).supported,false,v);
assert.equal(nowhereCapabilities('v2.2.1').supported,false);
const nw3=nowhereCapabilities('v3.0.0');
assert.equal(nw3.verified,true);assert.equal(nw3.wireProtocol,'nw3');assert.equal(nw3.vectorMux,false);assert.equal(nw3.morphWireGeneration,3);assert.equal(nw3.localTelemetry,true);
assert.equal(nowhereCapabilities('v3.0.1').verified,true);
assert.equal(nowhereCapabilities('v3.0.0-beta.1').verified,false);
console.log('NW3-only capability tests passed');

assert.equal(nowhereCapabilities('v3.1.0').authenticatedPrelude,true);
assert.equal(nowhereCapabilities('v3.1.0').requiresAuthenticatedPrelude,false);
assert.equal(nowhereCapabilities('v3.2.0').requiresAuthenticatedPrelude,true);
assert.equal(nowhereCapabilities('v3.0.1').fadePrelude,true);
