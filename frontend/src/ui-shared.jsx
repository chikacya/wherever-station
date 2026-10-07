import { useCallback, useEffect, useRef, useState } from "react";
import { Boxes, ChevronDown, Eye, EyeOff, X } from "lucide-react";
import { bytes, randomId } from "./lib.js";
import { createReadCoalescer } from "./read-coalescer.js";

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

async function requestRpc(method, params = {}) {
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
const rpc = createReadCoalescer(requestRpc);

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

const TRAFFIC_ACCOUNTING = { sum: "上下行合计", max: "较大方向", up: "仅上传", down: "仅下载" };

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
  "shared-key-upgrade-required": "升级前请将共享密钥改为 32–64 字符小写十六进制，并同步所有客户端",
  "next-key-upgrade-required": "下一跳密钥不符合 2.2.1 要求，请先同步更新下一跳配置",
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

export { EMPTY_STATE, rpc, readSessionDraft, writeSessionDraft, clearSessionDraft, useAsyncButton, IconButton, Button, Status, DraftStatus, Field, SecretInput, Modal, Empty, ContextGuide, PageHead, TRAFFIC_ACCOUNTING, MANAGED_ERROR, NOWHERE_LIFECYCLE, telemetryCounterTotal, telemetryTotal, duration, TelemetryTrend, TelemetrySparkline, TelemetryRefreshControl, executeTrackedManagedTask, executeTask };
