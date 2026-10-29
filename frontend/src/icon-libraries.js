const raw = 'https://raw.githubusercontent.com/';
export const ICON_LIBRARIES = [
  ['orz-color','Orz-3 彩色 A',raw+'Orz-3/mini/master/miniColor.json'],
  ['orz-plus','Orz-3 彩色 B',raw+'Orz-3/mini/master/mini+.json'],
  ['orz-mini','Orz-3 彩色 C',raw+'Orz-3/mini/master/mini.json'],
  ['orz-face','Orz-3 彩色 D',raw+'Orz-3/face/master/face.json'],
  ['qq','QQ 经典',raw+'ginibond/ginibond/main/Icons/QQ_Classic/tubiao.json'],
  ['qure','QureColor All',raw+'Koolson/Qure/master/Other/QureColor-All.json'],
  ['semporia','Semporia',raw+'Semporia/Hand-Painted-icon/master/Semporia.json'],
  ['shindgewongxj','shindgewongxj',raw+'shindgewongxj/WHATSINStash/main/icon/iconset.json'],
  ['themagic','TheMagic',raw+'Twoandz9/TheMagic-Icons/main/TheRaw.json'],
  ['tugepaopao','tugepaopao',raw+'tugepaopao/Image-Storage/master/other/Cute.json'],
  ['cartoon','可爱卡通',raw+'ginibond/ginibond/main/Icons/Cute_Cartoon/tubiao.json'],
  ['flags','彩色静态旗帜','https://gitlab.com/lodepuly/iconlibrary/-/raw/main/Flag_icon/ColorfulStaticFlag.json'],
  ['rage','暴怒表情',raw+'ginibond/ginibond/main/Icons/RageBaby/tubiao.json'],
  ['characters','角色',raw+'ginibond/ginibond/main/Icons/character/tubiao.json'],
].map(([id,name,url])=>({id,name,url}));
export const ICON_PAGE_SIZE = 36;
const cache = new Map(), TTL = 30 * 60 * 1000;
// GitHub's web raw links and GitLab's raw pages need canonical CORS endpoints.
export function iconResourceUrl(input) {
  const u = new URL(input);
  if(u.protocol !== 'https:' || u.username || u.password || u.port) throw Error('图标地址无效');
  if(u.hostname === 'github.com') {
    const match=u.pathname.match(/^\/([^/]+)\/([^/]+)\/raw\/(?:refs\/heads\/)?(.+)$/);
    if(!match) throw Error('图标地址无效');
    return raw+match[1]+'/'+match[2]+'/'+match[3];
  }
  if(u.hostname === 'gitlab.com') {
    const match=u.pathname.match(/^\/(.+)\/-\/raw\/([^/]+)\/(.+)$/);
    if(!match) throw Error('图标地址无效');
    return 'https://gitlab.com/api/v4/projects/'+encodeURIComponent(decodeURIComponent(match[1]))+'/repository/files/'+encodeURIComponent(decodeURIComponent(match[3]))+'/raw?ref='+encodeURIComponent(match[2]);
  }
  if(u.hostname !== 'raw.githubusercontent.com') throw Error('此图标地址暂不支持');
  return u.href;
}
export function parseIconLibrary(document) {
  if(!document || !Array.isArray(document.icons) || document.icons.length > 5000) throw Error('图标库格式无效');
  const seen=new Set(),icons=[];
  for(const item of document.icons) {
    if(typeof item?.name !== 'string' || !item.name.trim() || typeof item.url !== 'string') continue;
    try {
      const url=iconResourceUrl(item.url);if(seen.has(url))continue;seen.add(url);
      icons.push({name:item.name.trim().slice(0,120),url});
    } catch { /* Unusable entries do not prevent browsing the rest of the library. */ }
  }
  if(!icons.length) throw Error('图标库中没有可用图标');
  return {icons,description:typeof document.description === 'string' ? document.description.slice(0,200) : ''};
}
export async function readLimited(response, maxBytes) {
  if(!response.ok) { await response.body?.cancel(); const error=Error('下载失败（HTTP '+response.status+'）');error.status=response.status;throw error; }
  if(Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel();throw Error('文件过大'); }
  const reader=response.body?.getReader();
  if(!reader){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>maxBytes)throw Error('文件过大');return bytes;}
  const chunks=[];let length=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxBytes){await reader.cancel();throw Error('文件过大');}chunks.push(value);}
  } finally { reader.releaseLock(); }
  const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
async function download(url, limit, signal, refresh=false) {
  const controller=new AbortController();
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(abort,12000);
  try { return await readLimited(await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:refresh?'reload':'default'}),limit); }
  finally { clearTimeout(timer);signal?.removeEventListener('abort',abort); }
}
export async function loadIconLibrary(id, {signal,refresh=false}={}) {
  const source=ICON_LIBRARIES.find(item=>item.id===id);if(!source)throw Error('图标库不存在');
  const hit=cache.get(id);if(!refresh&&hit&&Date.now()-hit.time<TTL)return hit.data;
  const bytes=await download(iconResourceUrl(source.url),1024*1024,signal);
  const data=parseIconLibrary(JSON.parse(new TextDecoder().decode(bytes)));cache.set(id,{data,time:Date.now()});return data;
}
export async function readIconBlob(url, signal, refresh=false) {
  const bytes=await download(url,2*1024*1024,signal,refresh);
  const mime=bytes[0]===137&&bytes[1]===80?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':'';
  if(!mime)throw Error('该图片无法使用，请选择 PNG、JPEG 或 WebP 图标');
  return new Blob([bytes],{type:mime});
}
export async function downloadIcon(url, signal, cachedBlob) {
  const bitmap=await createImageBitmap(cachedBlob || await readIconBlob(url,signal));
  try {
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const scale=Math.min(1,256/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob||blob.size>256*1024)throw Error('图标转换失败，请换一张图片');
    const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('图标读取失败'));reader.readAsDataURL(blob);});
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');return base64;
  } finally { bitmap.close(); }
}
