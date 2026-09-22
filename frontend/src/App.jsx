import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { version as pluginVersion } from "../../package.json";
import RuleEditor from "./RuleEditor.jsx";
import { exitGroups } from "./ip-profile.js";
import { buildPreflightReport } from "./preflight.js";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { QRCodeSVG } from "qrcode.react";
import {
  Activity,
  Boxes,
  Check,
  ChevronDown,
  ChevronUp,
  CircleGauge,
  Clipboard,
  CloudDownload,
  Copy,
  Database,
  Download,
  Edit3,
  Eye,
  EyeOff,
  ExternalLink,
  Globe2,
  GripVertical,
  Import,
  Link2,
  ListFilter,
  Maximize2,
  MoreHorizontal,
  Network,
  PackageOpen,
  Play,
  Plus,
  Power,
  QrCode,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Server,
  Settings,
  ShieldCheck,
  KeyRound,
  CalendarClock,
  Moon,
  Sun,
  Monitor,
  Square,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  androidAnywhereLink,
  anywhereLink,
  buildRepairUri,
  bytes,
  flag,
  generateRealityKeypair,
  hostFromUri,
  inferNodeCountryCode,
  localDateInput,
  NAME_TEMPLATES,
  normalizeNowhereReleases,
  normalizeSingBoxReleases,
  nowhereVersionCapabilities,
  NOWHERE_RELEASE_FALLBACK,
  SING_BOX_RELEASE_FALLBACK,
  preferredPublicHost,
  randomId,
  splitTags,
  subscriptionUrl,
  templateNodeNames,
  evaluateTrafficPlan,
} from "./lib.js";

const NAV = [
  ["overview", "服务器", CircleGauge],
  ["nodes", "节点", Network],
  ["subscriptions", "订阅", Link2],
  ["sources", "订阅源", CloudDownload],
  ["deploy", "部署节点", Upload],
  ["providers", "外部面板", Database],
];
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
const EMPTY_STATE = {
  version: 14,
  revision: 0,
  settings: {
    publicBaseUrl: "",
    monitoring: {
      cpuPercent: 85,
      memoryPercent: 90,
      diskPercent: 90,
    },
  },
  machines: [],
  nodes: [],
  nodeDrafts: [],
  subscriptions: [],
  externalSources: [],
  ruleSets: [],
  serviceBindings: [],
  managedInstances: [],
  certificates: [],
  deploymentPresets: [],
  providers: [],
};
function readServiceCache() {
  try {
    const cached = JSON.parse(
      sessionStorage.getItem("proxy-console-service-status") || "{}",
    );
    for (const services of Object.values(cached)) {
      for (const row of Object.values(services || {})) {
        if (row && typeof row === "object" && row.pending) {
          row.pending = false;
          row.state = row.state === "active" || row.state === "inactive" ? row.state : "unavailable";
          row.error = "上次查询未完成，请重新刷新";
        }
      }
    }
    return cached;
  } catch (_) {
    return {};
  }
}

