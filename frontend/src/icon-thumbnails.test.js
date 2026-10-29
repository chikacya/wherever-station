import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadThumbnail } from './icon-thumbnails.js';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
describe('thumbnail queue',()=>{
  it('limits active downloads to four and reuses successful images',async()=>{
    const pending=[];let active=0,max=0;
    const fetcher=vi.fn(()=>{active++;max=Math.max(max,active);return new Promise(resolve=>pending.push(()=>{active--;resolve(new Response(png));}));});vi.stubGlobal('fetch',fetcher);
    const jobs=Array.from({length:8},(_,i)=>loadThumbnail('https://raw.githubusercontent.com/test/queue/main/'+i+'.png'));
    expect(fetcher).toHaveBeenCalledTimes(4);
    for(let i=0;i<8;i++){while(!pending.length)await new Promise(resolve=>setTimeout(resolve,0));pending.shift()();await new Promise(resolve=>setTimeout(resolve,0));}
    const results=await Promise.all(jobs);expect(max).toBe(4);expect(await loadThumbnail('https://raw.githubusercontent.com/test/queue/main/0.png')).toBe(results[0]);expect(fetcher).toHaveBeenCalledTimes(8);
  });
  it('automatically retries transient errors, but not missing files',async()=>{
    vi.useFakeTimers();const fetcher=vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValueOnce(new Response(png));vi.stubGlobal('fetch',fetcher);
    const job=loadThumbnail('https://raw.githubusercontent.com/test/retry/main/one.png');await vi.advanceTimersByTimeAsync(501);expect((await job).type).toBe('image/png');expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce(new Response('gone',{status:404}));await expect(loadThumbnail('https://raw.githubusercontent.com/test/retry/main/gone.png')).rejects.toMatchObject({status:404});expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not load already-cancelled work',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const controller=new AbortController();controller.abort();await expect(loadThumbnail('https://raw.githubusercontent.com/test/cancel/main/one.png',controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(fetcher).not.toHaveBeenCalled();
  });
});

it('shares in-flight downloads and cancelling one consumer keeps another alive',async()=>{
  let finish;const fetcher=vi.fn(()=>new Promise(resolve=>{finish=()=>resolve(new Response(png));}));vi.stubGlobal('fetch',fetcher);
  const controller=new AbortController();const first=loadThumbnail('https://raw.githubusercontent.com/test/shared/main/one.png',controller.signal);const second=loadThumbnail('https://raw.githubusercontent.com/test/shared/main/one.png');
  const rejected=expect(first).rejects.toMatchObject({name:'AbortError'});controller.abort();finish();await rejected;expect((await second).type).toBe('image/png');expect(fetcher).toHaveBeenCalledTimes(1);
});
