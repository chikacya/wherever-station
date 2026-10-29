import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import { Button, Field, IconButton } from './ui-shared.jsx';
import { loadThumbnail, discardThumbnail } from './icon-thumbnails.js';
import { ICON_LIBRARIES, ICON_PAGE_SIZE, loadIconLibrary, downloadIcon } from './icon-libraries.js';

function Thumbnail({icon,retry=0}) {
  const initialRetry=useRef(retry),successful=useRef(false);
  const host=useRef(null),[visible,setVisible]=useState(false),[state,setState]=useState({});
  useEffect(()=>{
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'80px'});
    if(host.current)observer.observe(host.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!visible)return;
    const controller=new AbortController();let url;
    setState({});loadThumbnail(icon.url,controller.signal,retry!==initialRetry.current&&!successful.current).then(blob=>{if(!controller.signal.aborted){url=URL.createObjectURL(blob);successful.current=true;setState({url});}}).catch(error=>{if(!controller.signal.aborted)setState({error:[404,410].includes(error.status)?'链接失效':'加载失败'});});
    return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
  },[visible,icon.url,retry]);
  return <span ref={host} className="icon-thumb" title={state.error ? state.error+'，可点击“重试本页图片”' : undefined}>
    {state.url ? <img src={state.url} alt="" decoding="async" onError={()=>{successful.current=false;discardThumbnail(icon.url);setState({error:'图片无效'});}}/> : <span className={'icon-thumb-fallback'+(state.error?' failed':'')} aria-label={state.error||'图片加载中'}>{state.error||'加载中'}</span>}
  </span>;
}
export default function IconLibraryPicker({onApply,onClose}) {
  const [library,setLibrary]=useState('orz-color'),[catalog,setCatalog]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [query,setQuery]=useState(''),[page,setPage]=useState(0),[selected,setSelected]=useState(null),[refresh,setRefresh]=useState(0),[applying,setApplying]=useState(false),[applyError,setApplyError]=useState(''),[imageRetry,setImageRetry]=useState(0);
  const root=useRef(null),search=useRef(null),selectionRequest=useRef(null),scroll=useRef(null),currentLibrary=ICON_LIBRARIES.find(item=>item.id===library);
  const deferredQuery=useDeferredValue(query.trim().toLocaleLowerCase());
  useEffect(()=>{root.current?.scrollIntoView({block:'start'});search.current?.focus({preventScroll:true});return()=>selectionRequest.current?.abort();},[]);
  useEffect(()=>{
    const controller=new AbortController();let active=true;setLoading(true);setError('');setCatalog(null);
    loadIconLibrary(library,{signal:controller.signal,refresh:refresh>0}).then(data=>{if(active)setCatalog(data);}).catch(()=>{if(active)setError('图库加载失败，请重试或切换其他图库。也可以继续使用本地上传。');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[library,refresh]);
  const filtered=useMemo(()=>catalog?.icons.filter(icon=>icon.name.toLocaleLowerCase().includes(deferredQuery))||[],[catalog,deferredQuery]);
  const pages=Math.max(1,Math.ceil(filtered.length/ICON_PAGE_SIZE));const currentPage=Math.min(page,pages-1);
  useEffect(()=>{scroll.current?.scrollTo({top:0});},[currentPage,library,deferredQuery]);
  const goPage=value=>{setPage(value);};
  const pageControls=()=><div className="icon-library-pagination" aria-label="图标分页"><div><Button icon={ChevronLeft} aria-label="上一页图标" disabled={currentPage===0} onClick={()=>goPage(currentPage-1)}>上一页</Button><span>第 <strong>{currentPage+1}</strong> / {pages} 页</span><Button icon={ChevronRight} variant={currentPage<pages-1?'primary':'secondary'} aria-label="下一页图标" disabled={currentPage>=pages-1} onClick={()=>goPage(currentPage+1)}>下一页</Button></div></div>;
  const chooseLibrary=value=>{selectionRequest.current?.abort();setLibrary(value);setRefresh(0);setQuery('');setPage(0);setSelected(null);setApplyError('');setApplying(false);};
  const apply=async()=>{
    if(!selected||applying)return;
    const controller=new AbortController();selectionRequest.current=controller;setApplying(true);setApplyError('');
    try {const blob=await loadThumbnail(selected.url,controller.signal);const data=await downloadIcon(selected.url,controller.signal,blob);if(!controller.signal.aborted){onApply(data);onClose();}}
    catch {if(!controller.signal.aborted)setApplyError('图标下载失败或图片不可用。请重试，或选择其他图标。');}
    finally {if(!controller.signal.aborted)setApplying(false);}
  };
  return <section ref={root} className="icon-library" aria-label="选择图库图标" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}}>
    <header><div><strong>从图标库选择</strong><span>选中预览，确认后应用到订阅</span></div><IconButton label="关闭图标库" onClick={onClose}><X size={16}/></IconButton></header>
    <div className="icon-library-toolbar">
      <Field label="图标库"><select aria-label="图标库" value={library} onChange={event=>chooseLibrary(event.target.value)}>{ICON_LIBRARIES.map(source=><option key={source.id} value={source.id}>{source.name}</option>)}</select></Field>
      <label><span>搜索图标</span><div className="icon-library-search"><Search size={15} aria-hidden="true"/><input ref={search} aria-label="搜索图标" value={query} placeholder="输入图标名称" onChange={event=>{setQuery(event.target.value);setPage(0);}}/></div></label>
      <IconButton label="刷新图标库" disabled={loading} onClick={()=>{selectionRequest.current?.abort();setApplying(false);setApplyError('');setRefresh(value=>value+1);setSelected(null);}}><RefreshCw size={16}/></IconButton>
    </div>
    <div className="icon-library-meta"><span>{loading?'正在加载…':error?'暂时无法加载':`${filtered.length} 个图标`}</span><a href={currentLibrary.url} target="_blank" rel="noreferrer">来源与作者</a></div>
    {!loading&&!error&&filtered.length>0&&<div className="icon-library-browse"><p>共 {filtered.length} 个图标 · 当前显示 {currentPage*ICON_PAGE_SIZE+1}–{Math.min((currentPage+1)*ICON_PAGE_SIZE,filtered.length)} 个</p>{pageControls()}</div>}
    <div className="icon-library-grid-wrap" ref={scroll} aria-busy={loading}>
      {loading ? <div className="icon-library-empty" role="status">正在加载 {currentLibrary.name}…</div> : error ? <div className="icon-library-empty" role="alert"><p>{error}</p><Button onClick={()=>setRefresh(value=>value+1)}>重新加载</Button></div> : !filtered.length ? <div className="icon-library-empty" role="status">没有匹配图标，试试其他名称或图库。</div> : <div className="icon-library-grid">{filtered.slice(currentPage*ICON_PAGE_SIZE,(currentPage+1)*ICON_PAGE_SIZE).map(icon=><button key={icon.url} type="button" title={icon.name} aria-label={`选择图标 ${icon.name}`} aria-pressed={selected?.url===icon.url} className={selected?.url===icon.url?'selected':''} onClick={()=>{selectionRequest.current?.abort();setApplying(false);setSelected(icon);setApplyError('');}}><Thumbnail icon={icon} retry={imageRetry}/><span>{icon.name}</span></button>)}</div>}
    </div>
    {!loading&&!error&&<div className="icon-library-bottom"><Button icon={RefreshCw} onClick={()=>setImageRetry(value=>value+1)}>重试本页图片</Button></div>}
    {!loading&&!error&&<p className="helper">图片加载失败会自动重试；仍不可用时可重试本页或换一个图标。</p>}
    <footer><div className="icon-library-selection">{selected?<><Thumbnail key={selected.url} icon={selected} retry={imageRetry}/><span>{selected.name}</span></>:<span>尚未选择图标</span>}</div><div className="ajson-actions"><Button onClick={onClose}>取消</Button><Button variant="primary" icon={Check} onClick={apply} disabled={!selected||applying}>{applying?'正在应用…':'使用此图标'}</Button></div></footer>
    {applyError&&<p className="form-error" role="alert">{applyError}</p>}
    <p className="icon-library-credit">{catalog?.description || '图标由各图库作者提供。'} 选中图标会保存在订阅中。</p>
  </section>;
}
