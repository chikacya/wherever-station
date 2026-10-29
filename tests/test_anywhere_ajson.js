const test=require('node:test'),assert=require('node:assert/strict');
const {renderAjson,validateAjson}=require('../tools/anywhere-ajson');
const nodes=[{id:'stable-1',name:'HK',uri:'vless://key@example.com:443?security=tls&type=xhttp&extra=%7B%7D#HK'},{id:'stable-2',name:'JP',uri:'nowhere://'+'a'.repeat(32)+'@example.com:2077?net=tcp&morph=1'},{id:'unknown',name:'Unsupported',uri:'future://key@host:443'}];
test('AJSON native nodes preserve stable IDs and metadata',()=>{
 const sub={name:'订阅'};const usage={upload:1,download:2,total:300,expire:1800000000};const out=renderAjson(nodes,sub,usage);validateAjson(out.body);const doc=JSON.parse(out.body);assert.equal(doc.anywhere,1);assert.deepEqual(doc.usage,usage);assert.equal(doc.proxies.length,2);assert.equal(doc.proxies[0].protocol,'vless');assert.equal(doc.proxies[0].transport.type,'xhttp');assert.equal(doc.proxies[0].security.type,'tls');
 const renamed=JSON.parse(renderAjson([{...nodes[1],name:'renamed'},nodes[0]],sub).body);assert.equal(renamed.proxies[0].id,'stable-2');assert.equal(renamed.proxies[0].name,'renamed');
 assert.throws(()=>renderAjson([nodes[0],nodes[0]],sub),/ID/);assert.throws(()=>renderAjson([nodes[2]],sub),/兼容/);
});
test('HTTP negotiation, explicit override, traffic, tokens and download',async()=>{
 const fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');const storage=fs.mkdtempSync(path.join(os.tmpdir(),'wherever-ajson-'));const root=path.resolve(__dirname,'..');const methods=new Map();const server={route(){},registerRPC(k,v){methods.set(k,v)},async call(){return {}}};const box={console,Buffer,setTimeout,clearTimeout,__dirname:root,__storageDir__:storage,require:n=>n==='server'?server:require(n)};
 try{
 vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(root,'script.js'),'utf8'),box);box.load();
 let state=box.readState();state.nodes=nodes.map(n=>({...n,protocol:n.uri.split(':')[0],enabled:true}));state.subscriptions=[{id:'sub',name:'AJSON Test',token:'a'.repeat(48),nodeIds:nodes.map(n=>n.id),enabled:true,quota:{mode:'manual',upload:11,download:22,total:100},expiresAt:'2030-01-01T00:00:00.000Z'}];box.writeState(box.cleanState(state));
 async function get(query={},headers={},token='a'.repeat(48)){const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}};await box.publicSubscription({url:'/proxy/sub/'+token,query,headers},res);return res;}
 const old=await get({}, {'user-agent':'Anywhere'});assert.equal(old.headers['Content-Type'],'text/plain; charset=utf-8');assert(Buffer.from(old.body,'base64').toString().includes(nodes[0].uri));
 const current=await get({}, {'user-agent':'Anywhere','x-anywhere-format':'ajson/1'});const doc=JSON.parse(current.body);assert.equal(doc.name,'AJSON Test');assert.equal(doc.proxies.length,2);assert.equal(doc.proxies[1].id,'stable-2');assert.equal(current.headers['X-Proxy-Console-Skipped'],'1');assert(current.headers.Vary.includes('X-Anywhere-Format'));assert.equal(doc.usage.expire,1893456000);
 assert.equal(JSON.parse((await get({format:'anywhere'}, {'x-anywhere-format':'ajson/1'})).body).anywhere,1);
 assert.equal((await get({format:'base64'},{'x-anywhere-format':'ajson/1'})).body,old.body);
 assert.equal((await get({}, {'user-agent':'Anywhere','x-anywhere-format':'ajson/2'})).body,old.body);
 const dl=await get({format:'ajson',download:'1'});assert(dl.headers['Content-Disposition'].includes('.ajson'));assert.equal(dl.headers['Cache-Control'],'no-store');assert.equal((await get({format:'ajson'},{},'invalid')).statusCode,404);
 let draft=box.readState();draft.subscriptions[0].ajson={icons:{light:icon},templates:{quiet:{morph:false}},overrides:{'stable-2':{template:'quiet',settings:{morphPrelude:'full8'}}}};
 let saved=methods.get('proxyConsole:saveState')({state:draft});assert.equal(saved.subscriptions[0].ajson.icons.light,icon);
 assert.equal((await get({format:'base64'})).body,old.body);
 const preview=methods.get('proxyConsole:previewAjsonSubscription')({subscription:saved.subscriptions[0]});assert.equal(preview.native,2);assert.equal(preview.document.proxies[1].morphPrelude,'full8');
 const backup=methods.get('proxyConsole:exportPortableBackup')();assert.equal(backup.state.subscriptions[0].ajson.templates.quiet.morph,false);
 const invalid=JSON.parse(JSON.stringify(saved));invalid.subscriptions[0].ajson.overrides['stable-2'].settings={security:{type:'tls'}};assert.throws(()=>methods.get('proxyConsole:saveState')({state:invalid}),/字段不支持/);assert.equal(box.readState().revision,saved.revision);
 const modified=JSON.parse(JSON.stringify(saved));modified.subscriptions[0].ajson.icons={};saved=methods.get('proxyConsole:saveState')({state:modified});
 const history=methods.get('proxyConsole:getSubscriptionHistory')({subscriptionId:'sub'});assert.equal(history[0].snapshot.ajson.icons.light,icon);
 const restored=methods.get('proxyConsole:restorePortableBackup')({backup,expectedRevision:saved.revision});assert.equal(restored.subscriptions[0].ajson.icons.light,icon);assert.equal(restored.subscriptions[0].ajson.overrides['stable-2'].settings.morphPrelude,'full8');
 }finally{fs.rmSync(storage,{recursive:true,force:true});}
});
const {nativeFromUri,cleanAjsonSettings}=require('../tools/anywhere-ajson');
const icon='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwaPj/HwAFggK/465+UQAAAABJRU5ErkJggg==';
const convert=uri=>nativeFromUri({id:'node',name:'Test',uri});
test('native conversion covers supported protocols, IPv6 and advanced URI parameters',()=>{
 const cases=[['nowhere://'+'b'.repeat(32)+'@[::1]:2077?net=udp&morph=0','nowhere'],['vless://user@host:443?security=tls&type=ws&path=%2Fa&host=cdn.example&alpn=h2%2Chttp%2F1.1&ech=1','vless'],['anytls://p%40ss@host:443?ici=30&it=60&mis=2','anytls'],['trojan://secret@host:443?sni=example.com','trojan'],['hy2://secret@host:443?obfs=gecko&obfs-password=secret&obfs-min-packet-size=512&obfs-max-packet-size=1200','hysteria'],['socks5://user:p%3Ass@host:1080','socks5'],['https://user:pass@host:443','rfc'],['ss://'+Buffer.from('aes-128-gcm:pass').toString('base64url')+'@host:443','shadowsocks']];
 for(const [uri,protocol]of cases)assert.equal(convert(uri)?.protocol,protocol,uri);
 const nw=convert(cases[0][0]);assert.equal(nw.server,'::1');assert.equal(nw.morph,false);
 assert.equal(convert(cases[2][0]).password,'p@ss');assert.equal(convert(cases[4][0]).obfs.maxPacketSize,1200);
 const reality=convert('vless://u@host:443?security=reality&sni=cdn.example&pbk='+Buffer.alloc(32,1).toString('base64url')+'&sid=ab12&type=grpc&serviceName=svc');assert.equal(reality.security.type,'reality');assert.equal(reality.transport.serviceName,'svc');
 const sudoku=convert('sudoku://'+Buffer.from(JSON.stringify({h:'host',p:443,k:'secret',a:'ascii',x:true,hm:'ws',hx:'auto'})).toString('base64url'));assert.equal(sudoku.protocol,'sudoku');assert.equal(sudoku.aeadMethod,'none');assert.equal(sudoku.asciiMode,'prefer_ascii');assert.equal(sudoku.enablePureDownlink,false);
});
test('unknown, ambiguous, legacy or invalid input remains an exact keyed link',()=>{
 const uris=['nowhere://'+'b'.repeat(64)+'@host:443','nowhere://'+'b'.repeat(32)+'@host:443?pin=abc','vless://u@host:443?type=ws&custom=x','vless://u@host:443?type=ws&type=grpc','vless://u@host:443?security=tls&fp=typo','vless://u@host:443?security=reality&pbk=invalid','ss://'+Buffer.from('invalid:pass').toString('base64url')+'@host:443'];
 for(const uri of uris){assert.equal(convert(uri),null,uri);const doc=JSON.parse(renderAjson([{id:'node',name:'Test',uri}],{name:'Test'}).body);assert.equal(doc.proxies[0].link,uri);assert.throws(()=>renderAjson([{id:'node',name:'Test',uri}],{ajson:{overrides:{node:{settings:{morph:false}}}}}),/不能覆盖/);}
});
test('template and per-node precedence, icons and stable identity survive AJSON serialization',()=>{
 const node={id:'node',name:'Test',uri:'nowhere://'+'a'.repeat(32)+'@host:443?morph=1'};
 const ajson={icons:{light:'data:image/png;base64,'+icon,dark:icon},templates:{quiet:{morph:false,morphPrelude:'low7'}},overrides:{node:{template:'quiet',settings:{morphPrelude:'full8'}}}};
 const body=renderAjson([node],{name:'Test',ajson}).body;validateAjson(body);const doc=JSON.parse(body);assert.equal(doc.icon.light,icon);assert.equal(doc.proxies[0].use,'quiet');assert.equal(doc.proxies[0].morph,undefined);assert.equal(doc.templates.quiet.morph,false);assert.equal(doc.proxies[0].morphPrelude,'full8');assert.equal(doc.proxies[0].id,'node');
 const vless={id:'node',name:'TLS',uri:'vless://u@host:443?security=tls&sni=cdn.example'};
 const nested=JSON.parse(renderAjson([vless],{ajson:{templates:{tls:{security:{type:'tls',insecure:true}}},overrides:{node:{template:'tls',settings:{security:{insecure:false,ech:true}}}}}}).body);assert.equal(nested.proxies[0].security.sni,'cdn.example');assert.equal(nested.proxies[0].security.insecure,false);assert.equal(nested.proxies[0].security.ech,true);
 assert.throws(()=>renderAjson([node],{ajson:{overrides:{node:{settings:{transport:{type:'ws'}}}}}}),/字段不支持/);
});
test('invalid icons, credential overrides and unsafe settings are rejected',()=>{
 for(const settings of [{icons:{light:Buffer.from('<svg>bad</svg>').toString('base64')}},{icons:{dark:Buffer.alloc(262145).toString('base64')}},{templates:{bad:{server:'h'}}},{overrides:{node:{template:'missing'}}},{templates:{bad:JSON.parse('{"security":{"__proto__":{}}}')}}])assert.throws(()=>cleanAjsonSettings(settings));
});

