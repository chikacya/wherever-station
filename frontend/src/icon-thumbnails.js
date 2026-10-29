import { readIconBlob } from './icon-libraries.js';
const cache=new Map(), queue=[],pending=new Map();
let active=0,cacheBytes=0;
const MAX_BYTES=12*1024*1024, MAX_ENTRIES=96;
function remember(url,blob) {
  if(cache.has(url))cacheBytes-=cache.get(url).size;cache.delete(url);cache.set(url,blob);cacheBytes+=blob.size;
  while(cache.size>MAX_ENTRIES||cacheBytes>MAX_BYTES){const first=cache.keys().next().value;cacheBytes-=cache.get(first).size;cache.delete(first);}
}
function aborted(){return new DOMException('Aborted','AbortError');}
function pause(ms,signal){return new Promise((resolve,reject)=>{const finish=()=>{signal?.removeEventListener('abort',cancel);resolve();};const timer=setTimeout(finish,ms);const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(aborted());};if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});});}
async function load(url,signal,refresh) {
  for(let attempt=0;attempt<3;attempt++){
    if(signal?.aborted)throw aborted();
    try {const blob=await readIconBlob(url,signal,refresh||attempt>0);remember(url,blob);return blob;}
    catch(error){if(signal?.aborted)throw aborted();if(attempt===2||[400,401,403,404,410].includes(error.status))throw error;await pause(attempt===0?500:1500,signal);}
  }
}
function settle(job,error,blob) {
  if(pending.get(job.url)===job)pending.delete(job.url);
  for(const client of job.clients){client.signal?.removeEventListener('abort',client.cancel);if(error)client.reject(error);else client.resolve(blob);}job.clients.clear();
}
function pump(){while(active<4&&queue.length){const job=queue.shift();if(job.controller.signal.aborted){settle(job,aborted());continue;}active++;load(job.url,job.controller.signal,job.refresh).then(blob=>settle(job,null,blob),error=>settle(job,error)).finally(()=>{active--;pump();});}}
export function discardThumbnail(url) {if(cache.has(url)){cacheBytes-=cache.get(url).size;cache.delete(url);}}
export function loadThumbnail(url,signal,refresh=false) {
  if(signal?.aborted)return Promise.reject(aborted());
  if(refresh)discardThumbnail(url);
  if(cache.has(url)){const blob=cache.get(url);cache.delete(url);cache.set(url,blob);return Promise.resolve(blob);}
  let job=pending.get(url);
  if(!job||job.controller.signal.aborted){job={url,refresh,controller:new AbortController(),clients:new Set()};pending.set(url,job);queue.push(job);}
  const result=new Promise((resolve,reject)=>{
    const client={signal,resolve,reject,cancel:()=>{job.clients.delete(client);signal?.removeEventListener('abort',client.cancel);reject(aborted());if(!job.clients.size)job.controller.abort();}};
    job.clients.add(client);signal?.addEventListener('abort',client.cancel,{once:true});
  });pump();return result;
}
