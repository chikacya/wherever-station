import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { version as pluginVersion } from "../../package.json";
import { createVisiblePoller } from "./polling.js";
import { Check, CircleGauge, CloudDownload, Database, Eye, EyeOff, Link2, Maximize2, Network, Settings, Moon, Sun, Monitor, Upload, X } from "lucide-react";
import { telemetryCounterTotal, EMPTY_STATE, rpc, executeTask } from './ui-shared.jsx';

// Fetch the default page while the initial RPCs are loading. Other pages stay on demand.
const overviewModule = import("./OverviewPage.jsx");
overviewModule.catch(() => {}); // Suspense/its boundary presents any load failure.
const Overview = lazy(() => overviewModule.then(module => ({ default: module.Overview })));
const Machines = lazy(() => overviewModule.then(module => ({ default: module.Machines })));
const Nodes = lazy(() => import("./NodesPage.jsx").then(module => ({ default: module.Nodes })));
const Subscriptions = lazy(() => import("./SubscriptionsPage.jsx").then(module => ({ default: module.Subscriptions })));
const Sources = lazy(() => import("./SourcesPage.jsx").then(module => ({ default: module.Sources })));
const Providers = lazy(() => import("./ProvidersPage.jsx").then(module => ({ default: module.Providers })));
const ManagedNowhereDeploy = lazy(() => import("./DeployPage.jsx").then(module => ({ default: module.ManagedNowhereDeploy })));
const SettingsDialog = lazy(() => import("./SettingsDialog.jsx").then(module => ({ default: module.SettingsDialog })));
const ExistingServiceDiscoveryDialog = lazy(() => import("./DiscoveryDialog.jsx").then(module => ({ default: module.ExistingServiceDiscoveryDialog })));

function PageLoading() {
  return <div className="empty" role="status" aria-live="polite"><span className="spinner" />正在加载页面…</div>;
}
class PageBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="empty" role="alert"><p>页面加载失败，请检查网络后重新加载。</p><button className="button secondary" onClick={() => window.location.reload()}>重新加载页面</button></div>;
    return this.props.children;
  }
}

const NAV = [
  ["overview", "服务器", CircleGauge],
  ["nodes", "节点", Network],
  ["subscriptions", "订阅", Link2],
  ["sources", "订阅源", CloudDownload],
  ["deploy", "部署节点", Upload],
  ["providers", "外部面板", Database],
];

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
    return createVisiblePoller(() => refreshMetrics(false), { interval: 3000, immediate: false });
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
      if (serviceBusyRef.current || (!manual && (document.hidden || (!targetClientId && document.querySelector("dialog[open]"))))) return;
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
    if (tab !== "overview" || loading || !me || me.two_factor_enabled) return undefined;
    return createVisiblePoller(() => refreshServices(false), { interval: 15000 });
  }, [tab, loading, me?.two_factor_enabled, refreshServices]);
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
        <PageBoundary key={tab}><Suspense fallback={<PageLoading />}><div className="route-view">
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
        </div></Suspense></PageBoundary>
      </main>
      {settingsOpen && <PageBoundary><Suspense fallback={<PageLoading />}><SettingsDialog
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
      /></Suspense></PageBoundary>}
      {discoveryMachine && <PageBoundary><Suspense fallback={<PageLoading />}><ExistingServiceDiscoveryDialog machine={discoveryMachine} state={state} clients={clients} persist={persist} notify={notify} me={me} onClose={() => setDiscoveryMachine(null)} /></Suspense></PageBoundary>}
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.error ? <X size={16} /> : <Check size={16} />}
          {toast.message}
        </div>
      )}
    </div>
  );
}

export { NAV, readServiceCache, systemPrefersDark, useThemeSync, StationMark, withTelemetryRate };