test('icons work in Komari without ascii/base64url Buffer encodings',()=>{
 const original=Buffer.prototype.toString, byteLength=Buffer.byteLength;Buffer.byteLength=undefined;
 Buffer.prototype.toString=function(encoding,...args){if(encoding==='ascii'||encoding==='base64url')throw Error('Unknown encoding');return original.call(this,encoding,...args);};
 try{assert.equal(cleanAjsonSettings({icons:{light:icon},templates:{quiet:{morph:false}}}).icons.light,icon);}finally{Buffer.prototype.toString=original;Buffer.byteLength=byteLength;}
});

test('a single subscription icon is shared across themes, including old dark-only data',()=>{
 const dark=cleanAjsonSettings({icons:{dark:icon}});assert.deepEqual(dark.icons,{light:icon,dark:icon});
 const light=cleanAjsonSettings({icons:{light:icon}});assert.deepEqual(light.icons,{light:icon,dark:icon});
});
test('built-in presets are available to existing subscriptions and match native protocol fields',async()=>{
 const {AJSON_PRESETS,presetsFor}=await import('../frontend/src/ajson-presets.js');
 const {validateNative,merge}=require('../tools/anywhere-native');
 for(const preset of AJSON_PRESETS){const protocol=preset.protocol==='hysteria2'?'hysteria':preset.protocol;const base={id:'n',name:'Test',server:'host',port:443,protocol,...({nowhere:{key:'a'.repeat(32)},vless:{uuid:'u'},hysteria:{password:'p'},anytls:{password:'p'},sudoku:{key:'k'},trojan:{password:'p'}}[protocol])};assert.doesNotThrow(()=>validateNative(merge(base,preset.settings)),preset.name);assert(presetsFor(preset.protocol).includes(preset));}
 assert.equal(presetsFor('ss').length,0);assert.equal(presetsFor('hy2')[0].protocol,'hysteria2');
});
