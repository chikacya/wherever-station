import { useEffect, useRef, useState } from "react";
import RuleEditor from "./RuleEditor.jsx";
import { createVisiblePoller } from "./polling.js";
import subscriptionTrafficHelpers from "../../tools/subscription-traffic.js";
import { buildPreflightReport } from "./preflight.js";
import { closestCenter, DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { QRCodeSVG } from "qrcode.react";
import { Boxes, Check, ChevronDown, ChevronUp, Copy, Database, Download, Edit3, ExternalLink, Globe2, GripVertical, Link2, Network, Plus, QrCode, RotateCw, Save, Search, Settings, Trash2, X } from "lucide-react";
import { androidAnywhereLink, anywhereLink, bytes, flag, hostFromUri, inferNodeCountryCode, localDateInput, randomId, subscriptionUrl } from "./lib.js";
import { rpc, IconButton, Button, Status, Modal, Empty, ContextGuide, PageHead, TRAFFIC_ACCOUNTING, readSessionDraft, writeSessionDraft, clearSessionDraft, DraftStatus, Field } from './ui-shared.jsx';

const { subscriptionMachine, subscriptionAllowance } = subscriptionTrafficHelpers;

const GROUP_LABELS = {
  select: "手动选择",
  "url-test": "自动测速",
  fallback: "故障转移",
  "load-balance": "负载均衡",
};

const DEVICE_CLIENTS = {
  "anywhere-ios": { label: "Anywhere · iOS", format: "anywhere", note: "使用 Anywhere 深链接；Raw/Base64 保留 Nowhere。" },
  "anywhere-android": { label: "Anywhere · Android", format: "anywhere", note: "使用通用订阅地址；保留 Anywhere 能识别的原始 URI。" },
  mihomo: { label: "Mihomo / Clash", format: "mihomo", note: "支持代理组与规则；不支持 Nowhere。" },
  surge: { label: "Surge", format: "surge", note: "支持代理组与规则；VLESS 和 Nowhere 会跳过。" },
  "sing-box": { label: "sing-box", format: "sing-box", note: "输出完整客户端配置；不支持 Nowhere。" },
  loon: { label: "Loon", format: "loon", note: "按 Loon Section 格式输出原始 URI、代理组与规则。" },
  generic: { label: "通用 URI 客户端", format: "base64", note: "Base64 URI 列表；是否支持各协议取决于客户端。" },
};

function Subscriptions({ state, persist, notify, onOpenSettings }) {
  const [editor, setEditor] = useState(null);
  const [qr, setQr] = useState(null);
  const [access, setAccess] = useState({});
  const [serverTraffic, setServerTraffic] = useState({});
  const trafficBusyRef = useRef(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (trafficBusyRef.current) return;
      trafficBusyRef.current = true;
      try { const value = await rpc("proxyConsole:getSubscriptionTraffic"); if (active) setServerTraffic(value || {}); }
      catch (_) { /* Retain the last successful traffic snapshot on transient failures. */ }
      finally { trafficBusyRef.current = false; }
    };
    const stop = createVisiblePoller(load, { interval: 60000, warmup: [1200, 3600] });
    return () => { active = false; stop(); };
  }, [state.revision]);
  const [preflight, setPreflight] = useState(null);
  const [history, setHistory] = useState(null);
  const [devices, setDevices] = useState(null);
  useEffect(() => {
    rpc("proxyConsole:getAccessStats")
      .then(setAccess)
      .catch(() => {});
  }, [state.subscriptions.length]);
  const remove = async (sub) => {
    if (confirm(`删除订阅“${sub.name}”？`))
      await persist(
        {
          ...state,
          subscriptions: state.subscriptions.filter(
            (item) => item.id !== sub.id,
          ),
        },
        "订阅已删除",
      );
  };
  const copy = async (value) => {
    await navigator.clipboard.writeText(value);
    notify("地址已复制");
  };
  const downloadPreflight = () => {
    const report = buildPreflightReport(preflight);
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `wherever-station-preflight-${preflight.sub?.id || "report"}.json`; anchor.click(); URL.revokeObjectURL(url); notify("预检报告已下载");
  };
  const rotate = async (sub) => {
    if (
      !confirm(
        `轮换“${sub.name}”的私密令牌？\n\n旧订阅地址会立即失效，所有设备都要重新导入。`,
      )
    )
      return;
    const token = (await rpc("proxyConsole:newToken")).token;
    await persist(
      {
        ...state,
        subscriptions: state.subscriptions.map((item) =>
          item.id === sub.id ? { ...item, token } : item,
        ),
      },
      "令牌已轮换；旧地址已失效",
    );
  };
  const check = async (sub) => {
    try {
      setPreflight({ loading: true, name: sub.name, sub });
      setPreflight({
        ...(await rpc("proxyConsole:subscriptionPreflight", {
          subscriptionId: sub.id,
        })),
        name: sub.name,
        sub,
      });
    } catch (error) {
      setPreflight({ name: sub.name, sub, error: error.message });
    }
  };
  const openHistory = async (sub) => {
    try {
      setHistory({ loading: true, sub, entries: [] });
      const entries = await rpc("proxyConsole:getSubscriptionHistory", {
        subscriptionId: sub.id,
      });
      setHistory({ loading: false, sub, entries });
    } catch (error) {
      setHistory(null);
      notify(error.message, true);
    }
  };
  const restoreHistory = async (entry) => {
    const sub = history?.sub;
    if (
      !sub ||
      !confirm(
        `恢复“${sub.name}”到 ${new Date(entry.savedAt).toLocaleString("zh-CN", { hour12: false })} 前的版本？\n\n当前版本会自动进入历史，私密令牌保持不变。`,
      )
    )
      return;
    await persist(
      {
        ...state,
        subscriptions: state.subscriptions.map((item) =>
          item.id === sub.id
            ? { ...item, ...entry.snapshot, id: item.id, token: item.token }
            : item,
        ),
      },
      "订阅历史版本已恢复",
    );
    setHistory(null);
  };
  const deviceUrl = (sub, client) => client === "anywhere-ios" ? anywhereLink(state, sub) : client === "anywhere-android" ? androidAnywhereLink(state, sub) : subscriptionUrl(state, sub, DEVICE_CLIENTS[client]?.format || "base64");
  return (
    <section className="workspace-page subscriptions-panel">
      <PageHead
        title="订阅管理"
        description="按节点自由组合订阅；结构化客户端可编排代理组，URI 客户端保留原始协议参数。"
      >
        <Button icon={Settings} onClick={onOpenSettings}>
          订阅地址
        </Button>
        <Button icon={Plus} variant="primary" onClick={() => setEditor({})}>
          新建订阅
        </Button>
      </PageHead>
      <ContextGuide icon={Globe2} label="格式支持">
        <p>
          <strong>格式兼容：</strong>Anywhere、Loon、Raw 和 Base64 使用无损 URI 列表；
          Mihomo、Surge 与 sing-box 只转换已适配且参数完整的节点。
        </p>
      </ContextGuide>
      <div className="card-list station-card-grid">
        {state.subscriptions.map((sub) => {
          const url = subscriptionUrl(state, sub);
          const stats = access[sub.id];
          const eligibleMachine = subscriptionMachine(sub, state.nodes, state.machines);
          const allowance = subscriptionAllowance(sub, eligibleMachine);
          const traffic = sub.quota?.mode === "machine" && eligibleMachine ? serverTraffic[sub.id] : null;
          const used = Number(traffic?.upload || 0) + Number(traffic?.download || 0);
          const expired = Boolean(sub.expiresAt && Date.parse(sub.expiresAt) <= Date.now());
          return (
            <article className="sub-card" key={sub.id}>
              <div className="sub-main">
                <span className="sub-icon">
                  <Link2 size={19} />
                </span>
                <div>
                  <h3>{sub.name}</h3>
                  <p>
                    {sub.nodeIds.length} 个节点 · {(sub.groups || []).length}{" "}
                    个代理组 · {(sub.ruleSetIds || []).length} 个规则集 · {(sub.devices || []).length} 台设备
                    {stats?.lastAccessAt
                      ? ` · 最近访问 ${new Date(stats.lastAccessAt).toLocaleString("zh-CN", { hour12: false })}`
                      : " · 暂无访问"}
                    {sub.expiresAt
                      ? ` · ${expired ? "已到期" : `有效至 ${new Date(sub.expiresAt).toLocaleDateString("zh-CN")}`}`
                      : ""}
                  </p>
                </div>
                <Status ok={sub.enabled && !expired}>
                  {expired ? "已到期" : sub.enabled ? "已启用" : "已停用"}
                </Status>
              </div>
              {sub.quota?.mode === "machine" && <div className="subscription-traffic" aria-label="订阅流量展示"><span>整机 Agent 流量 · {eligibleMachine?.name || "暂停展示"}</span>{!eligibleMachine ? <span>输出节点不再全部归属于同一 VPS</span> : <>{allowance.total > 0 && <span>{allowance.source === "custom" ? "自定义额度" : "VPS 流量额度"} <strong>{bytes(allowance.total)}</strong></span>}{!traffic ? <span>Agent 暂无有效计数</span> : <><span>{allowance.source === "server" ? `${TRAFFIC_ACCOUNTING[traffic.accounting] || "上下行合计"}已用` : "累计已用"} <strong>{bytes(used)}</strong></span>{allowance.total > 0 && <><span>{used > allowance.total ? "已超过展示额度" : `参考差额 ${bytes(allowance.total - used)}`}</span><progress max={allowance.total} value={Math.min(used, allowance.total)} aria-label="订阅流量展示进度" /></>}<span>含整台 VPS 流量 · {new Date(traffic.observedAt).toLocaleString("zh-CN", { hour12: false })}</span></>}</>}</div>}
              <code className="url-preview">
                {url.replace(sub.token, "••••••••••••")}
              </code>
              <div className="sub-actions">
                <Button icon={Copy} onClick={() => copy(url)}>
                  复制
                </Button>
                <Button
                  icon={QrCode}
                  onClick={() =>
                    setQr({
                      title: `${sub.name} · 通用订阅`,
                      value: url,
                      note: "适用于支持标准 HTTP 订阅的客户端。",
                    })
                  }
                >
                  通用码
                </Button>
                <Button
                  icon={QrCode}
                  onClick={() =>
                    setQr({
                      title: `${sub.name} · iOS Anywhere`,
                      value: anywhereLink(state, sub),
                      note: "供 iPhone / iPad Anywhere 扫描；使用 Anywhere 深链接。",
                    })
                  }
                >
                  iOS Anywhere
                </Button>
                <Button
                  icon={QrCode}
                  onClick={() =>
                    setQr({
                      title: `${sub.name} · Android Anywhere`,
                      value: androidAnywhereLink(state, sub),
                      note: "Android 使用普通订阅地址导入原始 URI；客户端只接纳自己支持的协议，代理组和规则不包含在 URI 列表中。",
                    })
                  }
                >
                  Android Anywhere
                </Button>
                <Button icon={Edit3} onClick={() => setEditor(sub)}>
                  编辑
                </Button>
                <Button icon={Check} onClick={() => check(sub)}>
                  客户端检查
                </Button>
                <Button icon={Database} onClick={() => openHistory(sub)}>
                  版本历史
                </Button>
                <Button icon={Network} onClick={() => setDevices({ sub, values: (sub.devices || []).map((item) => ({ ...item })) })}>设备</Button>
                <Button icon={RotateCw} onClick={() => rotate(sub)}>
                  轮换令牌
                </Button>
                <div className="format-links">
                  {["raw", "base64", "anywhere", "loon", "mihomo", "sing-box", "surge"].map(
                    (format) => (
                      <a
                        key={format}
                        href={subscriptionUrl(state, sub, format)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {format}
                        <ExternalLink size={12} />
                      </a>
                    ),
                  )}
                </div>
                <IconButton label="删除订阅" onClick={() => remove(sub)}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
            </article>
          );
        })}
        {!state.subscriptions.length && (
          <Empty title="还没有订阅">先创建订阅，再选择节点和代理组。</Empty>
        )}
      </div>
      <SubscriptionEditor
        open={!!editor}
        subscription={editor}
        nodes={state.nodes.filter((node) => node.enabled)}
        machines={state.machines}
        externalSources={state.externalSources || []}
        providers={state.providers || []}
        ruleSets={state.ruleSets || []}
        onClose={() => setEditor(null)}
        onSave={async (sub) => {
          const exists = state.subscriptions.some((item) => item.id === sub.id);
          await persist(
            {
              ...state,
              subscriptions: exists
                ? state.subscriptions.map((item) =>
                    item.id === sub.id ? sub : item,
                  )
                : [...state.subscriptions, sub],
            },
            "订阅已保存",
          );
          setEditor(null);
        }}
      />
      <Modal
        open={!!qr}
        title={qr?.title || "订阅二维码"}
        eyebrow="订阅二维码"
        onClose={() => setQr(null)}
      >
        <div className="qr-box">
          {qr && (
            <QRCodeSVG
              value={qr.value}
              size={240}
              level="M"
              bgColor="#ffffff"
              fgColor="#111827"
            />
          )}
        </div>
        {qr?.note && <p className="qr-note">{qr.note}</p>}
        <p className="warning">二维码包含私密订阅令牌，请勿公开截图。</p>
        <div className="dialog-actions">
          <Button icon={Copy} onClick={() => copy(qr.value)}>
            复制此地址
          </Button>
          <Button onClick={() => setQr(null)}>关闭</Button>
        </div>
      </Modal>
      <Modal
        open={!!preflight}
        title={`${preflight?.name || "订阅"} · 客户端检查`}
        eyebrow="客户端兼容"
        onClose={() => setPreflight(null)}
      >
        <div className="preflight-list">
          {preflight?.loading ? (
            <div className="boot">
              <span className="spinner" />
              正在检查
            </div>
          ) : preflight?.error ? (
            <div className="inline-error">{preflight.error}<Button onClick={() => check(preflight.sub)}>重试检查</Button></div>
          ) : (
            preflight?.formats?.map((item) => (
              <article key={item.format}>
                <div>
                  <strong>{item.format}</strong>
                  <Status ok={item.ok}>{item.ok ? "可生成" : "不可用"}</Status>
                </div>
                <p>
                  输出 {item.included} 个 · 跳过 {item.skipped} 个 ·{" "}
                  {bytes(item.bytes)}
                </p>
                {item.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
                {item.nodes?.length > 0 && <details className="preflight-nodes"><summary>查看节点名单与输出结果</summary><ul>{[...item.nodes].sort((a, b) => Number(a.included) - Number(b.included)).map((node) => <li className={node.included ? "" : "skipped"} key={node.id}><span>{node.name}</span><small>{node.included ? node.reason || "已纳入输出" : `已跳过 · ${node.reason}`}</small></li>)}</ul></details>}
                {item.ok && <Button icon={Copy} onClick={() => copy(subscriptionUrl(state, preflight.sub, item.format))}>复制 {item.format} 订阅地址</Button>}
              </article>
            ))
          )}
        </div>
        <p className="editor-note">
          这里检查输出格式与协议兼容；网络可用性可在节点页运行连接检查。
        </p>
        <div className="dialog-actions">
          {!preflight?.loading && !preflight?.error && preflight?.formats?.length > 0 && <Button icon={Download} onClick={downloadPreflight}>下载预检报告</Button>}
          <Button onClick={() => setPreflight(null)}>关闭</Button>
        </div>
      </Modal>
      <Modal
        open={!!history}
        title={`${history?.sub?.name || "订阅"} · 版本历史`}
        eyebrow="版本记录"
        onClose={() => setHistory(null)}
      >
        <div className="preflight-list">
          {history?.loading ? (
            <div className="boot">
              <span className="spinner" />
              正在读取
            </div>
          ) : history?.entries?.length ? (
            history.entries.map((entry) => (
              <article key={entry.id}>
                <div>
                  <strong>
                    {new Date(entry.savedAt).toLocaleString("zh-CN", {
                      hour12: false,
                    })}
                  </strong>
                  <span className="muted">{entry.reason}</span>
                </div>
                <p>
                  {entry.snapshot.nodeIds.length} 个节点 ·{" "}
                  {entry.snapshot.groups.length} 个代理组 ·{" "}
                  {(entry.snapshot.ruleSetIds || []).length} 个规则集 ·{" "}
                  {(entry.snapshot.devices || []).length} 台设备 ·{" "}
                  {entry.snapshot.enabled ? "启用" : "停用"}
                </p>
                <Button icon={RotateCw} onClick={() => restoreHistory(entry)}>
                  恢复此版本
                </Button>
              </article>
            ))
          ) : (
            <Empty title="暂无历史版本">
              首次修改或删除前会自动保存旧版本。
            </Empty>
          )}
        </div>
        <p className="editor-note">
          版本记录不包含订阅令牌或节点凭据。
        </p>
        <div className="dialog-actions">
          <Button onClick={() => setHistory(null)}>关闭</Button>
        </div>
      </Modal>
      <Modal open={!!devices} title={`${devices?.sub?.name || "订阅"} · 设备档案`} eyebrow="常用设备" onClose={() => setDevices(null)} size="large">
        <p className="editor-note">保存常用设备的客户端类型，之后可直接复制对应格式。</p>
        <details className="capability-matrix"><summary>查看客户端与格式能力</summary><div>{Object.entries(DEVICE_CLIENTS).map(([id, profile]) => <p key={id}><strong>{profile.label}</strong><span>{profile.format}</span><small>{profile.note}</small></p>)}</div></details>
        <div className="device-list">{devices?.values.map((device, index) => { const profile = DEVICE_CLIENTS[device.client] || DEVICE_CLIENTS.generic; const value = deviceUrl(devices.sub, device.client); return <article key={device.id}><div className="device-fields"><input aria-label="设备名称" value={device.name} onChange={(event) => setDevices((current) => ({ ...current, values: current.values.map((item, i) => i === index ? { ...item, name: event.target.value } : item) }))} placeholder="我的 iPhone" /><select aria-label="客户端类型" value={device.client} onChange={(event) => setDevices((current) => ({ ...current, values: current.values.map((item, i) => i === index ? { ...item, client: event.target.value } : item) }))}>{Object.entries(DEVICE_CLIENTS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select><IconButton label="删除设备档案" onClick={() => setDevices((current) => ({ ...current, values: current.values.filter((_, i) => i !== index) }))}><Trash2 size={16} /></IconButton></div><p><strong>推荐 {profile.format}</strong> · {profile.note}</p><div className="device-actions"><Button icon={Copy} onClick={() => copy(value)}>复制推荐地址</Button><Button icon={QrCode} onClick={() => setQr({ title: `${device.name || profile.label} · ${profile.format}`, value, note: profile.note })}>显示二维码</Button></div></article>; })}</div>
        {!devices?.values.length && <Empty title="还没有设备档案">添加常用设备后，不必再判断应该复制哪个格式。</Empty>}
        <div className="dialog-actions"><Button icon={Plus} onClick={() => setDevices((current) => ({ ...current, values: [...current.values, { id: randomId(), name: "", client: "generic", notes: "" }] }))}>添加设备</Button><span className="dialog-spacer" /><Button onClick={() => setDevices(null)}>取消</Button><Button variant="primary" icon={Save} onClick={async () => { if (devices.values.some((item) => !item.name.trim())) return notify("请填写设备名称", true); await persist({ ...state, subscriptions: state.subscriptions.map((item) => item.id === devices.sub.id ? { ...item, devices: devices.values } : item) }, "设备档案已保存"); setDevices(null); }}>保存设备</Button></div>
      </Modal>
    </section>
  );
}

function DraggableNode({ node, selected, machine, onToggle, handleOnly }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `palette:${node.id}`,
    data: { kind: "node", nodeId: node.id, label: node.name },
  });
  return (
    <div
      ref={(element) => { setNodeRef(element); if (!handleOnly) setActivatorNodeRef(element); }}
      style={{ opacity: isDragging ? 0.42 : 1 }}
      className={`palette-node ${selected ? "selected" : ""}`}
      onClick={onToggle}
      {...(handleOnly ? {} : { ...attributes, ...listeners })}
    >
      <button type="button" ref={handleOnly ? setActivatorNodeRef : undefined} className="drag-handle" aria-label={`拖动 ${node.name}`} onClick={(event) => event.stopPropagation()} {...(handleOnly ? { ...attributes, ...listeners } : {})}>
        <GripVertical size={15} />
      </button>
      <span className="node-copy">
        <strong>{node.name}</strong>
        <small>
          {node.protocol} · {machine?.name || hostFromUri(node)}
        </small>
      </span>
      {selected && <Check size={14} className="selected-check" />}
    </div>
  );
}

function SelectedNode({ node, machine, onRemove, recent }) {
  const sortable = useSortable({
    id: `selected:${node.id}`,
    data: { kind: "selected-node", nodeId: node.id, label: node.name },
  });
  return (
    <div
      ref={sortable.setNodeRef}
      data-selected-node-id={node.id}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.42 : 1,
      }}
      className={`selected-node ${recent ? "recent" : ""}`}
    >
      <button type="button" ref={sortable.setActivatorNodeRef} className="drag-handle" aria-label={`拖动 ${node.name} 调整顺序`} {...sortable.attributes} {...sortable.listeners}>
        <GripVertical size={15} />
      </button>
      <div>
        <strong>{node.name}</strong>
        <small>
          {node.protocol} · {machine?.name || hostFromUri(node)}
        </small>
      </div>
      <IconButton
        label="移出订阅"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onRemove}
      >
        <X size={14} />
      </IconButton>
    </div>
  );
}