async function rpc(method, params = {}) {
  const response = await fetch("/api/rpc2", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomId(), method, params }),
  });
  if (!response.ok) throw new Error(`请求失败 (${response.status})`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "操作失败");
  return data.result;
}
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
function shellQuote(value) {
  return `'${String(value || "").replaceAll("'", `'"'"'`)}'`;
}
function powershellQuote(value) {
  return `'${String(value || "").replaceAll("'", "''")}'`;
}
function systemPrefersDark() {
  try {
    if (window.parent !== window) {
      const root = window.parent.document.documentElement;
      if (root.classList.contains("dark") || root.dataset.theme === "dark") return true;
      if (root.classList.contains("light") || root.dataset.theme === "light") return false;
    }
  } catch (_) { /* Cross-origin parents fall back to the OS preference. */ }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
}
function useThemeSync() {
  const [mode, setMode] = useState(() => {
    try {
      const saved = localStorage.getItem("wherever-station-theme");
      return ["auto", "light", "dark"].includes(saved) ? saved : "auto";
    } catch (_) { return "auto"; }
  });
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  useEffect(() => {
    const sync = () => setSystemDark(systemPrefersDark());
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", sync);
    let observer;
    try {
      if (window.parent !== window) {
        observer = new MutationObserver(sync);
        observer.observe(window.parent.document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "data-theme"],
        });
      }
    } catch (_) { /* Cross-origin parents are intentionally ignored. */ }
    sync();
    return () => {
      observer?.disconnect();
      media?.removeEventListener?.("change", sync);
    };
  }, []);
  const resolved = mode === "auto" ? (systemDark ? "dark" : "light") : mode;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.classList.toggle("light", resolved === "light");
    root.dataset.stationTheme = resolved;
    try { localStorage.setItem("wherever-station-theme", mode); } catch (_) { /* Theme persistence is optional. */ }
  }, [mode, resolved]);
  return {
    mode,
    resolved,
    setMode,
    cycle: () => setMode((current) => ({ auto: "light", light: "dark", dark: "auto" })[current]),
  };
}
function readSessionDraft(key) {
  try {
    return JSON.parse(sessionStorage.getItem(`wherever-station:draft:${key}`) || "null");
  } catch (_) {
    return null;
  }
}
function writeSessionDraft(key, value) {
  try {
    sessionStorage.setItem(
      `wherever-station:draft:${key}`,
      JSON.stringify({ savedAt: new Date().toISOString(), value }),
    );
  } catch (_) { /* Draft persistence is best-effort in restricted browsers. */ }
}
function clearSessionDraft(key) {
  try { sessionStorage.removeItem(`wherever-station:draft:${key}`); }
  catch (_) { /* Draft persistence is best-effort in restricted browsers. */ }
}
function useAsyncButton(onClick) {
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const handleClick = useCallback((event) => {
    if (!onClick || pendingRef.current) return;
    const result = onClick(event);
    if (!result || typeof result.then !== "function") return;
    pendingRef.current = true;
    setPending(true);
    Promise.resolve(result).then(
      () => { pendingRef.current = false; setPending(false); },
      () => { pendingRef.current = false; setPending(false); },
    );
  }, [onClick]);
  return { pending, handleClick };
}
function IconButton({ label, children, onClick, disabled, ...props }) {
  const { pending, handleClick } = useAsyncButton(onClick);
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={label}
      title={label}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      onClick={onClick ? handleClick : undefined}
      {...props}
    >
      {pending ? <span className="action-spinner" aria-hidden="true" /> : children}
    </button>
  );
}
function StationMark({ size = 36, className = "" }) {
  return (
    <svg
      className={`station-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <rect className="station-mark-surface" x="4" y="4" width="56" height="56" rx="14" />
      <path className="station-mark-post" d="M31 21h2v30H31z" />
      <circle className="station-mark-location" cx="32" cy="52" r="3.5" />
      <rect className="station-mark-sign" x="16" y="10" width="32" height="11" rx="2.4" />
      <rect className="station-mark-border" x="17.5" y="11.4" width="29" height="8.2" rx="1.5" />
    </svg>
  );
}
function Button({ icon: Icon, children, variant = "secondary", onClick, disabled, ...props }) {
  const { pending, handleClick } = useAsyncButton(onClick);
  return (
    <button className={`button ${variant}`} type="button" aria-busy={pending || undefined} disabled={disabled || pending} onClick={onClick ? handleClick : undefined} {...props}>
      {pending ? <span className="action-spinner" aria-hidden="true" /> : Icon && <Icon size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}
function Status({ ok, tone, children, ...props }) {
  return (
    <span className={`status ${tone || (ok ? "ok" : "bad")}`} {...props}>
      <i />
      {children}
    </span>
  );
}
function DraftStatus({ onDiscard, children = "草稿已自动保留" }) {
  return (
    <span className="draft-status">
      {children}
      {onDiscard && <button type="button" onClick={onDiscard}>放弃草稿</button>}
    </span>
  );
}
function Field({ label, hint, error, wide, children }) {
  return (
    <label className={`${wide ? "wide" : ""} ${error ? "field-invalid" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small className="helper">{hint}</small>}
      {error && <small className="field-error" role="alert">{error}</small>}
    </label>
  );
}
function SecretInput({ value, onChange, ...props }) {
  const [revealed, setRevealed] = useState(false);
  return <span className="secret-input"><input {...props} type={revealed ? "text" : "password"} value={value} onChange={onChange} /><button type="button" aria-label={revealed ? "隐藏内容" : "显示内容"} title={revealed ? "隐藏内容" : "显示内容"} onClick={() => setRevealed((current) => !current)}>{revealed ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>;
}
function Modal({ open, title, eyebrow, onClose, children, size = "normal" }) {
  const ref = useRef(null);
  const requestClose = useCallback((notifyParent = true) => {
    const dialog = ref.current;
    if (dialog?.open) dialog.close();
    if (notifyParent) onClose();
  }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal ${size}`}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <div className="dialog-head">
        <div>
          {eyebrow && <p>{eyebrow}</p>}
          <h2>{title}</h2>
        </div>
        <IconButton label="关闭" onClick={() => requestClose()}>
          <X size={19} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
function Empty({ icon: Icon = Boxes, title, children }) {
  return (
    <div className="empty">
      <Icon size={28} />
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}
function ContextGuide({ icon: Icon, label, children }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`context-guide ${open ? "open" : ""}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span><Icon size={16} /><strong>{label}</strong></span>
        <ChevronDown size={17} />
      </button>
      <div className="context-guide-collapse" aria-hidden={!open}><div>{children}</div></div>
    </section>
  );
}

function Sparkline({ values, tone = "primary" }) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length < 2) return <span className="spark-empty">数据不足</span>;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const points = clean
    .map(
      (value, index) =>
        `${(index / (clean.length - 1)) * 240},${48 - ((value - min) / span) * 44}`,
    )
    .join(" ");
  return (
    <svg
      className={`spark ${tone}`}
      viewBox="0 0 240 52"
      preserveAspectRatio="none"
      role="img"
      aria-label="24 小时趋势"
    >
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
function FleetTrafficChart({ points }) {
  const samples = points.length === 1 ? [points[0], points[0]] : points;
  const max = Math.max(1, ...samples.flatMap((point) => [point.down, point.up]));
  const line = (key) => samples
    .map((point, index) => `${(index / Math.max(1, samples.length - 1)) * 600},${132 - (point[key] / max) * 112}`)
    .join(" ");
  const latest = samples.at(-1) || { down: 0, up: 0 };
  return (
    <div className="fleet-chart" role="img" aria-label={`最近 60 秒流量趋势，当前下载 ${bytes(latest.down, true)}，上传 ${bytes(latest.up, true)}`}>
      <div className="chart-legend" aria-hidden="true">
        <span className="down"><i />下载</span>
        <span className="up"><i />上传</span>
      </div>
      <svg viewBox="0 0 600 150" preserveAspectRatio="none" aria-hidden="true">
        {[20, 57, 94, 131].map((y) => <line key={y} className="grid" x1="0" x2="600" y1={y} y2={y} />)}
        {samples.length >= 2 && <>
          <polyline className="down" points={line("down")} />
          <polyline className="up" points={line("up")} />
        </>}
      </svg>
      <div className="chart-axis"><span>60S AGO</span><span>{points.length < 2 ? "正在积累样本" : `${points.length} 个实时样本`}</span><span>NOW</span></div>
    </div>
  );
}
function SelectedServerTrend({ client }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loadTrend = useCallback(async () => {
    if (!client?.uuid) return;
    setBusy(true);
    setError("");
    try {
      setData(
        await rpc("public:queryMetrics", {
          metric_keys: ["cpu.usage", "net.in.rate", "net.out.rate"],
          entity_ids: [client.uuid],
          hours: 24,
          max_points: 72,
          fill_empty: false,
        }),
      );
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }, [client?.uuid]);
  useEffect(() => {
    loadTrend();
  }, [loadTrend]);
  const series = data?.series || [];
  const values = (key) =>
    series
      .find((item) => item.entity_id === client?.uuid && item.metric_key === key)
      ?.points?.map((point) => point.value)
      .filter((value) => value != null) || [];
  const cpu = values("cpu.usage");
  const down = values("net.in.rate");
  const up = values("net.out.rate");
  const latest = (items) => items.at(-1) || 0;
  return (
    <section className="selected-server-trend" aria-label={`${client?.name || "服务器"} 24 小时历史趋势`}>
      <header>
        <span>24H TREND</span>
        <button type="button" onClick={loadTrend} disabled={busy} aria-label="刷新当前服务器 24 小时趋势" title="刷新 24 小时趋势">
          <RefreshCw size={13} className={busy ? "spin" : ""} />
        </button>
      </header>
      {error ? <p className="selected-trend-empty" title={error}>历史指标暂不可用</p> : (
        <div className="selected-trend-grid">
          <article><span>下载</span><strong>{bytes(latest(down), true)}</strong><Sparkline values={down} /></article>
          <article><span>上传</span><strong>{bytes(latest(up), true)}</strong><Sparkline values={up} tone="success" /></article>
          <article><span>CPU</span><strong>{cpu.length ? `${latest(cpu).toFixed(1)}%` : "—"}</strong><Sparkline values={cpu} /></article>
        </div>
      )}
    </section>
  );
}

function Overview({
  state,
  clients,
  statuses,
  updatedAt,
  onRefresh,
  busy,
  persist,
}) {
  const [thresholdsOpen, setThresholdsOpen] = useState(false);
  const [trafficHistory, setTrafficHistory] = useState([]);
  const clientList = Object.values(clients);
  const online = clientList.filter(
    (client) => statuses[client.uuid]?.online,
  ).length;
  const trafficDown = Object.values(statuses).reduce(
    (sum, status) => sum + Number(status.net_total_down || 0),
    0,
  );
  const trafficUp = Object.values(statuses).reduce(
    (sum, status) => sum + Number(status.net_total_up || 0),
    0,
  );
  const rateDown = Object.values(statuses).reduce(
    (sum, status) => sum + Number(status.net_in ?? status.net_in_speed ?? 0),
    0,
  );
  const rateUp = Object.values(statuses).reduce(
    (sum, status) => sum + Number(status.net_out ?? status.net_out_speed ?? 0),
    0,
  );
  useEffect(() => {
    if (!updatedAt) return;
    setTrafficHistory((current) => [
      ...current,
      { observedAt: Date.now(), down: rateDown, up: rateUp },
    ].filter((point) => Date.now() - point.observedAt <= 60000).slice(-20));
  }, [rateDown, rateUp, updatedAt]);
  const limits = state.settings.monitoring || EMPTY_STATE.settings.monitoring;
  const trafficAlerts = state.machines.flatMap((machine) => {
    const status = statuses[machine.monitorClientId] || {};
    const plan = evaluateTrafficPlan(machine.trafficPlan, { up: status.net_total_up, down: status.net_total_down });
    if (!["warning", "critical", "exceeded"].includes(plan.state)) return [];
    const label = plan.state === "exceeded" ? "已超出额度" : plan.state === "critical" ? "接近额度" : "达到提示线";
    return [`${machine.name} 流量 ${plan.percent.toFixed(1)}% · ${label}`];
  });
  const alerts = [...clientList.flatMap((client) => {
    const status = statuses[client.uuid] || {};
    const items = [];
    const add = (label, used, total, limit) => {
      const percentage = total ? (Number(used || 0) / Number(total)) * 100 : 0;
      if (percentage >= limit)
        items.push(`${client.name} ${label} ${percentage.toFixed(1)}%`);
    };
    add("CPU", status.cpu, 100, limits.cpuPercent);
    add(
      "内存",
      status.ram,
      status.ram_total || client.mem_total,
      limits.memoryPercent,
    );
    add(
      "磁盘",
      status.disk,
      status.disk_total || client.disk_total,
      limits.diskPercent,
    );
    if (!status.online) items.push(`${client.name} 当前离线`);
    return items;
  }), ...trafficAlerts, ...(state.certificates || []).filter((asset) => ["warning", "expired", "invalid", "missing"].includes(asset.status)).map((asset) => asset.status === "warning" ? `${asset.name} 将于 ${new Date(asset.expiresAt).toLocaleDateString("zh-CN")} 到期` : `${asset.name} · ${{ expired: "证书已过期", invalid: "证书检查失败", missing: "证书文件缺失" }[asset.status]}`)];
  return (
    <section className="overview-panel">
      <PageHead
        title="基础设施控制台"
        description="实时流量、服务器健康与托管服务使用同一套数据；选择服务器后再执行操作。"
      >
        <span className="updated">
          {updatedAt ? `更新于 ${updatedAt}` : "正在连接"}
        </span>
        <Button icon={Settings} onClick={() => setThresholdsOpen(true)}>
          提示阈值
        </Button>
        <Button icon={RefreshCw} onClick={onRefresh} disabled={busy}>
          刷新
        </Button>
      </PageHead>
      <div className="summary-strip">
        <Summary
          label="服务器"
          value={clientList.length}
          suffix="台"
          icon={Server}
        />
        <Summary
          label="在线"
          value={`${online}/${clientList.length}`}
          suffix="台"
          icon={Activity}
          tone="green"
        />
        <Summary
          label="Agent 累计下载 ↓"
          value={bytes(trafficDown)}
          icon={Download}
          tone="blue"
        />
        <Summary
          label="Agent 累计上传 ↑"
          value={bytes(trafficUp)}
          icon={Upload}
          tone="green"
        />
        <Summary
          label="可用节点"
          value={state.nodes.filter((node) => node.enabled).length}
          suffix="个"
          icon={Network}
        />
      </div>
      <div className="fleet-hero-grid">
        <article className="throughput-card" aria-label={`${online} 台在线服务器的实时总吞吐量`}>
          <header><span><strong>CURRENT THROUGHPUT</strong></span><b>LIVE · 3S</b></header>
          <div className="throughput-values">
            <div><span>↓ 下载</span><strong>{bytes(rateDown, true)}</strong></div>
            <div><span>↑ 上传</span><strong>{bytes(rateUp, true)}</strong></div>
          </div>
          <footer><span>ONLINE · {online}</span><span>AGENT TOTAL · {bytes(trafficDown + trafficUp)}</span></footer>
        </article>
        <article className="fleet-traffic-card">
          <header>
            <div><span>FLEET TRAFFIC / 60 SECONDS</span><strong>{bytes(trafficDown + trafficUp)}</strong><small>Agent 累计 · ↓ {bytes(trafficDown)}　↑ {bytes(trafficUp)}</small></div>
          </header>
          <FleetTrafficChart points={trafficHistory} />
        </article>
      </div>
      {alerts.length > 0 && (
        <div className="monitor-alerts">
          {alerts.map((alert) => (
            <span key={alert}>{alert}</span>
          ))}
        </div>
      )}
      <ThresholdDialog
        open={thresholdsOpen}
        values={limits}
        onClose={() => setThresholdsOpen(false)}
        onSave={async (monitoring) => {
          await persist(
            { ...state, settings: { ...state.settings, monitoring } },
            "监控提示阈值已保存",
          );
          setThresholdsOpen(false);
        }}
      />
    </section>
  );
}
function ThresholdDialog({ open, values, onClose, onSave }) {
  const [form, setForm] = useState(values);
  useEffect(() => {
    if (open) setForm(values);
  }, [open, values]);
  const number = (key, value) => setForm({ ...form, [key]: Number(value) });
  return (
    <Modal
      open={open}
      title="资源提示阈值"
      eyebrow="提示设置"
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="CPU 使用率 %">
          <input
            type="number"
            min="1"
            max="100"
            value={form.cpuPercent || 85}
            onChange={(event) => number("cpuPercent", event.target.value)}
          />
        </Field>
        <Field label="内存使用率 %">
          <input
            type="number"
            min="1"
            max="100"
            value={form.memoryPercent || 90}
            onChange={(event) => number("memoryPercent", event.target.value)}
          />
        </Field>
        <Field label="磁盘使用率 %">
          <input
            type="number"
            min="1"
            max="100"
            value={form.diskPercent || 90}
            onChange={(event) => number("diskPercent", event.target.value)}
          />
        </Field>
      </div>
      <p className="editor-note">
        服务器流量额度在对应服务器的“流量计划”中独立设置。
      </p>
      <div className="dialog-actions">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" icon={Save} onClick={() => onSave(form)}>
          保存阈值
        </Button>
      </div>
    </Modal>
  );
}
function PageHead({ title, description, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p className="sr-only">{description}</p>}
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
function Summary({ label, value, suffix, icon: Icon, tone = "neutral" }) {
  return (
    <article className={`summary ${tone}`}>
      <span className="summary-icon">
        <Icon size={18} />
      </span>
      <div>
        <span>{label}</span>
        <strong>
          {value}
          <small>{suffix}</small>
        </strong>
      </div>
    </article>
  );
}
function Nodes({ state, setState, persist, notify, parseUris, clients, me }) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [country, setCountry] = useState("");
  const [protocol, setProtocol] = useState("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState("name-asc");
  const [selected, setSelected] = useState({});
  const [editor, setEditor] = useState(null);
  const [importing, setImporting] = useState(false);
  const [batch, setBatch] = useState(null);
  const [directOutput, setDirectOutput] = useState(null);
  const [batchOutput, setBatchOutput] = useState([]);
  const [batchQrPage, setBatchQrPage] = useState(0);
  const [recentId, setRecentId] = useState("");
  const recentTimerRef = useRef(null);
  const [connection, setConnection] = useState(null);
  const [draftRepair, setDraftRepair] = useState(null);
  const [draftError, setDraftError] = useState("");
  useEffect(() => {
    const id = sessionStorage.getItem("wherever-node-focus");
    if (!id) return;
    const node = state.nodes.find((item) => item.id === id);
    sessionStorage.removeItem("wherever-node-focus");
    if (node) { setSearch(node.name); setRecentId(node.id); }
  }, []);
  useEffect(() => () => clearTimeout(recentTimerRef.current), []);
  const machineMap = useMemo(
    () => new Map(state.machines.map((machine) => [machine.id, machine])),
    [state.machines],
  );
  const sourceMap = useMemo(
    () => new Map(state.externalSources.map((item) => [item.id, item])),
    [state.externalSources],
  );
  const providerMap = useMemo(
    () => new Map((state.providers || []).map((item) => [item.id, item])),
    [state.providers],
  );
  const managedNodeIds = useMemo(
    () => new Set((state.managedInstances || []).map((item) => item.nodeId)),
    [state.managedInstances],
  );
  const deletionBlock = (node) => {
    if (managedNodeIds.has(node.id)) return "托管节点请在部署节点页面管理生命周期";
    if (node.source === "external" && node.sourceId) return "订阅源节点请在外部订阅源页面管理";
    if (node.source === "provider" && node.sourceId) return "面板节点请在外部面板同步中管理";
    return "";
  };
  const rows = useMemo(() => {
      const filtered = state.nodes.filter((node) => {
        const machine = machineMap.get(node.machineId) || {};
        const haystack =
          `${node.name} ${node.protocol} ${node.uri} ${(node.tags || []).join(" ")} ${machine.name || ""}`.toLowerCase();
        return (
          (!deferredSearch ||
            haystack.includes(deferredSearch.toLowerCase())) &&
          (!country || inferNodeCountryCode(node, machine) === country) &&
          (!protocol || node.protocol === protocol) &&
          (!source || node.source === source)
        );
      });
      const [key, direction] = sort.split("-");
      const multiplier = direction === "desc" ? -1 : 1;
      const value = (node) => {
        if (key === "country") return inferNodeCountryCode(node, machineMap.get(node.machineId));
        if (key === "protocol") return node.protocol || "";
        if (key === "source") return node.source || "";
        return node.name || "";
      };
      return [...filtered].sort((left, right) => multiplier * String(value(left)).localeCompare(String(value(right)), "zh-CN", { numeric: true, sensitivity: "base" }));
    },
    [state.nodes, machineMap, deferredSearch, country, protocol, source, sort],
  );
  useEffect(() => {
    if (!recentId) return undefined;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector(`[data-node-id="${recentId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
    const timer = setTimeout(() => setRecentId(""), 1600);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [recentId, rows.length]);
  const removeNodes = async (ids) => {
    const blocked = ids.map((id) => state.nodes.find((node) => node.id === id)).filter(Boolean).map((node) => ({ node, reason: deletionBlock(node) })).find((item) => item.reason);
    if (blocked) {
      notify(`${blocked.node.name}：${blocked.reason}`, true);
      return;
    }
    if (
      !confirm(
        `永久删除选中的 ${ids.length} 个独立节点？它们也会从订阅和代理组中移除。`,
      )
    )
      return;
    try {
      const next = await rpc("proxyConsole:deleteNodes", { nodeIds: ids, expectedRevision: state.revision });
      setState(next);
      setSelected({});
      notify(`已删除 ${ids.length} 个独立节点`);
    } catch (error) { notify(error.message, true); }
  };
  const columns = useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="选择当前全部节点"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`选择 ${row.original.name}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      },
      {
        accessorKey: "name",
        header: "节点",
        cell: ({ row }) => (
          <div className="node-name">
            <strong>{row.original.name}</strong>
            <small className="sensitive-value">{hostFromUri(row.original)}</small>
          </div>
        ),
      },
      {
        accessorKey: "protocol",
        header: "协议",
        cell: ({ getValue }) => (
          <span
            className={`protocol ${getValue() === "nowhere" ? "special" : ""}`}
          >
            {getValue()}
          </span>
        ),
      },
      {
        id: "host",
        header: "地区 / 归类",
        cell: ({ row }) => {
          const machine = machineMap.get(row.original.machineId) || {};
          const external = sourceMap.get(row.original.sourceId);
          const provider = providerMap.get(row.original.sourceId);
          const inferredCountry = inferNodeCountryCode(row.original, machine);
          return (
            <div className="host-cell">
              <span>
                {machine.id
                  ? `${flag(machine.countryCode)} ${String(machine.countryCode || "").toUpperCase() || "未分组"}`
                  : `${flag(inferredCountry)} ${inferredCountry || (provider ? "外部面板" : external ? "外部订阅" : "未归类")}`.trim()}
              </span>
              <small>{machine.name || external?.name || provider?.name || "未关联 VPS"}</small>
            </div>
          );
        },
      },
      {
        id: "tags",
        header: "标签",
        cell: ({ row }) => (
          <div className="tags">
            {(row.original.tags || []).slice(0, 3).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ),
      },
      {
        id: "source",
        header: "来源",
        cell: ({ row }) => (
          <div className="node-source-state"><span className="muted">
            {row.original.providerMissing ? "远端已不存在" : ({ manual: "手动", import: "导入", external: "订阅源", provider: "外部面板" }[
              row.original.source
            ] || "手动")}
          </span>{row.original.connectivity && <small className={row.original.connectivity.status === "passed" ? "probe-ok" : "probe-bad"}>{row.original.connectivity.status === "passed" ? "连接通过" : "连接失败"} · {new Date(row.original.connectivity.observedAt).toLocaleString("zh-CN", { hour12: false })}</small>}</div>
        ),
      },
      {
        id: "state",
        header: "订阅输出",
        cell: ({ row }) => (
          <label
            className="output-toggle"
            title="控制该节点是否参与订阅输出"
          >
            <span className="switch">
              <input
                type="checkbox"
                aria-label={`${row.original.name} 允许订阅输出`}
                checked={row.original.enabled}
                onChange={async () => {
                  const next = {
                    ...state,
                    nodes: state.nodes.map((node) =>
                      node.id === row.original.id
                        ? { ...node, enabled: !node.enabled }
                        : node,
                    ),
                  };
                  await persist(
                    next,
                    row.original.enabled
                      ? "已停止输出此节点"
                      : "已恢复输出此节点",
                  );
                }}
              />
              <span />
            </span>
            <small>{row.original.enabled ? "可输出" : "不输出"}</small>
          </label>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="row-actions">
            <button
              className="node-output-button"
              type="button"
              onClick={() => setDirectOutput(row.original)}
            >
              <QrCode size={15} />
              直出
            </button>
            <IconButton
              label="连接检查与历史"
              onClick={() => openConnection([row.original.id])}
            >
              <Activity size={16} />
            </IconButton>
            <IconButton
              label="编辑节点"
              onClick={() => setEditor(row.original)}
            >
              <Edit3 size={16} />
            </IconButton>
            <IconButton
              label={deletionBlock(row.original) || "删除节点"}
              disabled={!!deletionBlock(row.original)}
              onClick={() => removeNodes([row.original.id])}
            >
              <Trash2 size={16} />
            </IconButton>
          </div>
        ),
      },
    ],
    [machineMap, persist, providerMap, sourceMap, state, clients],
  );
  const table = useReactTable({
    data: rows,
    columns,
    state: { rowSelection: selected },
    onRowSelectionChange: setSelected,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  });
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const selectedDeletionBlock = selectedIds.map((id) => state.nodes.find((node) => node.id === id)).filter(Boolean).map(deletionBlock).find(Boolean) || "";
  const countryCodes = [...new Set(state.nodes.map((node) => inferNodeCountryCode(node, machineMap.get(node.machineId))).filter(Boolean))].sort();
  const probeSources = state.machines.filter((machine) => machine.monitorClientId && clients[machine.monitorClientId]);
  async function openConnection(nodeIds) {
    setConnection({ nodeIds, histories: [], results: [], running: false, loadingHistory: true });
    const histories = await rpc("proxyConsole:getConnectivityHistory", { nodeIds, limit: 80 }).catch(() => []);
    setConnection((current) => current ? ({ ...current, histories, loadingHistory: false }) : current);
  }
  const runConnectionChecks = async () => {
    if (!probeSources.length || connection.running) return;
    const otp = me?.two_factor_enabled ? prompt("请输入本次批量连接检查的两步验证码") || "" : "";
    if (me?.two_factor_enabled && !otp) return;
    setConnection((current) => ({ ...current, running: true, results: [] }));
    const results = []; let latestState = state;
    for (const nodeId of connection.nodeIds) {
      const node = state.nodes.find((item) => item.id === nodeId);
      const source = probeSources.find((machine) => machine.id !== node?.machineId) || probeSources[0];
      try {
        const spec = await rpc("proxyConsole:prepareNodeConnectivityCheck", { nodeId, sourceMachineId: source.id, requestId: crypto.randomUUID() });
        const task = await executeTask(spec.clientId, spec.command, otp, 40000);
        const saved = await rpc("proxyConsole:recordNodeConnectivityCheck", { nodeId, sourceMachineId: source.id, output: task.result });
        latestState = saved.state; results.push({ nodeId, name: node?.name || nodeId, ...saved.result });
      } catch (error) { results.push({ nodeId, name: node?.name || nodeId, status: "failed", error: error.message }); }
      setConnection((current) => current ? ({ ...current, results: [...results] }) : current);
    }
    setState(latestState); const histories = await rpc("proxyConsole:getConnectivityHistory", { nodeIds: connection.nodeIds, limit: 80 }).catch(() => []);
    setConnection((current) => current ? ({ ...current, running: false, histories }) : current);
    notify(`连接检查完成：${results.filter((item) => item.status === "passed").length}/${results.length} 通过`);
  };
  const quickBatch = async (kind) => {
    const idSet = new Set(selectedIds);
    let changed = state.nodes;
    if (kind === "flag")
      changed = state.nodes.map((node) => {
        if (!idSet.has(node.id)) return node;
        const icon = flag(inferNodeCountryCode(node, machineMap.get(node.machineId)));
        return icon && !node.name.startsWith(icon)
          ? { ...node, name: `${icon} ${node.name}` }
          : node;
      });
    if (kind === "enable" || kind === "disable")
      changed = state.nodes.map((node) =>
        idSet.has(node.id) ? { ...node, enabled: kind === "enable" } : node,
      );
    await persist(
      { ...state, nodes: changed },
      `已更新 ${selectedIds.length} 个节点`,
    );
  };
  const openDraftRepair = (draft) => {
    setDraftError("");
    setDraftRepair({ draft, name: draft.name || "", protocol: draft.protocol || "unknown", publicHost: draft.repair?.publicHost || "", port: draft.repair?.port || "", sni: draft.repair?.sni || "", credential: "", realityPublicKey: "", shortId: "", flow: draft.repair?.reality ? "xtls-rprx-vision" : "", method: "2022-blake3-aes-128-gcm", insecure: false, uri: "" });
  };
  const resolveDraft = async () => {
    try {
      const uri = buildRepairUri(draftRepair);
      const parsed = await rpc("proxyConsole:parseNodeUris", { text: uri });
      const incoming = parsed.nodes?.[0];
      if (!incoming) throw new Error(parsed.errors?.[0]?.message || "无法解析修复后的 URI");
      const identity = incoming.uri.split("#", 1)[0];
      if (state.nodes.some((node) => node.uri.split("#", 1)[0] === identity)) throw new Error("节点库中已经存在相同连接");
      const node = { ...incoming, id: randomId(), name: draftRepair.name.trim() || incoming.name, machineId: draftRepair.draft.machineId || "", enabled: true, tags: ["发现修复", draftRepair.draft.kind === "nowhere" ? "Nowhere" : "sing-box"], source: "import", sourceId: "" };
      await persist({ ...state, nodes: [...state.nodes, node], nodeDrafts: (state.nodeDrafts || []).filter((item) => item.id !== draftRepair.draft.id) }, "草稿已修复并加入节点库");
      setDraftRepair(null); setRecentId(node.id);
    } catch (error) { setDraftError(error.message); }
  };
  const removeDraft = async (draft) => {
    if (!confirm(`移除发现草稿“${draft.name}”？`)) return;
    await persist({ ...state, nodeDrafts: (state.nodeDrafts || []).filter((item) => item.id !== draft.id) }, "发现草稿已移除");
  };
  return (
    <section className="workspace-page nodes-panel">
      <PageHead
        title="节点管理"
        description="整理节点名称、归属和标签，并选择哪些节点参与订阅。"
      >
        <Button icon={Plus} onClick={() => setEditor({})}>
          添加节点
        </Button>
        <Button
          icon={Import}
          variant="primary"
          onClick={() => setImporting(true)}
        >
          批量导入
        </Button>
      </PageHead>
      {!!state.nodeDrafts?.length && <section className="draft-workbench" aria-label="待修复发现节点"><header><div><strong>待修复节点</strong><span>{state.nodeDrafts.length} 项已保留为草稿，补全前不会进入订阅。</span></div></header><div>{state.nodeDrafts.map((draft) => <article key={draft.id}><span className={`protocol ${draft.protocol === "nowhere" ? "special" : ""}`}>{draft.protocol}</span><div><strong>{draft.name}</strong><small>{draft.reason}</small><code title={draft.source}>{draft.source}</code></div><Status tone={draft.repair?.port ? "warning" : ""}>{draft.repair?.port ? "待确认" : "草稿"}</Status><div><Button icon={Edit3} variant="primary" onClick={() => openDraftRepair(draft)}>补全</Button><IconButton label={`移除 ${draft.name} 草稿`} onClick={() => removeDraft(draft)}><Trash2 size={16} /></IconButton></div></article>)}</div></section>}
      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索名称、地址、协议、宿主或标签"
          />
        </div>
        <Filter
          value={country}
          onChange={setCountry}
          label="全部地区"
          options={countryCodes.map((code) => [
            code,
            `${flag(code)} ${code}`,
          ])}
        />
        <Filter
          value={protocol}
          onChange={setProtocol}
          label="全部协议"
          options={[...new Set(state.nodes.map((node) => node.protocol))]
            .sort()
            .map((item) => [item, item])}
        />
        <Filter
          value={source}
          onChange={setSource}
          label="全部来源"
          options={[
            ["manual", "手动"],
            ["import", "批量导入"],
            ["external", "外部订阅"],
            ["provider", "外部面板"],
          ]}
        />
        <Filter
          value={sort}
          onChange={setSort}
          label="节点名称升序"
          options={[
            ["name-asc", "名称：升序"],
            ["name-desc", "名称：降序"],
            ["country-asc", "地区：升序"],
            ["protocol-asc", "协议：升序"],
            ["source-asc", "来源：升序"],
          ]}
        />
      </div>
      {selectedIds.length > 0 && (
        <div className="bulk">
          <strong>已选择 {selectedIds.length} 个</strong>
          <Button onClick={() => setBatch("template")}>一键整理命名</Button>
          <Button onClick={() => quickBatch("flag")}>仅添加国旗</Button>
          <Button onClick={() => setBatch("rename")}>正则重命名</Button>
          <Button onClick={() => setBatch("move")}>移动宿主</Button>
          <Button onClick={() => setBatch("tags")}>替换标签</Button>
          <Button icon={Activity} onClick={() => openConnection(selectedIds)}>连接检查</Button>
          <Button icon={QrCode} onClick={() => {
            setBatchQrPage(0);
            setBatchOutput(state.nodes.filter((node) => selectedIds.includes(node.id) && node.uri));
          }}>批量直出</Button>
          <Button onClick={() => quickBatch("enable")}>允许订阅输出</Button>
          <Button onClick={() => quickBatch("disable")}>停止订阅输出</Button>
          <Button
            variant="danger"
            icon={Trash2}
            disabled={!!selectedDeletionBlock}
            title={selectedDeletionBlock || "永久删除所选独立节点"}
            onClick={() => removeNodes(selectedIds)}
          >
            删除
          </Button>
        </div>
      )}
      <div className="table-shell node-library">
        <table>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id}>
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                data-node-id={row.original.id}
                className={`${recentId === row.original.id ? "recent" : ""} ${row.getIsSelected() ? "selected" : ""}`.trim()}
                aria-selected={row.getIsSelected()}
                tabIndex={0}
                onClick={(event) => {
                  if (event.target.closest?.("button, a, input, select, textarea, label, [role='button'], [data-row-selection-ignore]")) return;
                  if (window.getSelection()?.type === "Range") return;
                  row.toggleSelected(!row.getIsSelected());
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
                  event.preventDefault();
                  row.toggleSelected(!row.getIsSelected());
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <Empty title="没有匹配的节点">调整筛选条件或导入新节点。</Empty>
        )}
      </div>
      <NodeEditor
        open={!!editor}
        node={editor}
        machines={state.machines}
        onClose={() => setEditor(null)}
        onSave={async (node) => {
          const exists = state.nodes.some((item) => item.id === node.id);
          await persist(
            {
              ...state,
              nodes: exists
                ? state.nodes.map((item) => (item.id === node.id ? node : item))
                : [...state.nodes, node],
            },
            "节点已保存",
          );
          setEditor(null);
          if (!exists) {
            setSearch("");
            setCountry("");
            setProtocol("");
            setSource("");
            setRecentId(node.id);
          }
        }}
      />
      <Modal
        open={!!directOutput}
        title={`${directOutput?.name || "节点"} · 节点链接`}
        eyebrow="单节点输出"
        onClose={() => setDirectOutput(null)}
      >
        <p>直接复制 URI，或使用客户端扫描二维码。</p>
        {directOutput && <>
          <div className="qr-box"><QRCodeSVG value={directOutput.uri} size={232} level="M" bgColor="#ffffff" fgColor="#171717" /></div>
          <label className="direct-uri"><span>节点 URI</span><textarea readOnly rows={3} value={directOutput.uri} onFocus={(event) => event.currentTarget.select()} /></label>
        </>}
        <p className="warning">二维码和 URI 均包含节点凭据，请勿公开分享。</p>
        <div className="dialog-actions">
          <Button onClick={() => setDirectOutput(null)}>关闭</Button>
          <Button icon={Copy} variant="primary" onClick={async () => {
            try { await navigator.clipboard.writeText(directOutput?.uri || ""); notify("节点 URI 已复制"); }
            catch (_) { notify("复制失败，请手动选择 URI", true); }
          }}>复制 URI</Button>
        </div>
      </Modal>
      <Modal
        open={batchOutput.length > 0}
        title={`${batchOutput.length} 个节点 · 批量直出`}
        eyebrow="批量 URI / 二维码"
        size="large"
        onClose={() => setBatchOutput([])}
      >
        <p>多行 URI 可直接粘贴进支持批量导入的客户端；二维码按节点逐个生成。</p>
        <label className="direct-uri batch-uri"><span>批量节点 URI</span><textarea readOnly rows={7} value={batchOutput.map((node) => node.uri).join("\n")} onFocus={(event) => event.currentTarget.select()} /></label>
        <div className="batch-qr-toolbar">
          <strong>二维码 {batchQrPage * 6 + 1}–{Math.min((batchQrPage + 1) * 6, batchOutput.length)} / {batchOutput.length}</strong>
          <div>
            <Button disabled={batchQrPage === 0} onClick={() => setBatchQrPage((page) => Math.max(0, page - 1))}>上一页</Button>
            <Button disabled={(batchQrPage + 1) * 6 >= batchOutput.length} onClick={() => setBatchQrPage((page) => page + 1)}>下一页</Button>
          </div>
        </div>
        <div className="batch-qr-grid">
          {batchOutput.slice(batchQrPage * 6, batchQrPage * 6 + 6).map((node) => <article key={node.id}><QRCodeSVG value={node.uri} size={148} level="M" bgColor="#ffffff" fgColor="#171717" /><strong title={node.name}>{node.name}</strong></article>)}
        </div>
        <p className="warning">二维码和 URI 均包含节点凭据，请勿公开分享。</p>
        <div className="dialog-actions">
          <Button onClick={() => setBatchOutput([])}>关闭</Button>
          <Button icon={Copy} variant="primary" onClick={async () => {
            try { await navigator.clipboard.writeText(batchOutput.map((node) => node.uri).join("\n")); notify(`已复制 ${batchOutput.length} 条 URI`); }
            catch (_) { notify("复制失败，请手动选择 URI", true); }
          }}>复制全部 URI</Button>
        </div>
      </Modal>
      <ImportDialog
        open={importing}
        machines={state.machines}
        parseUris={parseUris}
        onClose={() => setImporting(false)}
        onSave={async (created) => {
          const importedId = created[0]?.id || "";
          await persist(
            { ...state, nodes: [...state.nodes, ...created] },
            `已导入 ${created.length} 个节点`,
          );
          setImporting(false);
          setSearch("");
          setCountry("");
          setProtocol("");
          setSource("");
          clearTimeout(recentTimerRef.current);
          recentTimerRef.current = setTimeout(() => setRecentId(importedId), 240);
        }}
      />
      <BatchDialog
        open={!!batch}
        mode={batch}
        nodes={state.nodes.filter((node) => selectedIds.includes(node.id))}
        machines={state.machines}
        sources={state.externalSources}
        onClose={() => setBatch(null)}
        onSave={async (updates) => {
          const map = new Map(updates.map((node) => [node.id, node]));
          await persist(
            {
              ...state,
              nodes: state.nodes.map((node) => map.get(node.id) || node),
            },
            `已批量更新 ${updates.length} 个节点`,
          );
          setBatch(null);
        }}
      />
      <Modal open={!!connection} title="连接检查" eyebrow="节点可用性" onClose={() => !connection?.running && setConnection(null)}>
        <p className="editor-note">自动从另一台可用 Agent 启动临时代理客户端，请求 HTTPS 测试地址并核对出口；没有异地 Agent 时才在节点宿主本机测试。</p>
        {connection?.running && <div className="probe-progress"><span className="spinner" />正在检查 {connection.results.length + 1} / {connection.nodeIds.length}</div>}
        {!!connection?.results.length && <div className="probe-results">{connection.results.map((item) => <div key={item.nodeId}><Status ok={item.status === "passed"}>{item.status === "passed" ? "通过" : "失败"}</Status><span>{item.name}</span><small>{item.sourceName ? `${item.sourceName} → ` : ""}<span className={item.actualIp ? "sensitive-value" : ""}>{item.actualIp || MANAGED_ERROR[item.error] || item.error || "检查完成"}</span></small></div>)}</div>}
        <details className="probe-history" open={!connection?.results.length}><summary>{connection?.loadingHistory ? "正在读取历史…" : `最近历史 · ${connection?.histories.length || 0}`}</summary><div>{connection?.histories.map((item) => <p key={item.id}><Status ok={item.status === "passed"}>{item.status === "passed" ? "通过" : "失败"}</Status><span>{item.nodeName}</span><small>{item.sourceName} · {new Date(item.observedAt).toLocaleString("zh-CN", { hour12: false })}{item.actualIp ? <> · <span className="sensitive-value">{item.actualIp}</span></> : ""}</small></p>)}</div></details>
        {!probeSources.length && <p className="inline-error">没有在线且已绑定的 Komari Agent，暂时无法执行检查。</p>}
        <div className="dialog-actions"><Button onClick={() => setConnection(null)} disabled={connection?.running}>关闭</Button><Button variant="primary" icon={Activity} onClick={runConnectionChecks} disabled={connection?.running || !probeSources.length}>{connection?.running ? "检查中…" : `代理测试 ${connection?.nodeIds.length || 0} 个节点`}</Button></div>
      </Modal>
      <Modal open={!!draftRepair} title={`补全 · ${draftRepair?.draft?.name || "发现节点"}`} eyebrow="发现修复" onClose={() => setDraftRepair(null)} size="large">
        <p className="editor-note">优先粘贴从原面板或客户端导出的完整 URI；也可按发现证据补齐常见协议参数。这里不会写回 VPS。</p>
        <div className="form-grid"><Field label="节点名称" wide><input value={draftRepair?.name || ""} onChange={(event) => setDraftRepair((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="协议"><select value={draftRepair?.protocol || "unknown"} onChange={(event) => setDraftRepair((current) => ({ ...current, protocol: event.target.value }))}>{["vless", "vmess", "trojan", "hysteria2", "anytls", "ss", "nowhere", "unknown"].map((value) => <option key={value} value={value}>{value}</option>)}</select></Field><Field label="公网地址"><input value={draftRepair?.publicHost || ""} onChange={(event) => setDraftRepair((current) => ({ ...current, publicHost: event.target.value }))} /></Field><Field label="端口"><input type="number" min="1" max="65535" value={draftRepair?.port || ""} onChange={(event) => setDraftRepair((current) => ({ ...current, port: Number(event.target.value) }))} /></Field><Field label="用户凭据" hint="UUID、密码或 Nowhere Shared Key。"><SecretInput autoComplete="off" value={draftRepair?.credential || ""} onChange={(event) => setDraftRepair((current) => ({ ...current, credential: event.target.value }))} /></Field><Field label="SNI / 证书域名"><input value={draftRepair?.sni || ""} onChange={(event) => setDraftRepair((current) => ({ ...current, sni: event.target.value }))} /></Field>{draftRepair?.protocol === "vless" && draftRepair?.draft?.repair?.reality && <><Field label="Reality 公钥"><input value={draftRepair?.realityPublicKey || ""} onChange={(event) => setDraftRepair((current) => ({ ...current, realityPublicKey: event.target.value }))} /></Field><Field label="Reality Short ID"><input value={draftRepair?.shortId || ""} onChange={(event) => setDraftRepair((current) => ({ ...current, shortId: event.target.value }))} /></Field></>}{["trojan", "hysteria2", "anytls"].includes(draftRepair?.protocol) && <label className="check-line"><input type="checkbox" checked={draftRepair?.insecure || false} onChange={(event) => setDraftRepair((current) => ({ ...current, insecure: event.target.checked }))} />客户端允许不安全证书</label>}<Field label="完整客户端 URI（推荐）" wide hint="填写后优先使用，并忽略上方连接参数。"><textarea rows={4} spellCheck="false" value={draftRepair?.uri || ""} onChange={(event) => { setDraftError(""); setDraftRepair((current) => ({ ...current, uri: event.target.value })); }} placeholder="vless://… / vmess://… / nowhere://…" /></Field></div>
        {draftRepair?.draft?.repair?.certificate && <div className="certificate-readiness"><strong>证书只读检查</strong><span>{draftRepair.draft.repair.certificate.readable ? "证书可读" : "未能读取证书"}</span><span>{draftRepair.draft.repair.certificate.keyMatch === true ? "证书与私钥匹配" : draftRepair.draft.repair.certificate.keyMatch === false ? "证书与私钥不匹配" : "未确认密钥匹配"}</span>{draftRepair.draft.repair.certificate.validTo && <span>有效至 {draftRepair.draft.repair.certificate.validTo}</span>}{draftRepair.draft.repair.certificate.sans?.length ? <span>SAN：{draftRepair.draft.repair.certificate.sans.join("、")}</span> : null}</div>}
        {draftError && <p className="form-error" role="alert">{draftError}</p>}<div className="dialog-actions"><Button onClick={() => setDraftRepair(null)}>取消</Button><Button icon={Save} variant="primary" onClick={resolveDraft} disabled={!draftRepair?.name?.trim()}>验证并加入节点库</Button></div>
      </Modal>
    </section>
  );
}
function Filter({ value, onChange, label, options }) {
  return (
    <label className="compact-select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{label}</option>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
      <ChevronDown size={14} />
    </label>
  );
}
function NodeEditor({ open, node, machines, onClose, onSave }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const draftKey = `node:${node?.id || "new"}`;
  useEffect(() => {
    if (!open) return;
    const initial = {
      id: node?.id || randomId(),
      name: node?.name || "",
      uri: node?.uri || "",
      machineId: node?.machineId || "",
      tags: (node?.tags || []).join(", "),
      enabled: node?.enabled !== false,
      source: node?.source || "manual",
      sourceId: node?.sourceId || "",
    };
    const draft = readSessionDraft(draftKey)?.value;
    setForm(draft ? { ...initial, ...draft, id: initial.id } : initial);
    setError("");
  }, [open, node?.id]);
  useEffect(() => {
    if (open && form.id) writeSessionDraft(draftKey, form);
  }, [draftKey, form, open]);
  const submit = async (event) => {
    event.preventDefault();
    const protocol = form.uri.split(":", 1)[0].toLowerCase();
    try {
      await rpc("proxyConsole:validateNode", { protocol, uri: form.uri });
      await onSave({
        id: form.id,
        name: form.name.trim(),
        uri: form.uri.trim(),
        protocol,
        machineId: form.machineId,
        tags: splitTags(form.tags),
        enabled: form.enabled,
        source: form.source,
        sourceId: form.sourceId,
      });
      clearSessionDraft(draftKey);
    } catch (reason) {
      setError(reason.message);
    }
  };
  return (
    <Modal
      open={open}
      title={node?.id ? "编辑节点" : "添加节点"}
      eyebrow="节点资料"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="节点名称" wide>
            <input
              required
              maxLength={160}
              value={form.name || ""}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </Field>
          <Field label="关联 VPS（可选）" hint="普通 URI 不需要预建宿主；仅远程发现、部署和服务控制依赖 Agent。">
            <select
              value={form.machineId || ""}
              onChange={(event) => {
                const machineId = event.target.value;
                const oldMachine = machines.find((item) => item.id === form.machineId);
                const machine = machines.find((item) => item.id === machineId);
                const oldDefault = oldMachine
                  ? `${flag(oldMachine.countryCode)} ${oldMachine.region || oldMachine.name} | 节点`.trim()
                  : "";
                const shouldFollow = !form.name?.trim() || form.name === oldDefault;
                const name = shouldFollow && machine
                  ? `${flag(machine.countryCode)} ${machine.region || machine.name} | 节点`.trim()
                  : form.name;
                setForm({ ...form, machineId, name });
              }}
            >
              <option value="">暂不关联 VPS</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {flag(machine.countryCode)} {machine.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="标签">
            <input
              value={form.tags || ""}
              onChange={(event) =>
                setForm({ ...form, tags: event.target.value })
              }
              placeholder="自用, 高速"
            />
          </Field>
          <Field
            label="分享 URI"
            wide
            hint="粘贴客户端可直接导入的完整 URI；协议参数会按原样保存。"
          >
            <textarea
              required
              rows={6}
              spellCheck="false"
              value={form.uri || ""}
              onChange={(event) => {
                setError("");
                setForm({ ...form, uri: event.target.value });
              }}
              placeholder="vless://… / vmess://… / hysteria2://… / 其他协议 URI"
            />
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <DraftStatus onDiscard={() => { clearSessionDraft(draftKey); onClose(); }} />
          <Button onClick={onClose}>取消</Button>
          <button className="button primary" type="submit">
            <Save size={16} />
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ImportDialog({ open, machines, parseUris, onClose, onSave }) {
  const [text, setText] = useState("");
  const [machineId, setMachineId] = useState("");
  const [tags, setTags] = useState("导入");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parseRequestRef = useRef(0);
  useEffect(() => {
    if (open) {
      const draft = readSessionDraft("node-import")?.value;
      setText(draft?.text || "");
      setResult(null);
      setError("");
      parseRequestRef.current += 1;
      setMachineId(draft?.machineId || "");
      setTags(draft?.tags || "导入");
    }
  }, [open]);
  useEffect(() => {
    if (open) writeSessionDraft("node-import", { text, machineId, tags });
  }, [machineId, open, tags, text]);
  const parse = async (value = text) => {
    const input = typeof value === "string" ? value : text;
    if (!input.trim()) return;
    const request = ++parseRequestRef.current;
    setBusy(true);
    setError("");
    try {
      const next = await parseUris(input);
      if (request === parseRequestRef.current) setResult(next);
    } catch (reason) {
      if (request === parseRequestRef.current) setError(reason.message);
    } finally {
      if (request === parseRequestRef.current) setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title="批量导入节点"
      eyebrow="批量导入"
      size="large"
      onClose={onClose}
    >
      <Field label="节点内容（URI、Base64 或 Clash/Mihomo YAML）">
        <textarea
          rows={10}
          spellCheck="false"
          value={text}
          onChange={(event) => {
            parseRequestRef.current += 1;
            setText(event.target.value);
            setResult(null);
            setError("");
            setBusy(false);
          }}
          onPaste={(event) => {
            const input = event.currentTarget;
            const next =
              input.value.slice(0, input.selectionStart) +
              event.clipboardData.getData("text") +
              input.value.slice(input.selectionEnd);
            setTimeout(() => parse(next), 0);
          }}
          placeholder={"vless://...\nvmess://...\n其他客户端 URI..."}
        />
      </Field>
      <div className="form-grid import-meta">
        <Field label="关联 VPS（可选）">
          <select
            value={machineId}
            onChange={(event) => setMachineId(event.target.value)}
          >
            <option value="">暂不关联 VPS</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {flag(machine.countryCode)} {machine.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="标签">
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </Field>
        <Button icon={ListFilter} onClick={parse} disabled={busy}>
          {busy ? "解析中" : "解析并预览"}
        </Button>
      </div>
      {result && (
        <div className="import-preview">
          <div>
            <strong>可导入 {result.nodes.length} 个</strong>
            <span>{result.errors.length} 行无法解析</span>
          </div>
          {result.nodes.slice(0, 80).map((node, index) => (
            <p key={`${node.uri}-${index}`}>
              <span
                className={`protocol ${node.protocol === "nowhere" ? "special" : ""}`}
              >
                {node.protocol}
              </span>
              <strong>{node.name}</strong>
              <small>{hostFromUri(node)}</small>
            </p>
          ))}
          {!!result.errors.length && (
            <details className="import-errors">
              <summary>查看无法导入的原因</summary>
              {result.errors.slice(0, 40).map((item, index) => (
                <p key={index}>
                  第 {item.line} 项：{item.message}
                </p>
              ))}
            </details>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <DraftStatus onDiscard={() => { clearSessionDraft("node-import"); onClose(); }} />
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          icon={Import}
          disabled={busy || !result?.nodes.length}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSave(
                result.nodes.map((node) => ({
                  ...node,
                  id: randomId(),
                  machineId,
                  tags: splitTags(tags),
                  source: "import",
                  sourceId: "",
                  enabled: true,
                })),
              );
              clearSessionDraft("node-import");
            } catch (reason) {
              setError(reason.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          导入 {result?.nodes.length || 0} 个
        </Button>
      </div>
    </Modal>
  );
}
function BatchDialog({
  open,
  mode,
  nodes,
  machines,
  sources,
  onClose,
  onSave,
}) {
  const [pattern, setPattern] = useState("");
  const [replacement, setReplacement] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [machineId, setMachineId] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [template, setTemplate] = useState(NAME_TEMPLATES[0][2]);
  const [start, setStart] = useState(1);
  const [digits, setDigits] = useState(2);
  const [numbering, setNumbering] = useState("group");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setPattern("");
      setReplacement("");
      setPrefix("");
      setSuffix("");
      setMachineId("");
      setTags("");
      setError("");
      setTemplate(NAME_TEMPLATES[0][2]);
      setStart(1);
      setDigits(2);
      setNumbering("group");
      setBusy(false);
    }
  }, [open, machines]);
  let preview = nodes;
  let previewError = "";
  try {
    const regex = pattern ? new RegExp(pattern, "g") : null;
    if (mode === "rename")
      preview = nodes.map((node) => ({
        ...node,
        name: `${prefix}${regex ? node.name.replace(regex, replacement) : node.name}${suffix}`
          .trim()
          .slice(0, 160),
      }));
    if (mode === "template")
      preview = templateNodeNames(
        nodes,
        machines,
        { template, start, digits, numbering },
        sources,
      );
  } catch (reason) {
    preview = nodes;
    previewError = reason.message;
  }
  const apply = async () => {
    setError("");
    setBusy(true);
    try {
      let output = nodes;
      if (mode === "rename") {
        const regex = pattern ? new RegExp(pattern, "g") : null;
        output = nodes.map((node) => ({
          ...node,
          name: `${prefix}${regex ? node.name.replace(regex, replacement) : node.name}${suffix}`
            .trim()
            .slice(0, 160),
        }));
      }
      if (mode === "template")
        output = templateNodeNames(
          nodes,
          machines,
          { template, start, digits, numbering },
          sources,
        );
      if (mode === "move")
        output = nodes.map((node) => ({ ...node, machineId }));
      if (mode === "tags")
        output = nodes.map((node) => ({ ...node, tags: splitTags(tags) }));
      await onSave(output);
    } catch (reason) {
      setError(reason.message);
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={
        {
          template: "一键整理节点名称",
          rename: "正则批量重命名",
          move: "移动到服务器",
          tags: "替换节点标签",
        }[mode] || "批量操作"
      }
      eyebrow="批量整理"
      onClose={onClose}
    >
      {mode === "template" && (
        <>
          <div className="template-presets" role="group" aria-label="命名模板">
            {NAME_TEMPLATES.map(([id, label, value]) => (
              <button
                key={id}
                type="button"
                className={template === value ? "active" : ""}
                onClick={() => setTemplate(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="form-grid">
            <Field
              label="名称模板"
              wide
              hint="占位符全部可选，可自由删减；重名会自动追加 (2)。支持 {flag} {country} {region} {provider} {protocol} {host} {name} {n}"
            >
              <input
                value={template}
                onChange={(event) => {
                  setError("");
                  setTemplate(event.target.value);
                }}
              />
            </Field>
            <Field label="编号方式">
              <select
                value={numbering}
                onChange={(event) => setNumbering(event.target.value)}
              >
                <option value="group">同地区/服务商/协议分别编号</option>
                <option value="global">按当前选择全局编号</option>
              </select>
            </Field>
            <Field label="起始编号 / 位数">
              <div className="inline-fields">
                <input
                  aria-label="起始编号"
                  type="number"
                  min="1"
                  max="9999"
                  value={start}
                  onChange={(event) => setStart(Number(event.target.value))}
                />
                <select
                  aria-label="编号位数"
                  value={digits}
                  onChange={(event) => setDigits(Number(event.target.value))}
                >
                  <option value="1">1 位</option>
                  <option value="2">2 位</option>
                  <option value="3">3 位</option>
                </select>
              </div>
            </Field>
          </div>
        </>
      )}
      {mode === "rename" && (
        <div className="form-grid">
          <Field label="查找（正则）">
            <input
              value={pattern}
              onChange={(event) => {
                setError("");
                setPattern(event.target.value);
              }}
              placeholder="^(.*)$"
            />
          </Field>
          <Field label="替换为">
            <input
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              placeholder="$1 · 自建"
            />
          </Field>
          <Field label="名称前缀">
            <input
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
            />
          </Field>
          <Field label="名称后缀">
            <input
              value={suffix}
              onChange={(event) => setSuffix(event.target.value)}
            />
          </Field>
        </div>
      )}
      {(mode === "rename" || mode === "template") && (
        <div className="rename-preview">
          <strong>应用前预览</strong>
          {preview.slice(0, 10).map((node, index) => (
            <p key={node.id}>
              <span title={nodes[index].name}>{nodes[index].name}</span>
              <b>→</b>
              <span title={node.name}>{node.name}</span>
            </p>
          ))}
        </div>
      )}
      {mode === "move" && (
        <Field label="目标宿主">
          <select
            value={machineId}
            onChange={(event) => setMachineId(event.target.value)}
          >
            <option value="">取消关联 VPS</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {flag(machine.countryCode)} {machine.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {mode === "tags" && (
        <Field label="替换为这些标签">
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="自用, 高速"
          />
        </Field>
      )}
      {(error || previewError) && (
        <p className="form-error">{error || previewError}</p>
      )}
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button
          variant="primary"
          icon={Check}
          disabled={busy || !!previewError}
          onClick={apply}
        >
          {busy ? "正在保存…" : `确认应用到 ${nodes.length} 个节点`}
        </Button>
      </div>
    </Modal>
  );
}

function effectiveSubscriptionTraffic(state, subscription) {
  const quota = subscription.quota || { mode: "none" };
  let traffic = null;
  if (quota.mode === "manual") traffic = quota;
  if (quota.mode === "external") traffic = state.externalSources.find((item) => item.id === quota.sourceId)?.traffic || null;
  if (quota.mode === "provider") {
    const provider = state.providers.find((item) => item.id === quota.sourceId);
    traffic = provider?.clients?.find((item) => item.id === quota.clientId) || null;
  }
  if (!traffic && !subscription.expiresAt) return null;
  const configuredExpire = subscription.expiresAt ? Math.floor(Date.parse(subscription.expiresAt) / 1000) : 0;
  return {
    upload: Number(traffic?.upload || 0), download: Number(traffic?.download || 0), total: Number(traffic?.total || 0),
    expire: configuredExpire && (!traffic?.expire || configuredExpire < traffic.expire) ? configuredExpire : Number(traffic?.expire || 0),
  };
}
function Subscriptions({ state, persist, notify, onOpenSettings }) {
  const [editor, setEditor] = useState(null);
  const [qr, setQr] = useState(null);
  const [access, setAccess] = useState({});
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
          const traffic = effectiveSubscriptionTraffic(state, sub);
          const used = Number(traffic?.upload || 0) + Number(traffic?.download || 0);
          const expired = Boolean(traffic?.expire && traffic.expire * 1000 <= Date.now());
          const exhausted = Boolean(traffic?.total && used >= traffic.total);
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
                <Status ok={sub.enabled && !expired && !exhausted}>
                  {expired ? "已到期" : exhausted ? "额度已用尽" : sub.enabled ? "已启用" : "已停用"}
                </Status>
              </div>
              {traffic && <div className="subscription-traffic" aria-label="订阅流量额度"><span>上传 <strong>{bytes(traffic.upload)}</strong></span><span>下载 <strong>{bytes(traffic.download)}</strong></span><span>剩余 <strong>{traffic.total ? bytes(Math.max(0, traffic.total - used)) : "不限"}</strong></span>{traffic.expire ? <span>到期 <strong>{new Date(traffic.expire * 1000).toLocaleDateString("zh-CN")}</strong></span> : null}</div>}
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
        mode: subscription?.quota?.mode || "none",
        upload: Number(subscription?.quota?.upload || 0),
        download: Number(subscription?.quota?.download || 0),
        total: Number(subscription?.quota?.total || 0),
        expire: Number(subscription?.quota?.expire || 0),
        sourceId: subscription?.quota?.sourceId || "",
        clientId: subscription?.quota?.clientId || "",
      },
      policyMode: subscription?.policyMode || "proxy-all",
      customRules: (subscription?.customRules || []).map((rule) => ({ ...rule })),
      ruleSetIds: [...(subscription?.ruleSetIds || [])],
      devices: (subscription?.devices || []).map((device) => ({ ...device })),
    };
    const draft = readSessionDraft(draftKey)?.value;
    setForm(draft ? { ...initial, ...draft, id: initial.id, token: initial.token } : initial);
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
    if (["external", "provider"].includes(form.quota.mode) && !form.quota.sourceId) return setSaveError("请选择额度来源");
    if (form.quota.mode === "provider" && !form.quota.clientId) return setSaveError("请选择额度对应的客户端");
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
          hint="到期当天 23:59 后返回 404；留空为长期有效。"
        >
          <input
            type="date"
            value={form.expiryDate}
            onChange={(event) =>
              setForm({ ...form, expiryDate: event.target.value })
            }
          />
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
        <summary>流量额度与订阅失效</summary>
        <p>额度只控制这条订阅链接，不会停止节点或改写 VPS。多个来源不会相加。</p>
        <div className="form-grid">
          <Field label="额度依据">
            <select value={form.quota.mode} onChange={(event) => setForm((current) => ({ ...current, quota: { ...current.quota, mode: event.target.value, sourceId: "", clientId: "" } }))}>
              <option value="none">无限制</option>
              <option value="manual">手动额度</option>
              <option value="external">跟随外部订阅源</option>
              <option value="provider">跟随外部面板客户端</option>
            </select>
          </Field>
          {form.quota.mode === "manual" && <>
            <Field label="已上传（GiB）"><input type="number" min="0" step="0.01" value={form.quota.upload ? form.quota.upload / 1073741824 : ""} onChange={(event) => setForm((current) => ({ ...current, quota: { ...current.quota, upload: Math.round(Number(event.target.value || 0) * 1073741824) } }))} /></Field>
            <Field label="已下载（GiB）"><input type="number" min="0" step="0.01" value={form.quota.download ? form.quota.download / 1073741824 : ""} onChange={(event) => setForm((current) => ({ ...current, quota: { ...current.quota, download: Math.round(Number(event.target.value || 0) * 1073741824) } }))} /></Field>
            <Field label="总额度（GiB）" hint="填 0 表示只展示用量、不按总量关闭链接。"><input type="number" min="0" step="0.01" value={form.quota.total ? form.quota.total / 1073741824 : ""} onChange={(event) => setForm((current) => ({ ...current, quota: { ...current.quota, total: Math.round(Number(event.target.value || 0) * 1073741824) } }))} /></Field>
          </>}
          {form.quota.mode === "external" && <Field label="外部订阅源" wide hint="使用该来源最近一次同步得到的 Subscription-Userinfo。"><select value={form.quota.sourceId} onChange={(event) => setForm((current) => ({ ...current, quota: { ...current.quota, sourceId: event.target.value } }))}><option value="">请选择来源</option>{externalSources.map((source) => <option key={source.id} value={source.id}>{source.name}{source.traffic ? ` · 剩余 ${bytes(Math.max(0, source.traffic.total - source.traffic.upload - source.traffic.download))}` : " · 暂无额度信息"}</option>)}</select></Field>}
          {form.quota.mode === "provider" && <><Field label="外部面板" wide><select value={form.quota.sourceId} onChange={(event) => setForm((current) => ({ ...current, quota: { ...current.quota, sourceId: event.target.value, clientId: "" } }))}><option value="">请选择面板</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.type === "2s-ui" ? "2S-UI" : "S-UI"}</option>)}</select></Field><Field label="客户端" wide><select value={form.quota.clientId} onChange={(event) => setForm((current) => ({ ...current, quota: { ...current.quota, clientId: event.target.value } }))}><option value="">请选择客户端</option>{(providers.find((provider) => provider.id === form.quota.sourceId)?.clients || []).map((client) => <option key={client.id} value={client.id}>{client.name} · 已用 {bytes(client.upload + client.download)}{client.total ? ` / ${bytes(client.total)}` : ""}</option>)}</select></Field></>}
        </div>
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
function SettingsDialog({ open, value, revision, theme, onClose, onSave, onRestored }) {
  const safariDownload = /^((?!chrome|crios|android|edg).)*safari/i.test(navigator.userAgent);
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const [backup, setBackup] = useState(null);
  const [backupPreview, setBackupPreview] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupDownloadStatus, setBackupDownloadStatus] = useState("");
  const [backupDownload, setBackupDownload] = useState(null);
  const [backupDownloadAttempted, setBackupDownloadAttempted] = useState(false);
  const [backupDownloadHelp, setBackupDownloadHelp] = useState(false);
  useEffect(() => {
    if (open) {
      const initial = {
        publicBaseUrl: value?.publicBaseUrl || "",
        cpuPercent: value?.monitoring?.cpuPercent || 85,
        memoryPercent: value?.monitoring?.memoryPercent || 90,
        diskPercent: value?.monitoring?.diskPercent || 90,
        themeMode: theme.mode,
      };
      setForm(readSessionDraft("settings")?.value || initial);
      setError("");
      setBackup(null);
      setBackupPreview(null);
      setBackupDownloadStatus("");
      setBackupDownload(null);
      setBackupDownloadAttempted(false);
      setBackupDownloadHelp(false);
    }
  }, [open]);
  useEffect(() => {
    if (open && form.themeMode) writeSessionDraft("settings", form);
  }, [form, open]);
  const save = async () => {
    try {
      if (form.publicBaseUrl) {
        const parsed = new URL(form.publicBaseUrl);
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password
        )
          throw new Error("请输入正常的 HTTP/HTTPS 根地址");
      }
      const monitoring = {
        cpuPercent: Math.min(100, Math.max(1, Number(form.cpuPercent) || 85)),
        memoryPercent: Math.min(100, Math.max(1, Number(form.memoryPercent) || 90)),
        diskPercent: Math.min(100, Math.max(1, Number(form.diskPercent) || 90)),
      };
      await onSave({
        ...value,
        publicBaseUrl: String(form.publicBaseUrl || "").replace(/\/$/, ""),
        monitoring,
      });
      theme.setMode(form.themeMode);
      clearSessionDraft("settings");
    } catch (reason) {
      setError(reason.message);
    }
  };
  const downloadBackup = async () => {
    setBackupDownloadStatus(""); setBackupDownload(null); setBackupDownloadAttempted(false); setBackupDownloadHelp(false); setError("");
    const filename = `wherever-station-backup-${new Date().toISOString().slice(0, 10)}.json`;
    let fileHandle = null;
    const sandboxBlocksDownloads = (() => {
      try { return !!window.frameElement?.sandbox && !window.frameElement.sandbox.contains("allow-downloads"); }
      catch { return false; }
    })();
    if (typeof window.showSaveFilePicker === "function") {
      try {
        // The picker needs the click's user activation, so open it before the RPC request.
        fileHandle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: "JSON 备份", accept: { "application/json": [".json"] } }] });
      } catch (reason) {
        if (reason?.name === "AbortError") return;
        if (sandboxBlocksDownloads) { setBackupDownloadStatus("blocked"); return; }
      }
    }
    if (sandboxBlocksDownloads && !fileHandle) { setBackupDownloadStatus("blocked"); return; }
    setBackupBusy(true);
    try {
      if (fileHandle) {
        const exported = await rpc("proxyConsole:exportPortableBackup");
        const content = JSON.stringify(exported, null, 2) + "\n";
        const writable = await fileHandle.createWritable();
        try { await writable.write(content); await writable.close(); }
        catch (reason) { await writable.abort().catch(() => {}); throw reason; }
        setBackupDownloadStatus("saved");
      } else {
        const ticket = await rpc("proxyConsole:preparePortableBackupDownload");
        setBackupDownload(ticket);
        setBackupDownloadStatus("ready");
      }
    } catch (reason) { setError(reason.message); }
    finally { setBackupBusy(false); }
  };
  const selectBackup = async (file) => {
    setBackup(null); setBackupPreview(null); setError("");
    if (!file) return;
    setBackupBusy(true);
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("备份超过 8 MB，请检查文件内容");
      const parsed = JSON.parse(await file.text());
      const preview = await rpc("proxyConsole:previewPortableBackup", { backup: parsed });
      setBackup(parsed); setBackupPreview({ ...preview, revision });
    } catch (reason) { setError(reason instanceof SyntaxError ? "文件不是有效的 JSON 备份" : reason.message); }
    finally { setBackupBusy(false); }
  };
  const restoreBackup = async () => {
    if (!backup || !backupPreview || !window.confirm("确认用备份替换当前插件数据？此操作不会改动 VPS 上的进程或文件。")) return;
    setBackupBusy(true); setError("");
    try {
      const restored = await rpc("proxyConsole:restorePortableBackup", { backup, expectedRevision: backupPreview.revision });
      clearSessionDraft("settings");
      setBackup(null); setBackupPreview(null);
      onRestored(restored);
    } catch (reason) { setError(reason.message); }
    finally { setBackupBusy(false); }
  };
  return (
    <Modal
      open={open}
      title="控制台设置"
      eyebrow="SETTINGS"
      onClose={onClose}
      size="large"
    >
      <div className="settings-grid">
        <section>
          <span>SUBSCRIPTION</span>
          <strong>订阅公开地址</strong>
          <Field label="公共根地址" hint="留空时沿用当前 Komari 域名。">
            <input type="url" value={form.publicBaseUrl || ""} onChange={(event) => setForm({ ...form, publicBaseUrl: event.target.value })} placeholder="https://sub.example.com" />
          </Field>
        </section>
        <section>
          <span>MONITORING</span>
          <strong>资源提示阈值</strong>
          <div className="settings-thresholds">
            <Field label="CPU %"><input type="number" min="1" max="100" value={form.cpuPercent || 85} onChange={(event) => setForm({ ...form, cpuPercent: event.target.value })} /></Field>
            <Field label="内存 %"><input type="number" min="1" max="100" value={form.memoryPercent || 90} onChange={(event) => setForm({ ...form, memoryPercent: event.target.value })} /></Field>
            <Field label="磁盘 %"><input type="number" min="1" max="100" value={form.diskPercent || 90} onChange={(event) => setForm({ ...form, diskPercent: event.target.value })} /></Field>
          </div>
        </section>
        <section className="settings-appearance">
          <span>APPEARANCE</span>
          <strong>界面主题</strong>
          <div role="radiogroup" aria-label="界面主题">
            {[["auto", "跟随 Komari", Monitor], ["light", "浅色", Sun], ["dark", "深色", Moon]].map(([mode, label, Icon]) => (
              <button key={mode} type="button" role="radio" aria-checked={form.themeMode === mode} className={form.themeMode === mode ? "active" : ""} onClick={() => setForm({ ...form, themeMode: mode })}><Icon size={17} /><span>{label}</span></button>
            ))}
          </div>
        </section>
        <section className="settings-backup">
          <span>PORTABILITY</span>
          <strong>备份与迁移</strong>
          <p>导出节点、订阅、宿主、预设、面板连接及规则缓存。备份含节点凭据和 API Token，请妥善保管。</p>
          <div className="settings-backup-actions">
            <Button icon={Download} onClick={downloadBackup} disabled={backupBusy}>下载备份</Button>
            <label className="button backup-file-picker"><Upload size={16} /><span>选择备份文件</span><input type="file" accept=".json,application/json" onChange={(event) => { selectBackup(event.target.files?.[0]); event.target.value = ""; }} disabled={backupBusy} /></label>
          </div>
          {backupDownloadStatus === "saved" && <p role="status">备份已保存。</p>}
          {backupDownloadStatus === "ready" && backupDownload && <div className="backup-download-ready" role="status">
            <p>备份已准备好，请<a href={backupDownload.url} onClick={(event) => { setBackupDownloadAttempted(true); if (safariDownload) { event.preventDefault(); setBackupDownloadHelp(true); } }}>点击下载备份文件</a>。链接有效 60 秒，仅可使用一次。</p>
            {backupDownloadAttempted && !backupDownloadHelp && <button type="button" className="backup-download-fallback" onClick={() => setBackupDownloadHelp(true)}>下载没反应？</button>}
            {backupDownloadHelp && <p>如果没有开始下载，请右键上方链接，选择“在新标签页打开”（触控设备请长按链接）。</p>}
          </div>}
          {backupDownloadStatus === "blocked" && <div className="backup-download-help" role="status">
            <p>Komari 内嵌页不允许普通下载。复制独立页面地址，在浏览器地址栏打开后再下载。</p>
            <Button icon={Copy} onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setBackupDownloadStatus("copied"); } catch (reason) { setError("复制失败，请手动复制下方地址"); } }}>复制页面地址</Button>
            <code>{window.location.href}</code>
          </div>}
          {backupDownloadStatus === "copied" && <p role="status">地址已复制，请粘贴到浏览器地址栏打开。</p>}
          {backupPreview && <div className="backup-preview" role="status">
            <strong>恢复预览 · {backupPreview.exportedAt ? new Date(backupPreview.exportedAt).toLocaleString("zh-CN") : "未知时间"}</strong>
            <div><span>服务器 {backupPreview.current.machines} → {backupPreview.incoming.machines}</span><span>节点 {backupPreview.current.nodes} → {backupPreview.incoming.nodes}</span><span>订阅 {backupPreview.current.subscriptions} → {backupPreview.incoming.subscriptions}</span><span>托管实例 {backupPreview.current.managedInstances} → {backupPreview.incoming.managedInstances}</span></div>
            <p>将替换当前插件数据。{backupPreview.boundAgents} 个 Agent 绑定需在目标 Komari 核对；证书文件、内核和 VPS 进程不会随备份迁移。</p>
            <Button variant="primary" icon={Upload} onClick={restoreBackup} disabled={backupBusy}>{backupBusy ? "恢复中…" : "确认覆盖并恢复"}</Button>
          </div>}
        </section>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="dialog-actions">
        <DraftStatus onDiscard={() => { clearSessionDraft("settings"); onClose(); }} />
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" icon={Save} onClick={save}>
          保存
        </Button>
      </div>
    </Modal>
  );
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

function HostServiceControls({ machine, managedInstances = [], me, serviceStates, refreshServices, serviceBusy, notify, onNavigate }) {
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [sampleMs, setSampleMs] = useState(3000);
  const rows = serviceStates[machine.monitorClientId] || {};
  const nowhereSources = [
    { key: "nowhere", label: "原生服务", instance: null },
    ...managedInstances.filter((item) => item.kind === "nowhere").map((instance) => ({ key: instance.id, label: instance.name || instance.id, instance })),
  ];
  const preferredSource = nowhereSources.find((item) => item.instance?.adoptionState === "adopted")?.key || "nowhere";
  const [nowhereSource, setNowhereSource] = useState(preferredSource);
  const selectedSource = nowhereSources.find((item) => item.key === nowhereSource) || nowhereSources[0];
  useEffect(() => {
    setHistory([]);
    setTelemetryOpen(false);
    setNowhereSource(preferredSource);
  }, [machine.monitorClientId]);
  useEffect(() => {
    if (!nowhereSources.some((item) => item.key === nowhereSource)) setNowhereSource(preferredSource);
  }, [nowhereSource, preferredSource, managedInstances.length]);
  useEffect(() => { setHistory([]); }, [nowhereSource]);
  useEffect(() => {
    const row = rows[nowhereSource]; const telemetry = row?.telemetry;
    if (!telemetry || !Number.isFinite(telemetry.upBytesPerSecond) || !Number.isFinite(telemetry.downBytesPerSecond)) return;
    setHistory((current) => current.at(-1)?.observedAt === row.observedAt ? current : [...current, { observedAt: row.observedAt, up: telemetry.upBytesPerSecond, down: telemetry.downBytesPerSecond }].slice(-60));
  }, [nowhereSource, rows[nowhereSource]?.observedAt]);
  useEffect(() => {
    if (!telemetryOpen || sampleMs <= 0 || me?.two_factor_enabled) return undefined;
    refreshServices(false, null, machine.monitorClientId);
    const timer = setInterval(() => refreshServices(false, null, machine.monitorClientId), sampleMs);
    return () => clearInterval(timer);
  }, [telemetryOpen, sampleMs, me?.two_factor_enabled, machine.monitorClientId, refreshServices]);
  const action = async (service, verb) => {
    const label = { start: "启动", stop: "停止", restart: "重启" }[verb];
    if (!confirm(`确认${label} ${machine.name} 上的 ${service}？\n\n这会中断或改变现有连接。`)) return;
    try {
      const otp = me?.two_factor_enabled ? prompt("请输入本次服务操作的两步验证码") || "" : "";
      if (me?.two_factor_enabled && !otp) return;
      const spec = await rpc("proxyConsole:serviceCommand", { service, action: verb });
      const task = await executeTask(machine.monitorClientId, spec.command, otp);
      if (Number(task.exit_code) !== 0) throw new Error(task.result || "服务操作失败");
      notify(`${service} 已${label}`); await refreshServices(false, otp, machine.monitorClientId);
    } catch (error) { notify(error.message, true); }
  };
  const nowhere = rows[nowhereSource]; const telemetry = nowhere?.telemetry;
  const serviceStatus = (service) => {
    const row = rows[service];
    const state = typeof row === "string" ? row : row?.state || "unknown";
    return {
      row,
      state,
      label: state === "active" ? "运行中" : state === "inactive" ? "已停止" : row?.pending ? "查询中" : state === "unavailable" ? "暂不可用" : "待查询",
      tone: state === "active" ? "ok" : state === "unavailable" ? "bad" : "warning",
    };
  };
  const singBox = serviceStatus("sing-box");
  return <>
    <section className="service-observatory-grid" aria-label={`${machine.name} 宿主服务与遥测`}>
      <article className="service-observatory singbox-observatory">
        <header><span>PROCESS TELEMETRY / SING-BOX</span><Status tone={singBox.tone} title={singBox.row?.error || undefined}>{singBox.label}</Status></header>
        <div className="service-observatory-title"><Activity size={21} /><div><strong>sing-box</strong><span>{machine.name}</span></div></div>
        <div className="service-process-metrics">
          <div><span>CPU</span><strong>{Number.isFinite(singBox.row?.telemetry?.cpuPercent) ? `${singBox.row.telemetry.cpuPercent.toFixed(1)}%` : "—"}</strong></div>
          <div><span>RSS</span><strong>{Number.isFinite(singBox.row?.telemetry?.rssBytes) ? bytes(singBox.row.telemetry.rssBytes) : "—"}</strong></div>
          <div><span>PID</span><strong>{singBox.row?.pid || "—"}</strong></div>
        </div>
        <div className="service-resource-line" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, singBox.row?.telemetry?.cpuPercent || 0))}%` }} /></div>
        <footer><div><Button icon={Play} onClick={() => action("sing-box", "start")} disabled={serviceBusy || singBox.state === "active"}>启动</Button><Button icon={Square} onClick={() => action("sing-box", "stop")} disabled={serviceBusy || singBox.state !== "active"}>停止</Button><Button icon={RotateCw} onClick={() => action("sing-box", "restart")} disabled={serviceBusy || singBox.state !== "active"}>重启</Button></div><span>宿主服务</span></footer>
      </article>
      <article className="service-observatory nowhere-observatory">
        <header><span>PROTOCOL TELEMETRY / NOWHERE</span><Status tone={serviceStatus(nowhereSource).tone} title={serviceStatus(nowhereSource).row?.error || undefined}>{serviceStatus(nowhereSource).label}</Status></header>
        <div className="service-observatory-title"><PackageOpen size={21} /><div><strong>Nowhere</strong><span>{NOWHERE_LIFECYCLE[telemetry?.lifecycle] || (serviceStatus(nowhereSource).state === "active" ? "进程运行中" : machine.name)}</span></div><label className="service-source-select"><span>状态来源</span><select value={nowhereSource} onChange={(event) => setNowhereSource(event.target.value)} aria-label="选择 Nowhere 状态来源">{nowhereSources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}</select></label></div>
        <div className="service-throughput-pair">
          <div><span>↓ DOWNLOAD</span><strong>{bytes(telemetry?.downBytesPerSecond, true)}</strong></div>
          <div><span>↑ UPLOAD</span><strong>{bytes(telemetry?.upBytesPerSecond, true)}</strong></div>
        </div>
        <div className="service-trend"><TelemetrySparkline points={history} /><span>{telemetry?.source === "local" ? "LOCAL" : "WAITING"}</span></div>
        <footer><div>{selectedSource.instance ? <Button icon={ExternalLink} onClick={() => onNavigate?.("deploy")}>前往托管实例</Button> : <><Button icon={Play} onClick={() => action("nowhere", "start")} disabled={serviceBusy || serviceStatus(nowhereSource).state === "active"}>启动</Button><Button icon={Square} onClick={() => action("nowhere", "stop")} disabled={serviceBusy || serviceStatus(nowhereSource).state !== "active"}>停止</Button><Button icon={RotateCw} onClick={() => action("nowhere", "restart")} disabled={serviceBusy || serviceStatus(nowhereSource).state !== "active"}>重启</Button></>}</div><Button icon={Activity} variant="primary" onClick={() => setTelemetryOpen(true)}>实时遥测</Button></footer>
      </article>
    </section>
    <Modal open={telemetryOpen} title={`${selectedSource.label} · Nowhere 实时遥测`} eyebrow={selectedSource.instance ? "托管实例" : "宿主原有服务"} onClose={() => setTelemetryOpen(false)} size="large">
      <div className="telemetry-toolbar"><p>详情打开时按所选间隔更新。</p><TelemetryRefreshControl value={sampleMs} onChange={setSampleMs} /></div>
      {telemetry ? <><div className="telemetry-status"><div><span className={`telemetry-dot ${telemetry.lifecycle === "READY" ? "ready" : ""}`} /><strong>{NOWHERE_LIFECYCLE[telemetry.lifecycle] || (nowhere?.state === "active" ? "进程运行中" : "未运行")}</strong></div><p>{telemetry.source === "local" ? `Nowhere 本地遥测${telemetry.version ? ` · ${telemetry.version}` : ""}` : "当前内核未提供可读遥测"}</p></div><div className="telemetry-grid"><div><span>当前上传</span><strong>↑ {bytes(telemetry.upBytesPerSecond, true)}</strong></div><div><span>当前下载</span><strong>↓ {bytes(telemetry.downBytesPerSecond, true)}</strong></div><div><span>累计上传</span><strong>{bytes(telemetryTotal(telemetry, "Up"))}</strong></div><div><span>累计下载</span><strong>{bytes(telemetryTotal(telemetry, "Down"))}</strong></div><div><span>Nowhere CPU</span><strong>{Number.isFinite(telemetry.cpuPercent) ? `${telemetry.cpuPercent.toFixed(1)}%` : "—"}</strong></div><div><span>Nowhere RSS</span><strong>{Number.isFinite(telemetry.rssBytes) ? bytes(telemetry.rssBytes) : "—"}</strong></div><div><span>运行时间</span><strong>{Number.isFinite(telemetry.uptimeMs) ? duration(telemetry.uptimeMs) : "—"}</strong></div><div><span>进程 PID</span><strong>{nowhere?.pid || "—"}</strong></div></div><TelemetryTrend points={history} /></> : <div className="telemetry-empty">该状态源还没有可用的遥测样本。</div>}
      <div className="dialog-actions"><Button onClick={() => setTelemetryOpen(false)}>关闭</Button></div>
    </Modal>
  </>;
}

const TRAFFIC_STATE = {
  unconfigured: { label: "未设置", tone: "neutral" },
  healthy: { label: "充足", tone: "ok" },
  warning: { label: "提醒", tone: "warning" },
  critical: { label: "紧急", tone: "bad" },
  exceeded: { label: "已超额", tone: "bad" },
};
const TRAFFIC_ACCOUNTING = { sum: "上下行合计", max: "较大方向", up: "仅上传", down: "仅下载" };
function shortCycleDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(timestamp));
}
function TrafficPlanGlance({ model, onOpen }) {
  const result = model?.trafficPlanResult || evaluateTrafficPlan();
  const state = TRAFFIC_STATE[result.state] || TRAFFIC_STATE.unconfigured;
  return (
    <button type="button" className={`traffic-plan-glance ${result.state}`} onClick={onOpen} aria-label={`${model?.machine?.name || "服务器"}流量计划，${state.label}`}>
      <span className="traffic-plan-heading"><span>TRAFFIC PLAN</span><Status tone={state.tone}>{state.label}</Status></span>
      {result.enabled ? <>
        <span className="traffic-plan-main"><strong>{result.percent.toFixed(result.percent >= 10 ? 0 : 1)}%</strong><span>{bytes(result.usedBytes)} / {bytes(result.limitBytes)}</span></span>
        <i className="traffic-plan-progress"><b style={{ width: `${Math.min(100, result.percent)}%` }} /></i>
        <span className="traffic-plan-facts"><span>剩余 {bytes(result.remainingBytes)}</span><span>{result.forecastRisk ? `预计 ${shortCycleDate(result.exhaustionAt || result.cycleEnd)} 用尽` : `预测 ${bytes(result.projectedBytes)}`}</span><span>{shortCycleDate(result.cycleEnd)} 重置</span></span>
      </> : <span className="traffic-plan-empty"><strong>设置服务器流量额度</strong><small>独立周期 · 预测 · Komari 通知</small></span>}
      <ChevronDown size={16} aria-hidden="true" />
    </button>
  );
}

function TrafficPlanDialog({ model, onClose, onSave, notify }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const machine = model?.machine;
  const client = model?.client;
  useEffect(() => {
    if (!model) return;
    const stored = machine?.trafficPlan || {};
    const clientLimit = Number(client?.traffic_limit || 0);
    const limitBytes = Number(stored.limitBytes || 0) || clientLimit;
    setForm({
      enabled: stored.enabled === true || (!stored.limitBytes && clientLimit > 0),
      quotaGB: limitBytes ? String(Math.round((limitBytes / 1024 ** 3) * 100) / 100) : "",
      accounting: stored.accounting || client?.traffic_limit_type || "sum",
      resetDay: stored.resetDay || 1,
      warningLevels: stored.warningLevels || [70, 90, 100],
    });
  }, [model, machine, client]);
  const limitBytes = Math.round(Math.max(0, Number(form.quotaGB) || 0) * 1024 ** 3);
  const preview = evaluateTrafficPlan({ ...form, limitBytes }, { up: model?.trafficUp, down: model?.trafficDown });
  const levels = Array.isArray(form.warningLevels) ? form.warningLevels.map(Number) : [];
  const validLevels = levels.length === 3 && levels.every((value, index) => value >= 1 && value <= 100 && (!index || value > levels[index - 1]));
  const valid = !form.enabled || (limitBytes > 0 && validLevels);
  const storedPlan = machine?.trafficPlan || {};
  const komariSynced = Boolean(client) && Number(client?.traffic_limit || 0) === (storedPlan.enabled ? Number(storedPlan.limitBytes || 0) : 0) && String(client?.traffic_limit_type || "sum") === String(storedPlan.accounting || "sum");
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSave({ enabled: form.enabled, limitBytes, accounting: form.accounting, resetDay: Number(form.resetDay), warningLevels: levels });
    } catch (error) { notify(error.message, true); }
    finally { setSaving(false); }
  };
  const updateLevel = (index, value) => setForm((current) => ({ ...current, warningLevels: current.warningLevels.map((item, itemIndex) => itemIndex === index ? Number(value) : item) }));
  return (
    <Modal open={!!model} title={`${machine?.name || "服务器"} · 流量计划`} eyebrow="Traffic Plan" onClose={() => !saving && onClose()} size="large">
      {model && <>
        <div className={`traffic-plan-preview ${preview.state}`}>
          <div><span>当前周期</span><strong>{preview.enabled ? `${preview.percent.toFixed(1)}%` : "未启用"}</strong><small>{preview.enabled ? `${bytes(preview.usedBytes)} / ${bytes(preview.limitBytes)}` : `Agent 累计 ${bytes(model.trafficDown + model.trafficUp)}`}</small></div>
          <div><span>预计周期末</span><strong>{preview.enabled ? bytes(preview.projectedBytes) : "—"}</strong><small>{shortCycleDate(preview.cycleStart)} — {shortCycleDate(preview.cycleEnd)}</small></div>
          <i><b style={{ width: `${preview.enabled ? Math.min(100, preview.percent) : 0}%` }} /></i>
        </div>
        <label className="traffic-plan-toggle"><span><strong>启用流量计划</strong><small>只控制额度和提醒，不停止节点</small></span><span className="switch"><input type="checkbox" checked={form.enabled === true} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} /><span /></span></label>
        <div className="form-grid traffic-plan-form">
          <Field label="周期额度 GiB"><input type="number" min="0" step="0.01" value={form.quotaGB || ""} onChange={(event) => setForm((current) => ({ ...current, quotaGB: event.target.value }))} disabled={!form.enabled} placeholder="例如 1000" /></Field>
          <Field label="统计方向"><select value={form.accounting || "sum"} onChange={(event) => setForm((current) => ({ ...current, accounting: event.target.value }))} disabled={!form.enabled}>{Object.entries(TRAFFIC_ACCOUNTING).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="每月重置日"><input type="number" min="1" max="31" value={form.resetDay || 1} onChange={(event) => setForm((current) => ({ ...current, resetDay: Number(event.target.value) }))} disabled={!form.enabled} /></Field>
          <Field label="提示线 %"><div className="traffic-levels">{levels.map((level, index) => <input key={index} aria-label={["提醒阈值", "紧急阈值", "超额阈值"][index]} type="number" min="1" max="100" value={level} onChange={(event) => updateLevel(index, event.target.value)} disabled={!form.enabled} />)}</div>{form.enabled && !validLevels && <small className="warning-text">三档阈值需从低到高排列</small>}</Field>
        </div>
        <div className="traffic-plan-integrations">
          <div><Database size={16} /><span><strong>Komari 配额</strong><small>{!client ? "未绑定 Agent" : komariSynced ? "已同步" : "保存时同步"}</small></span><Status tone={!client ? "warning" : komariSynced ? "ok" : "neutral"}>{!client ? "LOCAL" : komariSynced ? "SYNCED" : "READY"}</Status></div>
          <div><CalendarClock size={16} /><span><strong>Agent 周期</strong><small>已有 Agent 需在维护窗口校准</small></span><button type="button" onClick={() => { navigator.clipboard.writeText(`--month-rotate ${Number(form.resetDay) || 1}`); notify("Agent 周期参数已复制"); }}><Copy size={14} /> --month-rotate {Number(form.resetDay) || 1}</button></div>
        </div>
        <div className="dialog-actions"><Button onClick={onClose} disabled={saving}>取消</Button><Button variant="primary" icon={Save} onClick={submit} disabled={!valid || saving}>{saving ? "正在同步…" : client ? "保存并同步 Komari" : "保存计划"}</Button></div>
      </>}
    </Modal>
  );
}

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

function Machines({ state, clients, statuses = {}, persist, notify, onRefresh, me, onNavigate, onDiscover, serviceStates = {}, refreshServices, serviceBusy }) {
  const [editor, setEditor] = useState(null);
  const [trafficPlanEditor, setTrafficPlanEditor] = useState(null);
  const [recentId, setRecentId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [onboarding, setOnboarding] = useState(false);
  const [onboardingKey, setOnboardingKey] = useState("");
  const [onboardingEndpoint, setOnboardingEndpoint] = useState("");
  const [onboardingPlatform, setOnboardingPlatform] = useState("linux");
  const [onboardingResetDay, setOnboardingResetDay] = useState(1);
  const [profileBusy, setProfileBusy] = useState(false);
  const boundClientIds = new Set(state.machines.map((machine) => machine.monitorClientId).filter(Boolean));
  const unboundClients = Object.values(clients).filter((client) => !boundClientIds.has(client.uuid));
  const machineModels = state.machines.map((machine) => {
    const client = clients[machine.monitorClientId];
    const sampled = statuses[machine.monitorClientId] || {};
    const ramTotal = sampled.ram_total || client?.mem_total;
    const diskTotal = sampled.disk_total || client?.disk_total;
    const nodes = state.nodes.filter((node) => node.machineId === machine.id);
    const trafficPlanResult = evaluateTrafficPlan(machine.trafficPlan, { up: sampled.net_total_up, down: sampled.net_total_down });
    return {
      machine,
      client,
      sampled,
      nodes,
      protocols: new Set(nodes.map((node) => node.protocol)).size,
      rateDown: Number(sampled.net_in ?? sampled.net_in_speed ?? 0),
      rateUp: Number(sampled.net_out ?? sampled.net_out_speed ?? 0),
      trafficDown: Number(sampled.net_total_down || 0),
      trafficUp: Number(sampled.net_total_up || 0),
      cpu: Math.max(0, Math.min(100, Number(sampled.cpu || 0))),
      memory: ramTotal ? Math.max(0, Math.min(100, (Number(sampled.ram || 0) / Number(ramTotal)) * 100)) : null,
      disk: diskTotal ? Math.max(0, Math.min(100, (Number(sampled.disk || 0) / Number(diskTotal)) * 100)) : null,
      trafficPlanResult,
    };
  });
  const selectedModel = machineModels.find(({ machine }) => machine.id === selectedId) || machineModels[0];
  const selectedMachine = selectedModel?.machine;
  const maxMachineTraffic = Math.max(1, ...machineModels.map((item) => item.trafficDown + item.trafficUp));
  const machineBarLabel = (machine) => {
    const code = String(machine.countryCode || "VPS").toUpperCase();
    const place = String(machine.region || machine.provider || machine.name || "SERVER")
      .replace(new RegExp(`^${code}[\\s·|/_-]*`, "i"), "")
      .trim();
    return { code, place: place || String(machine.name || "SERVER") };
  };
  const managedRunning = (state.managedInstances || []).filter((item) => item.status === "running").length;
  const activeSubscriptions = (state.subscriptions || []).filter((item) => item.enabled !== false && (!item.expiresAt || Date.parse(item.expiresAt) >= Date.now())).length;
  const plannedMachines = machineModels.filter((item) => item.trafficPlanResult.enabled);
  const attentionPlans = plannedMachines.filter((item) => ["warning", "critical", "exceeded"].includes(item.trafficPlanResult.state));
  const profile = selectedMachine?.ipProfile;
  const profileLocation = [profile?.location?.city, profile?.location?.region, profile?.location?.country].filter((value, index, list) => value && !/[?？�]{2,}/.test(value) && list.indexOf(value) === index).join(" · ");
  const profileCountryCode = profile?.location?.countryCode || selectedMachine?.countryCode || "";
  const serviceLabel = { AVAILABLE: "可达", REACHABLE: "可达", PARTIAL: "待验证", BLOCKED: "受限", UNKNOWN: "未知" };
  const serviceReady = (profile?.services || []).filter((item) => ["AVAILABLE", "REACHABLE"].includes(item.status)).length;
  const profileExits = exitGroups(profile);
  const purityScore = profile?.purity?.score ?? null;
  const purityLabel = profile?.purity?.label || (purityScore == null ? "待判断" : purityScore >= 85 ? "纯净" : purityScore >= 65 ? "较纯净" : purityScore >= 40 ? "一般" : "高风险");
  const purityTone = purityScore == null ? "unknown" : purityScore >= 85 ? "clean" : purityScore >= 65 ? "good" : purityScore >= 40 ? "medium" : "risk";
  const networkFacts = profile ? [
    ["ASN", profile.network?.asn || "待判断"],
    ["运营组织", profile.network?.organization || "待判断"],
    ["ISP", profile.network?.isp || "待判断"],
    ["网段", profile.network?.range || "待判断"],
    ["时区", profile.location?.timezone || "待判断"],
  ] : [];
  useEffect(() => {
    if (!state.machines.length) {
      if (selectedId) setSelectedId("");
      return;
    }
    if (!state.machines.some((machine) => machine.id === selectedId)) setSelectedId(state.machines[0].id);
  }, [selectedId, state.machines]);
  useEffect(() => { if (onboarding && !onboardingEndpoint) setOnboardingEndpoint(window.location.origin); }, [onboarding, onboardingEndpoint]);
  const onboardingCommand = onboardingPlatform === "windows"
    ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "iwr 'https://raw.githubusercontent.com/komari-monitor/komari-agent/refs/heads/main/install.ps1' -UseBasicParsing -OutFile 'install.ps1'; & '.\\install.ps1' '-e' ${powershellQuote(onboardingEndpoint)} '--auto-discovery' ${powershellQuote(onboardingKey)} '--month-rotate' ${Number(onboardingResetDay) || 1}"`
    : `bash <(curl -sL https://raw.githubusercontent.com/komari-monitor/komari-agent/refs/heads/main/install.sh) -e ${shellQuote(onboardingEndpoint)} --auto-discovery ${shellQuote(onboardingKey)} --month-rotate ${Number(onboardingResetDay) || 1}`;
  useEffect(() => {
    if (!recentId) return undefined;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector(`[data-machine-id="${recentId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
    const timer = setTimeout(() => setRecentId(""), 1600);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [recentId, state.machines.length]);
  const remove = async (machine) => {
    const count = state.nodes.filter(
      (node) => node.machineId === machine.id,
    ).length;
    if (count) return alert(`该服务器仍关联 ${count} 个节点，请先批量迁移节点。`);
    if (confirm(`删除服务器“${machine.name}”？`))
      await persist(
        {
          ...state,
          machines: state.machines.filter((item) => item.id !== machine.id),
        },
        "服务器已删除",
      );
  };
  const inspectIpProfile = async () => {
    if (!selectedModel?.client || profileBusy) return;
    setProfileBusy(true);
    try {
      const otp = me?.two_factor_enabled ? prompt("请输入本次目标机检测的两步验证码") || "" : "";
      if (me?.two_factor_enabled && !otp) return;
      const spec = await rpc("proxyConsole:prepareMachineIpProfile", { machineId: selectedMachine.id });
      const task = await executeTask(spec.clientId, spec.command, otp);
      if (Number(task.exit_code) !== 0) throw new Error(task.result || "IP 检测未完成");
      await rpc("proxyConsole:recordMachineIpProfile", { machineId: selectedMachine.id, output: task.result });
      await onRefresh(); notify("IP 与服务可用性检测已更新");
    } catch (error) { notify(error.message, true); }
    finally { setProfileBusy(false); }
  };
  return (
    <section className="machines-panel">
      <div className="fleet-toolbar">
        <div>
          <span>SERVER WORKSPACE</span>
          <strong>{state.machines.length} 台服务器 · {state.machines.filter((machine) => machine.monitorClientId).length} 台已绑定监控</strong>
        </div>
        <div>
          <Button icon={Server} onClick={() => setOnboarding(true)}>接入新 VPS</Button>
          <Button icon={Plus} variant="primary" onClick={() => setEditor({})}>添加服务器</Button>
        </div>
      </div>
      {unboundClients.length > 0 && <div className="agent-onboarding">
        <div><strong>发现 {unboundClients.length} 台尚未加入的 Komari Agent</strong><span>补充服务器资料后，即可发现已有节点或创建独立实例。</span></div>
        <div>{unboundClients.map((client) => <Button key={client.uuid} icon={Plus} onClick={() => setEditor({ name: client.name || "新服务器", monitorClientId: client.uuid })}>添加 {client.name || "Agent"}</Button>)}</div>
      </div>}
      {machineModels.length ? <>
        <div className="control-bento">
          <article className="server-index-card dashboard-card">
            <header><span>SERVER INDEX</span><b>{machineModels.filter(({ sampled }) => sampled.online).length} ONLINE</b></header>
            <div className="server-index-list">
              {machineModels.map((item) => <button
                key={item.machine.id}
                type="button"
                data-machine-id={item.machine.id}
                aria-pressed={selectedModel?.machine.id === item.machine.id}
                className={`${selectedModel?.machine.id === item.machine.id ? "active" : ""} ${recentId === item.machine.id ? "recent" : ""} budget-${item.trafficPlanResult.state}`}
                style={{ "--traffic-plan-progress": `${Math.min(100, item.trafficPlanResult.percent)}%` }}
                onClick={() => setSelectedId(item.machine.id)}
              >
                <span className="server-code" aria-hidden="true"><b>{flag(item.machine.countryCode) || "◇"}</b><small>{String(item.machine.countryCode || item.machine.region || "VPS").slice(0, 3).toUpperCase()}</small></span>
                <span className="server-index-name"><strong>{item.machine.name}</strong><small>{item.machine.provider || "未填写服务商"} · {item.machine.region || item.machine.country || "未分组"}</small></span>
                <span className="server-index-rate"><strong>{bytes(item.rateDown, true)}</strong><small>↓ CURRENT</small></span>
                <i className={item.sampled.online ? "online" : ""} aria-label={item.sampled.online ? "在线" : "离线"} />
              </button>)}
            </div>
          </article>
          <article className="selected-server-card dashboard-card">
            <header>
              <span>SELECTED SERVER</span>
              <Status tone={!selectedModel?.client ? "warning" : selectedModel.sampled.online ? "ok" : "bad"}>{!selectedModel?.client ? "未绑定" : selectedModel.sampled.online ? "ONLINE" : "OFFLINE"}</Status>
            </header>
            <div className="selected-server-title">
              <strong>{selectedMachine?.name}</strong>
              <span>{selectedMachine?.provider || "未填写服务商"} · {flag(selectedMachine?.countryCode)} {String(selectedMachine?.countryCode || "").toUpperCase() || "未分组"}{selectedMachine?.region ? ` / ${selectedMachine.region}` : ""}{selectedModel?.client?.ipv4 || selectedModel?.client?.ip ? <> · <span className="sensitive-value">{selectedModel.client.ipv4 || selectedModel.client.ip}</span></> : ""}</span>
            </div>
            <div className="resource-bars" aria-label={`${selectedMachine?.name} 资源占用`}>
              {[['CPU', selectedModel?.cpu], ['MEMORY', selectedModel?.memory], ['DISK', selectedModel?.disk]].map(([label, value]) => <div key={label}><span>{label}<strong>{value == null ? "—" : `${value.toFixed(1)}%`}</strong></span><i><b style={{ width: `${value || 0}%` }} /></i></div>)}
            </div>
            <div className="selected-server-facts">
              <span>↓ {bytes(selectedModel?.rateDown, true)}</span><span>↑ {bytes(selectedModel?.rateUp, true)}</span><span>节点 {selectedModel?.nodes.length || 0}</span><span>协议 {selectedModel?.protocols || 0}</span>
            </div>
            <TrafficPlanGlance model={selectedModel} onOpen={() => setTrafficPlanEditor(selectedModel)} />
            {selectedModel?.client && <SelectedServerTrend client={selectedModel.client} />}
            <footer className="selected-server-actions">
              <div className="selected-server-primary-actions">
                <Button icon={Upload} variant="primary" onClick={() => onNavigate?.("deploy")} disabled={!selectedModel?.client}>在此部署</Button>
                <Button icon={Search} onClick={() => onDiscover?.(selectedMachine)} disabled={!selectedModel?.client}>发现节点</Button>
                <Button icon={RefreshCw} onClick={() => refreshServices(true, null, selectedMachine?.monitorClientId)} disabled={!selectedModel?.client || serviceBusy}>刷新状态</Button>
              </div>
              <div className="selected-server-secondary-actions">
                <IconButton label="编辑服务器" onClick={() => setEditor(selectedMachine)}><Edit3 size={16} /></IconButton>
                <IconButton label="删除服务器" onClick={() => remove(selectedMachine)}><Trash2 size={16} /></IconButton>
              </div>
            </footer>
          </article>
          <article className="monthly-traffic-card dashboard-card">
            <header><span>TRAFFIC PLANS</span><b>{plannedMachines.length}/{machineModels.length} SET</b></header>
            <strong className="monthly-total">{bytes(machineModels.reduce((sum, item) => sum + item.trafficDown + item.trafficUp, 0))}</strong>
            <small className="monthly-caption">AGENT TOTAL{attentionPlans.length ? ` · ${attentionPlans.length} ATTENTION` : ""}</small>
            <div className="host-bars" aria-label="各服务器累计流量与流量计划">
              {[...machineModels].sort((a, b) => (b.trafficDown + b.trafficUp) - (a.trafficDown + a.trafficUp)).map((item) => {
                const label = machineBarLabel(item.machine);
                return <button key={item.machine.id} type="button" className={`${selectedModel?.machine.id === item.machine.id ? "active" : ""} budget-${item.trafficPlanResult.state}`} aria-label={`${item.machine.name}，Agent 累计 ${bytes(item.trafficDown + item.trafficUp)}${item.trafficPlanResult.enabled ? `，额度已用 ${item.trafficPlanResult.percent.toFixed(1)}%` : "，未设置流量计划"}`} title={`${item.machine.name}：${bytes(item.trafficDown + item.trafficUp)}${item.trafficPlanResult.enabled ? ` · ${item.trafficPlanResult.percent.toFixed(1)}%` : ""}`} onClick={() => setSelectedId(item.machine.id)}><i style={{ height: `${Math.max(8, ((item.trafficDown + item.trafficUp) / maxMachineTraffic) * 100)}%` }} /><strong>{item.trafficPlanResult.enabled ? `${item.trafficPlanResult.percent.toFixed(0)}%` : bytes(item.trafficDown + item.trafficUp)}</strong><span className="bar-machine-label"><b>{label.code}</b><small>{label.place}</small></span></button>;
              })}
            </div>
          </article>
          <article className="ip-profile-card dashboard-card">
            <header><span>IP INTELLIGENCE / SERVICE ACCESS</span><b>{selectedMachine?.ipProfile?.checkedAt ? new Date(selectedMachine.ipProfile.checkedAt).toLocaleDateString("zh-CN") : "NOT TESTED"}</b></header>
            {!profile ? <div className="ip-profile-empty"><ShieldCheck size={28} /><strong>检测 VPS 出口画像</strong><span>位置、网络身份、风险特征、多源出口与服务可用性</span></div> : <div className="ip-profile-grid">
              <section className="ip-profile-identity">
                <span>EXIT IDENTITY</span>
                <div className="ip-profile-addresses">{profileExits.map((exit) => <span key={exit.family}><small>{exit.family === "ipv4" ? "IPv4" : "IPv6"}</small><b className={exit.address ? "sensitive-value" : "unavailable"}>{exit.address || "未检测到"}</b><em>{exit.address ? (exit.countries.length ? exit.countries.map((code) => `${flag(code)} ${code}`).join(" / ") : exit.places.join(" / ") || "地区未知") : "—"}{exit.conflict ? " · 来源有分歧" : ""}</em></span>)}</div>
                <div className="ip-profile-identity-meta"><span>数据库地区</span></div>
              </section>
              <section className="ip-profile-network">
                <header><span>NETWORK IDENTITY</span><b>{profile.publicIp?.includes(":") ? "IPv6" : "IPv4"} · {profile.network?.type || "UNCLASSIFIED"}</b></header>
                <div>{networkFacts.map(([label, value]) => <span key={label}><small>{label}</small><b title={value}>{value}</b></span>)}</div>
              </section>
              <section className={`ip-profile-purity purity-${purityTone}`}>
                <header><span>IP PURITY</span><b>{profile.publicIp?.includes(":") ? "IPv6" : "IPv4"} · 参考来源 {profile.purity?.sourceCount || 0}</b></header>
                <div className="ip-purity-score"><strong>{purityScore == null ? "—" : Math.round(purityScore)}</strong><span>{purityLabel}<small>PURITY SCORE</small></span></div>
                <div className="ip-purity-scale" role="img" aria-label={`IP 纯净度 ${purityScore == null ? "未知" : `${Math.round(purityScore)} 分`}`}><i style={{ left: `${purityScore == null ? 0 : purityScore}%` }} /></div>
                <div className="ip-purity-labels"><span>高风险</span><span>一般</span><span>纯净</span></div>
                <div className="ip-purity-facts"><span><small>网络属性</small><b>{profile.purity?.networkClass || "待判断"}</b></span><span><small>代理特征</small><b>{profile.purity?.proxyDetected === true ? "已发现" : profile.purity?.proxyDetected === false ? "未发现" : "待判断"}</b></span><span><small>判断依据</small><b title={(profile.purity?.sources || []).join("、")}>{profile.purity?.sourceCount ? `${profile.purity.sourceCount} 个来源` : "待检测"}</b></span></div>
              </section>
              <section className="ip-profile-services">
                <header><span>SERVICE ACCESS</span><b>{serviceReady}/{profile.services?.length || 0} 可达</b></header>
                <div>{(profile.services || []).slice(0, 12).map((item) => <span key={item.name} className={`profile-${String(item.status).toLowerCase()}`} title={item.detail || undefined}><i /><b>{item.name}</b><small>{serviceLabel[item.status] || item.status}{item.region ? ` · ${item.region}` : ""}</small><em>{item.latencyMs ? `${item.latencyMs} ms` : "—"}</em></span>)}</div>
              </section>
              <section className="ip-profile-observations">
                <header><span>EGRESS SOURCES</span><b>按地址查看</b></header>
                {profileExits.filter((exit) => exit.address).map((exit) => <React.Fragment key={exit.family}><h4>{exit.family === "ipv4" ? "IPv4" : "IPv6"}<small>{exit.conflict ? "地区有分歧" : `${exit.observations.length} 个来源`}</small></h4><div>{exit.observations.map((item) => <span key={item.source}><b>{item.source}</b><small>{item.countryCode ? flag(item.countryCode) : ""} {item.city || item.countryCode || "地区未知"}</small><time>{item.latencyMs ? `${item.latencyMs} ms` : "—"}</time></span>)}</div></React.Fragment>)}
              </section>
            </div>}
            <footer><Button icon={ShieldCheck} variant="primary" onClick={inspectIpProfile} disabled={profileBusy || !selectedModel?.client}>{profileBusy ? "并发检测中，约 10–15 秒…" : selectedMachine?.ipProfile ? "重新检测" : "运行检测"}</Button><span>{profile?.elapsedMs ? `${(profile.elapsedMs / 1000).toFixed(1)} 秒 · ` : ""}结果仅代表当前出口与检测时刻</span></footer>
          </article>
        </div>
        {selectedModel?.client && <HostServiceControls machine={selectedMachine} managedInstances={state.managedInstances.filter((item) => item.machineId === selectedMachine.id)} me={me} serviceStates={serviceStates} refreshServices={refreshServices} serviceBusy={serviceBusy} notify={notify} onNavigate={onNavigate} />}
        <div className="operation-grid">
          <article className="operation-card operation-index">
            <header><span>SYSTEM INDEX</span><b>{managedRunning} RUNNING</b></header>
            <div className="operation-index-list">
              <button type="button" title="打开托管实例" aria-label={`打开 ${state.managedInstances?.length || 0} 个托管实例`} onClick={() => onNavigate?.("deploy")}><span>托管实例</span><strong>{state.managedInstances?.length || 0}</strong></button>
              <button type="button" title="打开订阅管理" aria-label={`打开 ${state.nodes.filter((node) => node.enabled).length} 个可输出节点和 ${activeSubscriptions} 个有效订阅`} onClick={() => onNavigate?.("subscriptions")}><span>可输出节点</span><strong>{state.nodes.filter((node) => node.enabled).length}</strong></button>
            </div>
          </article>
          <article className="operation-card onboarding-operation">
            <header><span>CONNECT SERVER</span></header>
            <strong>接入一台新 VPS</strong>
            <Button icon={Server} variant="primary" onClick={() => setOnboarding(true)}>开始接入</Button>
          </article>
          <article className="operation-card quick-operation">
            <header><span>QUICK DEPLOY</span></header>
            <strong>创建一个托管节点</strong>
            <Button icon={Upload} variant="primary" onClick={() => onNavigate?.("deploy")}>开始部署</Button>
          </article>
        </div>
      </> : <Empty title="还没有服务器">先接入 Komari Agent；Agent 在线后会在上方出现一键添加入口。</Empty>}
      <MachineEditor
        open={!!editor}
        machine={editor}
        clients={clients}
        onClose={() => setEditor(null)}
        onSave={async (machine) => {
          const exists = state.machines.some((item) => item.id === machine.id);
          await persist(
            {
              ...state,
              machines: exists
                ? state.machines.map((item) =>
                    item.id === machine.id ? machine : item,
                  )
                : [...state.machines, machine],
            },
            "服务器已保存",
          );
          setEditor(null);
          if (!exists) setRecentId(machine.id);
        }}
      />
      <TrafficPlanDialog
        model={trafficPlanEditor}
        notify={notify}
        onClose={() => setTrafficPlanEditor(null)}
        onSave={async (plan) => {
          const saved = await rpc("proxyConsole:saveMachineTrafficPlan", { machineId: trafficPlanEditor.machine.id, revision: state.revision, plan });
          setTrafficPlanEditor(null);
          window.dispatchEvent(new Event("proxy-console-reload"));
          notify(saved.sync.komari ? "流量计划已保存并同步 Komari" : "流量计划已保存");
        }}
      />
      <Modal open={onboarding} title="接入新 VPS" eyebrow="Agent 自动注册" onClose={() => setOnboarding(false)} size="large">
        <ol className="onboarding-steps"><li className="active"><strong>1</strong><span>生成命令</span></li><li><strong>2</strong><span>在 VPS 执行</span></li><li><strong>3</strong><span>等待上线</span></li><li><strong>4</strong><span>完善资料</span></li></ol>
        <div className="form-grid onboarding-form"><Field label="Komari 地址" wide hint="已自动使用当前站点；若 Agent 访问的是另一个公网域名，可在这里修改。"><input type="url" value={onboardingEndpoint} onChange={(event) => setOnboardingEndpoint(event.target.value)} /></Field><Field label="系统"><select value={onboardingPlatform} onChange={(event) => setOnboardingPlatform(event.target.value)}><option value="linux">Linux / macOS</option><option value="windows">Windows</option></select></Field><Field label="流量重置日" hint="Agent 按此日期重新累计服务器月流量。"><input type="number" min="1" max="31" value={onboardingResetDay} onChange={(event) => setOnboardingResetDay(Math.min(31, Math.max(1, Number(event.target.value) || 1)))} /></Field><Field label="自动发现密钥" wide hint="从 Komari 的 Agent 自动发现设置复制；仅用于生成下方命令，不会保存。"><SecretInput autoComplete="off" value={onboardingKey} onChange={(event) => setOnboardingKey(event.target.value)} placeholder="粘贴 Auto Discovery Key" /></Field></div>
        <div className="onboarding-command"><div><strong>安装命令</strong><span>复制后在目标 VPS 的管理员终端执行</span></div><textarea readOnly value={onboardingKey.trim() && onboardingEndpoint.trim() ? onboardingCommand : "填写 Komari 地址和自动发现密钥后生成"} aria-label="Agent 安装命令" /><div><a href="https://komari-document.pages.dev/install/agent-ad" target="_blank" rel="noreferrer">查看 Komari 官方说明 <ExternalLink size={13} /></a><Button icon={Copy} variant="primary" disabled={!onboardingKey.trim() || !onboardingEndpoint.trim()} onClick={() => { navigator.clipboard.writeText(onboardingCommand); notify("Agent 安装命令已复制"); }}>复制命令</Button></div></div>
        <div className="onboarding-next"><Activity size={17} /><div><strong>命令执行后等待 Agent 上线</strong><span>刷新后可直接补充地区与服务商，无需切换页面。</span></div><Button icon={RefreshCw} onClick={onRefresh}>刷新 Agent</Button></div>
        <div className="dialog-actions"><Button onClick={() => setOnboarding(false)}>完成</Button></div>
      </Modal>
    </section>
  );
}
function MachineEditor({ open, machine, clients, onClose, onSave }) {
  const [form, setForm] = useState({});
  const draftKey = `machine:${machine?.id || "new"}`;
  useEffect(() => {
    if (open) {
      const initial = {
        id: machine?.id || randomId(),
        name: machine?.name || "",
        provider: machine?.provider || "",
        country: machine?.country || "",
        countryCode: machine?.countryCode || "",
        region: machine?.region || "",
        tags: (machine?.tags || []).join(", "),
        monitorClientId: machine?.monitorClientId || "",
        trafficPlan: machine?.trafficPlan,
      };
      const draft = readSessionDraft(draftKey)?.value;
      setForm(draft ? { ...initial, ...draft, id: initial.id } : initial);
    }
  }, [draftKey, machine?.id, open]);
  useEffect(() => {
    if (open && form.id) writeSessionDraft(draftKey, form);
  }, [draftKey, form, open]);
  return (
    <Modal
      open={open}
      title={machine?.id ? "编辑服务器" : "添加服务器"}
      eyebrow="服务器资料"
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="展示名称" wide>
          <input
            value={form.name || ""}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label="服务商">
          <input
            value={form.provider || ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                provider: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="国家/地区">
          <input
            value={form.country || ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                country: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="国家代码">
          <input
            maxLength={8}
            value={form.countryCode || ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                countryCode: event.target.value.toUpperCase(),
              }))
            }
            placeholder="JP"
          />
        </Field>
        <Field label="城市/区域">
          <input
            value={form.region || ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                region: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="绑定 Komari Agent">
          <select
            value={form.monitorClientId || ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                monitorClientId: event.target.value,
              }))
            }
          >
            <option value="">不绑定</option>
            {Object.values(clients).map((client) => (
              <option key={client.uuid} value={client.uuid}>
                {client.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="标签" wide>
          <input
            value={form.tags || ""}
            onChange={(event) =>
              setForm((current) => ({ ...current, tags: event.target.value }))
            }
          />
        </Field>
      </div>
      <div className="dialog-actions">
        <DraftStatus onDiscard={() => { clearSessionDraft(draftKey); onClose(); }} />
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          icon={Save}
          disabled={!form.name?.trim()}
          onClick={async () => {
            await onSave({
              ...form,
              name: form.name.trim(),
              tags: splitTags(form.tags),
            });
            clearSessionDraft(draftKey);
          }}
        >
          保存
        </Button>
      </div>
    </Modal>
  );
}

const MANAGED_STATUS = {
  draft: ["待创建", "warning"],
  validated: ["检查通过", "warning"],
  stopped: ["已停止", ""],
  running: ["运行中", "ok"],
  failed: ["需处理", "bad"],
};
const MANAGED_ERROR = {
  "binary-not-found": "目标机没有找到可复制的内核",
  "port-in-use": "监听端口已被占用",
  "kernel-rejected": "sing-box 内核未通过配置检查",
  "instance-exists": "目标机已有同名实例目录",
  "unit-exists": "目标机已有同名服务单元",
  "managed-instance-missing": "目标机上的托管实例文件已不存在",
  "service-action-failed": "服务操作失败，请查看日志",
  "daemon-reload-failed": "systemd 重新载入失败",
  "openssl-not-found": "目标机缺少 OpenSSL，无法生成自签证书",
  "certificate-generation-failed": "目标机生成自签证书失败",
  "certificate-file-missing": "证书或私钥文件不存在",
  "certificate-invalid": "证书或私钥无法读取",
  "certificate-key-mismatch": "证书与私钥不匹配",
  "certificate-exists": "目标机已存在同编号证书目录",
  "certificate-path-invalid": "证书目录不在 Wherever Station 的独立资产范围内",
  "certificate-delete-not-managed": "已有 PEM 只能取消登记，不能删除目标机文件",
  "root-required": "目标机 Agent 权限不足，无法管理证书文件",
  "release-asset-not-found": "官方发行版没有适配目标机的文件",
  "release-not-found": "找不到这个 Nowhere 发行版本，请从官方列表重新选择",
  "release-checksum-missing": "官方发行版缺少可验证的 SHA256 摘要",
  "release-checksum-mismatch": "发行版校验失败，文件未安装",
  "binary-version-mismatch": "下载的内核版本与所选版本不一致",
  "upgrade-failed": "升级失败，旧内核已保留或恢复",
  "configuration-changed": "目标机配置已变化，请重新打开编辑窗口",
  "configuration-invalid": "目标机配置格式无效",
  "update-in-progress": "该实例正在执行其他配置操作",
  "restart-failed": "新配置启动失败",
  "client-binary-not-found": "检测来源没有找到可用的客户端内核",
  "client-config-rejected": "检测来源的客户端内核无法加载此节点",
  "client-start-failed": "临时检测客户端启动失败",
  "client-start-timeout": "临时检测客户端未能及时监听本地端口",
  "proxy-https-failed": "代理通道未能完成 HTTPS 请求",
  "exit-ip-missing": "代理请求成功，但未能识别出口 IP",
  "exit-ip-mismatch": "代理可用，但出口 IP 与节点地址不一致",
  "adoption-source-invalid": "原 Nowhere 服务标识无效，无法接管",
  "adoption-source-not-running": "原 Nowhere 服务未运行，已取消接管",
  "adoption-source-stop-failed": "无法停止原 Nowhere 服务，托管实例未启动",
  "adoption-start-failed": "托管实例启动失败，已尝试恢复原服务",
  "adoption-persistence-failed": "开机启动切换失败，已尝试恢复原服务",
  "adoption-managed-stop-failed": "无法停止托管实例，未恢复原服务",
  "adoption-rollback-failed": "原服务恢复失败，已尝试重新启动托管实例",
  "adoption-failed": "Nowhere 接管操作失败",
  "probe-timeout": "连接检查超时",
  "probe-failed": "连接检查失败",
  "invalid-response": "检测来源没有返回可识别的结果",
  timeout: "目标机操作超时",
};
const NOWHERE_LIFECYCLE = {
  STARTING: "正在启动",
  READY: "就绪",
  DRAINING: "正在排空",
  STOPPED: "已停止",
};
const DEPLOY_PROTOCOL_LABELS = { "vless-reality": "VLESS Reality", shadowsocks: "Shadowsocks", hysteria2: "Hysteria2", anytls: "AnyTLS", tuic: "TUIC", trojan: "Trojan", vmess: "VMess" };
function PresetManager({ open, state, persist, notify, onClose }) {
  const [editor, setEditor] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  useEffect(() => { if (!open) { setEditor(null); setImporting(false); setImportText(""); } }, [open]);
  const saveAll = async (deploymentPresets, message) => persist({ ...state, deploymentPresets }, message);
  const beginNew = () => setEditor({ id: randomId(), name: "", suffix: "", tier: "advanced", summary: "", badges: [], origin: "user", hidden: false, values: { protocol: "vless-reality", serverName: "www.apple.com", handshakeServer: "www.apple.com", handshakePort: 443, flow: "xtls-rprx-vision" } });
  const duplicate = (preset) => setEditor({ ...structuredClone(preset), id: randomId(), name: `${preset.name} 副本`, origin: "user", hidden: false });
  const saveEditor = async () => {
    const exists = state.deploymentPresets.some((item) => item.id === editor.id);
    const next = exists ? state.deploymentPresets.map((item) => item.id === editor.id ? editor : item) : [...state.deploymentPresets, editor];
    await saveAll(next, exists ? "预设已更新" : "预设已创建"); setEditor(null);
  };
  const exportPresets = () => {
    const blob = new Blob([JSON.stringify({ schema: 1, presets: state.deploymentPresets }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "wherever-station-presets.json"; anchor.click(); URL.revokeObjectURL(url); notify("预设已导出");
  };
  const importPresets = async () => {
    try {
      const value = JSON.parse(importText); const list = Array.isArray(value) ? value : value.presets;
      if (!Array.isArray(list) || !list.length) throw new Error("文件中没有预设");
      const accepted = list.filter((item) => item && item.name && DEPLOY_PROTOCOL_LABELS[item.values?.protocol]).map((item) => ({ ...item, id: randomId(), origin: "user" }));
      if (!accepted.length) throw new Error("没有可识别的 sing-box 预设");
      await saveAll([...state.deploymentPresets, ...accepted], `已导入 ${accepted.length} 个预设`); setImporting(false); setImportText("");
    } catch (error) { notify(error.message, true); }
  };
  const updateValues = (key, value) => setEditor((old) => ({ ...old, values: { ...old.values, [key]: value } }));
  return <Modal open={open} title={editor ? (state.deploymentPresets.some((item) => item.id === editor.id) ? "编辑快捷预设" : "新建快捷预设") : "快捷预设"} eyebrow="sing-box 预设" onClose={editor ? () => setEditor(null) : onClose} size="large">
    {editor ? <>
      <div className="form-grid"><Field label="预设名称"><input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></Field><Field label="节点名后缀"><input value={editor.suffix} onChange={(event) => setEditor({ ...editor, suffix: event.target.value })} placeholder="例如 Reality" /></Field><Field label="协议规格"><select value={editor.values.protocol} onChange={(event) => setEditor({ ...editor, values: { protocol: event.target.value } })}>{Object.entries(DEPLOY_PROTOCOL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="用途说明" wide><input value={editor.summary} onChange={(event) => setEditor({ ...editor, summary: event.target.value })} /></Field></div>
      <div className="preset-parameters"><strong>非敏感默认参数</strong><div className="form-grid">
        {editor.values.protocol === "vless-reality" && <><Field label="Reality SNI"><input value={editor.values.serverName || ""} onChange={(event) => updateValues("serverName", event.target.value)} /></Field><Field label="握手目标"><input value={editor.values.handshakeServer || ""} onChange={(event) => updateValues("handshakeServer", event.target.value)} /></Field><Field label="握手端口"><input type="number" value={editor.values.handshakePort || 443} onChange={(event) => updateValues("handshakePort", Number(event.target.value))} /></Field><Field label="Flow"><select value={editor.values.flow ?? "xtls-rprx-vision"} onChange={(event) => updateValues("flow", event.target.value)}><option value="xtls-rprx-vision">Vision</option><option value="">不使用</option></select></Field></>}
        {editor.values.protocol === "vmess" && <><Field label="传输"><select value={editor.values.transport || "ws"} onChange={(event) => updateValues("transport", event.target.value)}><option value="ws">WebSocket</option><option value="tcp">TCP</option></select></Field>{editor.values.transport !== "tcp" && <Field label="WebSocket 路径"><input value={editor.values.wsPath || "/"} onChange={(event) => updateValues("wsPath", event.target.value)} /></Field>}</>}
        {editor.values.protocol === "shadowsocks" && <Field label="加密方式"><select value={editor.values.method || "2022-blake3-aes-128-gcm"} onChange={(event) => updateValues("method", event.target.value)}><option value="2022-blake3-aes-128-gcm">2022 AES-128-GCM</option><option value="2022-blake3-aes-256-gcm">2022 AES-256-GCM</option><option value="chacha20-ietf-poly1305">ChaCha20-Poly1305</option><option value="aes-128-gcm">AES-128-GCM</option></select></Field>}
        {["trojan", "hysteria2", "tuic", "anytls"].includes(editor.values.protocol) && <><Field label="默认 TLS SNI"><input value={editor.values.serverName || ""} onChange={(event) => updateValues("serverName", event.target.value)} placeholder="创建时可再填写" /></Field><Field label="证书方式"><select value={editor.values.certificateMode || "self-signed"} onChange={(event) => updateValues("certificateMode", event.target.value)}><option value="self-signed">自动私有自签</option><option value="existing">已有可信证书</option></select></Field></>}
      </div><p>预设不会保存宿主、端口、凭据、密钥或证书路径。</p></div>
      <div className="dialog-actions"><Button onClick={() => setEditor(null)}>返回</Button><Button icon={Save} variant="primary" onClick={saveEditor} disabled={!editor.name.trim() || !editor.suffix.trim()}>保存预设</Button></div>
    </> : <>
      <div className="preset-toolbar"><div><Button icon={Plus} variant="primary" onClick={beginNew}>新建预设</Button><Button icon={Import} onClick={() => setImporting((value) => !value)}>导入</Button><Button icon={Download} onClick={exportPresets} disabled={!state.deploymentPresets.length}>导出</Button></div><span>{state.deploymentPresets.filter((item) => !item.hidden).length} 个显示 · {state.deploymentPresets.filter((item) => item.hidden).length} 个隐藏</span></div>
      {importing && <div className="preset-import"><textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="粘贴 Wherever Station 预设 JSON" /><div><Button onClick={() => setImporting(false)}>取消</Button><Button variant="primary" onClick={importPresets} disabled={!importText.trim()}>检查并导入</Button></div></div>}
      <div className="preset-list">{state.deploymentPresets.map((preset) => <article key={preset.id} className={preset.hidden ? "hidden" : ""}><div><strong>{preset.name}</strong><span>{DEPLOY_PROTOCOL_LABELS[preset.values.protocol]} · {preset.origin === "builtin" ? "内置模板" : "自定义模板"}</span><p>{preset.summary || "暂无说明"}</p></div><div><Button icon={Copy} onClick={() => duplicate(preset)}>复制</Button><Button icon={Edit3} onClick={() => setEditor(structuredClone(preset))}>编辑</Button><Button icon={Power} onClick={() => saveAll(state.deploymentPresets.map((item) => item.id === preset.id ? { ...item, hidden: !item.hidden } : item), preset.hidden ? "预设已显示" : "预设已隐藏")}>{preset.hidden ? "显示" : "隐藏"}</Button><IconButton label="删除预设" onClick={() => confirm(`删除预设“${preset.name}”？`) && saveAll(state.deploymentPresets.filter((item) => item.id !== preset.id), "预设已删除")}><Trash2 size={16} /></IconButton></div></article>)}</div>
      {!state.deploymentPresets.length && <Empty title="没有快捷预设">可新建自己的组合，或导入其他 Wherever Station 导出的预设。</Empty>}
      <div className="dialog-actions"><Button onClick={onClose}>完成</Button></div>
    </>}
  </Modal>;
}
function telemetryCounterTotal(value, direction) {
  const parse = (input) => {
    try { return /^\d{1,20}$/.test(String(input ?? "")) ? BigInt(input) : 0n; }
    catch { return 0n; }
  };
  return parse(value?.[`tcpLogical${direction}`]) + parse(value?.[`udpLogical${direction}`]);
}
function telemetryTotal(value, direction) {
  return Number(telemetryCounterTotal(value, direction));
}
function duration(value) {
  const seconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
  const days = Math.floor(seconds / 86400); const hours = Math.floor(seconds % 86400 / 3600); const minutes = Math.floor(seconds % 3600 / 60);
  return days ? `${days} 天 ${hours} 小时` : hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}
function TelemetryTrend({ points }) {
  const [activeIndex, setActiveIndex] = useState(-1);
  if (points.length < 2) return <div className="telemetry-empty">等待下一次采样后显示速率趋势</div>;
  const width = 640; const height = 150; const padX = 10; const padTop = 16; const padBottom = 24;
  const maximum = Math.max(1, ...points.flatMap((point) => [point.up, point.down]));
  const chartHeight = height - padTop - padBottom;
  const line = (key) => points.map((point, index) => `${padX + index * (width - padX * 2) / Math.max(1, points.length - 1)},${padTop + chartHeight - point[key] / maximum * chartHeight}`).join(" ");
  const firstTime = new Date(points[0].observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const lastTime = new Date(points.at(-1).observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const active = points[activeIndex];
  const selectPoint = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    setActiveIndex(Math.round(ratio * (points.length - 1)));
  };
  return <div className="telemetry-chart">
    <div className="telemetry-legend"><span className="up"><i />上传 {bytes(points.at(-1).up, true)}</span><span className="down"><i />下载 {bytes(points.at(-1).down, true)}</span><small>峰值 {bytes(maximum, true)}</small></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Nowhere 最近上传和下载速率趋势" onPointerMove={selectPoint} onPointerDown={selectPoint} onPointerLeave={(event) => { if (event.pointerType !== "touch") setActiveIndex(-1); }}>
      {[0, .5, 1].map((ratio) => <line className="grid" key={ratio} x1={padX} x2={width - padX} y1={padTop + chartHeight * ratio} y2={padTop + chartHeight * ratio} />)}
      <polyline className="up" points={line("up")} />
      <polyline className="down" points={line("down")} />
      <circle className="up" cx={width - padX} cy={padTop + chartHeight - points.at(-1).up / maximum * chartHeight} r="3" />
      <circle className="down" cx={width - padX} cy={padTop + chartHeight - points.at(-1).down / maximum * chartHeight} r="3" />
      {active && <line className="cursor" x1={padX + activeIndex * (width - padX * 2) / Math.max(1, points.length - 1)} x2={padX + activeIndex * (width - padX * 2) / Math.max(1, points.length - 1)} y1={padTop} y2={padTop + chartHeight} />}
      <text x={padX} y={height - 5}>{firstTime}</text><text textAnchor="end" x={width - padX} y={height - 5}>{lastTime}</text>
    </svg>
    {active && <output className="telemetry-tooltip" style={{ left: `${(activeIndex / Math.max(1, points.length - 1)) * 100}%` }}><b>{new Date(active.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</b><span>↑ {bytes(active.up, true)}</span><span>↓ {bytes(active.down, true)}</span></output>}
  </div>;
}
function TelemetrySparkline({ points }) {
  const [activeIndex, setActiveIndex] = useState(-1);
  if (points.length < 2) return <span className="telemetry-spark-empty">正在积累趋势</span>;
  const values = points.slice(-20); const width = 112; const height = 28;
  const maximum = Math.max(1, ...values.flatMap((point) => [point.up, point.down]));
  const line = (key) => values.map((point, index) => `${index * width / Math.max(1, values.length - 1)},${height - 2 - point[key] / maximum * (height - 4)}`).join(" ");
  const active = values[activeIndex];
  const selectPoint = (event) => { const bounds = event.currentTarget.getBoundingClientRect(); setActiveIndex(Math.round(Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))) * (values.length - 1))); };
  return <span className="telemetry-spark-wrap"><svg className="telemetry-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Nowhere 速率趋势，可移动指针查看数值" onPointerMove={selectPoint} onPointerDown={selectPoint} onPointerLeave={(event) => { if (event.pointerType !== "touch") setActiveIndex(-1); }}><polyline className="up" points={line("up")} /><polyline className="down" points={line("down")} />{active && <line className="cursor" x1={activeIndex * width / Math.max(1, values.length - 1)} x2={activeIndex * width / Math.max(1, values.length - 1)} y1="0" y2={height} />}</svg>{active && <output><b>{new Date(active.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</b><span>↑ {bytes(active.up, true)}　↓ {bytes(active.down, true)}</span></output>}</span>;
}
function TelemetryRefreshControl({ value, onChange }) {
  return <label className="telemetry-refresh-control"><span>前台采样</span><select value={value} onChange={(event) => onChange(Number(event.target.value))}><option value={3000}>3 秒</option><option value={5000}>5 秒</option><option value={10000}>10 秒</option><option value={0}>暂停</option></select></label>;
}
function withTelemetryRate(row, previous) {
  if (!row?.telemetry || !previous?.telemetry || row.pid !== previous.pid) return row;
  const wallElapsed = (Date.parse(row.observedAt) - Date.parse(previous.observedAt)) / 1000;
  if (row.telemetry.source === "systemd") {
    const delta = Number(row.telemetry.cpuUsageNs || 0) - Number(previous.telemetry.cpuUsageNs || 0);
    return { ...row, telemetry: { ...row.telemetry, cpuPercent: wallElapsed > 0 && delta >= 0 ? delta / (wallElapsed * 1e7) : undefined } };
  }
  const elapsed = Number.isFinite(row.telemetry.uptimeMs) && Number.isFinite(previous.telemetry.uptimeMs)
    ? (row.telemetry.uptimeMs - previous.telemetry.uptimeMs) / 1000 : 0;
  const up = telemetryCounterTotal(row.telemetry, "Up"); const down = telemetryCounterTotal(row.telemetry, "Down");
  const oldUp = telemetryCounterTotal(previous.telemetry, "Up"); const oldDown = telemetryCounterTotal(previous.telemetry, "Down");
  if (!(elapsed > 0 && elapsed <= 90 && up >= oldUp && down >= oldDown)) return row;
  return { ...row, telemetry: { ...row.telemetry, upBytesPerSecond: Math.round(Number(up - oldUp) / elapsed), downBytesPerSecond: Math.round(Number(down - oldDown) / elapsed) } };
}

function NowhereCarrierFields({ values, onPatch, error = "" }) {
  const changePort = (kind, value) => {
    const next = Number(value);
    const tcpPort = kind === "tcp" ? next : Number(values.tcpPort || 0);
    const udpPort = kind === "udp" ? next : Number(values.udpPort || 0);
    onPatch({
      [`${kind}Port`]: next,
      port: tcpPort || udpPort || Number(values.port || 2077),
      network: tcpPort && udpPort ? "mix" : tcpPort ? "tcp" : "udp",
    });
  };
  return <>
    <Field label="TCP Carrier 端口" hint="填 0 关闭 TCP" error={error}><input type="number" min="0" max="65535" value={values.tcpPort ?? values.port ?? 2077} onChange={(event) => changePort("tcp", event.target.value)} /></Field>
    <Field label="UDP Carrier 端口" hint="填 0 关闭 UDP" error={error}><input type="number" min="0" max="65535" value={values.udpPort ?? values.port ?? 2077} onChange={(event) => changePort("udp", event.target.value)} /></Field>
    <Field label="TCP Carrier"><select value={values.tcpCarrier || "tcp"} onChange={(event) => onPatch({ tcpCarrier: event.target.value })}><option value="tcp">TCP · 自动地址族</option><option value="tcp4">TCP · IPv4</option><option value="tcp6">TCP · IPv6</option></select></Field>
    <Field label="UDP Carrier"><select value={values.udpCarrier || "udp"} onChange={(event) => onPatch({ udpCarrier: event.target.value })}><option value="udp">UDP · 自动地址族</option><option value="udp4">UDP · IPv4</option><option value="udp6">UDP · IPv6</option></select></Field>
  </>;
}

const NOWHERE_RESERVED_EXTENSION_KEYS = new Set([
  "NOWHERE_PORTAL", "NOWHERE_VERSION_VALUE", "NOWHERE_PUBLIC_HOST_VALUE", "NOWHERE_LISTEN_HOST_VALUE",
  "NOWHERE_PORT_VALUE", "NOWHERE_KEY_VALUE", "NOWHERE_NET_VALUE", "NOWHERE_CLIENT_VALUE", "NOWHERE_ALPN_VALUE",
  "NOWHERE_TLS_VALUE", "NOWHERE_CRT_VALUE", "NOWHERE_TLS_KEY_VALUE", "NOWHERE_RATE_VALUE", "NOWHERE_ETAR_VALUE",
  "NOWHERE_DIAL_VALUE", "NOWHERE_SOCKS_VALUE", "NOWHERE_LOG_VALUE", "NOWHERE_TELEMETRY_INTERVAL_VALUE",
  "NOWHERE_VECTOR_SOCKS_VALUE", "NOWHERE_VECTOR_SNI_VALUE", "NOWHERE_VECTOR_PIN_VALUE", "NOWHERE_VECTOR_MUX_VALUE",
  "NOWHERE_TCP_PORT_VALUE", "NOWHERE_UDP_PORT_VALUE", "NOWHERE_TCP_CARRIER_VALUE", "NOWHERE_UDP_CARRIER_VALUE",
  "NOWHERE_MORPH_VALUE", "NOWHERE_TRANSPORT_MEMORY_PROFILE_VALUE", "NOWHERE_CERTIFICATE_MODE_VALUE",
  "NOWHERE_CERTIFICATE_HOST_VALUE", "NOWHERE_CERTIFICATE_DAYS_VALUE", "NOW_TELEMETRY_INTERVAL", "NOW_TRANSPORT_MEMORY_PROFILE",
]);

function NowhereExtensionEditor({ value, onChange }) {
  const [keyName, setKeyName] = useState("");
  const [settingValue, setSettingValue] = useState("");
  const [error, setError] = useState("");
  const entries = Object.entries(value || {});
  const add = () => {
    const key = keyName.trim().toUpperCase();
    if (!/^NOW(?:HERE)?_[A-Z0-9_]{1,80}$/.test(key)) return setError("名称必须以 NOW_ 或 NOWHERE_ 开头，并只包含大写字母、数字和下划线");
    if (NOWHERE_RESERVED_EXTENSION_KEYS.has(key)) return setError("该名称已由标准配置项管理，请使用上方对应字段");
    if (Object.hasOwn(value || {}, key)) return setError("该扩展参数已经存在");
    onChange({ ...(value || {}), [key]: settingValue });
    setKeyName(""); setSettingValue(""); setError("");
  };
  return <Field label="环境变量" wide hint="最多 32 项；名称必须以 NOW_ 或 NOWHERE_ 开头。">
    <div className="nowhere-extension-editor">
      {!!entries.length && <div className="nowhere-extension-list">{entries.map(([key, current]) => <div key={key}><code>{key}</code><input aria-label={`${key} 的值`} value={current} onChange={(event) => onChange({ ...(value || {}), [key]: event.target.value })} /><IconButton label={`移除 ${key}`} onClick={() => onChange(Object.fromEntries(entries.filter(([name]) => name !== key)))}><Trash2 size={15} /></IconButton></div>)}</div>}
      <div className="nowhere-extension-add"><input aria-label="扩展参数名称" value={keyName} onChange={(event) => { setKeyName(event.target.value); setError(""); }} placeholder="NOWHERE_EXAMPLE" /><input aria-label="扩展参数值" value={settingValue} onChange={(event) => setSettingValue(event.target.value)} placeholder="值" /><Button icon={Plus} onClick={add} disabled={!keyName.trim() || entries.length >= 32}>添加</Button></div>
      {error && <small className="field-error">{error}</small>}
    </div>
  </Field>;
}

function NowhereAdvancedFields({ values, onPatch, capabilities }) {
  const update = (key, value) => onPatch({ [key]: value });
  return <>
    <Field label="Wire protocol"><input value="nw2（固定）" disabled /></Field>
    <Field label="上传限速 Mbps"><input type="number" min="0" value={values.rate || 0} onChange={(event) => update("rate", Number(event.target.value))} /></Field>
    <Field label="下载限速 Mbps"><input type="number" min="0" value={values.etar || 0} onChange={(event) => update("etar", Number(event.target.value))} /></Field>
    <Field label="拨号地址"><input value={values.dial || "auto"} onChange={(event) => update("dial", event.target.value)} /></Field>
    <Field label="SOCKS"><input value={values.socks || "none"} onChange={(event) => update("socks", event.target.value)} /></Field>
    <Field label="日志级别"><select value={values.log || "info"} onChange={(event) => update("log", event.target.value)}>{["none", "debug", "info", "warn", "error", "event"].map((option) => <option key={option}>{option}</option>)}</select></Field>
    <Field label="遥测间隔" hint="允许 250ms–60s"><input value={values.telemetryInterval || "1s"} onChange={(event) => update("telemetryInterval", event.target.value)} placeholder="例如 1s" /></Field>
    <Field label="Vector SOCKS"><input value={values.vectorSocks || "127.0.0.1:1080"} onChange={(event) => update("vectorSocks", event.target.value)} /></Field>
    <Field label="Vector SNI"><input value={values.vectorSni || "none"} onChange={(event) => update("vectorSni", event.target.value)} /></Field>
    {capabilities.vectorPin && <Field label="Vector Pin"><input value={values.vectorPin || "none"} onChange={(event) => update("vectorPin", event.target.value)} /></Field>}
    {capabilities.vectorMux && <Field label="Vector Mux"><select value={values.vectorMux || 0} onChange={(event) => update("vectorMux", Number(event.target.value))}><option value={0}>关闭</option><option value={1}>开启</option></select></Field>}
    {capabilities.morph && <Field label="Morph" hint={values.morph === 1 && capabilities.morphTcpPrelude ? "2.1 传输格式；所有同路径客户端与下一跳必须使用兼容版本" : "两端必须一致；跨 Morph 传输格式升级需要协同进行"}><select value={values.morph || 0} onChange={(event) => update("morph", Number(event.target.value))}><option value={0}>关闭</option><option value={1}>开启（两端必须一致）</option></select></Field>}
    {capabilities.transportMemoryProfile && <Field label="Transport 内存策略"><select value={values.transportMemoryProfile || "throughput"} onChange={(event) => update("transportMemoryProfile", event.target.value)}><option value="memory">节省内存</option><option value="balanced">平衡</option><option value="throughput">吞吐优先</option></select></Field>}
    <details className="nowhere-experimental">
      <summary>实验性环境变量{Object.keys(values.extensionEnvironment || {}).length ? ` · ${Object.keys(values.extensionEnvironment).length}` : ""}</summary>
      <p>仅在 Nowhere 官方文档明确要求时使用。这里会原样保留尚未进入标准表单的环境变量；普通部署无需填写。</p>
      <NowhereExtensionEditor value={values.extensionEnvironment} onChange={(next) => update("extensionEnvironment", next)} />
    </details>
  </>;
}

function ManagedNowhereDeploy({ state, setState, clients, me, notify, persist, onNavigate, onDiscover }) {
  const [liveStates, setLiveStates] = useState([]);
  const [telemetryDetail, setTelemetryDetail] = useState("");
  const [telemetryHistory, setTelemetryHistory] = useState({});
  const [telemetrySampleMs, setTelemetrySampleMs] = useState(3000);
  const [discoveryPicker, setDiscoveryPicker] = useState(false);
  const statusTargets = state.managedInstances.map(item => `${item.machineId}:${item.id}`).sort().join('|');
  const statusRevision = state.managedInstances.map(item => item.lastOperationId || '').join('|');
  useEffect(() => {
    let cancelled = false; let querying = false;
    const refresh = async () => {
      if (document.hidden || querying) return;
      querying = true;
      try {
        const cached = await rpc('proxyConsole:listInstanceStates');
        if (!cancelled) setLiveStates(cached);
        if (me?.two_factor_enabled) return;
        const allMachineIds = [...new Set(statusTargets.split('|').filter(Boolean).map(value => value.split(':')[0]))];
        const focusedMachineId = telemetryDetail ? state.managedInstances.find((item) => item.id === telemetryDetail)?.machineId : "";
        const machineIds = focusedMachineId ? [focusedMachineId] : allMachineIds;
        const samples = await Promise.all(machineIds.map(async (machineId) => {
          if (cancelled) return null;
          try {
            const spec = await rpc('proxyConsole:prepareInstanceStates', { machineId });
            const task = await executeTask(spec.clientId, spec.command);
            const line = String(task.result || '').split(/\r?\n/).find(value => value.startsWith('PCSTATES\t1\t'));
            if (!line) return null;
            const payload = JSON.parse(atob(line.slice('PCSTATES\t1\t'.length)));
            return { machineId, states: payload.states };
          } catch (_) { return null; /* One offline host must not block fresh samples from other hosts. */ }
        }));
        const batchObservedAt = new Date().toISOString();
        await Promise.all(samples.filter(Boolean).map(({ machineId, states }) => rpc('proxyConsole:recordInstanceStates', {
          machineId,
          states: states.map((row) => ({ ...row, observedAt: batchObservedAt })),
        })));
        if (!cancelled) setLiveStates(await rpc('proxyConsole:listInstanceStates'));
      } catch (_) { /* Retain explicitly timestamped cached values. */ }
      finally { querying = false; }
    };
    refresh();
    const interval = telemetryDetail ? telemetrySampleMs : 8000;
    const timer = interval > 0 ? setInterval(refresh, interval) : null;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [statusTargets, statusRevision, me?.two_factor_enabled, telemetryDetail, telemetrySampleMs]);
  useEffect(() => {
    setTelemetryHistory((current) => {
      let changed = false; const next = { ...current };
      for (const row of liveStates) {
        const telemetry = row.telemetry;
        if (!telemetry || !Number.isFinite(telemetry.upBytesPerSecond) || !Number.isFinite(telemetry.downBytesPerSecond)) continue;
        const old = next[row.instanceId] || [];
        if (old.at(-1)?.observedAt === row.observedAt) continue;
        next[row.instanceId] = [...old, { observedAt: row.observedAt, up: telemetry.upBytesPerSecond, down: telemetry.downBytesPerSecond }].slice(-60);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [liveStates]);
  const [tasks, setTasks] = useState([]);
  const completedTasks = useRef(new Set());
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const next = await rpc("proxyConsole:listManagedTasks");
        if (cancelled) return;
        setTasks(next.filter(task => !["status", "logs", "read-config"].includes(task.action) && task.phase !== "prepared" && task.phase !== "completed"));
        const completed = next.filter(task => task.phase === "completed");
        if (completed.some(task => !completedTasks.current.has(task.operationId))) {
          const latest = await rpc("proxyConsole:getState");
          if (!cancelled) setState(latest);
        }
        completed.forEach(task => completedTasks.current.add(task.operationId));
      } catch (_) { /* Keep existing state; foreground operations report failures. */ }
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [setState]);
  const [editor, setEditor] = useState(false);
  const [configEdit, setConfigEdit] = useState(null);
  const [configError, setConfigError] = useState("");
  const [singConfigEdit, setSingConfigEdit] = useState(null);
  const [singConfigError, setSingConfigError] = useState("");
  const [singEditor, setSingEditor] = useState(false);
  const [presetManager, setPresetManager] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [form, setForm] = useState({});
  const [singForm, setSingForm] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [singFormErrors, setSingFormErrors] = useState({});
  const [preview, setPreview] = useState(null);
  const [singPreview, setSingPreview] = useState(null);
  const [busy, setBusy] = useState(() => new Set());
  const beginBusy = (key) => setBusy(current => new Set(current).add(key));
  const endBusy = (key) => setBusy(current => { const next = new Set(current); next.delete(key); return next; });
  const hasBusy = (key) => busy.has(key);
  const [logs, setLogs] = useState(null);
  const [qr, setQr] = useState(null);
  const [nowhereManager, setNowhereManager] = useState(null);
  const [certificateCenter, setCertificateCenter] = useState(false);
  const [certificateEditor, setCertificateEditor] = useState(null);
  const [subscriptionEdit, setSubscriptionEdit] = useState(null);
  const [nowhereReleases, setNowhereReleases] = useState({
    loading: false,
    releases: NOWHERE_RELEASE_FALLBACK.map((tag) => ({ tag, publishedAt: "" })),
    latest: NOWHERE_RELEASE_FALLBACK[0],
    stale: true,
    error: "",
  });
  const [singBoxReleases, setSingBoxReleases] = useState({
    loading: false,
    releases: SING_BOX_RELEASE_FALLBACK.map((tag) => ({ tag, publishedAt: "" })),
    latest: SING_BOX_RELEASE_FALLBACK[0],
    stale: true,
    error: "",
  });
  const [recentInstanceId, setRecentInstanceId] = useState("");
  useEffect(() => {
    if (editor && form.machineId) writeSessionDraft("deploy:nowhere", form);
  }, [editor, form]);
  useEffect(() => {
    if (singEditor && singForm.machineId) writeSessionDraft("deploy:sing-box", singForm);
  }, [singEditor, singForm]);
  useEffect(() => {
    if (!recentInstanceId) return undefined;
    const frame = requestAnimationFrame(() => document.querySelector(`[data-instance-id="${recentInstanceId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    const timer = setTimeout(() => setRecentInstanceId(""), 1800);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [recentInstanceId, state.managedInstances.length]);
  const boundMachines = state.machines.filter((machine) => machine.monitorClientId && clients[machine.monitorClientId]);
  const instances = state.managedInstances.filter((item) => item.kind === "nowhere");
  const singInstances = state.managedInstances.filter((item) => item.kind === "sing-box");
  const visiblePresets = (state.deploymentPresets || []).filter((item) => !item.hidden);
  const certificates = state.certificates || [];
  const machineFor = (instance) => state.machines.find((item) => item.id === instance.machineId);
  const nodeFor = (instance) => state.nodes.find((item) => item.id === instance.nodeId);
  const autoHost = (machine) => preferredPublicHost(clients[machine?.monitorClientId]);
  const machineNamePrefix = (machine) => machine
    ? `${flag(machine.countryCode)} ${machine.region || machine.name || "服务器"}`.trim()
    : "";
  const selectMachine = (setter, machineId, defaultSuffix = "节点") => {
    const machine = boundMachines.find((item) => item.id === machineId);
    setter((old) => {
      const previousMachine = boundMachines.find((item) => item.id === old.machineId);
      const previousPrefix = machineNamePrefix(previousMachine);
      const followsMachine = !String(old.name || "").trim()
        || (previousPrefix && String(old.name).startsWith(`${previousPrefix} |`));
      const suffix = String(old.name || "").includes("|")
        ? String(old.name).split("|").slice(1).join("|").trim()
        : defaultSuffix;
      const publicHost = autoHost(machine);
      return {
        ...old,
        machineId,
        name: followsMachine ? `${machineNamePrefix(machine)} | ${suffix}`.trim() : old.name,
        publicHost,
        certificateAssetId: "",
        certificateHost: !old.certificateHost || old.certificateHost === old.publicHost ? publicHost : old.certificateHost,
      };
    });
  };
  const usableCertificates = (machineId) => certificates.filter((item) => item.machineId === machineId && ["valid", "warning"].includes(item.status));
  const certificateAssetOptions = (machineId) => usableCertificates(machineId).map((asset) => <option key={asset.id} value={`asset:${asset.id}`}>{asset.status === "warning" ? "⚠ " : ""}{asset.name} · {asset.expiresAt ? new Date(asset.expiresAt).toLocaleDateString("zh-CN") : "有效"}</option>);
  const certificateSelection = (values, fallback) => values?.certificateAssetId ? `asset:${values.certificateAssetId}` : values?.certificateMode || fallback;
  const selectCertificate = (setter, rawValue, kind) => setter((old) => {
    if (!rawValue.startsWith("asset:")) return { ...old, certificateAssetId: "", certificateMode: rawValue, tls: kind === "nowhere" ? (rawValue === "ephemeral" ? 1 : 2) : old.tls };
    const asset = certificates.find((item) => item.id === rawValue.slice(6) && item.machineId === old.machineId);
    if (!asset) return old;
    const serverName = asset.sans?.find((item) => /[a-z]/i.test(item)) || asset.subjectName || asset.sans?.[0] || old.publicHost;
    return { ...old, certificateAssetId: asset.id, certificateMode: "existing", certificatePath: asset.certificatePath, privateKeyPath: asset.privateKeyPath, certificateHost: serverName, serverName, tls: kind === "nowhere" ? 2 : old.tls, vectorPin: kind === "nowhere" ? asset.fingerprintSha256 : old.vectorPin };
  });
  const certificateUsage = (assetId) => state.managedInstances.filter((item) => item.certificateId === assetId);
  const openCertificateCreate = () => {
    const machine = boundMachines[0]; const subject = autoHost(machine);
    setCertificateEditor({ name: `${machine?.name || "服务器"} · 稳定证书`, machineId: machine?.id || "", mode: "managed", subjectName: subject, sans: subject, days: 825, certificatePath: "", privateKeyPath: "" });
  };
  const runCertificateAction = async (action, asset, input) => {
    const busyKey = `certificate:${asset?.id || "create"}:${action}`;
    if (hasBusy(busyKey)) return;
    const otp = operationOtp(); if (otp === null) return;
    if (action === "delete" && !confirm(`删除证书资产“${asset.name}”？\n\n仅 Wherever Station 创建的独立证书目录会被删除。`)) return;
    beginBusy(busyKey);
    try {
      const spec = await rpc("proxyConsole:prepareCertificateAction", { action, certificateId: asset?.id, confirmation: action === "delete" ? asset.id : "", input, requestId: crypto.randomUUID() });
      const saved = await executeTrackedManagedTask(spec, otp);
      setState(saved.state);
      if (!saved.result.ok) throw new Error(MANAGED_ERROR[saved.result.error] || saved.result.error || "证书操作失败");
      if (action === "create") setCertificateEditor(null);
      notify(action === "create" ? "证书资产已建立并检查" : action === "inspect" ? "证书状态已更新" : "证书资产已删除");
    } catch (error) { notify(error.message, true); }
    finally { endBusy(busyKey); }
  };
  const createCertificate = () => {
    if (!certificateEditor) return;
    const input = { ...certificateEditor, sans: String(certificateEditor.sans || "").split(/[\s,，]+/).filter(Boolean) };
    void runCertificateAction("create", null, input);
  };
  const forgetCertificate = async (asset) => {
    if (certificateUsage(asset.id).length || !confirm(`取消登记“${asset.name}”？\n\n目标机上的证书文件不会被删除。`)) return;
    try { const saved = await rpc("proxyConsole:removeCertificateRegistration", { certificateId: asset.id }); setState(saved.state); notify("已取消证书登记，目标机文件未变更"); }
    catch (error) { notify(error.message, true); }
  };
  const copyCertificateValue = async (value, label) => {
    try { await navigator.clipboard.writeText(value); notify(`${label}已复制`); }
    catch (_) { notify("复制失败", true); }
  };
  const update = (key, value) => { setForm((old) => ({ ...old, [key]: value })); setFormErrors((old) => ({ ...old, [key]: "", port: ["tcpPort", "udpPort"].includes(key) ? "" : old.port })); setPreview(null); };
  const updateSing = (key, value) => { setSingForm((old) => {
    const next = { ...old, [key]: value };
    if ((key === "protocol" && value === "shadowsocks") || (key === "method" && next.protocol === "shadowsocks")) {
      if (next.method === "2022-blake3-aes-128-gcm") next.password = next.shadowsocks128;
      if (next.method === "2022-blake3-aes-256-gcm") next.password = next.shadowsocks256;
    }
    return next;
  }); setSingFormErrors((old) => ({ ...old, [key]: "", port: key === "port" ? "" : old.port })); setSingPreview(null); };
  const selectSingTemplate = (templateId) => {
    const template = visiblePresets.find((item) => item.id === templateId);
    if (!template) return;
    setSingForm((old) => {
      const baseName = String(old.name || "新节点").split("|")[0].trim();
      const next = { ...old, ...template.values, name: `${baseName} | ${template.suffix}` };
      if (template.values.protocol === "shadowsocks") next.password = next.method === "2022-blake3-aes-256-gcm" ? next.shadowsocks256 : next.shadowsocks128;
      return next;
    });
    setSelectedPresetId(template.id);
    setSingPreview(null);
  };
  const operationOtp = () => {
    const otp = me?.two_factor_enabled ? prompt("请输入本次目标机操作的两步验证码") || "" : "";
    return me?.two_factor_enabled && !otp ? null : otp;
  };
  const loadNowhereReleases = async (force = false) => {
    if (nowhereReleases.loading) return nowhereReleases.releases;
    if (!force && nowhereReleases.fetchedAt && Date.now() - Date.parse(nowhereReleases.fetchedAt) < 15 * 60 * 1000) return nowhereReleases.releases;
    setNowhereReleases((current) => ({ ...current, loading: true, error: "" }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("https://api.github.com/repos/NodePassProject/Nowhere/releases?per_page=20", { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error("github-unavailable");
      const releases = normalizeNowhereReleases(await response.json());
      if (!releases.length) throw new Error("github-empty");
      const latestVerified = releases.find((release) => nowhereVersionCapabilities(release.tag).verified);
      setNowhereReleases({ releases, latest: latestVerified?.tag || "", fetchedAt: new Date().toISOString(), source: "github", stale: false, loading: false, error: "" });
      return releases;
    } catch (_) {
      setNowhereReleases((current) => ({ ...current, loading: false, stale: true, error: "refresh-failed" }));
      return nowhereReleases.releases;
    } finally {
      clearTimeout(timer);
    }
  };
  const loadSingBoxReleases = async (force = false) => {
    if (singBoxReleases.loading) return singBoxReleases.releases;
    if (!force && singBoxReleases.fetchedAt && Date.now() - Date.parse(singBoxReleases.fetchedAt) < 15 * 60 * 1000) return singBoxReleases.releases;
    setSingBoxReleases((current) => ({ ...current, loading: true, error: "" }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("https://api.github.com/repos/SagerNet/sing-box/releases?per_page=20", { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error("github-unavailable");
      const releases = normalizeSingBoxReleases(await response.json());
      if (!releases.length) throw new Error("github-empty");
      setSingBoxReleases({ releases, latest: releases[0].tag, fetchedAt: new Date().toISOString(), source: "github", stale: false, loading: false, error: "" });
      return releases;
    } catch (_) {
      setSingBoxReleases((current) => ({ ...current, loading: false, stale: true, error: "refresh-failed" }));
      return singBoxReleases.releases;
    } finally { clearTimeout(timer); }
  };
  const selectNowhereRuntime = (selection) => {
    setForm((current) => ({
      ...current,
      binarySource: selection === "copy" ? "copy" : "download",
      version: selection === "copy" ? current.version : selection === "custom" ? "" : selection,
    }));
    setPreview(null);
  };
  const selectSingRuntime = (selection) => {
    setSingForm((current) => ({
      ...current,
      binarySource: selection === "copy" ? "copy" : "download",
      downloadVersion: selection === "copy" ? current.downloadVersion : selection === "custom" ? "" : selection,
    }));
    setSingPreview(null);
  };
  const executeManaged = async (kind, instanceId, action, otp, confirmation = "", extra = {}) => {
    const prefix = kind === "nowhere" ? "ManagedNowhere" : "ManagedSingBox";
    const spec = await rpc(`proxyConsole:prepare${prefix}Action`, { instanceId, action, confirmation, ...extra, requestId: crypto.randomUUID() });
    const saved = await executeTrackedManagedTask(spec, otp);
    const result = saved.result;
    setState(saved.state);
    if (!result.ok) throw new Error(MANAGED_ERROR[result.error] || result.error || "目标机操作失败");
    return { result, state: saved.state };
  };
  const openNowhere = async () => {
    try {
      const defaults = await rpc("proxyConsole:newManagedNowhereValues");
      const first = boundMachines[0];
      const initial = { ...defaults, name: `${machineNamePrefix(first)} | Nowhere`.trim(), machineId: first?.id || "", publicHost: autoHost(first), listenHost: "0.0.0.0", client: "anywhere", network: "mix", tls: 1, certificateMode: "ephemeral", certificateHost: autoHost(first), certificateDays: 825, alpn: "nw2", rate: 0, etar: 0, dial: "auto", socks: "none", log: "info", telemetryInterval: "1s", vectorSocks: "127.0.0.1:1080", vectorSni: "none", vectorPin: "none", vectorMux: 0, morph: 0, transportMemoryProfile: "throughput", binarySource: "download" };
      const draft = readSessionDraft("deploy:nowhere")?.value;
      setForm(draft ? { ...initial, ...draft } : initial);
      setPreview(null); setEditor(true);
      void loadNowhereReleases();
    } catch (error) { notify(error.message, true); }
  };
  const openSing = async () => {
    try {
      const defaults = await rpc("proxyConsole:newManagedSingBoxValues");
      let realityKeys = {};
      try { realityKeys = await generateRealityKeypair(); }
      catch (error) { notify(`${error.message}，可在“凭据与日志”中手动填写 Reality 密钥`, true); }
      const first = boundMachines[0];
      const preset = visiblePresets[0];
      const values = preset?.values || { protocol: "vless-reality", serverName: "www.apple.com", handshakeServer: "www.apple.com", handshakePort: 443, flow: "xtls-rprx-vision" };
      const initial = { ...defaults, ...realityKeys, name: `${machineNamePrefix(first)} | ${preset?.suffix || "Reality"}`.trim(), machineId: first?.id || "", publicHost: autoHost(first), listenHost: "0.0.0.0", transport: "tcp", wsPath: "/", method: "2022-blake3-aes-128-gcm", certificateMode: "self-signed", certificatePath: "", privateKeyPath: "", log: "info", ...values };
      const draft = readSessionDraft("deploy:sing-box")?.value;
      setSingForm(draft ? { ...initial, ...draft } : initial);
      setSelectedPresetId(preset?.id || "");
      setSingPreview(null); setSingEditor(true); void loadSingBoxReleases();
    } catch (error) { notify(error.message, true); }
  };
  const previewForm = async () => {
    try { setPreview(await rpc("proxyConsole:previewManagedNowhere", { input: form })); }
    catch (error) { notify(error.message, true); }
  };
  const previewSing = async () => {
    try { setSingPreview(await rpc("proxyConsole:previewManagedSingBox", { input: singForm })); }
    catch (error) { notify(error.message, true); }
  };
  const create = async () => {
    const busyKey = "nowhere:create"; if (hasBusy(busyKey)) return;
    const otp = operationOtp(); if (otp === null) return;
    let draftId = ""; setFormErrors({});
    beginBusy(busyKey);
    try {
      await rpc("proxyConsole:previewManagedNowhere", { input: form });
      const draft = await rpc("proxyConsole:createManagedNowhereDraft", { input: form });
      draftId = draft.instanceId;
      setState(draft.state);
      await executeManaged("nowhere", draft.instanceId, "preflight", otp);
      await executeManaged("nowhere", draft.instanceId, "create", otp);
      clearSessionDraft("deploy:nowhere");
      setEditor(false); setRecentInstanceId(draft.instanceId); notify("Nowhere 托管实例已创建，尚未启动");
    } catch (error) {
      if (draftId) { try { setState(await rpc("proxyConsole:discardManagedNowhereDraft", { instanceId: draftId })); } catch (_) {} }
      if (/port|端口|address already in use/i.test(error.message)) setFormErrors({ port: "该端口已被目标机上的其他进程占用，请更换端口后重试。" });
      notify(error.message, true);
    }
    finally { endBusy(busyKey); }
  };
  const createSing = async () => {
    const busyKey = "sing:create"; if (hasBusy(busyKey)) return;
    const otp = operationOtp(); if (otp === null) return;
    setSingFormErrors({}); beginBusy(busyKey);
    try {
      await rpc("proxyConsole:previewManagedSingBox", { input: singForm });
      const spec = await rpc("proxyConsole:prepareManagedSingBoxCreate", { input: singForm, requestId: crypto.randomUUID() });
      const saved = await executeTrackedManagedTask(spec, otp);
      const result = saved.result;
      setState(saved.state);
      if (!result.ok) throw new Error(MANAGED_ERROR[result.error] || result.error || "创建失败");
      clearSessionDraft("deploy:sing-box");
      setSingEditor(false); setRecentInstanceId(spec.instanceId); notify("sing-box 托管实例已创建，尚未启动");
    } catch (error) { if (/port|端口|address already in use/i.test(error.message)) setSingFormErrors({ port: "该端口已被目标机上的其他进程占用，请更换端口后重试。" }); notify(error.message, true); }
    finally { endBusy(busyKey); }
  };
  const act = async (kind, instance, action) => {
    const busyKey = `${kind}:${instance.id}:${action}`;
    if ([...busy].some(key => key.split(":").includes(instance.id))) return;
    const label = { start: "启动", stop: "停止", restart: "重启", status: "刷新", logs: "读取日志", delete: "删除", adopt: "切换接管", "rollback-adoption": "退出接管" }[action];
    const confirmation = action === "adopt"
      ? `切换接管“${instance.name}”？\n\n原服务会先停止，再启动已核对的托管实例；原文件会保留。若新实例启动失败，系统会自动尝试恢复原服务。`
      : action === "rollback-adoption"
        ? `退出对“${instance.name}”的接管？\n\n托管实例会停止，原 Nowhere 服务会重新启动；托管记录与文件仍会保留，之后可以再次切换接管。`
        : `${label}托管实例“${instance.name}”？${action === "delete" ? "\n\n实例目录与对应节点记录会被删除。" : ""}`;
    if (["start", "stop", "restart", "delete", "adopt", "rollback-adoption"].includes(action) && !confirm(confirmation)) return;
    const otp = operationOtp(); if (otp === null) return;
    beginBusy(busyKey);
    try {
      const done = await executeManaged(kind, instance.id, action, otp, action === "delete" ? instance.id : "");
      if (action === "logs") setLogs({ instance, text: done.result.logs });
      else notify(`${instance.name} · ${label}完成`);
    } catch (error) { notify(error.message, true); }
    finally { endBusy(busyKey); }
  };
  const copyUri = async (instance) => {
    const uri = nodeFor(instance)?.uri;
    if (!uri) return notify("没有找到关联的客户端链接", true);
    try { await navigator.clipboard.writeText(uri); notify("客户端链接已复制"); }
    catch (_) { notify("复制失败，请在节点页手动复制", true); }
  };
  const retryNowhere = async (instance) => {
    const busyKey = `nowhere:${instance.id}:create`;
    if ([...busy].some(key => key.split(":").includes(instance.id))) return;
    const otp = operationOtp(); if (otp === null) return;
    beginBusy(busyKey);
    try {
      // A previous browser timeout may have left a successfully created unit.
      // Read the host first; never blindly replay the create command.
      const current = await executeManaged("nowhere", instance.id, "status", otp);
      if (current.result.installed) {
        notify("已找到创建完成的实例，状态已恢复");
        return;
      }
      await executeManaged("nowhere", instance.id, "preflight", otp);
      await executeManaged("nowhere", instance.id, "create", otp);
      notify("Nowhere 实例已创建，可以启动");
    } catch (error) { notify(error.message, true); }
    finally { endBusy(busyKey); }
  };
  const openNowhereManager = async (instance) => {
    const busyKey = `nowhere:${instance.id}:status`;
    if ([...busy].some((key) => key.split(":").includes(instance.id))) return;
    const otp = operationOtp(); if (otp === null) return;
    setNowhereManager({ instance, loading: true, result: null, targetVersion: instance.version });
    beginBusy(busyKey);
    try {
      const [done, releases] = await Promise.all([
        executeManaged("nowhere", instance.id, "status", otp),
        loadNowhereReleases(),
      ]);
      const currentGeneration = nowhereVersionCapabilities(instance.version).protocolGeneration;
      const targetVersion = releases.find((release) => { const capabilities = nowhereVersionCapabilities(release.tag); return capabilities.verified && capabilities.protocolGeneration === currentGeneration; })?.tag || instance.version;
      setNowhereManager({ instance: done.state.managedInstances.find((item) => item.id === instance.id) || instance, loading: false, result: done.result, targetVersion });
    } catch (error) {
      setNowhereManager(null); notify(error.message, true);
    } finally { endBusy(busyKey); }
  };
  const upgradeNowhere = async () => {
    if (!nowhereManager?.instance || nowhereManager.loading) return;
    const { instance, targetVersion } = nowhereManager;
    if (targetVersion === instance.version) return notify("实例已经是所选版本");
    const action = "upgrade";
    const currentCapabilities = nowhereVersionCapabilities(instance.version);
    const targetCapabilities = nowhereVersionCapabilities(targetVersion);
    const morphBoundary = instance.morph === 1 && currentCapabilities.morphWireGeneration !== targetCapabilities.morphWireGeneration;
    const message = `将“${instance.name}”切换到 ${targetVersion}？\n\n仅替换此托管实例的私有内核；运行实例会短暂停止，失败自动恢复旧版本。${morphBoundary ? "\n\n此实例已启用 Morph，目标版本使用不同的 Morph 传输格式。请先确认同一路径的 Portal、Anywhere/Vector 客户端及原生下一跳会同步升级；两代 Morph 没有自动回退。" : ""}`;
    if (!confirm(message)) return;
    const otp = operationOtp(); if (otp === null) return;
    const busyKey = `nowhere:${instance.id}:${action}`; beginBusy(busyKey);
    setNowhereManager((current) => ({ ...current, loading: true }));
    try {
      const done = await executeManaged("nowhere", instance.id, action, otp, morphBoundary ? "morph-peers-coordinated" : "", { targetVersion });
      const updated = done.state.managedInstances.find((item) => item.id === instance.id) || { ...instance, version: targetVersion };
      setNowhereManager((current) => ({ ...current, instance: updated, loading: false, result: { ...current.result, ...done.result } }));
      notify(`${instance.name} 已切换到 ${targetVersion}`);
    } catch (error) {
      setNowhereManager((current) => current ? { ...current, loading: false } : current);
      notify(error.message, true);
    } finally { endBusy(busyKey); }
  };
  const editNowhere = async (instance) => {
    const busyKey = `read:${instance.id}`;
    if ([...busy].some(key => key.split(":").includes(instance.id))) return;
    const otp = operationOtp(); if (otp === null) return;
    beginBusy(busyKey); setConfigError("");
    try {
      const spec = await rpc("proxyConsole:prepareManagedNowhereAction", { instanceId: instance.id, action: "read-config", requestId: crypto.randomUUID() });
      const saved = await executeTrackedManagedTask(spec, otp);
      if (!saved.result.ok) throw new Error(saved.result.error || "读取配置失败");
      setConfigEdit({ instanceId: instance.id, name: instance.name, readOperationId: spec.operationId, values: { ...saved.result.configuration, name: instance.name, machineId: instance.machineId, certificateAssetId: instance.certificateId || "" } });
    } catch (error) { notify(error.message, true); }
    finally { endBusy(busyKey); }
  };
  const saveNowhereConfig = async () => {
    if (!configEdit) return; const busyKey = `update:${configEdit.instanceId}`; if (hasBusy(busyKey)) return;
    const otp = operationOtp(); if (otp === null) return;
    beginBusy(busyKey); setConfigError("");
    try {
      const spec = await rpc("proxyConsole:prepareManagedNowhereUpdate", { instanceId: configEdit.instanceId, readOperationId: configEdit.readOperationId, changes: configEdit.values, requestId: crypto.randomUUID() });
      const saved = await executeTrackedManagedTask(spec, otp);
      setState(saved.state);
      if (!saved.result.ok) throw new Error(`${saved.result.error || "保存失败"}${saved.result.rolledBack ? "，已恢复旧配置" : ""}`);
      setConfigEdit(null); notify("配置已保存，订阅链接已同步；请在客户端更新订阅");
    } catch (error) { setConfigError(error.message); }
    finally { endBusy(busyKey); }
  };
  const editSingBox = async (instance) => {
    const busyKey = `read:${instance.id}`;
    if ([...busy].some(key => key.split(":").includes(instance.id))) return;
    const otp = operationOtp(); if (otp === null) return;
    beginBusy(busyKey); setSingConfigError("");
    try {
      const spec = await rpc("proxyConsole:prepareManagedSingBoxAction", { instanceId: instance.id, action: "read-config", requestId: crypto.randomUUID() });
      const saved = await executeTrackedManagedTask(spec, otp);
      if (!saved.result.ok) throw new Error(MANAGED_ERROR[saved.result.error] || saved.result.error || "读取配置失败");
      setSingConfigEdit({ instanceId: instance.id, name: instance.name, protocol: instance.protocol, readOperationId: spec.operationId, values: { ...saved.result.configuration, name: instance.name, machineId: instance.machineId, certificateAssetId: instance.certificateId || "" } });
    } catch (error) { notify(error.message, true); }
    finally { endBusy(busyKey); }
  };
  const saveSingBoxConfig = async () => {
    if (!singConfigEdit) return; const busyKey = `update:${singConfigEdit.instanceId}`; if (hasBusy(busyKey)) return;
    const otp = operationOtp(); if (otp === null) return;
    beginBusy(busyKey); setSingConfigError("");
    try {
      const spec = await rpc("proxyConsole:prepareManagedSingBoxUpdate", { instanceId: singConfigEdit.instanceId, readOperationId: singConfigEdit.readOperationId, changes: singConfigEdit.values, requestId: crypto.randomUUID() });
      const saved = await executeTrackedManagedTask(spec, otp);
      setState(saved.state);
      if (!saved.result.ok) throw new Error(`${MANAGED_ERROR[saved.result.error] || saved.result.error || "保存失败"}${saved.result.rolledBack ? "，已恢复旧配置" : ""}`);
      setSingConfigEdit(null); notify("sing-box 配置已保存，订阅链接已同步；请在客户端更新订阅");
    } catch (error) { setSingConfigError(error.message); }
    finally { endBusy(busyKey); }
  };
  const checkConnection = async (instance) => {
    const busyKey = `probe:${instance.id}`;
    if ([...busy].some(key => key.split(":").includes(instance.id)) || instance.status !== "running") return;
    const source = boundMachines.find(machine => machine.id !== instance.machineId) || machineFor(instance);
    if (!source) return notify("没有可用的 Komari Agent 作为检测来源", true);
    const otp = operationOtp(); if (otp === null) return;
    beginBusy(busyKey);
    try {
      const spec = await rpc("proxyConsole:prepareConnectivityCheck", { instanceId: instance.id, sourceMachineId: source.id, requestId: crypto.randomUUID() });
      const task = await executeTask(spec.clientId, spec.command, otp, 40000);
      const saved = await rpc("proxyConsole:recordConnectivityCheck", { instanceId: instance.id, sourceMachineId: source.id, output: task.result });
      setState(saved.state);
      if (saved.result.status !== "passed") throw new Error(MANAGED_ERROR[saved.result.error] || saved.result.error || "连接检查失败");
      notify(`连接通过 · 来源：${source.name}`);
    } catch (error) { notify(error.message, true); }
    finally { endBusy(busyKey); }
  };
  const saveSubscription = async () => {
    if (!subscriptionEdit) return;
    const nodeId = subscriptionEdit.nodeId;
    let next;
    if (subscriptionEdit.subscriptionId === "new") {
      const name = subscriptionEdit.name.trim();
      if (!name) return notify("请输入订阅名称", true);
      const { token } = await rpc("proxyConsole:newToken");
      next = { ...state, subscriptions: [...state.subscriptions, { id: randomId(), name, token, nodeIds: [nodeId], groups: [], enabled: true, expiresAt: "", policyMode: "proxy-all", customRules: [] }] };
    } else {
      const target = state.subscriptions.find(item => item.id === subscriptionEdit.subscriptionId);
      if (!target) return notify("请选择订阅", true);
      if (target.nodeIds.includes(nodeId)) { setSubscriptionEdit(null); return notify("该节点已经在此订阅中"); }
      next = { ...state, subscriptions: state.subscriptions.map(item => item.id === target.id ? { ...item, nodeIds: [...item.nodeIds, nodeId] } : item) };
    }
    try { await persist(next, "节点已加入订阅"); setSubscriptionEdit(null); }
    catch (_) { /* persist has already shown the current revision error. */ }
  };
  const nowhereCreating = hasBusy("nowhere:create");
  const singCreating = hasBusy("sing:create");
  const nowhereSaving = Boolean(configEdit && hasBusy(`update:${configEdit.instanceId}`));
  const singSaving = Boolean(singConfigEdit && hasBusy(`update:${singConfigEdit.instanceId}`));
  const formCapabilities = nowhereVersionCapabilities(form.version);
  const configCapabilities = nowhereVersionCapabilities(configEdit?.values?.version || "");
  const managerCurrentCapabilities = nowhereVersionCapabilities(nowhereManager?.instance?.version);
  const managerTargetCapabilities = nowhereVersionCapabilities(nowhereManager?.targetVersion);
  const nowhereV2Releases = nowhereReleases.releases.filter((release) => nowhereVersionCapabilities(release.tag).verified);
  const nowhereUnverifiedReleases = nowhereReleases.releases.filter((release) => !nowhereVersionCapabilities(release.tag).verified);
  const managedCard = (instance, kind) => {
    const observed = liveStates.find(item => item.instanceId === instance.id);
    if (observed?.observedAt && Date.parse(observed.observedAt) >= Date.parse(instance.updatedAt) && Date.now() - Date.parse(observed.observedAt) <= 15000 && !['draft', 'validated'].includes(instance.status)) {
      const sampledStatus = { active: 'running', inactive: 'stopped', failed: 'failed' }[observed.state];
      if (sampledStatus) instance = { ...instance, status: sampledStatus };
    }
    const machine = machineFor(instance); const node = nodeFor(instance); const status = MANAGED_STATUS[instance.status] || [instance.status || "未知", ""]; const connection = instance.connectivity; const telemetry = observed?.telemetry;
    const instanceCapabilities = kind === "nowhere" ? nowhereVersionCapabilities(instance.version) : null;
    const listenSummary = [instance.tcpPort ? `TCP ${instance.tcpPort}` : "", instance.udpPort ? `UDP ${instance.udpPort}` : ""].filter(Boolean).join(" · ");
    const adoptionStaged = kind === "nowhere" && instance.adoptionState === "staged";
    const adopted = kind === "nowhere" && instance.adoptionState === "adopted";
    const canStart = (instance.status === "stopped" || instance.status === "failed") && !adoptionStaged;
    const instanceBusy = [...busy].some(key => key.split(":").includes(instance.id));
    const connectionLabel = connection?.status === "passed" ? "最近连接测试通过" : connection?.status === "failed" ? "最近连接测试失败" : "尚未测试连接";
    const connectionTitle = connection ? `${connectionLabel} · ${new Date(connection.observedAt).toLocaleString()}${connection.sourceKind === "target" ? " · 目标机自测，不代表公网可达" : " · 由另一台 Agent 发起"}` : connectionLabel;
    return <article className={`managed-card ${recentInstanceId === instance.id ? "recent" : ""}`} data-instance-id={instance.id} key={instance.id}>
      <header><div className="managed-title"><span>{flag(machine?.countryCode) || (kind === "nowhere" ? "N" : "S")}</span><div><h3>{instance.name}</h3><p>{machine?.name || "宿主已删除"} · <span className="sensitive-value">{instance.publicHost}:{instance.port}</span></p></div></div><div className="managed-header-status"><span className={`connection-indicator ${connection?.status || "untested"}`} role="img" aria-label={connectionLabel} title={connectionTitle}>{connection?.status === "passed" ? <Check size={15} /> : connection?.status === "failed" ? <X size={15} /> : <Activity size={15} />}</span>{adoptionStaged && <Status tone="warning">待接管</Status>}{adopted && <Status tone="ok">已接管</Status>}<Status tone={status[1]}>{status[0]}</Status></div></header>
      <dl><div><dt>内核 / 协议</dt><dd>{kind === "nowhere" ? `Nowhere ${instance.version || ""} · NW2` : instance.protocol || "sing-box"}</dd></div><div><dt>监听</dt><dd>{listenSummary}</dd></div><div><dt>{kind === "nowhere" ? "传输" : "版本"}</dt><dd>{kind === "nowhere" ? (instance.network === "mix" ? "TCP + UDP" : String(instance.network || "mix").toUpperCase()) : instance.version || "跟随宿主"}</dd></div><div><dt>归属</dt><dd>Wherever Station</dd></div></dl>
      {instance.lastError && <p className="managed-error">{MANAGED_ERROR[instance.lastError] || instance.lastError}</p>}
      <p className="muted">进程采样：{observed?.observedAt ? `${observed.state} · ${new Date(observed.observedAt).toLocaleTimeString()}${Date.now() - Date.parse(observed.observedAt) > 15000 ? '（旧数据）' : ''}` : '尚未采样'}{me?.two_factor_enabled ? ' · 两步验证已开启，自动远程采样暂停' : ''}</p>
      {kind === "nowhere" && <div className="telemetry-glance"><div><span>Nowhere</span><strong>{telemetry?.lifecycle ? NOWHERE_LIFECYCLE[telemetry.lifecycle] || telemetry.lifecycle : observed?.state === "active" ? "遥测不可用" : "未运行"}</strong></div><div><span>当前速率</span><strong>↑ {bytes(telemetry?.upBytesPerSecond, true)}　↓ {bytes(telemetry?.downBytesPerSecond, true)}</strong></div><TelemetrySparkline points={telemetryHistory[instance.id] || []} /><Button icon={Activity} onClick={() => setTelemetryDetail(instance.id)}>实时遥测</Button></div>}
      {kind === "sing-box" && <div className="telemetry-glance singbox-process-glance"><div><span>sing-box 进程</span><strong>{observed?.state === "active" ? "运行中" : "未运行"}</strong></div><div><span>CPU / RSS</span><strong>{Number.isFinite(telemetry?.cpuPercent) ? `${telemetry.cpuPercent.toFixed(1)}%` : "等待采样"}　/　{Number.isFinite(telemetry?.rssBytes) ? bytes(telemetry.rssBytes) : "—"}</strong></div><div><span>PID</span><strong>{observed?.pid || "—"}</strong></div></div>}
      {kind === "nowhere" && !["draft", "validated"].includes(instance.status) && <div className="managed-primary-actions"><Button icon={Edit3} onClick={() => editNowhere(instance)} disabled={instanceBusy}>{hasBusy(`read:${instance.id}`) ? "正在读取配置…" : "编辑运行配置"}</Button><Button icon={PackageOpen} onClick={() => openNowhereManager(instance)} disabled={instanceBusy}>版本与证书</Button></div>}
      {kind === "sing-box" && <div className="managed-primary-actions"><Button icon={Edit3} onClick={() => editSingBox(instance)} disabled={instanceBusy}>{hasBusy(`read:${instance.id}`) ? "正在读取配置…" : "编辑运行配置"}</Button></div>}
      {kind === "nowhere" && ["draft", "validated", "failed"].includes(instance.status) && <div className="managed-primary-actions"><Button onClick={() => retryNowhere(instance)} disabled={instanceBusy}>检查并继续创建</Button><small>先核对远端结果；已创建的实例只恢复状态。</small></div>}
      <footer><div className="managed-primary-actions">{adoptionStaged ? <Button icon={ShieldCheck} variant="primary" onClick={() => act(kind, instance, "adopt")} disabled={instanceBusy}>切换接管</Button> : canStart ? <Button icon={Play} variant="primary" onClick={() => act(kind, instance, "start")} disabled={instanceBusy}>启动</Button> : <Button icon={Square} onClick={() => act(kind, instance, "stop")} disabled={instanceBusy || instance.status !== "running"}>停止</Button>}<Button icon={RotateCw} onClick={() => act(kind, instance, "restart")} disabled={instanceBusy || instance.status !== "running" || adoptionStaged}>重启</Button><Button icon={Activity} onClick={() => checkConnection(instance)} disabled={instanceBusy || instance.status !== "running"}>{hasBusy(`probe:${instance.id}`) ? "正在检测…" : "测试连接"}</Button><Button icon={Link2} onClick={() => node && setSubscriptionEdit({ nodeId: node.id, nodeName: node.name, subscriptionId: state.subscriptions[0]?.id || "new", name: `${machine?.region || machine?.name || "我的"}节点` })} disabled={!node}>加入订阅</Button></div><div className="managed-secondary-actions"><IconButton disabled={instanceBusy} label="刷新状态" onClick={() => act(kind, instance, "status")}><RefreshCw size={16} /></IconButton><IconButton disabled={instanceBusy} label="查看日志" onClick={() => act(kind, instance, "logs")}><Clipboard size={16} /></IconButton><IconButton label="复制客户端链接" onClick={() => copyUri(instance)}><Copy size={16} /></IconButton><IconButton label="显示二维码" onClick={() => node?.uri && setQr({ name: instance.name, uri: node.uri })}><QrCode size={16} /></IconButton>{adopted && <IconButton disabled={instanceBusy} label="退出接管并恢复原服务" onClick={() => act(kind, instance, "rollback-adoption")}><Undo2 size={16} /></IconButton>}<IconButton disabled={instanceBusy || adopted} label={adopted ? "请先退出接管" : "删除托管实例"} onClick={() => act(kind, instance, "delete")}><Trash2 size={16} /></IconButton></div></footer>
    </article>;
  };
  return <section className="workspace-page deploy-panel">
    <PageHead title="部署节点" description="创建、接入并管理节点实例。"><Button icon={Settings} onClick={() => setPresetManager(true)}>管理预设</Button></PageHead>
    <div className="deploy-launch-grid">
      <button className="deploy-launch-card nowhere-launch" type="button" onClick={openNowhere} disabled={!boundMachines.length}>
        <header><span>NOWHERE CONTROL</span><PackageOpen size={23} /></header>
        <strong>部署 Nowhere</strong>
        <div className="deploy-capabilities"><span>VERSION</span><span>CERTIFICATE</span><span>TELEMETRY</span></div>
        <b><Plus size={16} />新建实例</b>
      </button>
      <button className="deploy-launch-card singbox-launch" type="button" onClick={openSing} disabled={!boundMachines.length || !visiblePresets.length}>
        <header><span>QUICK PRESETS</span><Upload size={21} /></header>
        <strong>sing-box 快捷部署</strong>
        <small>{visiblePresets.length} 个可用预设</small>
        <b><Plus size={16} />选择协议</b>
      </button>
      <button className="deploy-launch-card certificate-launch" type="button" onClick={() => setCertificateCenter(true)} disabled={!boundMachines.length}>
        <header><span>CERTIFICATE VAULT</span><ShieldCheck size={20} /></header>
        <strong>证书工作台</strong>
        <small>{certificates.length ? `${certificates.length} 项 · ${certificates.filter((item) => ["warning", "expired", "invalid", "missing"].includes(item.status)).length} 项需留意` : "稳定自签 · 已有 PEM · Pin"}</small>
        <b><KeyRound size={15} />管理证书</b>
      </button>
      <button className="deploy-launch-card import-launch" type="button" onClick={() => onNavigate("nodes")}>
        <header><span>IMPORT</span><Import size={19} /></header><strong>导入节点链接</strong><small>URI · Base64 · Clash YAML</small><b>打开节点库</b>
      </button>
      <button className="deploy-launch-card discovery-launch" type="button" onClick={() => boundMachines.length === 1 ? onDiscover?.(boundMachines[0]) : setDiscoveryPicker(true)} disabled={!boundMachines.length}>
        <header><span>DISCOVERY</span><Search size={19} /></header><strong>发现现有节点</strong><small>读取服务与配置 · 不修改远端</small><b><Search size={15} />选择服务器</b>
      </button>
      <button className="deploy-launch-card provider-launch" type="button" onClick={() => onNavigate("providers")}>
        <header><span>EXTERNAL PANEL</span><Database size={19} /></header><strong>连接专业面板</strong><small>2S-UI · S-UI</small><b>管理连接</b>
      </button>
    </div>
    {tasks.map(task => <div className="warning" key={task.operationId}><RefreshCw size={16} /><span>{task.kind} · {task.action}：{task.error || "后台处理中，可离开此页，结果会自动更新"}</span></div>)}
    <div className="managed-strip"><Check size={15} /><span>新建实例默认保持停止，可确认配置后再启动。</span></div>
    <div className="managed-list">{instances.map((item) => managedCard(item, "nowhere"))}{singInstances.map((item) => managedCard(item, "sing-box"))}{!instances.length && !singInstances.length && <Empty title="还没有节点实例">从上方选择部署方式，检查配置后即可创建。</Empty>}</div>
    {!boundMachines.length && <div className="warning"><Activity size={17} /><span>请先在“服务器”中绑定至少一个在线 Komari Agent。</span></div>}
    {(() => {
      const instance = instances.find((item) => item.id === telemetryDetail); const observed = liveStates.find((item) => item.instanceId === telemetryDetail); const telemetry = observed?.telemetry;
      return <Modal open={!!telemetryDetail} title={`${instance?.name || "Nowhere"} · 实时遥测`} eyebrow="Nowhere 遥测" onClose={() => setTelemetryDetail("")} size="large">
        <div className="telemetry-toolbar"><p>详情打开时按所选间隔更新。</p><TelemetryRefreshControl value={telemetrySampleMs} onChange={setTelemetrySampleMs} /></div>
        {telemetry && <><div className="telemetry-status"><div><span className={`telemetry-dot ${telemetry.lifecycle === "READY" ? "ready" : ""}`} /> <strong>{NOWHERE_LIFECYCLE[telemetry.lifecycle] || (observed?.state === "active" ? "进程运行中" : "未运行")}</strong>{telemetry.lifecycleReason && <small>{telemetry.lifecycleReason}</small>}</div><p>{telemetry.source === "local" ? `本地遥测${telemetry.version ? ` · ${telemetry.version}` : ""}` : "当前内核未提供可读遥测"} · {observed?.observedAt ? new Date(observed.observedAt).toLocaleTimeString() : "尚未采样"}{observed?.stale ? " · 已过期" : ""}</p></div><div className="telemetry-grid">
          <div><span>当前上传</span><strong>↑ {bytes(telemetry.upBytesPerSecond, true)}</strong></div><div><span>当前下载</span><strong>↓ {bytes(telemetry.downBytesPerSecond, true)}</strong></div><div><span>累计上传</span><strong>{bytes(telemetryTotal(telemetry, "Up"))}</strong></div><div><span>累计下载</span><strong>{bytes(telemetryTotal(telemetry, "Down"))}</strong></div>
          <div><span>TCP / UDP</span><strong>{telemetry.tcpActive ?? "—"} / {telemetry.udpActive ?? "—"}</strong></div><div><span>TLS / QUIC carrier</span><strong>{telemetry.tlsCarriersActive ?? "—"} / {telemetry.quicCarriersActive ?? "—"}</strong></div><div><span>探测延迟</span><strong>{Number.isFinite(telemetry.pingMs) ? `${telemetry.pingMs} ms` : "—"}</strong></div><div><span>运行时间</span><strong>{Number.isFinite(telemetry.uptimeMs) ? duration(telemetry.uptimeMs) : "—"}</strong></div>
          <div><span>Nowhere CPU</span><strong>{Number.isFinite(telemetry.cpuPercent) ? `${telemetry.cpuPercent.toFixed(1)}%` : "—"}</strong></div><div><span>Nowhere RSS</span><strong>{Number.isFinite(telemetry.rssBytes) ? bytes(telemetry.rssBytes) : "—"}</strong></div><div><span>文件描述符</span><strong>{telemetry.openFds ?? "—"}</strong></div><div><span>进程 PID</span><strong>{observed?.pid || "—"}</strong></div>
        </div>{(telemetry.serviceEndpoint || telemetry.configSummary) && <div className="telemetry-note">{telemetry.serviceEndpoint && <span>实例端点：{telemetry.serviceEndpoint}</span>}{telemetry.configSummary && <code>{telemetry.configSummary}</code>}</div>}<TelemetryTrend points={telemetryHistory[telemetryDetail] || []} /></>}
        {!telemetry && <div className="telemetry-empty">尚无遥测样本。实例运行后会自动获取。</div>}
        <div className="dialog-actions"><Button onClick={() => setTelemetryDetail("")}>关闭</Button></div>
      </Modal>;
    })()}
    <Modal open={certificateCenter} title="证书工作台" eyebrow="TLS ASSETS" onClose={() => { setCertificateCenter(false); setCertificateEditor(null); }} size="large">
      <div className="certificate-workbench">
        <div className="certificate-summary">
          <div><ShieldCheck size={19} /><span>状态正常</span><strong>{certificates.filter((item) => item.status === "valid").length}</strong></div>
          <div><CalendarClock size={19} /><span>到期或异常</span><strong>{certificates.filter((item) => ["warning", "expired", "invalid", "missing"].includes(item.status)).length}</strong></div>
          <div><KeyRound size={19} /><span>实例引用</span><strong>{state.managedInstances.filter((item) => item.certificateId).length}</strong></div>
          <button type="button" onClick={openCertificateCreate}><Plus size={18} /><span>建立证书资产</span></button>
        </div>
        {certificateEditor && <div className="certificate-compose">
          <header><div><span>NEW ASSET</span><strong>{certificateEditor.mode === "managed" ? "生成稳定自签证书" : "登记目标机已有 PEM"}</strong></div><IconButton label="关闭新建表单" onClick={() => setCertificateEditor(null)}><X size={17} /></IconButton></header>
          <div className="form-grid">
            <Field label="资产名称"><input autoFocus value={certificateEditor.name} onChange={(event) => setCertificateEditor((old) => ({ ...old, name: event.target.value }))} /></Field>
            <Field label="所属服务器"><select value={certificateEditor.machineId} onChange={(event) => { const machine = boundMachines.find((item) => item.id === event.target.value); const subject = autoHost(machine); setCertificateEditor((old) => ({ ...old, machineId: event.target.value, subjectName: subject, sans: subject, name: `${machine?.name || "服务器"} · 稳定证书` })); }}>{boundMachines.map((machine) => <option key={machine.id} value={machine.id}>{flag(machine.countryCode)} {machine.name}</option>)}</select></Field>
            <Field label="证书来源"><select value={certificateEditor.mode} onChange={(event) => setCertificateEditor((old) => ({ ...old, mode: event.target.value }))}><option value="managed">生成稳定自签证书</option><option value="existing">登记已有 PEM</option></select></Field>
            {certificateEditor.mode === "managed" ? <>
              <Field label="证书名称（CN）"><input value={certificateEditor.subjectName} onChange={(event) => setCertificateEditor((old) => ({ ...old, subjectName: event.target.value }))} /></Field>
              <Field label="备用名称（SAN）" hint="多个域名或 IP 用逗号分隔"><input value={certificateEditor.sans} onChange={(event) => setCertificateEditor((old) => ({ ...old, sans: event.target.value }))} /></Field>
              <Field label="有效天数"><input type="number" min="1" max="3650" value={certificateEditor.days} onChange={(event) => setCertificateEditor((old) => ({ ...old, days: Number(event.target.value) }))} /></Field>
            </> : <>
              <Field label="证书链路径"><input value={certificateEditor.certificatePath} onChange={(event) => setCertificateEditor((old) => ({ ...old, certificatePath: event.target.value }))} placeholder="/etc/ssl/example/fullchain.pem" /></Field>
              <Field label="私钥路径"><input value={certificateEditor.privateKeyPath} onChange={(event) => setCertificateEditor((old) => ({ ...old, privateKeyPath: event.target.value }))} placeholder="/etc/ssl/example/private-key.pem" /></Field>
            </>}
          </div>
          <div className="dialog-actions"><Button onClick={() => setCertificateEditor(null)}>取消</Button><Button icon={ShieldCheck} variant="primary" onClick={createCertificate} disabled={hasBusy("certificate:create:create") || !certificateEditor.machineId || !certificateEditor.name || (certificateEditor.mode === "managed" ? !certificateEditor.subjectName : !certificateEditor.certificatePath || !certificateEditor.privateKeyPath)}>{certificateEditor.mode === "managed" ? "生成并检查" : "检查并登记"}</Button></div>
        </div>}
        <div className="certificate-grid">
          {certificates.map((asset) => {
            const machine = state.machines.find((item) => item.id === asset.machineId); const usage = certificateUsage(asset.id);
            const status = { valid: ["有效", "good"], warning: ["即将到期", "warn"], expired: ["已过期", "bad"], missing: ["文件缺失", "bad"], invalid: ["检查失败", "bad"], unchecked: ["待检查", ""] }[asset.status] || ["待检查", ""];
            return <article className="certificate-card" key={asset.id}>
              <header><div className="certificate-mark"><ShieldCheck size={20} /></div><div><h3>{asset.name}</h3><p>{flag(machine?.countryCode)} {machine?.name || "宿主已删除"}</p></div><Status tone={status[1]}>{status[0]}</Status></header>
              <div className="certificate-facts"><div><span>到期</span><strong>{asset.expiresAt ? new Date(asset.expiresAt).toLocaleDateString("zh-CN") : "待检查"}</strong></div><div><span>引用</span><strong>{usage.length ? `${usage.length} 个实例` : "未使用"}</strong></div><div><span>来源</span><strong>{{ managed: "工作台自签", existing: "已有 PEM", instance: "实例生成" }[asset.mode] || asset.mode}</strong></div></div>
              <div className="certificate-identity"><span>{asset.sans?.length ? asset.sans.join(" · ") : asset.subjectName || "尚未读取 SAN"}</span><code title={asset.certificatePath}>{asset.certificatePath}</code></div>
              {!!usage.length && <div className="certificate-usage">{usage.map((instance) => <span key={instance.id}>{instance.name}</span>)}</div>}
              <footer>
                <Button icon={RefreshCw} onClick={() => runCertificateAction("inspect", asset)} disabled={hasBusy(`certificate:${asset.id}:inspect`)}>检查</Button>
                <IconButton label="复制证书 SHA256" disabled={!asset.fingerprintSha256} onClick={() => copyCertificateValue(asset.fingerprintSha256, "证书 SHA256")}><Copy size={16} /></IconButton>
                <IconButton label="复制公钥 SPKI Pin" disabled={!asset.publicKeySha256} onClick={() => copyCertificateValue(asset.publicKeySha256, "公钥 SPKI Pin")}><KeyRound size={16} /></IconButton>
                <IconButton label={usage.length ? "证书仍被实例引用" : asset.mode === "managed" ? "删除证书资产" : "取消登记"} disabled={!!usage.length} onClick={() => asset.mode === "managed" ? runCertificateAction("delete", asset) : forgetCertificate(asset)}><Trash2 size={16} /></IconButton>
              </footer>
            </article>;
          })}
          {!certificates.length && !certificateEditor && <Empty title="还没有证书资产">建立稳定自签证书，或登记目标机上已有的 PEM 文件。</Empty>}
        </div>
      </div>
      <div className="dialog-actions"><Button onClick={() => { setCertificateCenter(false); setCertificateEditor(null); }}>关闭</Button></div>
    </Modal>
    <Modal open={!!nowhereManager} title={`${nowhereManager?.instance?.name || "Nowhere"} · 版本与证书`} eyebrow="Nowhere 控制面" onClose={() => !nowhereManager?.loading && setNowhereManager(null)} size="large">
      {nowhereManager?.loading ? <div className="boot"><span className="spinner" />正在读取目标机状态</div> : nowhereManager && <>
        <div className="nowhere-control-summary">
          <div><span>当前版本</span><strong>{nowhereManager.instance.version || "未知"} · NW2</strong><small>{nowhereManager.result?.binaryVersion || "尚未读取内核输出"}</small></div>
          <div><span>证书模式</span><strong>{{ ephemeral: "临时自签", managed: "稳定自签", existing: "已有证书" }[nowhereManager.result?.certificate?.mode || nowhereManager.instance.certificateMode] || "未知"}</strong><small>{nowhereManager.result?.certificate?.fingerprint && nowhereManager.result.certificate.ephemeral ? "已读取当前指纹；重启后会变化" : nowhereManager.result?.certificate?.mode === "ephemeral" ? "实例启动后可读取当前指纹" : nowhereManager.result?.certificate?.valid ? "证书有效，且与私钥匹配" : nowhereManager.result?.certificate?.error ? MANAGED_ERROR[nowhereManager.result.certificate.error] || nowhereManager.result.certificate.error : "尚未检查"}</small></div>
          <div><span>运行状态</span><strong>{nowhereManager.result?.state === "active" ? "运行中" : nowhereManager.result?.state === "inactive" ? "已停止" : nowhereManager.result?.state || "未知"}</strong><small>仅管理此实例的私有内核</small></div>
        </div>
        {nowhereManager.result?.certificate?.fingerprint && <div className="certificate-fingerprint"><span>SHA256 指纹</span><code>{nowhereManager.result.certificate.fingerprint}</code>{nowhereManager.result.certificate.expiresAt && <small>到期：{nowhereManager.result.certificate.expiresAt}</small>}{!!nowhereManager.result.certificate.sans?.length && <small>SAN：{nowhereManager.result.certificate.sans.join("、")}</small>}<Button icon={Copy} onClick={() => navigator.clipboard.writeText(nowhereManager.result.certificate.fingerprint).then(() => notify("证书指纹已复制"))}>复制指纹</Button></div>}
        {nowhereManager.instance.migration && <div className="managed-strip"><Check size={15} /><span>已保留迁移前的 {nowhereManager.instance.migration.fromVersion} 快照，可回退。</span></div>}
        <div className="nowhere-upgrade-row">
          <span className="control-label">目标版本</span>
          <select aria-label="目标版本" value={nowhereManager.targetVersion || nowhereManager.instance.version} onChange={(event) => setNowhereManager((current) => ({ ...current, targetVersion: event.target.value }))}>{!managerCurrentCapabilities.verified && <option value={nowhereManager.instance.version}>{nowhereManager.instance.version} · 当前未验证</option>}{!!nowhereV2Releases.length && <optgroup label="已验证">{nowhereV2Releases.map((release, index) => <option key={release.tag} value={release.tag}>{release.tag}{index === 0 ? " · 最新" : ""}</option>)}</optgroup>}{!!nowhereUnverifiedReleases.length && <optgroup label="发现但尚未适配">{nowhereUnverifiedReleases.map((release) => <option key={release.tag} value={release.tag} disabled>{release.tag} · 只读</option>)}</optgroup>}</select>
          <Button icon={RefreshCw} onClick={() => loadNowhereReleases(true)} disabled={nowhereReleases.loading}>{nowhereReleases.loading ? "获取中" : "刷新列表"}</Button>
          <Button icon={Upload} variant="primary" onClick={upgradeNowhere} disabled={!managerCurrentCapabilities.verified || !managerTargetCapabilities.verified || !nowhereManager.targetVersion || nowhereManager.targetVersion === nowhereManager.instance.version}>切换此实例</Button>
          <small>只允许切换到适配清单中已验证的 2.x 版本；新 Release 会先出现为只读待验证。</small>
        </div>
      </>}
      <div className="dialog-actions"><Button onClick={() => setNowhereManager(null)} disabled={nowhereManager?.loading}>关闭</Button></div>
    </Modal>
    <Modal open={!!configEdit} title={`编辑 Nowhere · ${configEdit?.name || ""}`} onClose={() => !nowhereSaving && setConfigEdit(null)} size="large">
      <p>修改仅应用到此托管实例。运行中的实例会重启；停止的实例保持停止。保存失败会尝试恢复旧配置，成功后同步订阅链接。</p>
      {configEdit && <div className="form-grid">
        <Field label="节点名称" wide><input autoFocus value={configEdit.values.name || ""} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, name: event.target.value } }))} /></Field>
        {[["publicHost", "公网域名或 IP"], ["listenHost", "监听地址"]].map(([key, label]) => <Field key={key} label={label}><input value={configEdit.values[key] ?? ""} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, [key]: event.target.value } }))} /></Field>)}
        <Field label="客户端输出"><select value={configEdit.values.client || "anywhere"} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, client: event.target.value } }))}><option value="anywhere">Anywhere</option><option value="both">Anywhere + Vector</option></select></Field>
        <Field label="共享密钥"><SecretInput value={configEdit.values.key || ""} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, key: event.target.value } }))} /></Field>
        <NowhereCarrierFields values={configEdit.values} onPatch={(patch) => setConfigEdit(old => ({ ...old, values: { ...old.values, ...patch } }))} />
        <Field label="TLS 与证书"><select value={certificateSelection(configEdit.values, "ephemeral")} onChange={event => selectCertificate((updater) => setConfigEdit((old) => ({ ...old, values: updater(old.values) })), event.target.value, "nowhere")}><option value="ephemeral">临时自签</option><option value="managed">为此实例生成稳定自签</option><option value="existing">手动填写已有 PEM</option>{!!usableCertificates(configEdit.values.machineId).length && <optgroup label="证书工作台">{certificateAssetOptions(configEdit.values.machineId)}</optgroup>}</select></Field>
        {!configEdit.values.certificateAssetId && configEdit.values.certificateMode === "managed" && <><Field label="证书名称"><input value={configEdit.values.certificateHost || configEdit.values.publicHost || ""} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, certificateHost: event.target.value } }))} /></Field><Field label="有效天数"><input type="number" min="1" max="3650" value={configEdit.values.certificateDays || 825} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, certificateDays: Number(event.target.value) } }))} /></Field></>}
        {!configEdit.values.certificateAssetId && configEdit.values.certificateMode === "existing" && <><Field label="证书链路径"><input value={configEdit.values.certificatePath || ""} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, certificatePath: event.target.value } }))} /></Field><Field label="私钥路径"><input value={configEdit.values.privateKeyPath || ""} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, privateKeyPath: event.target.value } }))} /></Field></>}
      </div>}
      {configEdit && <details className="deploy-advanced"><summary>高级运行参数</summary><div className="form-grid"><NowhereAdvancedFields values={configEdit.values} capabilities={configCapabilities} onPatch={(patch) => setConfigEdit(old => ({ ...old, values: { ...old.values, ...patch } }))} /></div></details>}
      {configError && <p role="alert" className="managed-error">{configError}</p>}
      <div className="dialog-actions"><Button onClick={() => setConfigEdit(null)} disabled={nowhereSaving}>取消</Button><Button variant="primary" icon={Save} onClick={saveNowhereConfig} disabled={nowhereSaving}>{nowhereSaving ? "正在应用…" : "保存并应用"}</Button></div>
    </Modal>
    <Modal open={!!singConfigEdit} title={`编辑 sing-box · ${singConfigEdit?.name || ""}`} onClose={() => !singSaving && setSingConfigEdit(null)} size="large">
      <p>候选配置会先由此实例自己的 sing-box 内核检查。运行中的实例仅在检查通过后重启；失败时恢复旧配置，订阅链接只在成功后更新。</p>
      {singConfigEdit && <div className="form-grid deploy-form">
        <Field label="节点名称" wide><input autoFocus value={singConfigEdit.values.name || ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, name: event.target.value } }))} /></Field>
        {[["publicHost", "公网域名或 IP"], ["listenHost", "监听地址"], ["port", "监听端口", "number"]].map(([key, label, type]) => <Field key={key} label={label}><input type={type || "text"} value={singConfigEdit.values[key] ?? ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, [key]: type === "number" ? Number(event.target.value) : event.target.value } }))} /></Field>)}
        <Field label="日志级别"><select value={singConfigEdit.values.log || "info"} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, log: event.target.value } }))}>{["debug", "info", "warn", "error"].map(value => <option key={value}>{value}</option>)}</select></Field>
        {["vless-reality", "vmess", "tuic"].includes(singConfigEdit.protocol) && <Field label="用户 UUID"><input value={singConfigEdit.values.uuid || ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, uuid: event.target.value } }))} /></Field>}
        {singConfigEdit.protocol === "vless-reality" && <><Field label="Reality SNI"><input value={singConfigEdit.values.serverName || ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, serverName: event.target.value } }))} /></Field><Field label="握手目标"><input value={singConfigEdit.values.handshakeServer || ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, handshakeServer: event.target.value } }))} /></Field><Field label="握手端口"><input type="number" value={singConfigEdit.values.handshakePort || 443} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, handshakePort: Number(event.target.value) } }))} /></Field><Field label="Flow"><select value={singConfigEdit.values.flow ?? "xtls-rprx-vision"} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, flow: event.target.value } }))}><option value="xtls-rprx-vision">Vision</option><option value="">不使用 Flow</option></select></Field><Field label="Reality 私钥"><SecretInput autoComplete="off" value={singConfigEdit.values.realityPrivateKey || ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, realityPrivateKey: event.target.value } }))} /></Field><Field label="Reality 公钥"><input value={singConfigEdit.values.realityPublicKey || ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, realityPublicKey: event.target.value } }))} /></Field><Field label="Short ID"><input value={singConfigEdit.values.shortId || ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, shortId: event.target.value } }))} /></Field></>}
        {singConfigEdit.protocol === "vmess" && <><Field label="传输"><select value={singConfigEdit.values.transport || "tcp"} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, transport: event.target.value } }))}><option value="tcp">TCP</option><option value="ws">WebSocket</option></select></Field>{singConfigEdit.values.transport === "ws" && <Field label="WebSocket 路径"><input value={singConfigEdit.values.wsPath || "/"} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, wsPath: event.target.value } }))} /></Field>}</>}
        {singConfigEdit.protocol === "shadowsocks" && <Field label="加密方式"><select value={singConfigEdit.values.method} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, method: event.target.value } }))}><option value="2022-blake3-aes-128-gcm">2022 BLAKE3 AES-128-GCM</option><option value="2022-blake3-aes-256-gcm">2022 BLAKE3 AES-256-GCM</option><option value="chacha20-ietf-poly1305">ChaCha20-Poly1305</option><option value="aes-128-gcm">AES-128-GCM</option></select></Field>}
        {["shadowsocks", "trojan", "hysteria2", "tuic", "anytls"].includes(singConfigEdit.protocol) && <Field label="密码"><SecretInput autoComplete="off" value={singConfigEdit.values.password || ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, password: event.target.value } }))} /></Field>}
        {["trojan", "hysteria2", "tuic", "anytls"].includes(singConfigEdit.protocol) && <><Field label="TLS SNI"><input value={singConfigEdit.values.serverName || ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, serverName: event.target.value } }))} /></Field><Field label="证书来源"><select value={certificateSelection(singConfigEdit.values, "existing")} onChange={event => selectCertificate((updater) => setSingConfigEdit((old) => ({ ...old, values: updater(old.values) })), event.target.value, "sing-box")}>{singConfigEdit.values.certificateMode === "managed-self-signed" && <option value="managed-self-signed">保留实例自签证书</option>}<option value="existing">手动填写已有 PEM</option>{!!usableCertificates(singConfigEdit.values.machineId).length && <optgroup label="证书工作台">{certificateAssetOptions(singConfigEdit.values.machineId)}</optgroup>}</select></Field>{!singConfigEdit.values.certificateAssetId && singConfigEdit.values.certificateMode === "existing" && <><Field label="证书链路径"><input value={singConfigEdit.values.certificatePath || ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, certificatePath: event.target.value } }))} /></Field><Field label="私钥路径"><input value={singConfigEdit.values.privateKeyPath || ""} onChange={event => setSingConfigEdit(old => ({ ...old, values: { ...old.values, privateKeyPath: event.target.value } }))} /></Field></>}</>}
      </div>}
      {singConfigError && <p role="alert" className="managed-error">{singConfigError}</p>}
      <div className="dialog-actions"><Button onClick={() => setSingConfigEdit(null)} disabled={singSaving}>取消</Button><Button variant="primary" icon={Save} onClick={saveSingBoxConfig} disabled={singSaving}>{singSaving ? "正在检查并应用…" : "保存并应用"}</Button></div>
    </Modal>
    <Modal open={!!subscriptionEdit} title={`加入订阅 · ${subscriptionEdit?.nodeName || ""}`} onClose={() => setSubscriptionEdit(null)}>
      {subscriptionEdit && <div className="form-grid"><Field label="目标订阅" wide><select value={subscriptionEdit.subscriptionId} onChange={event => setSubscriptionEdit(old => ({ ...old, subscriptionId: event.target.value }))}>{state.subscriptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="new">新建订阅</option></select></Field>{subscriptionEdit.subscriptionId === "new" && <Field label="新订阅名称" wide><input autoFocus value={subscriptionEdit.name} onChange={event => setSubscriptionEdit(old => ({ ...old, name: event.target.value }))} /></Field>}</div>}
      <div className="dialog-actions"><Button onClick={() => setSubscriptionEdit(null)}>取消</Button><Button variant="primary" icon={Save} onClick={saveSubscription} disabled={!subscriptionEdit || (subscriptionEdit.subscriptionId === "new" && !subscriptionEdit.name.trim())}>确认加入</Button></div>
    </Modal>
    <Modal open={editor} title="新建 Nowhere 节点" eyebrow="快捷部署" onClose={() => !nowhereCreating && setEditor(false)} size="large">
      <div className="deploy-intro"><strong>配置 Nowhere 节点</strong><p>选择宿主、连接方式和内核版本，确认后创建。</p></div>
      <div className="form-grid deploy-form">
        <Field label="节点名称" wide><input value={form.name || ""} onChange={(event) => update("name", event.target.value)} /></Field>
        <Field label="协议"><input value="NW2" disabled /></Field>
        <Field label="服务器"><select value={form.machineId || ""} onChange={(event) => { selectMachine(setForm, event.target.value, "Nowhere"); setPreview(null); }}><option value="">请选择</option>{boundMachines.map((machine) => <option key={machine.id} value={machine.id}>{flag(machine.countryCode)} {machine.name}</option>)}</select></Field>
        <Field label="内核版本" wide hint={nowhereReleases.loading ? "正在获取 Nowhere 官方 Release…" : nowhereReleases.error ? "官方列表暂时不可用，可使用已验证缓存版本" : "默认下载并校验所选官方版本，也可以复用目标机已有内核。"}>
          <div className="release-picker"><select aria-label="Nowhere 内核版本" value={form.binarySource === "copy" ? "copy" : nowhereReleases.releases.some((release) => release.tag === form.version) ? form.version : "custom"} onChange={(event) => selectNowhereRuntime(event.target.value)}>{!!nowhereV2Releases.length && <optgroup label="已验证版本">{nowhereV2Releases.map((release, index) => <option key={release.tag} value={release.tag}>{release.tag}{index === 0 ? " · 最新" : ""}{release.publishedAt ? ` · ${new Date(release.publishedAt).toLocaleDateString("zh-CN")}` : ""}</option>)}</optgroup>}{!!nowhereUnverifiedReleases.length && <optgroup label="发现但尚未适配">{nowhereUnverifiedReleases.map((release) => <option key={release.tag} value={release.tag} disabled>{release.tag} · 只读待验证</option>)}</optgroup>}<optgroup label="目标机"><option value="copy">复用目标机现有内核</option></optgroup><option value="custom">手动检查版本…</option></select><Button icon={RefreshCw} onClick={() => loadNowhereReleases(true)} disabled={nowhereReleases.loading}>{nowhereReleases.loading ? "获取中" : "刷新版本"}</Button></div>
          {form.binarySource !== "copy" && !nowhereReleases.releases.some((release) => release.tag === form.version) && <input aria-label="手动指定 Nowhere 版本" value={form.version || ""} onChange={(event) => update("version", event.target.value)} placeholder="例如 v2.1.0" />}
          {form.binarySource !== "copy" && !formCapabilities.verified && <small className="warning-text">此版本尚未进入已验证适配清单，只能识别，不能创建实例。</small>}
        </Field>
        <Field label="公网域名或 IP" hint={form.publicHost ? "已从 Komari 自动带出，可手动覆盖" : "Komari 未提供公网地址，请手动填写"}><input value={form.publicHost || ""} onChange={(event) => update("publicHost", event.target.value)} placeholder="example.com 或公网 IP" /></Field>
        <NowhereCarrierFields values={form} error={formErrors.port} onPatch={(patch) => { setForm((old) => ({ ...old, ...patch })); setFormErrors({}); setPreview(null); }} />
        <Field label="监听地址"><input value={form.listenHost || "0.0.0.0"} onChange={(event) => update("listenHost", event.target.value)} /></Field>
        <Field label="客户端输出"><select value={form.client || "anywhere"} onChange={(event) => update("client", event.target.value)}><option value="anywhere">Anywhere</option><option value="both">Anywhere + Vector</option></select></Field>
        <Field label="TLS 与证书" hint={form.certificateAssetId ? "复用证书工作台资产，并输出固定 Pin" : form.certificateMode === "ephemeral" ? "每次启动由 Nowhere 生成临时证书" : form.certificateMode === "managed" ? "为此实例生成并长期保留" : "手动填写目标机 PEM 路径"}><select value={certificateSelection(form, "ephemeral")} onChange={(event) => { selectCertificate(setForm, event.target.value, "nowhere"); setPreview(null); }}><option value="ephemeral">临时自签</option><option value="managed">为此实例生成稳定自签</option><option value="existing">手动填写已有 PEM</option>{!!usableCertificates(form.machineId).length && <optgroup label="证书工作台">{certificateAssetOptions(form.machineId)}</optgroup>}</select></Field>
        <Field label="共享密钥" wide><SecretInput autoComplete="new-password" value={form.key || ""} onChange={(event) => update("key", event.target.value)} /></Field>
        {!form.certificateAssetId && form.certificateMode === "managed" && <><Field label="证书名称"><input value={form.certificateHost || form.publicHost || ""} onChange={(event) => update("certificateHost", event.target.value)} /></Field><Field label="有效天数"><input type="number" min="1" max="3650" value={form.certificateDays || 825} onChange={(event) => update("certificateDays", Number(event.target.value))} /></Field></>}
        {!form.certificateAssetId && form.certificateMode === "existing" && <><Field label="证书链路径"><input value={form.certificatePath || ""} onChange={(event) => update("certificatePath", event.target.value)} /></Field><Field label="私钥路径"><input value={form.privateKeyPath || ""} onChange={(event) => update("privateKeyPath", event.target.value)} /></Field></>}
      </div>
      <details className="deploy-advanced"><summary>高级运行参数</summary><div className="form-grid"><NowhereAdvancedFields values={form} capabilities={formCapabilities} onPatch={(patch) => { setForm((old) => ({ ...old, ...patch })); setPreview(null); }} /></div></details>
      {preview && <div className="deploy-preview"><Check size={17} /><div><strong>参数可生成 · NW2</strong><p>{[preview.summary.tcpPort ? `TCP ${preview.summary.tcpPort}` : "", preview.summary.udpPort ? `UDP ${preview.summary.udpPort}` : ""].filter(Boolean).join(" · ")} · TLS {preview.summary.tls} · {preview.links.anywhere.length} 条 Anywhere 链接</p></div></div>}
      <div className="dialog-actions"><DraftStatus onDiscard={() => { clearSessionDraft("deploy:nowhere"); setEditor(false); }} /><Button onClick={() => setEditor(false)} disabled={nowhereCreating}>取消</Button><Button icon={Search} onClick={previewForm} disabled={nowhereCreating || !formCapabilities.verified}>预览</Button><Button icon={Download} variant="primary" onClick={create} disabled={nowhereCreating || !formCapabilities.verified || !form.machineId || !form.publicHost || !form.name}>{nowhereCreating ? "检查并创建中…" : "检查并创建（不启动）"}</Button></div>
    </Modal>
    <Modal open={singEditor} title="新建 sing-box 节点" eyebrow="快捷部署" onClose={() => !singCreating && setSingEditor(false)} size="large">
      <div className="deploy-intro"><strong>配置 sing-box 节点</strong><p>先选择快捷预设，再调整连接与证书参数。</p></div>
      <div className="sing-template-section">
        <div className="sing-template-head"><div><strong>快捷预设</strong><span>先按使用场景选择；宿主、端口和凭据不会保存在预设中</span></div><Button icon={Settings} onClick={() => setPresetManager(true)}>管理预设</Button></div>
        <div className="sing-template-grid">{visiblePresets.map((template) => <button key={template.id} type="button" className={selectedPresetId === template.id ? "active" : ""} aria-pressed={selectedPresetId === template.id} onClick={() => selectSingTemplate(template.id)}><span><strong>{template.name}</strong></span><small>{template.summary}</small></button>)}</div>
        {!visiblePresets.length && <div className="inline-error">没有可用预设。请先在“管理预设”中新建或导入一个规格。</div>}
      </div>
      <div className="form-grid runtime-version-grid">
        <Field label="内核版本" wide hint={singBoxReleases.loading ? "正在获取 sing-box 官方 Release…" : singBoxReleases.error ? "官方列表暂时不可用，可复用目标机内核或手动指定" : `可以复用目标机内核，或下载官方稳定版本 · 最新 ${singBoxReleases.latest}`}><div className="release-picker"><select aria-label="sing-box 内核版本" value={singForm.binarySource !== "download" ? "copy" : singBoxReleases.releases.some((release) => release.tag === singForm.downloadVersion) ? singForm.downloadVersion : "custom"} onChange={(event) => selectSingRuntime(event.target.value)}>{singBoxReleases.releases.length > 0 && <optgroup label="官方稳定版本">{singBoxReleases.releases.map((release, index) => <option key={release.tag} value={release.tag}>{release.tag}{index === 0 ? " · 最新" : ""}{release.publishedAt ? ` · ${new Date(release.publishedAt).toLocaleDateString("zh-CN")}` : ""}</option>)}</optgroup>}<optgroup label="目标机"><option value="copy">复用目标机现有内核</option></optgroup><option value="custom">手动指定版本…</option></select><Button icon={RefreshCw} onClick={() => loadSingBoxReleases(true)} disabled={singBoxReleases.loading}>{singBoxReleases.loading ? "获取中" : "刷新版本"}</Button></div>{singForm.binarySource === "download" && !singBoxReleases.releases.some((release) => release.tag === singForm.downloadVersion) && <input aria-label="手动指定 sing-box 版本" value={singForm.downloadVersion || ""} onChange={(event) => updateSing("downloadVersion", event.target.value)} placeholder="例如 1.13.11" />}</Field>
      </div>
      <div className="form-grid deploy-form"><Field label="节点名称" wide><input value={singForm.name || ""} onChange={(event) => updateSing("name", event.target.value)} /></Field><Field label="节点宿主"><select value={singForm.machineId || ""} onChange={(event) => { selectMachine(setSingForm, event.target.value, visiblePresets.find((item) => item.id === selectedPresetId)?.suffix || "节点"); setSingPreview(null); }}><option value="">请选择</option>{boundMachines.map((machine) => <option key={machine.id} value={machine.id}>{flag(machine.countryCode)} {machine.name}</option>)}</select></Field><Field label="快捷预设" hint={visiblePresets.find((item) => item.id === selectedPresetId)?.summary}><select value={selectedPresetId} onChange={(event) => selectSingTemplate(event.target.value)}><option value="" disabled>请选择预设</option>{visiblePresets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="公网域名或 IP" hint={singForm.publicHost ? "已从 Komari 自动带出，可手动覆盖" : "Komari 未提供公网地址，请手动填写"}><input value={singForm.publicHost || ""} onChange={(event) => updateSing("publicHost", event.target.value)} /></Field><Field label="监听端口"><input type="number" min="1024" max="65535" value={singForm.port || 20888} onChange={(event) => updateSing("port", Number(event.target.value))} /></Field><Field label="监听地址"><input value={singForm.listenHost || "0.0.0.0"} onChange={(event) => updateSing("listenHost", event.target.value)} /></Field>{singForm.protocol === "vless-reality" && <><Field label="Reality SNI"><input value={singForm.serverName || ""} onChange={(event) => updateSing("serverName", event.target.value)} /></Field><Field label="握手目标"><input value={singForm.handshakeServer || ""} onChange={(event) => updateSing("handshakeServer", event.target.value)} /></Field><Field label="握手端口"><input type="number" value={singForm.handshakePort || 443} onChange={(event) => updateSing("handshakePort", Number(event.target.value))} /></Field><Field label="Flow"><select value={singForm.flow ?? "xtls-rprx-vision"} onChange={(event) => updateSing("flow", event.target.value)}><option value="xtls-rprx-vision">Vision</option><option value="">不使用 Flow</option></select></Field></>}{singForm.protocol === "vmess" && <><Field label="传输"><select value={singForm.transport || "tcp"} onChange={(event) => updateSing("transport", event.target.value)}><option value="tcp">TCP</option><option value="ws">WebSocket</option></select></Field>{singForm.transport === "ws" && <Field label="WebSocket 路径"><input value={singForm.wsPath || "/"} onChange={(event) => updateSing("wsPath", event.target.value)} /></Field>}</>}{singForm.protocol === "shadowsocks" && <Field label="加密方式"><select value={singForm.method || "2022-blake3-aes-128-gcm"} onChange={(event) => updateSing("method", event.target.value)}><option value="2022-blake3-aes-128-gcm">2022 BLAKE3 AES-128-GCM</option><option value="2022-blake3-aes-256-gcm">2022 BLAKE3 AES-256-GCM</option><option value="chacha20-ietf-poly1305">ChaCha20-Poly1305</option><option value="aes-128-gcm">AES-128-GCM</option></select></Field>}{["trojan", "hysteria2", "tuic", "anytls"].includes(singForm.protocol) && <><Field label="TLS SNI"><input value={singForm.serverName || ""} onChange={(event) => updateSing("serverName", event.target.value)} /></Field><Field label="证书方式" hint={singForm.certificateAssetId ? "复用证书工作台资产并输出 Pin" : singForm.certificateMode === "self-signed" ? "为此实例生成独立自签证书" : "手动填写目标机 PEM 路径"}><select value={certificateSelection(singForm, "self-signed")} onChange={(event) => { selectCertificate(setSingForm, event.target.value, "sing-box"); setSingPreview(null); }}><option value="self-signed">为此实例生成自签证书</option><option value="existing">手动填写已有 PEM</option>{!!usableCertificates(singForm.machineId).length && <optgroup label="证书工作台">{certificateAssetOptions(singForm.machineId)}</optgroup>}</select></Field>{!singForm.certificateAssetId && singForm.certificateMode === "existing" && <><Field label="证书链路径"><input value={singForm.certificatePath || ""} onChange={(event) => updateSing("certificatePath", event.target.value)} /></Field><Field label="私钥路径"><input value={singForm.privateKeyPath || ""} onChange={(event) => updateSing("privateKeyPath", event.target.value)} /></Field></>}</>}</div>
      {singFormErrors.port && <p className="field-error deploy-field-error" role="alert">监听端口：{singFormErrors.port}</p>}
      <details className="deploy-advanced"><summary>凭据与日志</summary><div className="form-grid"><Field label="用户 UUID"><input value={singForm.uuid || ""} onChange={(event) => updateSing("uuid", event.target.value)} /></Field>{["shadowsocks", "trojan", "hysteria2", "tuic", "anytls"].includes(singForm.protocol) && <Field label="密码"><SecretInput value={singForm.password || ""} onChange={(event) => updateSing("password", event.target.value)} /></Field>}{singForm.protocol === "vless-reality" && <><Field label="Reality 私钥"><SecretInput value={singForm.realityPrivateKey || ""} onChange={(event) => updateSing("realityPrivateKey", event.target.value)} /></Field><Field label="Reality 公钥"><input value={singForm.realityPublicKey || ""} onChange={(event) => updateSing("realityPublicKey", event.target.value)} /></Field><Field label="Short ID"><input value={singForm.shortId || ""} onChange={(event) => updateSing("shortId", event.target.value)} /></Field></>}<Field label="日志级别"><select value={singForm.log || "info"} onChange={(event) => updateSing("log", event.target.value)}>{["debug", "info", "warn", "error"].map((value) => <option key={value}>{value}</option>)}</select></Field></div></details>
      {singPreview && <div className="deploy-preview"><Check size={17} /><div><strong>完整配置可生成</strong><p>{singPreview.summary.label} · {singPreview.summary.publicHost}:{singPreview.summary.port} · {singPreview.selfSigned ? "将生成独立自签证书，客户端会允许该自签证书" : "创建前将在目标机执行 sing-box check"}</p></div></div>}
      <div className="dialog-actions"><DraftStatus onDiscard={() => { clearSessionDraft("deploy:sing-box"); setSingEditor(false); }} /><Button onClick={() => setSingEditor(false)} disabled={singCreating}>取消</Button><Button icon={Search} onClick={previewSing} disabled={singCreating}>预览</Button><Button icon={Download} variant="primary" onClick={createSing} disabled={singCreating || !singForm.machineId || !singForm.publicHost || !singForm.name}>{singCreating ? "校验并创建中…" : "校验并创建（不启动）"}</Button></div>
    </Modal>
    <PresetManager open={presetManager} state={state} persist={persist} notify={notify} onClose={() => setPresetManager(false)} />
    <Modal open={discoveryPicker} title="选择要扫描的服务器" eyebrow="发现现有节点" onClose={() => setDiscoveryPicker(false)}>
      <div className="discovery-machine-grid">{boundMachines.map((machine) => <button key={machine.id} type="button" onClick={() => { setDiscoveryPicker(false); onDiscover?.(machine); }}><span>{flag(machine.countryCode) || "◇"}</span><div><strong>{machine.name}</strong><small>{machine.provider || "VPS"} · {machine.region || machine.country || "未分组"}</small></div><Search size={17} /></button>)}</div>
      <div className="dialog-actions"><Button onClick={() => setDiscoveryPicker(false)}>取消</Button></div>
    </Modal>
    <Modal open={!!logs} title={`${logs?.instance?.name || "节点实例"} · 最近日志`} eyebrow="运行日志" onClose={() => setLogs(null)} size="large"><pre className="managed-logs">{logs?.text || "暂无日志"}</pre><div className="dialog-actions"><Button onClick={() => setLogs(null)}>关闭</Button></div></Modal>
    <Modal open={!!qr} title={`${qr?.name || "节点实例"} · 客户端链接`} eyebrow="节点二维码" onClose={() => setQr(null)}><div className="qr-box">{qr && <QRCodeSVG value={qr.uri} size={240} level="M" bgColor="#ffffff" fgColor="#171717" />}</div><p className="warning">二维码包含节点凭据，请勿公开截图。</p><div className="dialog-actions"><Button onClick={() => setQr(null)}>关闭</Button></div></Modal>
  </section>;
}

async function executeTrackedManagedTask(spec, otp = "") {
  if (!spec.deduplicated) {
    const job = await rpc("admin:exec", { command: spec.command, clients: [spec.clientId], two_factor_code: otp });
    // Bind immediately after native authenticated submission. Backend observation
    // continues independently of this page; never retry the command on timeout.
    await rpc("proxyConsole:bindManagedTask", { operationId: spec.operationId, taskId: job.task_id });
  }
  const deadline = Date.now() + 30000;
  let interval = 150;
  while (Date.now() < deadline) {
    const value = await rpc("proxyConsole:getManagedTask", { operationId: spec.operationId });
    if (value.task.phase === "completed") return { state: value.state, result: value.task.result };
    if (["rejected", "needs-review"].includes(value.task.phase)) throw new Error(value.task.error);
    await new Promise(resolve => setTimeout(resolve, interval));
    interval = Math.min(1000, Math.round(interval * 1.5));
  }
  throw new Error("任务仍在后台核对，可离开此页；请勿重复创建");
}

async function executeTask(clientId, command, otp = "", timeoutMs = 15000) {
  const job = await rpc("admin:exec", {
    command,
    clients: [clientId],
    two_factor_code: otp,
  });
  const deadline = Date.now() + timeoutMs;
  let interval = 150;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const task = await rpc("admin:getSpecificTaskResult", {
        task_id: job.task_id,
        uuid: clientId,
      });
      if (task.exit_code !== null && task.exit_code !== undefined) return task;
      lastError = "";
    } catch (error) { lastError = error.message; }
    await new Promise((resolve) => setTimeout(resolve, interval));
    interval = Math.min(1000, Math.round(interval * 1.5));
  }
  throw new Error(`任务已发送，结果尚未确认；请刷新状态，不要重复创建${lastError ? `（${lastError}）` : ""}`);
}

