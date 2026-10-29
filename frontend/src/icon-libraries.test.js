import { afterEach, describe, expect, it, vi } from 'vitest';
import { ICON_LIBRARIES, ICON_PAGE_SIZE, iconResourceUrl, parseIconLibrary, readLimited, loadIconLibrary } from './icon-libraries.js';
afterEach(()=>vi.unstubAllGlobals());
describe('icon library boundaries and loading',()=>{
  it('includes all requested libraries and converts web URLs to CORS endpoints',()=>{
    expect(ICON_LIBRARIES).toHaveLength(14);expect(ICON_PAGE_SIZE).toBeLessThanOrEqual(48);
    expect(iconResourceUrl('https://github.com/user/repo/raw/main/a.png')).toBe('https://raw.githubusercontent.com/user/repo/main/a.png');
    expect(iconResourceUrl('https://github.com/user/repo/raw/refs/heads/main/a.png')).toBe('https://raw.githubusercontent.com/user/repo/main/a.png');
    expect(iconResourceUrl('https://gitlab.com/lodepuly/iconlibrary/-/raw/main/Flag_icon/120px/AD.png')).toBe('https://gitlab.com/api/v4/projects/lodepuly%2Ficonlibrary/repository/files/Flag_icon%2F120px%2FAD.png/raw?ref=main');
  });
  it('skips malformed entries, de-duplicates and rejects non-image-source hosts',()=>{
    const good={name:'Test',url:'https://raw.githubusercontent.com/a/b/main/a.png'};
    const result=parseIconLibrary({icons:[good,good,{name:'bad',url:'javascript:alert(1)'},{name:'bad',url:'http://localhost/a.png'},{name:'bad',url:'https://example.com/a.png'},{name:'bad',url:'https://user:pass@raw.githubusercontent.com/a.png'}]});
    expect(result.icons).toEqual([good]);expect(()=>parseIconLibrary({icons:[]})).toThrow();expect(()=>parseIconLibrary({icons:new Array(5001)})).toThrow();
  });
  it('enforces response size even without content-length and cancels the stream',async()=>{
    let cancelled=false;
    const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8));controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
    await expect(readLimited(new Response(stream),10)).rejects.toThrow('文件过大');expect(cancelled).toBe(true);
    await expect(readLimited(new Response('x',{status:404}),10)).rejects.toThrow('404');
  });
  it('caches successful catalogs but refreshes only on request; failed refresh keeps previous data',async()=>{
    const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({icons:[{name:'A',url:'https://raw.githubusercontent.com/a/b/main/a.png'}]}))));vi.stubGlobal('fetch',fetcher);
    const first=await loadIconLibrary('orz-plus');expect((await loadIconLibrary('orz-plus'))).toBe(first);expect(fetcher).toHaveBeenCalledTimes(1);
    await loadIconLibrary('orz-plus',{refresh:true});expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockRejectedValueOnce(Error('offline'));await expect(loadIconLibrary('orz-plus',{refresh:true})).rejects.toThrow('offline');expect((await loadIconLibrary('orz-plus')).icons[0].name).toBe('A');
  });
});