function SelectedNodeList({ nodes, machines, onRemove, recentNodeId }) {
  const drop = useDroppable({
    id: "selected-nodes",
    data: { kind: "selected-list" },
  });
  return (
    <section
      ref={drop.setNodeRef}
      className={`selected-list ${drop.isOver ? "over" : ""}`}
    >
      <div className="pane-title">
        <div>
          <strong>订阅节点</strong>
          <span>{nodes.length} 个 · 以下名称就是实际输出名称</span>
        </div>
      </div>
      <SortableContext
        items={nodes.map((node) => `selected:${node.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="selected-stack">
          {nodes.map((node) => (
            <SelectedNode
              key={node.id}
              node={node}
              machine={machines.find(
                (machine) => machine.id === node.machineId,
              )}
              recent={recentNodeId === node.id}
              onRemove={() => onRemove(node.id)}
            />
          ))}
        </div>
      </SortableContext>
      {!nodes.length && (
        <div className="drop-empty">
          <Download size={20} />
          <strong>拖入节点开始编排</strong>
          <span>也可以在右侧直接点击节点</span>
        </div>
      )}
    </section>
  );
}

function SortableGroupEntry({
  groupId,
  entry,
  index,
  entries,
  name,
  onChange,
}) {
  const sortable = useSortable({
    id: `entry:${groupId}:${entry.kind}:${entry.id}`,
    data: { kind: "group-entry", groupId, entry, label: name },
  });
  const stop = (event) => event.stopPropagation();
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.4 : 1,
      }}
      className="group-entry"
    >
      <button type="button" ref={sortable.setActivatorNodeRef} className="drag-handle" aria-label={`拖动 ${name || "项目"} 调整顺序`} {...sortable.attributes} {...sortable.listeners}><GripVertical size={14} /></button>
      <span>
        {entry.kind === "group" ? <Boxes size={14} /> : <Network size={14} />}
        {name || "已移除项目"}
      </span>
      <div onPointerDown={stop}>
        <IconButton
          label="上移"
          disabled={!index}
          onClick={() => onChange(arrayMove(entries, index, index - 1))}
        >
          <ChevronUp size={14} />
        </IconButton>
        <IconButton
          label="下移"
          disabled={index === entries.length - 1}
          onClick={() => onChange(arrayMove(entries, index, index + 1))}
        >
          <ChevronDown size={14} />
        </IconButton>
        <IconButton
          label="从组中移除"
          onClick={() =>
            onChange(entries.filter((_, itemIndex) => itemIndex !== index))
          }
        >
          <X size={14} />
        </IconButton>
      </div>
    </div>
  );
}

function SortableGroup({ group, nodes, allGroups, onChange, onRemove }) {
  const sortable = useSortable({
    id: `group:${group.id}`,
    data: { kind: "group", groupId: group.id, label: group.name },
  });
  const drop = useDroppable({
    id: `drop:${group.id}`,
    data: { kind: "group-drop", groupId: group.id },
  });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const groupMap = new Map(allGroups.map((item) => [item.id, item]));
  const stop = (event) => event.stopPropagation();
  return (
    <article
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.42 : 1,
      }}
      className="group-card"
    >
      <button type="button" ref={sortable.setActivatorNodeRef} className="group-dragbar" aria-label={`拖动代理组 ${group.name}`} {...sortable.attributes} {...sortable.listeners}>
        <GripVertical size={16} />
        <span>拖动整个代理组调整位置</span>
      </button>
      <div className="group-head" onPointerDown={stop}>
        <input
          aria-label="代理组名称"
          value={group.name}
          onChange={(event) => onChange({ ...group, name: event.target.value })}
        />
        <select
          aria-label="代理组类型"
          value={group.type}
          onChange={(event) => onChange({ ...group, type: event.target.value })}
        >
          {Object.entries(GROUP_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <IconButton label="删除代理组" onClick={onRemove}>
          <Trash2 size={15} />
        </IconButton>
      </div>
      {group.type !== "select" && (
        <div className="group-options" onPointerDown={stop}>
          <input
            aria-label="测速地址"
            value={group.url}
            onChange={(event) =>
              onChange({ ...group, url: event.target.value })
            }
          />
          <input
            aria-label="间隔秒数"
            type="number"
            min="60"
            max="86400"
            value={group.interval}
            onChange={(event) =>
              onChange({ ...group, interval: Number(event.target.value) })
            }
          />
        </div>
      )}
      <div
        ref={drop.setNodeRef}
        className={`group-drop ${drop.isOver ? "over" : ""}`}
        onPointerDown={stop}
      >
        <SortableContext
          items={group.entries.map(
            (entry) => `entry:${group.id}:${entry.kind}:${entry.id}`,
          )}
          strategy={verticalListSortingStrategy}
        >
          {group.entries.map((entry, index) => {
            const node = nodeMap.get(entry.id);
            return (
              <SortableGroupEntry
                key={`${entry.kind}:${entry.id}`}
                groupId={group.id}
                entry={entry}
                index={index}
                entries={group.entries}
                name={
                  entry.kind === "node"
                    ? node?.name
                    : groupMap.get(entry.id)?.name
                }
                onChange={(entries) => onChange({ ...group, entries })}
              />
            );
          })}
        </SortableContext>
        {!group.entries.length && (
          <span className="drop-hint">把右侧节点拖到这里</span>
        )}
      </div>
    </article>
  );
}

function SubscriptionEditor({
  open,
  subscription,
  nodes,
  machines,
  externalSources,
  providers,
  ruleSets,
  onClose,
  onSave,
}) {
  const [stage, setStage] = useState("nodes");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState("");
  const [activeDrag, setActiveDrag] = useState(null);
  const [handleOnly, setHandleOnly] = useState(() => window.matchMedia("(max-width: 760px), (pointer: coarse)").matches);
  const [recentNodeId, setRecentNodeId] = useState("");
  const [review, setReview] = useState(null);
  const reviewRef = useRef(null);
  const draftKey = `subscription:${subscription?.id || "new"}`;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px), (pointer: coarse)");
    const update = () => setHandleOnly(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    setStage("nodes");
    setSaving(false);
    setSaveError("");
    setRecentNodeId("");
    setReview(null);
    const initial = {
      id: subscription?.id || randomId(),
      name: subscription?.name || "",
      token: subscription?.token || "",
      nodeIds: [...(subscription?.nodeIds || [])],
      groups: (subscription?.groups || []).map((group) => ({
        ...group,
        entries: [...group.entries],
      })),
      enabled: subscription?.enabled !== false,
      expiryDate: localDateInput(subscription?.expiresAt),
      quota: {
        mode: subscription?.quota?.mode === "machine" ? "machine" : "none",
        totalBytes: subscription?.quota?.totalBytes || 0,
        customTotalEnabled: subscription?.quota?.customTotalEnabled ?? Boolean(subscription?.quota?.totalBytes),
      },
      policyMode: subscription?.policyMode || "proxy-all",
      customRules: (subscription?.customRules || []).map((rule) => ({ ...rule })),
      ruleSetIds: [...(subscription?.ruleSetIds || [])],
      devices: (subscription?.devices || []).map((device) => ({ ...device })),
    };
    const draft = readSessionDraft(draftKey)?.value;
    setForm(draft ? { ...initial, ...draft, id: initial.id, token: initial.token, quota: { mode: draft.quota?.mode === "machine" ? "machine" : "none", totalBytes: draft.quota?.totalBytes || 0, customTotalEnabled: draft.quota?.customTotalEnabled ?? Boolean(draft.quota?.totalBytes) } } : initial);
    setSearch("");
  }, [open, subscription?.id]);
  useEffect(() => {
    if (!open || !form) return;
    const { token: _token, ...draft } = form;
    writeSessionDraft(draftKey, draft);
  }, [draftKey, form, open]);
  useEffect(() => {
    if (!review) return;
    const frame = requestAnimationFrame(() => {
      reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      reviewRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [review]);
  useEffect(() => {
    if (!recentNodeId || stage !== "nodes") return undefined;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector(`[data-selected-node-id="${recentNodeId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
    const timer = setTimeout(() => setRecentNodeId(""), 1600);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [recentNodeId, stage, form?.nodeIds.length]);
  if (!form) return null;
  const trafficMachine = subscriptionMachine(form, nodes, machines);
  const trafficAllowance = subscriptionAllowance(form, trafficMachine);
  const visible = nodes.filter(
    (node) =>
      node.name.toLowerCase().includes(search.toLowerCase()) ||
      node.protocol.includes(search.toLowerCase()),
  );
  const toggleNode = (id) =>
    setForm((current) => {
      const removing = current.nodeIds.includes(id);
      if (!removing) setRecentNodeId(id);
      return removing
        ? {
            ...current,
            nodeIds: current.nodeIds.filter((item) => item !== id),
            groups: current.groups.map((group) => ({
              ...group,
              entries: group.entries.filter(
                (entry) => entry.kind !== "node" || entry.id !== id,
              ),
            })),
          }
        : { ...current, nodeIds: [...current.nodeIds, id] };
    });
  const changeGroup = (group) =>
    setForm((current) => ({
      ...current,
      groups: current.groups.map((item) =>
        item.id === group.id ? group : item,
      ),
    }));
  const addGroup = () =>
    setForm((current) => ({
      ...current,
      groups: [
        ...current.groups,
        {
          id: randomId(),
          name: `代理组 ${current.groups.length + 1}`,
          type: "select",
          entries: [],
          url: "https://www.gstatic.com/generate_204",
          interval: 3600,
        },
      ],
    }));
  const generateGroups = (mode) =>
    setForm((current) => {
      if (
        current.groups.length &&
        !confirm("这会替换当前尚未保存的代理组，继续吗？")
      )
        return current;
      const selected = current.nodeIds;
      const buckets = new Map();
      selected.forEach((nodeId) => {
        const node = nodes.find((item) => item.id === nodeId);
        const machine = machines.find((item) => item.id === node?.machineId);
        if (!node) return;
        const countryCode = inferNodeCountryCode(node, machine);
        const key =
          mode === "country"
            ? countryCode || "OTHER"
            : machine?.id || "EXTERNAL";
        const name =
          mode === "country"
            ? `${flag(countryCode)} ${countryCode || "未分类"}`.trim()
            : `${flag(machine?.countryCode)} ${machine?.name || "外部节点"}`.trim();
        if (!buckets.has(key)) buckets.set(key, { name, entries: [] });
        buckets.get(key).entries.push({ kind: "node", id: node.id });
      });
      return {
        ...current,
        nodeIds: selected,
        groups: [...buckets.values()].map((bucket) => ({
          id: randomId(),
          name: bucket.name,
          type: "select",
          entries: bucket.entries,
          url: "https://www.gstatic.com/generate_204",
          interval: 3600,
        })),
      };
    });
  const onDragEnd = ({ active, over }) => {
    setActiveDrag(null);
    if (!over) return;
    const activeKind = active.data.current?.kind;
    const overKind = over.data.current?.kind;
    if (
      activeKind === "node" &&
      (overKind === "selected-list" || overKind === "selected-node")
    ) {
      const nodeId = active.data.current.nodeId;
      setRecentNodeId(nodeId);
      setForm((current) => {
        if (current.nodeIds.includes(nodeId)) return current;
        const target =
          overKind === "selected-node"
            ? current.nodeIds.indexOf(over.data.current.nodeId)
            : current.nodeIds.length;
        const next = [...current.nodeIds];
        next.splice(target < 0 ? next.length : target, 0, nodeId);
        return { ...current, nodeIds: next };
      });
    }
    if (activeKind === "selected-node" && overKind === "selected-node") {
      setForm((current) => {
        const oldIndex = current.nodeIds.indexOf(active.data.current.nodeId);
        const newIndex = current.nodeIds.indexOf(over.data.current.nodeId);
        return oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex
          ? {
              ...current,
              nodeIds: arrayMove(current.nodeIds, oldIndex, newIndex),
            }
          : current;
      });
    }
    if (
      (activeKind === "node" || activeKind === "selected-node") &&
      overKind === "group-drop"
    ) {
      const groupId = over.data.current.groupId;
      const nodeId = active.data.current.nodeId;
      setForm((current) => ({
        ...current,
        nodeIds: current.nodeIds.includes(nodeId)
          ? current.nodeIds
          : [...current.nodeIds, nodeId],
        groups: current.groups.map((group) =>
          group.id === groupId &&
          !group.entries.some(
            (entry) => entry.kind === "node" && entry.id === nodeId,
          )
            ? {
                ...group,
                entries: [...group.entries, { kind: "node", id: nodeId }],
              }
            : group,
        ),
      }));
    }
    if (activeKind === "group-entry" && overKind === "group-entry") {
      const sourceGroupId = active.data.current.groupId;
      const targetGroupId = over.data.current.groupId;
      setForm((current) => {
        const source = current.groups.find(
          (group) => group.id === sourceGroupId,
        );
        const target = current.groups.find(
          (group) => group.id === targetGroupId,
        );
        if (!source || !target) return current;
        const oldIndex = source.entries.findIndex(
          (entry) =>
            entry.kind === active.data.current.entry.kind &&
            entry.id === active.data.current.entry.id,
        );
        const newIndex = target.entries.findIndex(
          (entry) =>
            entry.kind === over.data.current.entry.kind &&
            entry.id === over.data.current.entry.id,
        );
        if (oldIndex < 0 || newIndex < 0) return current;
        if (sourceGroupId === targetGroupId)
          return {
            ...current,
            groups: current.groups.map((group) =>
              group.id === sourceGroupId
                ? {
                    ...group,
                    entries: arrayMove(group.entries, oldIndex, newIndex),
                  }
                : group,
            ),
          };
        const moved = source.entries[oldIndex];
        return {
          ...current,
          groups: current.groups.map((group) =>
            group.id === sourceGroupId
              ? {
                  ...group,
                  entries: group.entries.filter(
                    (_, index) => index !== oldIndex,
                  ),
                }
              : group.id === targetGroupId &&
                  !group.entries.some(
                    (entry) =>
                      entry.kind === moved.kind && entry.id === moved.id,
                  )
                ? {
                    ...group,
                    entries: [
                      ...group.entries.slice(0, newIndex),
                      moved,
                      ...group.entries.slice(newIndex),
                    ],
                  }
                : group,
          ),
        };
      });
    }
    if (
      activeKind === "group-entry" &&
      overKind === "group-drop" &&
      active.data.current.groupId !== over.data.current.groupId
    ) {
      const sourceGroupId = active.data.current.groupId;
      const targetGroupId = over.data.current.groupId;
      const moved = active.data.current.entry;
      setForm((current) => ({
        ...current,
        groups: current.groups.map((group) =>
          group.id === sourceGroupId
            ? {
                ...group,
                entries: group.entries.filter(
                  (entry) => entry.kind !== moved.kind || entry.id !== moved.id,
                ),
              }
            : group.id === targetGroupId &&
                !group.entries.some(
                  (entry) => entry.kind === moved.kind && entry.id === moved.id,
                )
              ? { ...group, entries: [...group.entries, moved] }
              : group,
        ),
      }));
    }
    if (activeKind === "group" && overKind === "group") {
      const oldIndex = form.groups.findIndex(
        (group) => group.id === active.data.current.groupId,
      );
      const newIndex = form.groups.findIndex(
        (group) => group.id === over.data.current.groupId,
      );
      if (oldIndex !== newIndex)
        setForm({
          ...form,
          groups: arrayMove(form.groups, oldIndex, newIndex),
        });
    }
    if (activeKind === "group" && overKind === "group-drop") {
      const sourceId = active.data.current.groupId;
      const targetId = over.data.current.groupId;
      const byId = new Map(form.groups.map((group) => [group.id, group]));
      const reaches = (from, target, seen = new Set()) => {
        if (from === target) return true;
        if (seen.has(from)) return false;
        seen.add(from);
        return (byId.get(from)?.entries || [])
          .filter((entry) => entry.kind === "group")
          .some((entry) => reaches(entry.id, target, seen));
      };
      if (sourceId === targetId || reaches(sourceId, targetId))
        return alert("不能创建代理组循环引用");
      setForm((current) => ({
        ...current,
        groups: current.groups.map((group) =>
          group.id === targetId &&
          !group.entries.some(
            (entry) => entry.kind === "group" && entry.id === sourceId,
          )
            ? {
                ...group,
                entries: [...group.entries, { kind: "group", id: sourceId }],
              }
            : group,
        ),
      }));
    }
  };
  const collisionDetection = (args) => {
    const pointer = pointerWithin(args);
    const kind = args.active.data.current?.kind;
    const preferred = kind === "node" || kind === "selected-node"
      ? ["group-drop", "selected-node", "selected-list"]
      : kind === "group-entry" ? ["group-entry", "group-drop"] : [];
    for (const targetKind of preferred) {
      const hits = pointer.filter(({ id }) => args.droppableContainers.find((container) => container.id === id)?.data.current?.kind === targetKind);
      if (hits.length) return hits;
    }
    return pointer.length ? pointer : closestCenter(args);
  };
  const submit = async () => {
    if (saving) return;
    if (!form.name.trim()) return setSaveError("请填写订阅名称");
    if (!form.nodeIds.length) return setSaveError("请至少纳入一个节点");
    if (form.quota?.mode === "machine" && form.quota.customTotalEnabled && !form.quota.totalBytes) return setSaveError("启用自定义额度后，请填写大于 0 的额度");
    setSaving(true);
    setSaveError("");
    try {
      const token = form.token || review?.candidate?.token || (await rpc("proxyConsole:newToken")).token;
      const expiresAt = form.expiryDate
        ? new Date(`${form.expiryDate}T23:59:59.999`).toISOString()
        : "";
      const candidate = { ...form, name: form.name.trim(), token, expiresAt };
      const signature = JSON.stringify(candidate);
      if (!review || review.signature !== signature) {
        const diff = await rpc("proxyConsole:previewSubscriptionChange", { subscription: candidate });
        setReview({ signature, candidate, diff }); setSaving(false); return;
      }
      if (!review.diff.changed) { setSaveError("没有需要保存的变化"); return; }
      await onSave(candidate);
      clearSessionDraft(draftKey);
    } catch (error) {
      setSaveError(error.message);
      if (error.message.includes("规则")) setStage("rules");
    } finally {
      setSaving(false);
    }
  };
  const machineMap = new Map(machines.map((machine) => [machine.id, machine]));
  return (
    <Modal
      open={open}
      title={subscription?.id ? "编辑订阅" : "新建订阅"}
      eyebrow="订阅编辑"
      size="wide"
      onClose={onClose}
    >
      <div className="sub-editor-top">
        <Field
          label="订阅名称"
          hint="在 Anywhere 中，一个订阅会显示为一个独立的节点文件夹。"
        >
          <input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="日常 · 亚洲节点"
          />
        </Field>
        <Field
          label="到期日期（可选）"
          hint={form.expiryDate ? "到期当天 23:59 后返回 404。" : "当前为长期有效。"}
        >
          <span className="expiry-control">
            <input
              type="date"
              autoComplete="off"
              value={form.expiryDate || ""}
              onChange={(event) =>
                setForm({ ...form, expiryDate: event.target.value || "" })
              }
            />
            <button
              type="button"
              disabled={!form.expiryDate}
              onClick={() => setForm({ ...form, expiryDate: "" })}
            >
              长期有效
            </button>
          </span>
        </Field>
        <div className="subscription-switches">
          <label className="check-line">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) =>
                setForm({ ...form, enabled: event.target.checked })
              }
            />
            启用订阅链接
          </label>
        </div>
      </div>
      <details className="quota-editor">
        <summary>订阅流量展示</summary>
        <label className="check-line">
          <input type="checkbox" checked={form.quota?.mode === "machine"} disabled={!trafficMachine && form.quota?.mode !== "machine"} onChange={(event) => setForm(current => ({ ...current, quota: { ...current.quota, mode: event.target.checked ? "machine" : "none" } }))} />
          展示同 VPS 的 Agent 用量{trafficMachine ? " · " + trafficMachine.name : ""}
        </label>
        {form.quota?.mode === "machine" && <><p>当前额度：{!trafficMachine ? "节点暂不属于同一 VPS" : trafficAllowance.total ? `${bytes(trafficAllowance.total)} · ${trafficAllowance.source === "custom" ? "自定义 · 上下行合计" : `继承 VPS · ${TRAFFIC_ACCOUNTING[trafficMachine.trafficPlan?.accounting] || "上下行合计"}`}` : "未设置；VPS 流量计划尚无额度"}</p><label className="check-line"><input type="checkbox" checked={Boolean(form.quota.customTotalEnabled)} onChange={(event) => setForm(current => ({ ...current, quota: { ...current.quota, customTotalEnabled: event.target.checked } }))} />自定义订阅展示额度</label>{form.quota.customTotalEnabled && <Field label="自定义额度 GiB"><input type="number" min="0.01" step="0.01" required value={form.quota.totalBytes ? Math.round(form.quota.totalBytes / 1024 ** 3 * 100) / 100 : ""} onChange={(event) => setForm(current => ({ ...current, quota: { ...current.quota, totalBytes: Math.round(Math.max(0, Number(event.target.value) || 0) * 1024 ** 3) } }))} placeholder="例如 500" /></Field>}</>}
        <p>{trafficMachine ? "已用量为整台 VPS 的 Agent 累计，不是本订阅独占，也不会按月重置；VPS 额度按其流量计划读取，超额仅提示。" : "全部输出节点归属于同一台已绑定 Agent 的 VPS 时可展示；否则暂停展示。"}</p>
      </details>
      <div className="editor-tabs" role="tablist" aria-label="订阅编辑模式">
        <button
          type="button"
          role="tab"
          aria-selected={stage === "nodes"}
          onClick={() => setStage("nodes")}
        >
          1. 节点范围 · {form.nodeIds.length}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={stage === "policy"}
          onClick={() => setStage("policy")}
        >
          2. 代理组（可选）
        </button>
        <button type="button" role="tab" aria-selected={stage === "rules"} onClick={() => setStage("rules")}>3. 分流规则 · {form.customRules.length}</button>
      </div>
      <p className="scope-description">
        {stage === "nodes"
          ? "左侧显示订阅实际输出的完整名称；从右侧点击或拖入。不使用代理组也可以创建订阅。"
          : stage === "rules" ? "规则决定哪些请求代理、直连或拒绝；仅作用于 Mihomo / Surge / sing-box，不影响 Anywhere 的节点文件夹。" : "代理组决定可选择的出口。拖动编排组和节点；默认使用第一个有兼容节点的代理组。"}
      </p>
      {stage === "rules" ? <><RuleEditor rules={form.customRules} policyMode={form.policyMode} onChange={(patch) => { setReview(null); setForm((current) => ({ ...current, ...patch })); }} onPreview={(params) => rpc("proxyConsole:previewPolicy", params)} /><div className="rule-set-picker"><div><strong>远程规则集</strong><span>只有缓存成功且启用的规则集会参与输出；顺序位于手写规则之后。</span></div>{ruleSets.length ? ruleSets.map((source) => <label key={source.id} className="rule-set-option"><input type="checkbox" checked={form.ruleSetIds.includes(source.id)} onChange={(event) => { setReview(null); setForm((current) => ({ ...current, ruleSetIds: event.target.checked ? [...current.ruleSetIds, source.id] : current.ruleSetIds.filter((id) => id !== source.id) })); }} /><span><strong>{source.name}</strong><small>{source.lastSuccessAt ? `${source.entryCount} 条 · 缓存 ${source.version}` : "尚无可用缓存"}{source.lastError && source.lastSuccessAt ? " · 最近刷新失败，沿用旧缓存" : ""}</small></span></label>) : <p className="muted">可在“订阅源”页添加文本规则集。</p>}</div></> : <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={({ active, activatorEvent }) => {
          setActiveDrag(active.data.current || null);
        }}
        onDragCancel={() => setActiveDrag(null)}
        onDragEnd={onDragEnd}
      >
        <div className="composer-layout">
          {stage === "nodes" ? (
            <SelectedNodeList
              nodes={form.nodeIds
                .map((id) => nodes.find((node) => node.id === id))
                .filter(Boolean)}
              machines={machines}
              recentNodeId={recentNodeId}
              onRemove={toggleNode}
            />
          ) : (
            <main className="composer-canvas">
              <div className="composer-toolbar">
                <div>
                  <strong>客户端出口策略</strong>
                  <span>
                    {form.groups.length} 个代理组 · 供 Mihomo / Surge / sing-box
                    使用
                  </span>
                </div>
                <div className="group-presets">
                  <button
                    type="button"
                    onClick={() => generateGroups("country")}
                  >
                    按国家生成
                  </button>
                  <button
                    type="button"
                    onClick={() => generateGroups("machine")}
                  >
                    按宿主生成
                  </button>
                  <Button icon={Plus} onClick={addGroup}>
                    添加代理组
                  </Button>
                </div>
              </div>
              <SortableContext
                items={form.groups.map((group) => `group:${group.id}`)}
                strategy={verticalListSortingStrategy}
              >
                <div className="group-canvas-grid">
                  {form.groups.map((group) => (
                    <SortableGroup
                      key={group.id}
                      group={group}
                      nodes={nodes}
                      allGroups={form.groups}
                      onChange={changeGroup}
                      onRemove={() =>
                        setForm({
                          ...form,
                          groups: form.groups
                            .filter((item) => item.id !== group.id)
                            .map((item) => ({
                              ...item,
                              entries: item.entries.filter(
                                (entry) =>
                                  entry.kind !== "group" ||
                                  entry.id !== group.id,
                              ),
                            })),
                        })
                      }
                    />
                  ))}
                </div>
              </SortableContext>
              {!form.groups.length && (
                <div className="drop-empty group-empty">
                  <Boxes size={20} />
                  <strong>尚未配置客户端出口策略</strong>
                  <span>
                    不影响 Anywhere、Raw 或 Base64；Mihomo、Surge、sing-box
                    会使用默认代理组。
                  </span>
                </div>
              )}
            </main>
          )}
          <aside className="available-pool">
            <div className="pane-title">
              <div>
                <strong>订阅节点范围</strong>
                <span>
                  {form.nodeIds.length} / {nodes.length} 个节点会输出
                </span>
              </div>
            </div>
            <p className="pool-help">
              勾选表示纳入当前订阅；输出名称与节点资料库完全一致。
            </p>
            <div className="search">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="按名称或协议筛选"
              />
            </div>
            <div className="quick-row">
              <button
                type="button"
                onClick={() =>
                  setForm({ ...form, nodeIds: nodes.map((node) => node.id) })
                }
              >
                全部纳入订阅
              </button>
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    nodeIds: [],
                    groups: form.groups.map((group) => ({
                      ...group,
                      entries: group.entries.filter(
                        (entry) => entry.kind !== "node",
                      ),
                    })),
                  })
                }
              >
                清空节点
              </button>
              {[...new Set(nodes.map((node) => inferNodeCountryCode(node, machineMap.get(node.machineId))).filter(Boolean))].sort().map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      nodeIds: [
                        ...new Set([
                          ...form.nodeIds,
                          ...nodes
                            .filter((node) => inferNodeCountryCode(node, machineMap.get(node.machineId)) === code)
                            .map((node) => node.id),
                        ]),
                      ],
                    })
                  }
                >
                  {flag(code)} {code}
                </button>
              ))}
              {machines.filter((machine) => nodes.some((node) => node.machineId === machine.id)).map((machine) => (
                <button
                  key={`machine:${machine.id}`}
                  type="button"
                  title={`纳入 ${machine.name} 的全部节点`}
                  onClick={() => setForm((current) => ({
                    ...current,
                    nodeIds: [...new Set([
                      ...current.nodeIds,
                      ...nodes.filter((node) => node.machineId === machine.id).map((node) => node.id),
                    ])],
                  }))}
                >
                  {flag(machine.countryCode)} {machine.name}
                </button>
              ))}
            </div>
            <div className="palette">
              {visible.map((node) => (
                <DraggableNode
                  key={node.id}
                  node={node}
                  machine={machineMap.get(node.machineId)}
                  selected={form.nodeIds.includes(node.id)}
                  onToggle={() => toggleNode(node.id)}
                  handleOnly={handleOnly}
                />
              ))}
            </div>
          </aside>
        </div>
        <DragOverlay
          modifiers={[({ activatorEvent, draggingNodeRect, overlayNodeRect, transform }) => {
            if (!activatorEvent || !draggingNodeRect || !overlayNodeRect) return transform;
            const start = "clientX" in activatorEvent
              ? activatorEvent
              : activatorEvent.touches?.[0] || activatorEvent.changedTouches?.[0];
            if (!start) return transform;
            return {
              ...transform,
              x: transform.x + start.clientX - draggingNodeRect.left - overlayNodeRect.width / 2,
              y: transform.y + start.clientY - draggingNodeRect.top - overlayNodeRect.height / 2,
            };
          }]}
          dropAnimation={{ duration: 160, easing: "ease-out" }}
        >
          {activeDrag && (
            <div className="drag-overlay">
              <GripVertical size={15} />
              <strong>{activeDrag.label || "代理组"}</strong>
            </div>
          )}
        </DragOverlay>
      </DndContext>}
      {saveError && (
        <p className="form-error" role="alert">
          {saveError}
        </p>
      )}
      {review && <div ref={reviewRef} className="change-review" role="status" tabIndex={-1}><div><strong>{subscription?.id ? "确认本次修改" : "确认创建内容"}</strong><span>{review.diff.fields.length ? review.diff.fields.join("；") : "没有变化"}</span></div><dl><div><dt>节点</dt><dd>{review.diff.before.nodes} → {review.diff.after.nodes}</dd></div><div><dt>代理组</dt><dd>{review.diff.before.groups} → {review.diff.after.groups}</dd></div><div><dt>规则</dt><dd>{review.diff.before.rules} → {review.diff.after.rules}</dd></div><div><dt>设备</dt><dd>{review.diff.before.devices} → {review.diff.after.devices}</dd></div></dl>{!!review.diff.addedNodes.length && <small>新增：{review.diff.addedNodes.join("、")}</small>}{!!review.diff.removedNodes.length && <small>移除：{review.diff.removedNodes.join("、")}</small>}</div>}
      <div className="dialog-actions sticky-actions">
        <span className="save-summary">
          {form.nodeIds.length} 个节点 · {form.groups.length}{" "}
          个代理组 · {form.customRules.length} 条规则
        </span>
        <DraftStatus onDiscard={() => { clearSessionDraft(draftKey); onClose(); }} />
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          icon={Save}
          disabled={saving}
          onClick={submit}
        >
          {saving ? "处理中…" : review ? (subscription?.id ? "确认保存" : "确认创建") : "预览变更"}
        </Button>
      </div>
    </Modal>
  );
}

export { subscriptionMachine, subscriptionAllowance, GROUP_LABELS, DEVICE_CLIENTS, Subscriptions, DraggableNode, SelectedNode, SelectedNodeList, SortableGroupEntry, SortableGroup, SubscriptionEditor };
