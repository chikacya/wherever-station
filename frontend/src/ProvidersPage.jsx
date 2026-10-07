import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ChevronDown, ChevronUp, Copy, Database, Edit3, ExternalLink, Globe2, Network, Plus, QrCode, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { bytes, flag, hostFromUri, inferNodeCountryCode } from "./lib.js";
import { rpc, readSessionDraft, writeSessionDraft, clearSessionDraft, IconButton, Button, Status, DraftStatus, Field, SecretInput, Modal, Empty, PageHead } from './ui-shared.jsx';

async function providerRpc(action, input) {
  const started = await rpc("proxyConsole:startProviderOperation", { action, input, requestId: crypto.randomUUID() });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const operation = await rpc("proxyConsole:getProviderOperation", { operationId: started.operationId });
    if (operation.phase === "completed") return operation.result;
    if (operation.phase === "failed") throw new Error(operation.error || "外部面板操作失败");
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  throw new Error("外部面板操作超时，请稍后重试");
}

function Providers({ state, setState, notify, onNavigate }) {
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState({});
  const [missingActions, setMissingActions] = useState({});
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});
  const [qr, setQr] = useState(null);
  const providerDraftKey = `provider:${editor?.id || "new"}`;
  useEffect(() => {
    if (!editor) return;
    const initial = { id: editor.id || "", name: editor.name || "", type: editor.type || "2s-ui", baseUrl: editor.baseUrl || "", token: "", enabled: editor.enabled !== false, hasToken: editor.hasToken === true };
    const draft = readSessionDraft(providerDraftKey)?.value;
    setForm(draft ? { ...initial, ...draft, id: initial.id, token: "" } : initial);
  }, [editor?.id]);
  useEffect(() => {
    if (!editor) return;
    const { token: _token, ...draft } = form;
    if (form.type) writeSessionDraft(providerDraftKey, draft);
  }, [editor, form, providerDraftKey]);
  const save = async () => {
    setBusy("save");
    try {
      const result = await rpc("proxyConsole:saveProvider", { provider: { ...form, token: undefined }, token: form.token });
      setState(result.state || await rpc("proxyConsole:getState")); clearSessionDraft(providerDraftKey); setEditor(null); notify("外部面板已保存");
    } catch (error) { notify(error.message, true); } finally { setBusy(""); }
  };
  const test = async (provider) => {
    setBusy(`test:${provider.id}`);
    try { const result = await providerRpc("test", { providerId: provider.id }); setState(result.state || await rpc("proxyConsole:getState")); notify(`连接成功：${result.inbounds} 个入站，${result.links} 条分享链接`); }
    catch (error) { notify(error.message, true); window.dispatchEvent(new CustomEvent("proxy-console-reload")); }
    finally { setBusy(""); }
  };
  const inspect = async (provider) => {
    setBusy(`sync:${provider.id}`);
    try {
      const result = await providerRpc("preview", { providerId: provider.id });
      setPreview(result);
      setSelected(Object.fromEntries(result.candidates.map((item) => [item.remoteId, item.action !== "ignored"])));
      setMissingActions(Object.fromEntries(result.missing.map((item) => [item.localId, "retain"])));
    } catch (error) { notify(error.message, true); } finally { setBusy(""); }
  };
  const identifyRegions = async (provider) => {
    setBusy(`geo:${provider.id}`);
    try {
      const result = await providerRpc("geolocate", { providerId: provider.id });
      setState(result?.state || await rpc("proxyConsole:getState"));
      notify(`地区识别完成：更新 ${result.updated} 个${result.unresolved ? `，${result.unresolved} 个未识别` : ""}`);
    } catch (error) { notify(error.message, true); }
    finally { setBusy(""); }
  };
  const removeProviderNode = async (provider, node) => {
    if (!confirm(`从本地移除“${node.name}”？远端面板不会受影响，后续同步会默认忽略该节点。`)) return;
    setBusy(`remove-node:${node.id}`);
    try {
      setState(await rpc("proxyConsole:removeProviderNode", { providerId: provider.id, nodeId: node.id, expectedRevision: state.revision }));
      notify("节点已从本地移除，并加入该面板的忽略清单");
    } catch (error) { notify(error.message, true); }
    finally { setBusy(""); }
  };
  const apply = async () => {
    setBusy("apply");
    try {
      const remoteIds = Object.keys(selected).filter((id) => selected[id]);
      const result = await providerRpc("apply", { providerId: preview.provider.id, remoteIds, missingActions });
      setState(result.state || await rpc("proxyConsole:getState"));
      setPreview(null);
      notify(`同步完成：新增 ${result.created}，更新 ${result.updated}，停用 ${result.disabled}，删除 ${result.deleted}，转手动 ${result.detached}`);
    } catch (error) { notify(error.message, true); } finally { setBusy(""); }
  };
  const remove = async (provider) => {
    if (!confirm(`删除外部面板“${provider.name}”？已同步节点会保留，但会停用并标记来源断开。`)) return;
    setBusy(`delete:${provider.id}`);
    try { setState(await rpc("proxyConsole:deleteProvider", { providerId: provider.id })); notify("外部面板已删除"); }
    catch (error) { notify(error.message, true); } finally { setBusy(""); }
  };
  const visibleProviders = (state.providers || []).filter((provider) => {
    const nodes = state.nodes.filter((node) => node.sourceId === provider.id);
    const value = `${provider.name} ${provider.baseUrl} ${nodes.map((node) => `${node.name} ${node.remoteName || ""} ${node.protocol}`).join(" ")}`.toLowerCase();
    return !search.trim() || value.includes(search.trim().toLowerCase());
  });
  const locate = (node) => {
    sessionStorage.setItem("wherever-node-focus", node.id);
    onNavigate("nodes");
  };
  return <section className="workspace-page providers-panel">
    <PageHead title="外部面板" description="连接专业面板，把已有节点同步到统一节点库。">
      <Button icon={Plus} variant="primary" onClick={() => setEditor({})}>连接专业面板</Button>
    </PageHead>
    <div className="provider-toolbar"><div className="search"><Search size={16} /><input aria-label="搜索外部面板和节点" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索面板、节点或协议" /></div><span>{state.providers?.length || 0} 个面板 · {state.nodes.filter((node) => node.source === "provider").length} 个节点</span></div>
    <div className="card-list provider-list">
      {visibleProviders.map((provider) => { const providerNodes = state.nodes.filter((node) => node.sourceId === provider.id); const isExpanded = expanded[provider.id] !== false; return <article className="provider-card" key={provider.id}>
        <header><button className="provider-expand" type="button" aria-label={`${isExpanded ? "收起" : "展开"} ${provider.name} 节点`} aria-expanded={isExpanded} onClick={() => setExpanded((value) => ({ ...value, [provider.id]: !isExpanded }))}>{isExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button><div><h3>{provider.name}</h3><p>{provider.type === "2s-ui" ? "2S-UI" : "S-UI"} · <span className="sensitive-value">{provider.baseUrl}</span></p><div className="provider-meta"><span>{providerNodes.length} 个节点</span><span>{provider.inboundCount} 入站</span><span>{provider.clientCount} 客户端</span>{provider.status && <span>{provider.status.startsWith("running:") ? `sing-box 运行中 · ${provider.status.slice(8)}` : provider.status.startsWith("stopped:") ? `sing-box 已停止 · ${provider.status.slice(8)}` : provider.status}</span>}<span>{provider.lastSyncAt ? `同步于 ${new Date(provider.lastSyncAt).toLocaleString("zh-CN", { hour12: false })}` : "尚未同步"}</span></div></div><Status tone={provider.lastError ? "bad" : provider.lastSuccessAt ? "ok" : "warning"}>{provider.lastError ? "连接异常" : provider.lastSuccessAt ? "连接正常" : "待检查"}</Status><div className="provider-head-actions">
          <Button icon={RefreshCw} onClick={() => test(provider)} disabled={!!busy}>{busy === `test:${provider.id}` ? "检查中…" : "检查"}</Button>
          <Button icon={RefreshCw} variant="primary" onClick={() => inspect(provider)} disabled={!!busy}>{busy === `sync:${provider.id}` ? "正在读取…" : "同步"}</Button>
          <Button icon={Globe2} title="根据节点域名或 IP 归类，不会通过代理测试出口" onClick={() => identifyRegions(provider)} disabled={!!busy || !providerNodes.length}>{busy === `geo:${provider.id}` ? "识别中…" : "识别节点地区"}</Button>
          <a className="icon-button" aria-label="打开原面板" title="打开原面板" href={provider.baseUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /></a>
          <IconButton label="编辑连接" onClick={() => setEditor(provider)}><Edit3 size={16} /></IconButton>
          <IconButton label="删除连接" onClick={() => remove(provider)}><Trash2 size={16} /></IconButton>
        </div></header>
        {provider.lastError && <p className="inline-error provider-error">{provider.lastError}</p>}
        {!!provider.clients?.length && <details className="provider-clients"><summary>客户端与额度 · {provider.clients.length}</summary><div>{provider.clients.map((client) => <p key={client.id}><span><strong>{client.name}</strong><small>{client.enabled ? "已启用" : "已停用"}{client.expire ? ` · ${new Date(client.expire * 1000).toLocaleDateString("zh-CN")} 到期` : ""}</small></span><span>↑ {bytes(client.upload)}　↓ {bytes(client.download)}{client.total ? `　剩余 ${bytes(Math.max(0, client.total - client.upload - client.download))}` : ""}</span></p>)}</div></details>}
        {isExpanded && <div className="provider-node-list" role="region" aria-label={`${provider.name} 已同步节点`}>
          <div className="provider-node-head"><span>节点</span><span>协议 / 地址</span><span>远端来源</span><span>状态</span><span /></div>
          {providerNodes.map((node) => <div className="provider-node-row" key={node.id}>
            <div><strong>{flag(inferNodeCountryCode(node))} {inferNodeCountryCode(node) || "--"} · {node.name}</strong>{node.remoteName && node.remoteName !== node.name && <small>远端：{node.remoteName}</small>}{node.geo?.organization && <small>{node.geo.asn} · {node.geo.organization}</small>}</div>
            <div><span className={`protocol ${node.protocol === "nowhere" ? "special" : ""}`}>{node.protocol}</span><small>{hostFromUri(node)}</small></div>
            <div><span>{node.remoteClientName || `${provider.type === "2s-ui" ? "2S-UI" : "S-UI"} 客户端`}</span><small>{node.remoteInboundName || "分享链接"}</small></div>
            <div><Status tone={node.providerMissing ? "bad" : node.enabled ? "ok" : "warning"}>{node.providerMissing ? "远端已移除" : node.enabled ? "可输出" : "已停用"}</Status></div>
            <div className="provider-node-actions"><IconButton label={`复制 ${node.name} URI`} onClick={() => { navigator.clipboard.writeText(node.uri); notify("节点 URI 已复制"); }}><Copy size={15} /></IconButton><IconButton label={`显示 ${node.name} 二维码`} onClick={() => setQr(node)}><QrCode size={15} /></IconButton><IconButton label={`在节点库查看 ${node.name}`} onClick={() => locate(node)}><ExternalLink size={15} /></IconButton><IconButton label={`从本地移除 ${node.name}`} disabled={!!busy} onClick={() => removeProviderNode(provider, node)}><Trash2 size={15} /></IconButton></div>
          </div>)}
          {!providerNodes.length && <div className="provider-node-empty"><Network size={18} /><span>还没有同步节点。点击“同步”读取远端分享链接并选择导入。</span></div>}
        </div>}
      </article>})}
      {!(state.providers || []).length && <Empty icon={Database} title="还没有连接专业面板">填写 2S-UI / S-UI 地址与 API Token，或继续使用 URI 导入和快捷部署。</Empty>}
      {!!state.providers?.length && !visibleProviders.length && <Empty icon={Search} title="没有匹配结果">换一个面板、节点或协议关键词。</Empty>}
    </div>
    <Modal open={!!editor} title={editor?.id ? "编辑面板连接" : "连接专业面板"} eyebrow="面板连接" onClose={() => !busy && setEditor(null)}>
      <div className="form-grid"><Field label="显示名称"><input value={form.name || ""} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：东京 2S-UI" /></Field><Field label="面板类型"><select value={form.type || "2s-ui"} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="2s-ui">2S-UI（推荐）</option><option value="s-ui">S-UI（兼容）</option></select></Field><Field label="面板根地址" wide hint="填写浏览器中打开面板的根地址，可包含面板路径；末尾不要手动添加 /apiv2。"><input type="url" value={form.baseUrl || ""} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://panel.example.com/app" /></Field><Field label={form.hasToken ? "替换 API Token（可留空）" : "API Token"} wide hint="在面板设置中创建；这里只保存到服务端私有文件。"><SecretInput autoComplete="new-password" value={form.token || ""} onChange={(event) => setForm({ ...form, token: event.target.value })} placeholder={form.hasToken ? "留空保留现有 Token" : "Token"} /></Field></div>
      <div className="dialog-actions"><DraftStatus onDiscard={() => { clearSessionDraft(providerDraftKey); setEditor(null); }}>草稿已保留（Token 除外）</DraftStatus><Button onClick={() => setEditor(null)}>取消</Button><Button icon={Save} variant="primary" onClick={save} disabled={busy === "save" || !form.name?.trim() || !form.baseUrl?.trim() || (!form.hasToken && !form.token?.trim())}>{busy === "save" ? "保存中…" : "保存连接"}</Button></div>
    </Modal>
    <Modal open={!!preview} title={`同步预览 · ${preview?.provider.name || ""}`} eyebrow="同步确认" onClose={() => !busy && setPreview(null)} size="large">
      {preview && <><div className="provider-preview-summary"><span><strong>{preview.summary.create}</strong>新增</span><span><strong>{preview.summary.update}</strong>更新</span><span><strong>{preview.summary.unchanged}</strong>无变化</span><span><strong>{preview.summary.pending || 0}</strong>待完善</span><span><strong>{preview.summary.missing}</strong>远端消失</span><span><strong>{preview.summary.unsupported}</strong>无法导入</span></div>
      {!!preview.inbounds?.length && <details className="provider-readiness" open={preview.inbounds.some((item) => item.readiness !== "ready")}><summary>入站状态 · {preview.inbounds.filter((item) => item.readiness === "ready").length}/{preview.inbounds.length} 已就绪</summary><div>{preview.inbounds.map((item) => <div className="provider-readiness-row" key={item.id}><span className="protocol">{item.type}</span><span><strong>{item.tag || `Inbound ${item.id}`}</strong><small>{item.listen || "::"}:{item.port || "—"}{item.clients?.length ? ` · ${item.clients.join("、")}` : ""}</small></span><Status tone={item.readiness === "ready" ? "ok" : "warning"}>{item.readiness === "ready" ? "可同步" : item.readiness === "needs-link" ? "等待分享链接" : "等待客户端"}</Status>{item.readiness !== "ready" && <small className="provider-readiness-reason">{item.reason}</small>}</div>)}</div></details>}
      <div className="provider-preview-list">{preview.candidates.map((item) => <label key={item.remoteId} className="provider-candidate"><input type="checkbox" checked={selected[item.remoteId] === true} onChange={(event) => setSelected({ ...selected, [item.remoteId]: event.target.checked })} /><span className="protocol">{item.protocol}</span><div><strong>{item.localName || item.remoteName}</strong><small>{item.clientName} · {item.inboundName || "外部链接"} · {hostFromUri(item)}</small></div><Status tone={item.action === "create" ? "warning" : item.action === "update" ? "ok" : item.action === "ignored" ? "warning" : ""}>{{ create: "新增", update: "更新", unchanged: "无变化", ignored: "已忽略" }[item.action]}</Status><IconButton label="复制远端分享链接" onClick={(event) => { event.preventDefault(); navigator.clipboard.writeText(item.uri); notify("分享链接已复制"); }}><Copy size={15} /></IconButton></label>)}</div>
      {!!preview.missing.length && <div className="provider-missing"><div className="provider-missing-head"><strong>远端已消失</strong><span>逐项选择本地记录的处理方式</span></div>{preview.missing.map((item) => <label className="provider-missing-row" key={item.localId}><span><strong>{item.name}</strong><small>{item.alreadyMissing ? "当前已停用" : "本次同步发现"}</small></span><select aria-label={`${item.name} 的处理方式`} value={missingActions[item.localId] || "retain"} onChange={(event) => setMissingActions({ ...missingActions, [item.localId]: event.target.value })}><option value="retain">停用并保留</option><option value="delete">删除本地记录</option><option value="detach">转为手动节点</option></select></label>)}</div>}
      {!!preview.unsupported.length && <details className="provider-unsupported"><summary>{preview.unsupported.length} 项无法导入</summary>{preview.unsupported.map((item) => <p key={item.remoteId}><strong>{item.name || item.remoteId}</strong> · {item.reason}</p>)}</details>}</>}
      <div className="dialog-actions"><Button onClick={() => setPreview(null)}>取消</Button><Button icon={RefreshCw} variant="primary" onClick={apply} disabled={busy === "apply" || (!Object.values(selected).some(Boolean) && !preview?.missing.length)}>{busy === "apply" ? "同步中…" : `执行同步 · ${Object.values(selected).filter(Boolean).length} 项`}</Button></div>
    </Modal>
    <Modal open={!!qr} title={`${qr?.name || "节点"} · 二维码`} eyebrow="单节点输出" onClose={() => setQr(null)}><div className="qr-box">{qr && <QRCodeSVG value={qr.uri} size={240} level="M" bgColor="#ffffff" fgColor="#171717" />}</div><p className="warning">二维码包含节点凭据，请勿公开截图。</p><div className="dialog-actions"><Button onClick={() => setQr(null)}>关闭</Button></div></Modal>
  </section>;
}

export { providerRpc, Providers };
