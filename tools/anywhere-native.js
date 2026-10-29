const { URL } = require('node:url');
const PROTOCOLS = {
  nowhere: ['key','network','morph','morphPrelude'],
  vless: ['uuid','encryption','flow','security','transport'],
  hysteria: ['password','sni','congestion','upMbps','downMbps','obfs'],
  sudoku: ['key','aeadMethod','paddingMin','paddingMax','asciiMode','customTables','enablePureDownlink','multiplex','httpMask'],
  trojan: ['password','security'], anytls: ['password','security','idleCheckInterval','idleTimeout','minIdleSession'],
  shadowsocks: ['method','password'], socks5: ['username','password'], rfc: ['username','password','security'],
};
const ADVANCED = new Set(['network','morph','morphPrelude','encryption','flow','security','transport','sni','congestion','upMbps','downMbps','obfs','aeadMethod','paddingMin','paddingMax','asciiMode','customTables','enablePureDownlink','multiplex','httpMask','idleCheckInterval','idleTimeout','minIdleSession']);
function decodeBase64(value) { const text=value.replace(/-/g,'+').replace(/_/g,'/');return Buffer.from(text+'='.repeat((4-text.length%4)%4),'base64'); }
function object(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function safeJson(x, depth = 0) {
  if (depth > 10) throw Error('AJSON 配置嵌套过深');
  if (object(x)) for (const [key,value] of Object.entries(x)) { if (['__proto__','constructor','prototype'].includes(key)) throw Error('AJSON 配置键无效'); safeJson(value,depth+1); }
  else if (Array.isArray(x)) x.forEach(v=>safeJson(v,depth+1));
}
function merge(base, patch) { const result = {...base}; for (const [k,v] of Object.entries(patch)) result[k] = object(v)&&object(result[k]) ? merge(result[k],v) : v; return result; }
function checkAdvanced(value) {
  if (!object(value) || Buffer.from(JSON.stringify(value),'utf8').length > 32768) throw Error('AJSON 高级参数必须为不超过 32 KiB 的对象');
  safeJson(value); for (const k of Object.keys(value)) if (!ADVANCED.has(k)) throw Error('AJSON 不支持此高级字段：'+k);
  return value;
}
function validateNative(proxy) {
  const fields=PROTOCOLS[proxy.protocol]; if (!fields) throw Error('AJSON 原生协议不支持'); safeJson(proxy);
  for(const k of Object.keys(proxy)) if (!['id','name','server','port','protocol',...fields].includes(k)) throw Error('AJSON 原生字段不支持：'+k);
  if(typeof proxy.server!=='string'||!proxy.server||!Number.isInteger(proxy.port)||proxy.port<1||proxy.port>65535) throw Error('AJSON 服务器或端口无效');
  const enumValue=(key,values)=>{if(proxy[key]!=null&&!values.includes(proxy[key]))throw Error('AJSON 枚举无效：'+key)};
  for(const k of ['morph','enablePureDownlink']) if(proxy[k]!=null&&typeof proxy[k]!=='boolean')throw Error('AJSON 字段必须为 boolean：'+k);
  for(const k of ['key','uuid','password','method','username','sni','encryption','flow']) if(proxy[k]!=null&&typeof proxy[k]!=='string')throw Error('AJSON 字段必须为字符串：'+k);
  const required={nowhere:'key',vless:'uuid',hysteria:'password',sudoku:'key',trojan:'password',anytls:'password',shadowsocks:'method'}[proxy.protocol];if(required&&!proxy[required])throw Error('AJSON 缺少 '+required);
  if(proxy.protocol==='nowhere'&&!/^[0-9a-f]{32}$/.test(proxy.key))throw Error('AJSON Nowhere 原生模式要求 NW3 32 字符密钥');
  for(const k of ['upMbps','downMbps','paddingMin','paddingMax','idleCheckInterval','idleTimeout','minIdleSession'])if(proxy[k]!=null&&(!Number.isSafeInteger(proxy[k])||proxy[k]<0))throw Error('AJSON 字段必须为非负整数：'+k);
  enumValue('network',['tcp','udp']);enumValue('morphPrelude',['fade','full8','low7']);enumValue('congestion',['brutal','bbr']);enumValue('aeadMethod',['chacha20-poly1305','aes-128-gcm','none']);enumValue('asciiMode',['prefer_entropy','prefer_ascii','up_ascii_down_entropy','up_entropy_down_ascii']);enumValue('multiplex',['off','auto','on']);
  if(proxy.customTables!=null&&(!Array.isArray(proxy.customTables)||proxy.customTables.some(v=>typeof v!=='string')))throw Error('customTables 必须是字符串数组');
  if(proxy.security!=null){const s=typeof proxy.security==='string'?{type:proxy.security}:proxy.security;if(!object(s)||!['none','tls','reality'].includes(s.type))throw Error('AJSON security 无效');if(s.type==='reality'&&proxy.protocol!=='vless')throw Error('Reality 只适用于 VLESS');if(!['vless','trojan','anytls','rfc'].includes(proxy.protocol))throw Error('此协议不支持配置 security');
    const allowed=s.type==='tls'?['type','sni','alpn','fingerprint','minVersion','maxVersion','insecure','ech']:s.type==='reality'?['type','sni','publicKey','shortId','fingerprint']:['type'];for(const k of Object.keys(s))if(!allowed.includes(k))throw Error('AJSON security 不支持字段：'+k);
    for(const k of ['sni','fingerprint','minVersion','maxVersion','publicKey','shortId'])if(s[k]!=null&&typeof s[k]!=='string')throw Error('AJSON security 字段类型无效：'+k);
    if(s.insecure!=null&&typeof s.insecure!=='boolean')throw Error('insecure 必须为 boolean');if(s.ech!=null&&typeof s.ech!=='boolean'&&typeof s.ech!=='string')throw Error('ech 必须为 boolean 或配置字符串');if(typeof s.ech==='string'&&(!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s.ech.trim())||!Buffer.from(s.ech,'base64').length))throw Error('ECH Base64 无效');if(s.alpn!=null&&(!Array.isArray(s.alpn)||s.alpn.some(v=>typeof v!=='string')))throw Error('alpn 必须为字符串数组');
    if(s.fingerprint!=null&&!['chrome_133','chrome_120','chrome_106','firefox_148','firefox_120','safari_26','edge_106','non_browser','chrome','firefox','safari','edge'].includes(s.fingerprint))throw Error('TLS fingerprint 无效');
    for(const k of ['minVersion','maxVersion'])if(s[k]!=null&&!['1.0','1.1','1.2','1.3'].includes(s[k]))throw Error('TLS 版本无效');if(s.type==='reality'&&(!s.sni||!s.publicKey||decodeBase64(s.publicKey).length!==32||!/^([0-9a-fA-F]{2}){0,8}$/.test(s.shortId||'')))throw Error('Reality SNI、公钥或 shortId 无效');
  }
  if(proxy.transport!=null){const t=typeof proxy.transport==='string'?{type:proxy.transport}:proxy.transport;if(proxy.protocol!=='vless'||!object(t)||!['raw','ws','httpupgrade','grpc','xhttp'].includes(t.type))throw Error('AJSON transport 无效');
    const transportKeys={raw:['type'],ws:['type','host','path','headers','maxEarlyData','earlyDataHeaderName','heartbeatPeriod'],httpupgrade:['type','host','path','headers'],grpc:['type','serviceName','authority','multiMode','userAgent','initialWindowsSize','idleTimeout','healthCheckTimeout','permitWithoutStream']}[t.type];if(transportKeys&&Object.keys(t).some(k=>!transportKeys.includes(k)))throw Error('传输层包含不支持的字段');
    for(const k of ['host','path','serviceName','authority','userAgent','earlyDataHeaderName'])if(t[k]!=null&&typeof t[k]!=='string')throw Error('传输层字段必须为字符串：'+k);
    for(const k of ['multiMode','permitWithoutStream'])if(t[k]!=null&&typeof t[k]!=='boolean')throw Error(k+' 必须为 boolean');for(const k of ['heartbeatPeriod','maxEarlyData','initialWindowsSize','idleTimeout','healthCheckTimeout'])if(t[k]!=null&&(!Number.isSafeInteger(t[k])||t[k]<0))throw Error(k+' 必须为非负整数');if(t.mode!=null&&!['auto','stream-one','stream-up','packet-up'].includes(t.mode))throw Error('XHTTP mode 无效');
    if(t.headers!=null&&(!object(t.headers)||Object.values(t.headers).some(v=>typeof v!=='string')))throw Error('headers 必须为字符串映射');
  }
  if(proxy.obfs!=null){if(!object(proxy.obfs)||Object.keys(proxy.obfs).some(k=>!['type','password','minPacketSize','maxPacketSize'].includes(k))||!['salamander','gecko'].includes(proxy.obfs.type)||!proxy.obfs.password||typeof proxy.obfs.password!=='string')throw Error('Hysteria obfs 无效');for(const k of ['minPacketSize','maxPacketSize'])if(proxy.obfs[k]!=null&&(!Number.isInteger(proxy.obfs[k])||proxy.obfs[k]<0))throw Error('Gecko 包长无效');}
  if(proxy.httpMask!=null){if(!object(proxy.httpMask)||Object.keys(proxy.httpMask).some(k=>!['disable','tls','mode','host','pathRoot'].includes(k)))throw Error('httpMask 必须是对象');for(const k of ['host','pathRoot'])if(proxy.httpMask[k]!=null&&typeof proxy.httpMask[k]!=='string')throw Error('httpMask 字符串无效');for(const k of ['disable','tls'])if(proxy.httpMask[k]!=null&&typeof proxy.httpMask[k]!=='boolean')throw Error('httpMask boolean 无效');if(proxy.httpMask.mode!=null&&!['legacy','stream','poll','auto','ws'].includes(proxy.httpMask.mode))throw Error('httpMask mode 无效');}
  if(proxy.protocol==='shadowsocks'&&!['aes-128-gcm','aes-256-gcm','chacha20-ietf-poly1305','2022-blake3-aes-128-gcm','2022-blake3-aes-256-gcm','2022-blake3-chacha20-poly1305','none'].includes(proxy.method))throw Error('Shadowsocks method 无效');
  if(proxy.protocol==='rfc'&&proxy.username?.includes(':'))throw Error('RFC username 不能包含冒号');
  return proxy;
}
// Convert only when every URI parameter is represented. Unknown/ambiguous input
// stays a keyed link, preserving the complete original URI for the client.
function nativeFromUri(node) {
 try {
  if(node.uri.startsWith('sudoku://')) {
   const encoded=node.uri.slice(9);if(!/^[A-Za-z0-9_-]+={0,2}$/.test(encoded))return null;
   const j=JSON.parse(decodeBase64(encoded).toString('utf8'));safeJson(j);
   if(!object(j)||Object.keys(j).some(k=>!['h','p','k','e','a','n','t','table','custom_table','ts','x','hd','hm','ht','hh','hy','hx'].includes(k)))return null;
   for(const k of ['x','hd','ht'])if(j[k]!=null&&typeof j[k]!=='boolean')return null;
   const ascii={entropy:'prefer_entropy',ascii:'prefer_ascii',prefer_entropy:'prefer_entropy',prefer_ascii:'prefer_ascii',up_ascii_down_entropy:'up_ascii_down_entropy',up_entropy_down_ascii:'up_entropy_down_ascii'};
   const p={id:node.id,name:node.name||'Proxy',server:j.h,port:Number(j.p),protocol:'sudoku',key:j.k,aeadMethod:j.e||'none',asciiMode:ascii[j.a||'entropy'],paddingMin:5,paddingMax:15,enablePureDownlink:!j.x,multiplex:j.hx||'off',httpMask:{disable:j.hd??false,mode:j.hm||'legacy',tls:j.ht??false,host:j.hh||'',pathRoot:j.hy||''}};
   if(!p.asciiMode)return null;
   const legacy=(j.t??j.table??j.custom_table??'').trim();p.customTables=j.ts??(legacy?[legacy]:[]);
   return validateNative(p);
  }
  const u=new URL(node.uri),scheme=u.protocol.slice(0,-1),q=u.searchParams;const all=[...q.keys()];if(new Set(all).size!==all.length)return null;
  if(u.pathname&&u.pathname!=='/')return null;
  const p={id:node.id,name:node.name||'Proxy',server:u.hostname.replace(/^\[|\]$/g,''),port:Number(u.port||(['http','https'].includes(scheme)?scheme==='https'?443:80:0))};
  const user=decodeURIComponent(u.username),pass=decodeURIComponent(u.password);const known=(keys)=>all.every(k=>keys.includes(k));const bool=(v)=>{if(!['0','1'].includes(v))throw Error();return v==='1';};
  if(scheme==='nowhere'){if(!known(['net','morph'])||u.password||!/^[0-9a-f]{32}$/.test(user))return null;Object.assign(p,{protocol:'nowhere',key:user,network:q.get('net')||'tcp',morph:q.has('morph')?bool(q.get('morph')):true});}
  else if(scheme==='vless'){
   if(!known(['type','security','flow','encryption','sni','fp','pbk','sid','alpn','insecure','allowInsecure','ech','host','path','serviceName','authority','mode','extra'])||u.password)return null;
   Object.assign(p,{protocol:'vless',uuid:user});for(const k of ['flow','encryption'])if(q.get(k))p[k]=q.get(k);
   const security=q.get('security')||'none';p.security={type:security};const sk={sni:'sni',fp:'fingerprint',pbk:'publicKey',sid:'shortId'};for(const [a,b]of Object.entries(sk))if(q.has(a))p.security[b]=q.get(a);if(q.has('alpn'))p.security.alpn=q.get('alpn').split(',');if(q.has('insecure')&&q.has('allowInsecure')&&q.get('insecure')!==q.get('allowInsecure'))return null;if(q.has('insecure')||q.has('allowInsecure'))p.security.insecure=bool(q.get('insecure')||q.get('allowInsecure'));if(q.has('ech'))p.security.ech=['0','1'].includes(q.get('ech'))?bool(q.get('ech')):q.get('ech');
   const type=q.get('type')||'tcp';p.transport={type:type==='tcp'?'raw':type};for(const k of ['host','path','serviceName','authority','mode'])if(q.has(k))p.transport[k]=q.get(k);if(q.has('extra')){if(type!=='xhttp')return null;const extra=JSON.parse(q.get('extra'));if(!object(extra)||'type'in extra)return null;safeJson(extra);p.transport={...extra,...p.transport};}
  }
  else if(['trojan','anytls'].includes(scheme)){if(!known(['sni','peer','insecure','allowInsecure','type','ici','it','mis'])||u.password||(q.has('type')&&q.get('type')!=='tcp')||(q.has('peer')&&q.has('sni')&&q.get('peer')!==q.get('sni')))return null;Object.assign(p,{protocol:scheme,password:user,security:{type:'tls'}});if(q.get('sni')||q.get('peer'))p.security.sni=q.get('sni')||q.get('peer');if(q.has('insecure')&&q.has('allowInsecure')&&q.get('insecure')!==q.get('allowInsecure'))return null;if(q.has('insecure')||q.has('allowInsecure'))p.security.insecure=bool(q.get('insecure')||q.get('allowInsecure'));for(const [a,b]of [['ici','idleCheckInterval'],['it','idleTimeout'],['mis','minIdleSession']])if(q.has(a)){if(scheme!=='anytls')return null;p[b]=Number(q.get(a));}}
  else if(['hysteria2','hy2'].includes(scheme)){if(!known(['sni','obfs','obfs-password','obfs-min-packet-size','obfs-max-packet-size','upmbps','downmbps'])||u.password)return null;Object.assign(p,{protocol:'hysteria',password:user});if(q.has('sni'))p.sni=q.get('sni');for(const [a,b]of [['upmbps','upMbps'],['downmbps','downMbps']])if(q.has(a))p[b]=Number(q.get(a));if(q.has('obfs'))p.obfs={type:q.get('obfs'),password:q.get('obfs-password')||''};else if(['obfs-password','obfs-min-packet-size','obfs-max-packet-size'].some(k=>q.has(k)))return null;for(const [a,b]of [['obfs-min-packet-size','minPacketSize'],['obfs-max-packet-size','maxPacketSize']])if(q.has(a))p.obfs[b]=Number(q.get(a));}
  else if(['socks','socks5','http','https','rfc'].includes(scheme)){if(all.length)return null;Object.assign(p,{protocol:['socks','socks5'].includes(scheme)?'socks5':'rfc'});if(user)p.username=user;if(pass)p.password=pass;if(p.protocol==='rfc')p.security={type:scheme==='http'?'none':'tls'};}
  else if(scheme==='ss'){if(all.length)return null;const credentials=u.password?user+':'+pass:Buffer.from(user.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');const split=credentials.indexOf(':');if(split<1)return null;Object.assign(p,{protocol:'shadowsocks',method:credentials.slice(0,split),password:credentials.slice(split+1)});}
  else return null;
  return validateNative(p);
 } catch (_) { return null; }
}
module.exports={nativeFromUri,validateNative,checkAdvanced,merge,object};