function parseManagedNowhereOutput(output) {
  const prefix = "PCNOWHERE\t2\t";
  const line = String(output || "").split(/\r?\n/).find((item) => item.startsWith(prefix));
  if (!line) return { ok: false, error: "远端没有返回可识别的结果" };
  try {
    const binary = atob(line.slice(prefix.length));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    return { ok: false, error: "远端结果无法解析" };
  }
}
function parseManagedSingBoxOutput(output) {
  const prefix = "PCSINGBOX\t1\t";
  const line = String(output || "").split(/\r?\n/).find((item) => item.startsWith(prefix));
  if (!line) return { ok: false, error: "远端没有返回可识别的结果" };
  try {
    const binary = atob(line.slice(prefix.length));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
  } catch (_) { return { ok: false, error: "远端结果无法解析" }; }
}

export default function App() {
  const theme = useThemeSync();
  const embedded = window.self !== window.top;
  const fullscreenHref = `${window.location.origin}/api/admin/plugin/proxy-console/pages/admin.html`;
  const [tab, setTab] = useState("overview");
  const [state, setState] = useState(EMPTY_STATE);
  const [clients, setClients] = useState({});
  const [statuses, setStatuses] = useState({});
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [metricsBusy, setMetricsBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const [toast, setToast] = useState(null);
  const [privacyMode, setPrivacyMode] = useState(() => sessionStorage.getItem("wherever-privacy-mode") === "1");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [discoveryMachine, setDiscoveryMachine] = useState(null);
  const [serviceStates, setServiceStates] = useState(readServiceCache);
  const [serviceBusy, setServiceBusy] = useState(false);
  const serviceWarmRef = useRef(false);
  const metricsBusyRef = useRef(false);
  const serviceBusyRef = useRef(false);
  const statusesRef = useRef(statuses);
  useEffect(() => {
    statusesRef.current = statuses;
  }, [statuses]);
  useEffect(() => {
    document
      .querySelector('.nav button[aria-current="page"]')
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [tab, loading]);
  const notify = useCallback((message, error = false) => {
    setToast({ message, error });
    setTimeout(() => setToast(null), 3600);
  }, []);
  const load = useCallback(async () => {
    try {
      const [nextState, nextClients, nextStatuses, nextMe] = await Promise.all([
        rpc("proxyConsole:getState"),
        rpc("common:getNodes"),
        rpc("common:getNodesLatestStatus"),
        rpc("public:getMe"),
      ]);
      setState(nextState);
      setClients(nextClients || {});
      setStatuses(nextStatuses || {});
      setMe(nextMe || {});
      setUpdatedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    } catch (error) {
      notify(error.message, true);
    } finally {
      setLoading(false);
    }
  }, [notify]);
  useEffect(() => {
    load();
    const listener = () => load();
    window.addEventListener("proxy-console-reload", listener);
    return () => window.removeEventListener("proxy-console-reload", listener);
  }, [load]);
  const refreshMetrics = useCallback(
    async (manual = false) => {
      if (
        metricsBusyRef.current ||
        document.hidden ||
        (!manual && document.querySelector("dialog[open]"))
      )
        return;
      metricsBusyRef.current = true;
      setMetricsBusy(true);
      try {
        setStatuses((await rpc("common:getNodesLatestStatus")) || {});
        setUpdatedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
        if (manual) notify("监控数据已更新");
      } catch (error) {
        if (manual) notify(error.message, true);
      } finally {
        metricsBusyRef.current = false;
        setMetricsBusy(false);
      }
    },
    [notify],
  );
  useEffect(() => {
    if (tab !== "overview" || loading) return undefined;
    refreshMetrics(false);
    const timer = setInterval(() => refreshMetrics(false), 3000);
    const resume = () => {
      if (!document.hidden) refreshMetrics(false);
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [tab, loading, refreshMetrics]);
  const persist = useCallback(
    async (next, message) => {
      try {
        const saved = await rpc("proxyConsole:saveState", { state: next });
        setState(saved);
        notify(message);
        return saved;
      } catch (error) {
        notify(error.message, true);
        if (/其他页面/.test(error.message)) await load();
        throw error;
      }
    },
    [load, notify],
  );
  const parseUris = useCallback(
    async (text) => rpc("proxyConsole:parseNodeUris", { text }),
    [],
  );
  const refreshServices = useCallback(
    async (manual = false, providedOtp = null, targetClientId = "") => {
      if (serviceBusyRef.current) return;
      serviceBusyRef.current = true;
      setServiceBusy(true);
      try {
        const otp =
          providedOtp === null && me?.two_factor_enabled
            ? prompt("请输入本次状态查询的两步验证码") || ""
            : providedOtp || "";
        if (me?.two_factor_enabled && !otp) return;
        const bound = state.machines.filter(
          (machine) =>
            machine.monitorClientId && clients[machine.monitorClientId] &&
            (!targetClientId || machine.monitorClientId === targetClientId),
        );
        if (!bound.length) return;
        setServiceStates((current) => {
          const next = { ...current };
          for (const machine of bound) {
            const previous = current[machine.monitorClientId] || {};
            const managedRows = Object.fromEntries(state.managedInstances.filter((item) => item.machineId === machine.id && item.kind === "nowhere" && !["draft", "validated"].includes(item.status)).map((item) => [item.id, { ...(previous[item.id] || {}), pending: true, error: "" }]));
            next[machine.monitorClientId] = {
              "sing-box": { ...(previous["sing-box"] || {}), pending: true, error: "" },
              nowhere: { ...(previous.nowhere || {}), pending: true, error: "" },
              ...managedRows,
            };
          }
          return next;
        });
        const results = await Promise.allSettled(
          bound.map(async (machine) => {
            if (statusesRef.current[machine.monitorClientId]?.online === false) {
              throw new Error("Komari Agent 离线");
            }
            const spec = await rpc("proxyConsole:statusCommand", { machineId: machine.id });
            const task = await executeTask(
              machine.monitorClientId,
              spec.command,
              otp,
              10000,
            );
            if (Number(task.exit_code) !== 0) throw new Error(task.result || "状态命令执行失败");
            const line = String(task.result || "").split(/\r?\n/).find((value) => value.startsWith("PCSTATES\t1\t"));
            if (!line) throw new Error(`${machine.name} 没有返回可识别的服务状态`);
            const binary = atob(line.slice("PCSTATES\t1\t".length));
            const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
            const rows = Object.fromEntries(payload.states.map((row) => [row.instanceId, row]));
            return {
              clientId: machine.monitorClientId,
              value: {
                "sing-box": { ...(rows["service-sing-box"] || { state: "unknown" }), pending: false, error: "" },
                nowhere: { ...(rows["service-nowhere"] || { state: "unknown" }), pending: false, error: "" },
                ...Object.fromEntries(state.managedInstances.filter((item) => item.machineId === machine.id && item.kind === "nowhere" && !["draft", "validated"].includes(item.status)).map((item) => [item.id, { ...(rows[item.id] || { state: "unknown" }), pending: false, error: "" }])),
              },
            };
          }),
        );
        let succeeded = 0;
        const sampled = {};
        results.forEach((result, index) => {
          const clientId = bound[index].monitorClientId;
          if (result.status === "fulfilled") {
            succeeded += 1;
            sampled[clientId] = result.value.value;
            return;
          }
          const error = result.reason?.message || "状态暂不可用";
          const machine = bound[index];
          const unavailable = { state: "unavailable", pending: false, error, observedAt: new Date().toISOString() };
          sampled[clientId] = {
            "sing-box": unavailable,
            nowhere: unavailable,
            ...Object.fromEntries(state.managedInstances.filter((item) => item.machineId === machine.id && item.kind === "nowhere" && !["draft", "validated"].includes(item.status)).map((item) => [item.id, { ...unavailable }])),
          };
        });
        setServiceStates((current) => {
          const next = { ...current };
          for (const [clientId, value] of Object.entries(sampled)) next[clientId] = Object.fromEntries(Object.entries(value).map(([key, row]) => [key, withTelemetryRate(row, current[clientId]?.[key])]));
          sessionStorage.setItem("proxy-console-service-status", JSON.stringify(next));
          return next;
        });
        if (manual) {
          const failed = bound.length - succeeded;
          notify(failed ? `${succeeded} 台状态已更新，${failed} 台暂不可用` : "服务状态已更新", failed > 0);
        }
      } catch (error) {
        if (manual) notify(error.message, true);
        setServiceStates((current) => {
          const next = structuredClone(current);
          for (const services of Object.values(next)) {
            for (const row of Object.values(services || {})) {
              if (!row?.pending) continue;
              row.pending = false;
              row.state = "unavailable";
              row.error = error.message || "状态暂不可用";
              row.observedAt = new Date().toISOString();
            }
          }
          try { sessionStorage.setItem("proxy-console-service-status", JSON.stringify(next)); } catch (_) {}
          return next;
        });
      } finally {
        serviceBusyRef.current = false;
        setServiceBusy(false);
      }
    },
    [clients, me, notify, state.machines, state.managedInstances],
  );
  useEffect(() => {
    if (
      serviceWarmRef.current ||
      !me ||
      me.two_factor_enabled ||
      !Object.keys(clients).length
    )
      return;
    serviceWarmRef.current = true;
    refreshServices(false);
  }, [clients, me, refreshServices]);
  useEffect(() => {
    if (tab !== "overview" || me?.two_factor_enabled) return undefined;
    refreshServices(false);
    const timer = setInterval(() => refreshServices(false), 15000);
    return () => clearInterval(timer);
  }, [tab, me?.two_factor_enabled, refreshServices]);
  if (loading)
    return (
      <div className="boot">
        <StationMark size={52} />
        <span className="spinner" />
        <strong>正在打开 Wherever Station</strong>
      </div>
    );
  return (
    <div className={`app-shell station-theme ${theme.resolved}${privacyMode ? " privacy-mode" : ""}`}>
      <div className="station-chrome">
      <header className="app-header">
        <div className="brand">
          <StationMark size={38} />
          <div>
            <strong>Wherever Station</strong>
            <small>INFRASTRUCTURE CONTROL · v{pluginVersion}</small>
          </div>
        </div>
      </header>
      <nav className="nav" aria-label="控制台页面">
        {NAV.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>
      <div className="station-meta">
        {embedded && <a className="theme-toggle fullscreen-toggle" href={fullscreenHref} target="_blank" rel="noreferrer" aria-label="全屏打开 Wherever Station" title="全屏打开"><Maximize2 size={15} /><span>全屏</span></a>}
        <button className={`theme-toggle${privacyMode ? " active" : ""}`} type="button" onClick={() => setPrivacyMode((current) => { const next = !current; sessionStorage.setItem("wherever-privacy-mode", next ? "1" : "0"); return next; })} aria-pressed={privacyMode} aria-label={privacyMode ? "关闭隐私打码" : "隐藏 IP 与地址"} title={privacyMode ? "关闭隐私打码" : "截图隐私模式"}>{privacyMode ? <EyeOff size={15} /> : <Eye size={15} />}<span>{privacyMode ? "已打码" : "隐私"}</span></button>
        <button className="theme-toggle" type="button" onClick={() => setSettingsOpen(true)} aria-label="打开设置" title="设置"><Settings size={15} /><span>设置</span></button>
        <button className="theme-toggle" type="button" onClick={theme.cycle} aria-label={`切换主题，当前${theme.mode === "auto" ? "跟随 Komari" : theme.mode === "light" ? "浅色" : "深色"}`} title="跟随 Komari / 浅色 / 深色">
          {theme.mode === "auto" ? <Monitor size={15} /> : theme.mode === "light" ? <Sun size={15} /> : <Moon size={15} />}
          <span>{theme.mode === "auto" ? "自动" : theme.mode === "light" ? "浅色" : "深色"}</span>
        </button>
        <div className="live">
          <i />
          Komari 已连接
        </div>
      </div>
      </div>
      <main className="content">
        <div className="route-view" key={tab}>
        {tab === "overview" && (
          <div className="server-workspace">
            <Overview
              state={state}
              clients={clients}
              statuses={statuses}
              updatedAt={updatedAt}
              onRefresh={() => refreshMetrics(true)}
              busy={metricsBusy}
              persist={persist}
            />
            <Machines state={state} clients={clients} statuses={statuses} persist={persist} notify={notify} onRefresh={load} me={me} onNavigate={setTab} onDiscover={setDiscoveryMachine} serviceStates={serviceStates} refreshServices={refreshServices} serviceBusy={serviceBusy} />
          </div>
        )}
        {tab === "nodes" && (
          <Nodes
            state={state}
            setState={setState}
            persist={persist}
            notify={notify}
            parseUris={parseUris}
            clients={clients}
            me={me}
          />
        )}
        {tab === "subscriptions" && (
          <Subscriptions state={state} persist={persist} notify={notify} onOpenSettings={() => setSettingsOpen(true)} />
        )}
        {tab === "sources" && (
          <Sources state={state} persist={persist} notify={notify} />
        )}
        {tab === "deploy" && <ManagedNowhereDeploy state={state} setState={setState} clients={clients} me={me} notify={notify} persist={persist} onNavigate={setTab} onDiscover={setDiscoveryMachine} />}
        {tab === "providers" && <Providers state={state} setState={setState} notify={notify} onNavigate={setTab} />}
        </div>
      </main>
      <SettingsDialog
        open={settingsOpen}
        value={state.settings || EMPTY_STATE.settings}
        theme={theme}
        revision={state.revision}
        onClose={() => setSettingsOpen(false)}
        onSave={async (settings) => {
          await persist({ ...state, settings }, "控制台设置已保存");
          setSettingsOpen(false);
        }}
        onRestored={(restored) => { setState(restored); setSettingsOpen(false); notify("备份已恢复，请核对 Agent 绑定和证书路径"); }}
      />
      <ExistingServiceDiscoveryDialog machine={discoveryMachine} state={state} clients={clients} persist={persist} notify={notify} me={me} onClose={() => setDiscoveryMachine(null)} />
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.error ? <X size={16} /> : <Check size={16} />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
