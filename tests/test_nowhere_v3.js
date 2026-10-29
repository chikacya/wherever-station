const assert=require('node:assert/strict');
const {planManagedNowhere}=require('../tools/managed-nowhere');
const {decodeNowhereConfig}=require('../tools/nowhere-config');
const {buildManagedNowhereCommand}=require('../tools/managed-nowhere-remote');
const input={id:'nw3-test-node',version:'v3.0.0',publicHost:'example.com',listenHost:'0.0.0.0',port:2077,tcpPort:2077,udpPort:2078,key:'a'.repeat(32),client:'both'};
const p=planManagedNowhere(input);
assert.equal(p.summary.alpn,'nw3'); assert.equal(p.summary.morph,1);
assert.equal(p.links.anywhere.length,2); assert.equal(p.links.vector.length,2);
for(const l of p.links.anywhere){ const u=new URL(l.uri);assert.equal(u.pathname,'');assert.equal(u.searchParams.get('net'),l.up);assert(!u.searchParams.has('up'));assert(!u.searchParams.has('mux')); }
for(const l of p.links.vector){ const u=new URL(l.uri);assert.equal(u.pathname,`/${l.up}:${l.up==='tcp'?2077:2078}`);assert(u.searchParams.has('in'));assert(!u.searchParams.has('socks')); }
assert(!p.environment.includes('NOW_TELEMETRY_INTERVAL='));
const values=Object.fromEntries(p.environment.trim().split('\n').map(l=>{const i=l.indexOf('=');return [l.slice(0,i),JSON.parse(l.slice(i+1))]}));
assert.equal(planManagedNowhere({...decodeNowhereConfig(values),id:input.id,name:p.name}).environment,p.environment);
for(const n of [31,33,64])assert.throws(()=>planManagedNowhere({...input,key:'a'.repeat(n)}),/32 字符/);
for(const patch of [{vectorMux:1},{next:'x'},{up:'tcp'},{out:'egress',udpPort:0},{out:'egress',dial4:'auto'}])assert.throws(()=>planManagedNowhere({...input,...patch}));
const e=planManagedNowhere({...input,role:'egress',tcpPort:0,vectorPin:'b'.repeat(64)});
assert(e.environment.includes('egress://'));assert.equal(e.links.anywhere.length,0);assert.equal(e.links.vector.length,0);
const parts=[...buildManagedNowhereCommand('preflight',e).matchAll(/'([^']+)'/g)].map(m=>m[1]);
assert.deepEqual(JSON.parse(Buffer.from(parts[2],'base64')).ports,[]);
assert.throws(()=>buildManagedNowhereCommand('upgrade',{...p,targetVersion:'v2.2.1'}),/migration/);
assert.throws(()=>buildManagedNowhereCommand('create',{...p,version:'v3.2.1'}),/Unverified/);
console.log('NW3 URL, key, Egress and migration guards passed');
