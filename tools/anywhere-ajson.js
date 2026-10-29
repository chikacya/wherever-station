const { nativeFromUri, validateNative, checkAdvanced, merge, object } = require('./anywhere-native');
const SCHEMES = new Set(['nowhere','vless','hysteria2','hy2','sudoku','trojan','anytls','ss','socks5','socks','rfc','http','https']);
function ajsonSupported(node) { return SCHEMES.has(String(node.uri || '').split(':', 1)[0].toLowerCase()); }
function cleanIcon(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 350000) throw Error('订阅图标不能超过 256 KiB');
  const text=value.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw Error('图标 Base64 无效');
  const bytes=Buffer.from(text,'base64');
  if (bytes.length>256*1024 || bytes.length<12) throw Error('订阅图标必须为不超过 256 KiB 的 PNG/JPEG/WebP');
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const webp=bytes.subarray(0,4).equals(Buffer.from('RIFF'))&&bytes.subarray(8,12).equals(Buffer.from('WEBP'));
  if(!png&&!jpeg&&!webp)throw Error('图标只支持 PNG/JPEG/WebP');
  return text;
}
function cleanAjsonSettings(value) {
  if(value==null)return {icons:{},templates:{},overrides:{}};
  if(!object(value))throw Error('AJSON 设置必须为对象');
  for(const key of Object.keys(value))if(!['icons','templates','overrides'].includes(key))throw Error('AJSON 设置键无效：'+key);
  if(value.icons!=null&&!object(value.icons))throw Error('图标设置必须为对象');
  const icons={},templates={},overrides={};
  for(const theme of ['light','dark']) { const icon=cleanIcon(value.icons?.[theme]); if(icon)icons[theme]=icon; }
  const sharedIcon=icons.light||icons.dark;
  if(sharedIcon){icons.light=sharedIcon;icons.dark=sharedIcon;}
  if(value.templates!=null&&!object(value.templates))throw Error('AJSON 模板必须为对象');
  if(Object.keys(value.templates||{}).length>30)throw Error('最多 30 个 AJSON 模板');
  for(const [name,settings]of Object.entries(value.templates||{})){if(['__proto__','constructor','prototype'].includes(name)||!/^[A-Za-z0-9_-]{1,64}$/.test(name))throw Error('模板名称限字母、数字、下划线和连字符');templates[name]=checkAdvanced(settings);}
  if(value.overrides!=null&&!object(value.overrides))throw Error('AJSON 节点设置必须为对象');
  if(Object.keys(value.overrides||{}).length>500)throw Error('AJSON 节点设置过多');
  for(const [id,entry]of Object.entries(value.overrides||{})){
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)||!object(entry))throw Error('AJSON 节点设置无效');
    if(Object.keys(entry).some(k=>!['template','settings'].includes(k)))throw Error('AJSON 节点设置包含未知字段');
    const template=entry.template||'';if(typeof template!=='string')throw Error('AJSON 模板名称必须为字符串');if(template&&!Object.prototype.hasOwnProperty.call(templates,template))throw Error('AJSON 引用了不存在的模板');
    overrides[id]={template,settings:checkAdvanced(entry.settings||{})};
  }
  return {icons,templates,overrides};
}
function ajsonProxy(node,config) {
  const base=nativeFromUri(node),entry=config.overrides[node.id];
  if(!base){if(entry&&(entry.template||Object.keys(entry.settings).length))throw Error('此节点 URI 含尚未适配的参数，不能覆盖原生高级设置：'+node.name);return {id:node.id,name:node.name||'Proxy',link:node.uri};}
  const settings=entry?merge(entry.template?config.templates[entry.template]:{},entry.settings):{};
  const result=validateNative(merge(base,settings));
  if(entry?.template){const emitted={...result,use:entry.template};for(const [key,value]of Object.entries(config.templates[entry.template]))if(JSON.stringify(emitted[key])===JSON.stringify(value))delete emitted[key];return emitted;}
  return result;
}
function renderAjson(nodes, subscription, usage) {
  const ids = new Set();
  const config=cleanAjsonSettings(subscription.ajson);
  for(const node of nodes) {const entry=config.overrides[node.id];if(!ajsonSupported(node)&&entry&&(entry.template||Object.keys(entry.settings).length))throw Error('此节点协议不支持 AJSON 原生设置：'+node.name);}
  const proxies = nodes.filter(ajsonSupported).map(node => {
    const id = String(node.id || '');
    if (!id || ids.has(id)) throw new Error('AJSON 节点 ID 缺失或重复');
    ids.add(id);
    return ajsonProxy({...node,id},config);
  });
  if (!proxies.length) throw new Error('AJSON 没有兼容节点，未生成空订阅');
  const result = { anywhere: 1, name: subscription.name, proxies };
  if(Object.keys(config.icons).length)result.icon=config.icons;
  const used=new Set(proxies.map(p=>p.use).filter(Boolean));
  if(used.size)result.templates=Object.fromEntries([...used].map(name=>[name,config.templates[name]]));
  if (usage) {
    result.usage = {};
    for (const key of ['upload', 'download', 'total', 'expire']) {
      if (Number.isSafeInteger(usage[key]) && usage[key] >= 0) result.usage[key] = usage[key];
    }
  }
  return { body: JSON.stringify(result, null, 2) + '\n', type: 'application/json; charset=utf-8' };
}
function validateAjson(body) {
  const document = JSON.parse(body), ids = new Set();
  if (document.anywhere !== 1 || !Array.isArray(document.proxies) || !document.proxies.length) throw new Error('AJSON 文档无效');
  for (const proxy of document.proxies) {
    if (typeof proxy.id !== 'string' || !proxy.id || ids.has(proxy.id) || typeof proxy.name !== 'string' || !proxy.name.trim()) throw new Error('AJSON 节点无效');
    if(proxy.link) { if(!ajsonSupported({uri:proxy.link}))throw Error("AJSON link 无效"); }
    else { const expanded=proxy.use?merge(document.templates?.[proxy.use]||{},proxy):{...proxy};delete expanded.use;validateNative(expanded); }
    ids.add(proxy.id);
  }
}
module.exports = { ajsonSupported, renderAjson, validateAjson, cleanAjsonSettings, nativeFromUri, ajsonProxy };
