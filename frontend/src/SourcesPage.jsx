import { useEffect, useState } from "react";
import { CloudDownload, Edit3, ListFilter, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { bytes, flag, randomId, splitTags } from "./lib.js";
import { rpc, IconButton, Button, Status, Empty, ContextGuide, PageHead, readSessionDraft, writeSessionDraft, clearSessionDraft, DraftStatus, Field, Modal } from './ui-shared.jsx';

async function sourceRpc(sourceId) {
  const started = await rpc("proxyConsole:startExternalSourceOperation", { sourceId, requestId: crypto.randomUUID() });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const operation = await rpc("proxyConsole:getExternalSourceOperation", { operationId: started.operationId });
    if (operation.phase === "completed") return operation.result;
    if (operation.phase === "failed") throw new Error(operation.error || "订阅源同步失败");
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  throw new Error("订阅源同步超时，请稍后查看最近同步状态");
}

function Sources({ state, persist, notify }) {
  const [editor, setEditor] = useState(null);
  const [ruleEditor, setRuleEditor] = useState(null);
  const [syncing, setSyncing] = useState("");
  const [syncingRule, setSyncingRule] = useState("");
  const sync = async (source) => {
    setSyncing(source.id);
    try {
      const result = await sourceRpc(source.id);
      notify(
        `同步完成：新增 ${result.created}，更新 ${result.updated}，停用 ${result.disabled}${result.duplicates ? `，跳过重复 ${result.duplicates}` : ""}`,
      );
      window.dispatchEvent(new CustomEvent("proxy-console-reload"));
    } catch (error) {
      notify(error.message, true);
      window.dispatchEvent(new CustomEvent("proxy-console-reload"));
    } finally {
      setSyncing("");
    }
  };
  const remove = async (source) => {
    if (
      !confirm(
        `删除订阅源“${source.name}”？已同步节点会保留并转为普通外部节点。`,
      )
    )
      return;
    const nodes = state.nodes.map((node) =>
      node.sourceId === source.id ? { ...node, sourceId: "" } : node,
    );
    await persist(
      {
        ...state,
        nodes,
        externalSources: state.externalSources.filter(
          (item) => item.id !== source.id,
        ),
      },
      "订阅源已删除",
    );
  };
  const syncRule = async (source) => {
    setSyncingRule(source.id);
    try { const result = await rpc("proxyConsole:syncRuleSet", { ruleSetId: source.id }); notify(`规则集已缓存：${result.entryCount} 条 · ${result.version}`); }
    catch (error) { notify(error.message, true); }
    finally { setSyncingRule(""); window.dispatchEvent(new CustomEvent("proxy-console-reload")); }
  };
  const removeRule = async (source) => {
    if (!confirm(`删除规则集“${source.name}”？订阅中的引用也会移除。`)) return;
    try { await rpc("proxyConsole:deleteRuleSet", { ruleSetId: source.id }); notify("规则集已删除"); window.dispatchEvent(new CustomEvent("proxy-console-reload")); }
    catch (error) { notify(error.message, true); }
  };
  return (
    <section className="workspace-page sources-panel">
      <PageHead
        title="外部订阅源"
        description="可粘贴机场或自建 HTTP/HTTPS 订阅地址，将其中节点同步到本地节点库。"
      >
        <Button icon={ListFilter} onClick={() => setRuleEditor({})}>添加规则集</Button>
        <Button icon={Plus} variant="primary" onClick={() => setEditor({})}>
          添加订阅源
        </Button>
      </PageHead>
      <ContextGuide icon={CloudDownload} label="同步规则">
        <p>
          支持 URI、Base64 与 Clash/Mihomo YAML。机场订阅可直接填写地址；
          远端移除的节点会标记为停用，便于同步后核对。
        </p>
      </ContextGuide>
      <div className="card-list station-card-grid">
        {state.externalSources.map((source) => (
          <article className="source-card" key={source.id}>
            <div className="source-main">
              <span className="sub-icon">
                <CloudDownload size={19} />
              </span>
              <div>
                <h3>{source.name}</h3>
                <p>
                  {source.nodeIds.length} 个节点 · 每{" "}
                  {source.refreshIntervalHours} 小时
                </p>
              </div>
              <Status ok={!source.lastError}>
                {source.lastError
                  ? "同步异常"
                  : source.lastSyncAt
                    ? "已同步"
                    : "待同步"}
              </Status>
            </div>
            <p className="source-url sensitive-value">{source.url}</p>
            {source.traffic && <div className="subscription-traffic source-traffic" aria-label="上游订阅流量"><span>上传 <strong>{bytes(source.traffic.upload)}</strong></span><span>下载 <strong>{bytes(source.traffic.download)}</strong></span><span>剩余 <strong>{source.traffic.total ? bytes(Math.max(0, source.traffic.total - source.traffic.upload - source.traffic.download)) : "未提供"}</strong></span>{source.traffic.expire ? <span>到期 <strong>{new Date(source.traffic.expire * 1000).toLocaleDateString("zh-CN")}</strong></span> : null}</div>}
            {source.lastError && (
              <p className="inline-error">{source.lastError}</p>
            )}
            <div className="source-foot">
              <span>
                {source.lastSyncAt
                  ? `上次：${new Date(source.lastSyncAt).toLocaleString("zh-CN")}`
                  : "从未同步"}
              </span>
              <div>
                <Button
                  icon={RefreshCw}
                  onClick={() => sync(source)}
                  disabled={syncing === source.id}
                >
                  {syncing === source.id ? "同步中" : "立即同步"}
                </Button>
                <Button icon={Edit3} onClick={() => setEditor(source)}>
                  编辑
                </Button>
                <IconButton label="删除订阅源" onClick={() => remove(source)}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
            </div>
          </article>
        ))}
        {!state.externalSources.length && (
          <Empty title="还没有外部订阅源">
            添加机场订阅地址，或继续使用手动和批量 URI 导入。
          </Empty>
        )}
      </div>
      <SourceEditor
        open={!!editor}
        source={editor}
        machines={state.machines}
        onClose={() => setEditor(null)}
        onSave={async (source) => {
          const exists = state.externalSources.some(
            (item) => item.id === source.id,
          );
          await persist(
            {
              ...state,
              externalSources: exists
                ? state.externalSources.map((item) =>
                    item.id === source.id ? source : item,
                  )
                : [...state.externalSources, source],
            },
            "订阅源已保存",
          );
          setEditor(null);
        }}
      />
      <div className="section-divider"><div><strong>远程规则集</strong><span>供 Mihomo、Surge 和 sing-box 的分流规则使用；刷新失败会继续使用最后成功缓存。</span></div></div>
      <div className="card-list station-card-grid">
        {(state.ruleSets || []).map((source) => <article className="source-card" key={source.id}>
          <div className="source-main"><span className="sub-icon"><ListFilter size={19} /></span><div><h3>{source.name}</h3><p>{source.entryCount || 0} 条 · {source.action === "proxy" ? "代理" : source.action === "direct" ? "直连" : "拒绝"}{source.version ? ` · ${source.version}` : ""}</p></div><Status ok={Boolean(source.lastSuccessAt)}>{source.lastError ? (source.lastSuccessAt ? "旧缓存可用" : "刷新失败") : source.lastSuccessAt ? "缓存可用" : "待刷新"}</Status></div>
          <p className="source-url sensitive-value">{source.url}</p>
          {source.lastError && <p className="inline-error">{source.lastError}{source.lastSuccessAt ? "；订阅仍沿用上次成功内容" : ""}</p>}
          <div className="source-foot"><span>{source.lastSuccessAt ? `成功：${new Date(source.lastSuccessAt).toLocaleString("zh-CN")}` : "尚无可用缓存"}</span><div><Button icon={RefreshCw} onClick={() => syncRule(source)} disabled={syncingRule === source.id}>{syncingRule === source.id ? "刷新中" : "刷新缓存"}</Button><Button icon={Edit3} onClick={() => setRuleEditor(source)}>编辑</Button><IconButton label="删除规则集" onClick={() => removeRule(source)}><Trash2 size={16} /></IconButton></div></div>
        </article>)}
        {!(state.ruleSets || []).length && <Empty title="还没有规则集">添加纯文本域名/CIDR 列表；没有规则集也不影响现有订阅。</Empty>}
      </div>
      <RuleSetEditor open={!!ruleEditor} source={ruleEditor} onClose={() => setRuleEditor(null)} onSave={async (source) => {
        const exists = (state.ruleSets || []).some((item) => item.id === source.id);
        const previous = state.ruleSets?.find((item) => item.id === source.id); const changedAddress = previous && previous.url !== source.url; const savedSource = changedAddress ? { ...source, lastError: "地址已修改；刷新成功前沿用旧缓存" } : source;
        await persist({ ...state, ruleSets: exists ? state.ruleSets.map((item) => item.id === source.id ? savedSource : item) : [...(state.ruleSets || []), savedSource] }, "规则集已保存；刷新成功后才会参与订阅"); setRuleEditor(null);
      }} />
    </section>
  );
}

function RuleSetEditor({ open, source, onClose, onSave }) {
  const [form, setForm] = useState({}); const [error, setError] = useState("");
  const draftKey = `rule-set:${source?.id || "new"}`;
  useEffect(() => { if (open) { setError(""); const initial = { id: source?.id || randomId(), name: source?.name || "", url: source?.url || "", action: source?.action || "proxy", enabled: source?.enabled !== false, lastSyncAt: source?.lastSyncAt || "", lastSuccessAt: source?.lastSuccessAt || "", lastError: source?.lastError || "", version: source?.version || "", entryCount: source?.entryCount || 0 }; const draft = readSessionDraft(draftKey)?.value; setForm(draft ? { ...initial, ...draft, id: initial.id } : initial); } }, [draftKey, open, source?.id]);
  useEffect(() => { if (open && form.id) writeSessionDraft(draftKey, form); }, [draftKey, form, open]);
  const save = async () => { try { if (!form.name?.trim()) throw new Error("请填写规则集名称"); const url = new URL(form.url || ""); if (!["http:", "https:"].includes(url.protocol)) throw new Error("请输入 HTTP/HTTPS 地址"); await onSave({ ...form, name: form.name.trim(), url: url.toString() }); clearSessionDraft(draftKey); } catch (reason) { setError(reason.message); } };
  return <Modal open={open} title={source?.id ? "编辑规则集" : "添加规则集"} eyebrow="远程规则集" onClose={onClose}>
    <p className="editor-note">支持域名、CIDR 和常见规则文本；同步成功后更新本地版本。</p>
    <div className="form-grid"><Field label="名称"><input value={form.name || ""} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="匹配后的动作"><select value={form.action || "proxy"} onChange={(event) => setForm({ ...form, action: event.target.value })}><option value="proxy">走订阅默认代理组</option><option value="direct">直连</option><option value="reject">拒绝</option></select></Field><Field label="文本规则地址" wide hint="每行一个域名、CIDR 或标准规则条目，最大 1 MiB。"><input type="url" value={form.url || ""} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://example.com/rules.txt" /></Field></div>
    <label className="check-line"><input type="checkbox" checked={form.enabled || false} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />允许定时刷新并参与订阅</label>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><DraftStatus onDiscard={() => { clearSessionDraft(draftKey); onClose(); }} /><Button onClick={onClose}>取消</Button><Button variant="primary" icon={Save} onClick={save}>保存</Button></div>
  </Modal>;
}

function SourceEditor({ open, source, machines, onClose, onSave }) {
  const [form, setForm] = useState({});
  const draftKey = `source:${source?.id || "new"}`;
  useEffect(() => {
    if (open) {
      const initial = {
        id: source?.id || randomId(),
        name: source?.name || "",
        url: source?.url || "",
        machineId: source?.machineId || "",
        tags: (source?.tags || []).join(", "),
        enabled: source?.enabled !== false,
        refreshIntervalHours: source?.refreshIntervalHours || 24,
        lastSyncAt: source?.lastSyncAt || "",
        lastError: source?.lastError || "",
        traffic: source?.traffic || null,
        nodeIds: source?.nodeIds || [],
      };
      const draft = readSessionDraft(draftKey)?.value;
      setForm(draft ? { ...initial, ...draft, id: initial.id } : initial);
    }
  }, [draftKey, open, source?.id]);
  useEffect(() => {
    if (open && form.id) writeSessionDraft(draftKey, form);
  }, [draftKey, form, open]);
  return (
    <Modal
      open={open}
      title={source?.id ? "编辑订阅源" : "添加订阅源"}
      eyebrow="订阅源"
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="名称">
          <input
            value={form.name || ""}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
          />
        </Field>
        <Field label="同步间隔">
          <select
            value={form.refreshIntervalHours || 24}
            onChange={(event) =>
              setForm({
                ...form,
                refreshIntervalHours: Number(event.target.value),
              })
            }
          >
            {[1, 6, 12, 24, 72, 168].map((hours) => (
              <option key={hours} value={hours}>
                {hours} 小时
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="订阅地址"
          wide
          hint="机场或自建订阅的 HTTP/HTTPS 地址；支持 URI、Base64 URI 与 Clash/Mihomo YAML。"
        >
          <input
            type="url"
            value={form.url || ""}
            onChange={(event) => setForm({ ...form, url: event.target.value })}
            placeholder="https://example.com/sub"
          />
        </Field>
        <Field
          label="默认节点归类（可选）"
          hint="机场订阅通常保持“不关联 VPS”；只有明确属于某台自建机器时才选择。"
        >
          <select
            value={form.machineId || ""}
            onChange={(event) =>
              setForm({ ...form, machineId: event.target.value })
            }
          >
            <option value="">不关联 VPS（机场订阅）</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {flag(machine.countryCode)} {machine.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="节点标签">
          <input
            value={form.tags || ""}
            onChange={(event) => setForm({ ...form, tags: event.target.value })}
            placeholder="机场, 备用"
          />
        </Field>
      </div>
      <label className="check-line">
        <input
          type="checkbox"
          checked={form.enabled || false}
          onChange={(event) =>
            setForm({ ...form, enabled: event.target.checked })
          }
        />
        参与后台到期同步
      </label>
      <div className="dialog-actions">
        <DraftStatus onDiscard={() => { clearSessionDraft(draftKey); onClose(); }} />
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          icon={Save}
          onClick={async () => {
            await onSave({
              ...form,
              name: form.name.trim(),
              url: form.url.trim(),
              tags: splitTags(form.tags),
            });
            clearSessionDraft(draftKey);
          }}
          disabled={!form.name?.trim() || !form.url?.trim()}
        >
          保存订阅源
        </Button>
      </div>
    </Modal>
  );
}

export { sourceRpc, Sources, RuleSetEditor, SourceEditor };
