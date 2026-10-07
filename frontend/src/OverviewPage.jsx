import React, { useCallback, useEffect, useState } from "react";
import { createVisiblePoller } from "./polling.js";
import { exitGroups } from "./ip-profile.js";
import { Activity, ChevronDown, Copy, Database, Download, Edit3, ExternalLink, Network, PackageOpen, Play, Plus, RefreshCw, RotateCw, Save, Search, Server, Settings, ShieldCheck, CalendarClock, Square, Trash2, Upload } from "lucide-react";
import { bytes, flag, randomId, splitTags, evaluateTrafficPlan } from "./lib.js";
import { rpc, EMPTY_STATE, Button, PageHead, Field, Modal, Status, NOWHERE_LIFECYCLE, telemetryTotal, duration, TelemetryTrend, TelemetrySparkline, TelemetryRefreshControl, executeTask, TRAFFIC_ACCOUNTING, IconButton, SecretInput, Empty, readSessionDraft, writeSessionDraft, clearSessionDraft, DraftStatus } from './ui-shared.jsx';

async function trafficPlanRpc(machineId, revision, plan) {
  const started = await rpc("proxyConsole:startMachineTrafficPlanOperation", { machineId, revision, plan, requestId: crypto.randomUUID() });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const operation = await rpc("proxyConsole:getMachineTrafficPlanOperation", { operationId: started.operationId });
    if (operation.phase === "completed") return operation.result;
    if (operation.phase === "failed") throw new Error(operation.error || "流量计划保存失败");
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  throw new Error("流量计划同步超时，请刷新查看实际保存状态");
}

function shellQuote(value) {
  return `'${String(value || "").replaceAll("'", `'"'"'`)}'`;
}

function powershellQuote(value) {
  return `'${String(value || "").replaceAll("'", "''")}'`;
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
    return createVisiblePoller(() => refreshServices(false, null, machine.monitorClientId), { interval: sampleMs });
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
          const saved = await trafficPlanRpc(trafficPlanEditor.machine.id, state.revision, plan);
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

export { trafficPlanRpc, shellQuote, powershellQuote, Sparkline, FleetTrafficChart, SelectedServerTrend, Overview, ThresholdDialog, Summary, HostServiceControls, TRAFFIC_STATE, shortCycleDate, TrafficPlanGlance, TrafficPlanDialog, Machines, MachineEditor };
