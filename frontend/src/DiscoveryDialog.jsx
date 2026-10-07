import { useEffect, useState } from "react";
import { Copy, Import, Save, Search, ShieldCheck } from "lucide-react";
import { preferredPublicHost } from "./lib.js";
import { rpc, IconButton, Button, Status, Field, Modal, MANAGED_ERROR, executeTrackedManagedTask, executeTask } from './ui-shared.jsx';

function ExistingServiceDiscoveryDialog({ machine, state, clients, persist, notify, me, onClose }) {
  const [model, setModel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState({});
  useEffect(() => {
    if (!machine) {
      setModel(null);
      setSelected({});
      return;
    }
    setModel({ machine, publicHost: preferredPublicHost(clients[machine.monitorClientId]) || "", result: null });
    setSelected({});
  }, [machine, clients]);
  const close = () => {
    if (!busy) onClose();
  };
  const scan = async () => {
    if (!model?.machine || busy) return;
    const otp = me?.two_factor_enabled ? prompt("请输入本次只读发现的两步验证码") || "" : "";
    if (me?.two_factor_enabled && !otp) return;
    setBusy(true);
    try {
      const spec = await rpc("proxyConsole:prepareExistingServiceDiscovery", { machineId: model.machine.id, publicHost: model.publicHost.trim() });
      const task = await executeTask(spec.clientId, spec.command, otp, 30000);
      if (Number(task.exit_code) !== 0) throw new Error(task.result || "目标机扫描失败");
      const result = await rpc("proxyConsole:parseExistingServiceDiscovery", { output: task.result });
      setModel((current) => current ? { ...current, result } : current);
      setSelected(Object.fromEntries(result.candidates.map((item) => [item.id, true])));
      notify(`发现 ${result.units.length} 个服务、${result.candidates.length} 个可导入节点`);
    } catch (error) { notify(error.message, true); }
    finally { setBusy(false); }
  };
  const importSelected = async () => {
    const candidates = (model?.result?.candidates || []).filter((item) => selected[item.id]);
    if (!candidates.length) return;
    setBusy(true);
    try {
      const result = await rpc("proxyConsole:importDiscoveredNodes", { machineId: model.machine.id, candidates });
      if (!result.added) {
        notify(result.duplicates?.length ? `所选节点已由节点库或订阅源收录（${result.duplicates.length} 项）` : "所选节点无法无损导入", true);
        return;
      }
      notify(`已导入 ${result.added} 个发现节点${result.duplicates?.length ? `，跳过 ${result.duplicates.length} 个重复项` : ""}`);
      window.dispatchEvent(new Event("proxy-console-reload"));
      onClose();
    } catch (error) { notify(error.message, true); }
    finally { setBusy(false); }
  };
  const saveDrafts = async (items) => {
    if (!items.length || busy) return;
    setBusy(true);
    try {
      const existing = new Set((state.nodeDrafts || []).map((item) => item.id));
      const createdAt = new Date().toISOString();
      const drafts = items.map((item) => ({ id: `draft-${item.id}`, name: item.name, protocol: item.protocol, machineId: model.machine.id, kind: item.kind, source: item.source, reason: item.reason, evidence: item.evidence || [], repair: item.repair || {}, createdAt })).filter((item) => !existing.has(item.id));
      if (!drafts.length) { notify("这些发现项已经保存在待修复列表中"); return; }
      await persist({ ...state, nodeDrafts: [...(state.nodeDrafts || []), ...drafts] }, `已保存 ${drafts.length} 个待修复节点`);
    } catch (error) { notify(error.message, true); }
    finally { setBusy(false); }
  };
  const stageNowhereAdoption = async (item) => {
    if (busy || !item?.adoption?.eligible) return;
    if (!confirm(`将“${item.name}”纳入 Wherever Station 管理？\n\n本步骤只复制当前内核与配置并建立停止状态的托管实例，不会停止原服务。确认配置后，再到“部署节点”执行切换接管。`)) return;
    const otp = me?.two_factor_enabled ? prompt("请输入本次目标机操作的两步验证码") || "" : "";
    if (me?.two_factor_enabled && !otp) return;
    setBusy(true);
    try {
      const draft = await rpc("proxyConsole:createManagedNowhereAdoptionDraft", { machineId: model.machine.id, candidate: item });
      const spec = await rpc("proxyConsole:prepareManagedNowhereAction", { instanceId: draft.instanceId, action: "create", requestId: crypto.randomUUID() });
      const saved = await executeTrackedManagedTask(spec, otp);
      if (!saved.result.ok) throw new Error(MANAGED_ERROR[saved.result.error] || saved.result.error || "建立接管实例失败");
      notify("已建立待接管实例；原 Nowhere 仍在运行，可到“部署节点”核对后切换");
      window.dispatchEvent(new Event("proxy-console-reload"));
      onClose();
    } catch (error) { notify(error.message, true); }
    finally { setBusy(false); }
  };
  return <Modal open={!!machine} title={`${model?.machine?.name || machine?.name || "服务器"} · 发现现有节点`} eyebrow="只读扫描" onClose={close} size="large">
    <div className="discovery-intro"><Search size={17} /><div><strong>读取服务、进程和配置，不修改远端</strong><span>参数完整的节点可以直接导入；不能可靠推导的部分会保留为待补全草稿。</span></div></div>
    <div className="discovery-controls"><Field label="公网域名或 IP（可选）" hint="Komari 有公网地址时会自动带出；留空仍可扫描。"><input value={model?.publicHost || ""} onChange={(event) => setModel((current) => current ? { ...current, publicHost: event.target.value, result: null } : current)} placeholder="example.com 或公网 IP" /></Field><Button icon={Search} variant="primary" disabled={busy || !model} onClick={scan}>{busy ? "正在只读扫描…" : "开始扫描"}</Button></div>
    {model?.result && <div className="discovery-results">
      <div className="discovery-summary"><span><strong>{model.result.units.length}</strong>服务</span><span><strong>{model.result.candidates.length}</strong>可导入</span><span><strong>{model.result.needsReview.filter((item) => item.confidence === "confirm").length}</strong>待确认</span><span><strong>{model.result.needsReview.filter((item) => item.confidence !== "confirm").length}</strong>草稿</span></div>
      <details className="discovery-units"><summary>查看发现依据</summary>{model.result.units.map((unit) => <div key={unit.unit}><span className={`status ${unit.active === "active" ? "ok" : ""}`}><i />{unit.active}</span><strong>{unit.unit}</strong><small>{unit.adapter === "native-cli" ? `Nowhere 原生命令行${unit.binaryVersion ? ` · ${unit.binaryVersion}` : ""}` : unit.fragmentPath || "未找到 unit 文件"}</small>{unit.configPaths?.map((path) => <code key={path}>{path}</code>)}</div>)}</details>
      <div className="discovery-candidates">{model.result.candidates.map((item) => <label key={item.id}><input type="checkbox" checked={selected[item.id] !== false} onChange={(event) => setSelected((current) => ({ ...current, [item.id]: event.target.checked }))} /><span className={`protocol ${item.protocol === "nowhere" ? "special" : ""}`}>{item.protocol}</span><div><strong>{item.name}</strong><small>{item.adapter === "native-cli" ? "Nowhere 原生发现" : item.source}</small>{item.certificate && <small>{item.certificate.readable && item.certificate.keyMatch ? "证书与私钥可用" : "证书需要检查"}</small>}</div>{item.adoption?.eligible ? <Button icon={ShieldCheck} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void stageNowhereAdoption(item); }} disabled={busy}>纳入管理</Button> : <Status tone="ok">可导入</Status>}<IconButton label={`复制 ${item.name} URI`} onClick={(event) => { event.preventDefault(); navigator.clipboard.writeText(item.uri); notify("发现节点 URI 已复制"); }}><Copy size={15} /></IconButton></label>)}</div>
      {!!model.result.needsReview.length && <details className="discovery-review" open><summary>{model.result.needsReview.length} 项可继续补全</summary><div className="discovery-review-actions"><span>保留为草稿后可在“节点”页补全；补全前不会进入订阅。</span><Button icon={Save} onClick={() => saveDrafts(model.result.needsReview)} disabled={busy}>全部保存为草稿</Button></div>{model.result.needsReview.map((item) => <div key={item.id}><span className="protocol">{item.protocol}</span><p><strong>{item.name}</strong><small>{item.reason}</small><code>{item.source}</code></p><Status tone={item.confidence === "confirm" ? "warning" : ""}>{item.confidence === "confirm" ? "待确认" : "草稿"}</Status><Button icon={Save} onClick={() => saveDrafts([item])} disabled={busy}>保留</Button></div>)}</details>}
    </div>}
    {!model?.result && !busy && <div className="discovery-empty">选择开始扫描；远端保持只读。</div>}
    {busy && <div className="probe-progress"><span className="spinner" /><span>正在读取 systemd、进程参数和可访问的配置文件…</span></div>}
    <div className="dialog-actions"><Button onClick={close} disabled={busy}>关闭</Button><Button icon={Import} variant="primary" onClick={importSelected} disabled={busy || !Object.values(selected).some(Boolean)}>导入所选 {Object.values(selected).filter(Boolean).length} 项</Button></div>
  </Modal>;
}

export { ExistingServiceDiscoveryDialog };
