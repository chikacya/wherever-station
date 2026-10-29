import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button, Field, rpc } from './ui-shared.jsx';

import { mergeSettings, effectiveRows, iconDataUrl } from './ajson-display.js';
import { presetsFor } from './ajson-presets.js';
import { Images, Upload, Trash2, Check } from 'lucide-react';

const IconLibraryPicker = lazy(() => import('./IconLibraryPicker.jsx'));

export default function AjsonEditor({ value, onChange, nodes, subscription, onValidityChange }) {
  const settings = value || { icons: {}, templates: {}, overrides: {} };
  const fileInput = useRef(null);
  const galleryTrigger = useRef(null);
  const [galleryOpen,setGalleryOpen] = useState(false);
  const closeGallery = () => { setGalleryOpen(false); galleryTrigger.current?.querySelector('button')?.focus(); };
  const icon = settings.icons?.light || settings.icons?.dark;
  const [selected, setSelected] = useState(nodes[0]?.id || '');
  const [templateText, setTemplateText] = useState(() => JSON.stringify(settings.templates || {}, null, 2));
  const [nodeText, setNodeText] = useState('{}');
  const [errors, setErrors] = useState({});
  const [preview, setPreview] = useState(null);
  const [pendingTemplate, setPendingTemplate] = useState(null);
  const [effective, setEffective] = useState({ loading: true });
  const [previewing, setPreviewing] = useState(false);
  const entry = settings.overrides?.[selected] || { template: '', settings: {} };
  useEffect(() => { setNodeText(JSON.stringify(settings.overrides?.[selected]?.settings || {}, null, 2)); setErrors(old => ({ ...old, node: '' })); }, [selected]);
  useEffect(() => { onValidityChange(!Object.values(errors).some(Boolean)); }, [errors, onValidityChange]);
  const patch = next => { onChange({ ...settings, ...next }); setPreview(null); setErrors(old => ({ ...old, server: '' })); };
  const changeEntry = next => patch({ overrides: { ...(settings.overrides || {}), [selected]: { ...entry, ...next } } });
  const presets = presetsFor(nodes.find(node => node.id === selected)?.protocol);
  const applyTemplate = name => {
    if (!name.startsWith('preset:')) { changeEntry({ template: name, settings: {} }); setNodeText('{}'); setErrors(old => ({...old,node:''})); return; }
    const preset = presets.find(item => 'preset:' + item.id === name);
    if (!preset) return;
    const templates = { ...(settings.templates || {}) };
    let key = 'builtin_' + preset.id;
    for (let suffix = 2; templates[key] && JSON.stringify(templates[key]) !== JSON.stringify(preset.settings); suffix++) key = 'builtin_' + preset.id + '_' + suffix;
    templates[key] = structuredClone(preset.settings);
    patch({ templates, overrides: { ...(settings.overrides || {}), [selected]: { template: key, settings: {} } } });
    setNodeText('{}');
    setTemplateText(JSON.stringify(templates, null, 2));
    setErrors(old => ({ ...old, templates: '', node: '' }));
  };
  const chooseTemplate = name => {
    if (Object.keys(entry.settings || {}).length || errors.node) setPendingTemplate({ node: selected, name });
    else applyTemplate(name);
  };
  const resetNode = () => {
    const overrides = { ...(settings.overrides || {}) }; delete overrides[selected]; patch({ overrides });
    setNodeText('{}'); setPendingTemplate(null); setErrors(old => ({ ...old, node: '', server: '' }));
  };
  const custom = Boolean(entry.template || Object.keys(entry.settings || {}).length);
  const chosenSettings = mergeSettings(settings.templates?.[entry.template] || {}, entry.settings || {});
  const selectedNode = nodes.find(node => node.id === selected);
  const protocol = selectedNode?.protocol;
  const signature = JSON.stringify(settings);
  useEffect(() => {
    let active = true; setEffective({ loading: true });
    if (!selected) return () => { active = false; };
    const timer = setTimeout(async () => {
      try {
        const result = await rpc('proxyConsole:previewAjsonSubscription', { subscription: { ...subscription, nodeIds: [selected], groups: [], ajson: settings } });
        if (active) setEffective({ proxy: result.document.proxies.find(p => p.id === selected), templates: result.document.templates });
      } catch (error) { if (active) setEffective({ error: error.message }); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [selected, signature, selectedNode?.uri]);
  const updateField = (path, value) => {
    const next = structuredClone(entry.settings || {}); const parts = path.split('.');
    let parent = next;
    for (const key of parts.slice(0,-1)) { if (!parent[key] || typeof parent[key] !== 'object') parent[key] = {}; parent = parent[key]; }
    if (value === '') delete parent[parts.at(-1)]; else parent[parts.at(-1)] = value;
    for (const key of Object.keys(next)) if (next[key] && typeof next[key] === 'object' && !Object.keys(next[key]).length) delete next[key];
    changeEntry({ settings: next }); setNodeText(JSON.stringify(next,null,2)); setErrors(old => ({ ...old, node: '' }));
  };
  const field = (label, path, options, numeric = false) => {
    const current = path.split('.').reduce((value,key) => value?.[key], entry.settings || {});
    return <Field key={path} label={label}>{options ? <select aria-label={label} value={current == null ? '' : String(current)} onChange={event => updateField(path, event.target.value === '' ? '' : event.target.value === 'true' ? true : event.target.value === 'false' ? false : event.target.value)}><option value="">沿用模板或节点</option>{options.map(([value,name]) => <option key={value} value={value}>{name}</option>)}</select> : <input aria-label={label} type={numeric ? 'number' : 'text'} min={numeric ? 0 : undefined} step={numeric ? 1 : undefined} placeholder="沿用模板或节点" value={current ?? ''} onChange={event => updateField(path, event.target.value === '' ? '' : numeric ? Number(event.target.value) : event.target.value)} />}</Field>;
  };
  const parse = (kind, text) => {
    try {
      const parsed = JSON.parse(text); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error('必须是 JSON 对象');
      if (kind === 'templates') patch({ templates: parsed }); else changeEntry({ settings: parsed });
      setErrors(old => ({ ...old, [kind]: '' }));
    } catch (_) { setErrors(old => ({ ...old, [kind]: '请输入有效的 JSON 对象；修复前不能保存订阅' })); }
  };
  const upload = async (file) => {
    if (!file) return;
    setGalleryOpen(false);
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 256 * 1024) throw Error('请选择不超过 256 KiB 的 PNG/JPEG/WebP');
      const bitmap = await createImageBitmap(file); bitmap.close();
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      patch({ icons: { light: data, dark: data } }); setErrors(old => ({ ...old, icon: '' }));
    } catch (error) { setErrors(old => ({ ...old, icon: error.message || '图片无法读取' })); }
  };
  const inspect = async () => {
    setPreviewing(true);
    try { setPreview(await rpc('proxyConsole:previewAjsonSubscription', { subscription: { ...subscription, ajson: settings } })); setErrors(old => ({ ...old, server: '' })); }
    catch (error) { setErrors(old => ({ ...old, server: error.message })); }
    finally { setPreviewing(false); }
  };
  return <details className="quota-editor ajson-editor">
    <summary>Anywhere 原生参数与订阅图标</summary>
    <p>设置 Anywhere 的订阅图标和节点参数。保存后，下次更新 AJSON 订阅时生效。</p>
    <div className="ajson-body">
      <div className="ajson-icon-row">
        <div className="ajson-icon-preview">{icon ? <img src={iconDataUrl(icon)} alt="订阅图标预览" /> : <span>无图标</span>}</div>
        <div className="ajson-icon-controls"><strong>订阅图标</strong><span className="helper">PNG、JPEG 或 WebP，最大 256 KiB</span>
          <div className="ajson-actions">
            <span ref={galleryTrigger}><Button icon={Images} aria-expanded={galleryOpen} onClick={() => setGalleryOpen(open => !open)}>从图标库选择</Button></span>
            <Button icon={Upload} onClick={() => fileInput.current?.click()}>{icon ? '更换图标' : '上传图标'}</Button>
            <Button icon={Trash2} onClick={() => { patch({ icons: {} }); setErrors(old => ({ ...old, icon: '' })); }} disabled={!icon}>移除图标</Button>
          </div>
          <input ref={fileInput} className="ajson-file-input" aria-label="上传订阅图标" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
        </div>
      </div>
      {galleryOpen && <Suspense fallback={<p className="helper" role="status">正在打开图标库…</p>}><IconLibraryPicker onClose={closeGallery} onApply={data => { patch({ icons: { light:data, dark:data } });setErrors(old => ({ ...old, icon:'' })); }} /></Suspense>}
      <p className="helper">已有节点通常无需调整。选择节点后，可查看 Anywhere 实际使用的连接设置；需要时再展开自定义。</p>
      <div className="form-grid">
        <Field wide label="配置节点"><select aria-label="AJSON 配置节点" value={selected} onChange={event => { setSelected(event.target.value); setPendingTemplate(null); }}><option value="">请选择</option>{nodes.map(node => <option key={node.id} value={node.id}>{node.name} · {node.protocol}</option>)}</select></Field>
      </div>
      {selected && <>
        <div className="ajson-effective" aria-live="polite">
          <div className="ajson-effective-head"><strong>当前生效配置</strong><span>{custom ? '已自定义' : '沿用节点链接'}</span></div>
          {errors.node || errors.templates ? <p className="form-error">JSON 草稿尚未有效，请先修复后查看生效配置。</p> : effective.loading ? <p className="helper">正在读取连接设置…</p> : effective.error ? <p className="form-error">配置未通过检查：{effective.error}</p> : effective.proxy?.link ? <p className="helper">保留原始节点链接，连接参数由 Anywhere 读取。</p> : <dl>{effectiveRows(effective.proxy,effective.templates).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
          {Object.keys(entry.settings || {}).length > 0 && <p className="helper">包含单独设置的节点参数，上方已显示合并后的结果。</p>}
          {custom && <Button onClick={resetNode}>恢复节点参数</Button>}
        </div>
        <details className="ajson-advanced" key={'custom-' + selected}>
          <summary>自定义连接设置{custom ? ' · 已启用' : '（可选）'}</summary>
          <p className="helper">这些设置只影响 Anywhere，需与服务器提供的连接方式一致。</p>
          <div className="form-grid">
            <Field wide label="快速填入设置" hint="选择后会替换当前节点的单独设置；其他节点不受影响。"><select aria-label="AJSON 节点模板" value={entry.template || ''} onChange={event => chooseTemplate(event.target.value)}>
              <option value="">不使用预设</option>
              {!!presets.length && <optgroup label="内置预设">{presets.map(item => <option key={item.id} value={'preset:' + item.id}>{item.name}</option>)}</optgroup>}
              {!!Object.keys(settings.templates || {}).length && <optgroup label="订阅模板">{Object.keys(settings.templates || {}).map(name => <option key={name} value={name}>{presets.find(p => name === 'builtin_' + p.id)?.name || name}</option>)}</optgroup>}
            </select></Field>
          </div>
          {pendingTemplate?.node === selected && <div className="ajson-replace" role="alert"><p>当前节点有单独设置。切换预设将清除这些设置，使用新预设。</p><div className="ajson-actions"><Button onClick={() => { applyTemplate(pendingTemplate.name); setPendingTemplate(null); }}>替换当前设置</Button><Button onClick={() => setPendingTemplate(null)}>保留当前设置</Button></div></div>}
          {entry.template && <p className="helper">{presets.find(p => entry.template.startsWith('builtin_' + p.id))?.hint || '已引用订阅模板，可在下方继续调整此节点。'}</p>}
          <div className="form-grid">
            {protocol === 'nowhere' && <>{field('网络','network',[['tcp','TCP'],['udp','UDP']])}{field('Morph 混淆','morph',[[true,'开启'],[false,'关闭']])}{field('Prelude 模式','morphPrelude',[['fade','Fade'],['full8','Full8'],['low7','Low7']])}</>}
            {protocol === 'vless' && <>
              {field('传输方式','transport.type',[['raw','TCP'],['ws','WebSocket'],['xhttp','XHTTP'],['grpc','gRPC'],['httpupgrade','HTTP Upgrade']])}
              {['ws','xhttp','httpupgrade'].includes(chosenSettings.transport?.type || effective.proxy?.transport?.type) && <>{field('连接路径','transport.path')}{field('Host','transport.host')}</>}
              {(chosenSettings.transport?.type || effective.proxy?.transport?.type) === 'xhttp' && field('XHTTP 模式','transport.mode',[['auto','自动'],['stream-one','Stream One'],['stream-up','Stream Up'],['packet-up','Packet Up']])}
              {(chosenSettings.transport?.type || effective.proxy?.transport?.type) === 'grpc' && field('gRPC 服务名','transport.serviceName')}
            </>}
            {['hysteria2','hy2'].includes(protocol) && <>{field('拥塞控制','congestion',[['bbr','BBR'],['brutal','Brutal']])}{field('上行带宽（Mbps）','upMbps',null,true)}{field('下行带宽（Mbps）','downMbps',null,true)}</>}
            {protocol === 'anytls' && <>{field('会话检查间隔（秒）','idleCheckInterval',null,true)}{field('空闲超时（秒）','idleTimeout',null,true)}{field('最少空闲会话','minIdleSession',null,true)}</>}
            {protocol === 'sudoku' && field('连接复用','multiplex',[['off','关闭'],['auto','自动'],['on','开启']])}
          </div>
          <details className="ajson-advanced"><summary>专家模式（JSON）</summary>
            <p className="helper">用于表单未提供的高级选项。节点覆盖优先于订阅模板；修改后请查看上方生效配置。</p>
            <div className="form-grid"><Field wide label="节点覆盖参数"><textarea aria-label="AJSON 节点高级参数" rows={5} spellCheck={false} value={nodeText} onChange={event => { setNodeText(event.target.value); parse('node', event.target.value); }} /></Field></div>
            <details className="ajson-advanced"><summary>管理订阅模板</summary><p className="helper">模板供多个节点共用。修改一个模板会影响所有引用它的节点。</p><div className="form-grid"><Field wide label="自建模板"><textarea aria-label="AJSON 复用模板" rows={5} spellCheck={false} value={templateText} onChange={event => { setTemplateText(event.target.value); parse('templates', event.target.value); }} /></Field></div></details>
          </details>
        </details>
      </>}
    <div className="ajson-actions">
    <Button icon={Check} onClick={inspect} disabled={previewing || Object.entries(errors).some(([k,v]) => k !== 'server' && v)}>{previewing ? '检查中…' : '检查 AJSON 输出'}</Button></div>
    {Object.entries(errors).filter(([,error])=>error).map(([key,error])=><p role="alert" className="managed-error" key={key}>{error}</p>)}
    {preview && <div className="ajson-preview"><p>检查通过：原生节点 {preview.native} 个，原始链接 {preview.links} 个。</p><details><summary>查看完整 AJSON（包含节点凭据）</summary><pre>{JSON.stringify(preview.document,null,2)}</pre></details></div>}
    </div>
  </details>;
}
