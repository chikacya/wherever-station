import { useEffect, useRef, useState } from "react";
import { createVisiblePoller } from "./polling.js";
import { QRCodeSVG } from "qrcode.react";
import { Activity, Check, Clipboard, Copy, Database, Download, Edit3, Import, Link2, PackageOpen, Play, Plus, Power, QrCode, RefreshCw, RotateCw, Save, Search, Settings, ShieldCheck, KeyRound, CalendarClock, Square, Trash2, Undo2, Upload, X } from "lucide-react";
import { bytes, flag, generateRealityKeypair, normalizeNowhereReleases, normalizeSingBoxReleases, nowhereKeyNeedsUpdate, nowhereVersionCapabilities, NOWHERE_RELEASE_FALLBACK, SING_BOX_RELEASE_FALLBACK, preferredPublicHost, randomId } from "./lib.js";
import { IconButton, Button, Field, Modal, Empty, rpc, readSessionDraft, writeSessionDraft, clearSessionDraft, Status, DraftStatus, SecretInput, PageHead, MANAGED_ERROR, NOWHERE_LIFECYCLE, telemetryTotal, duration, TelemetryTrend, TelemetrySparkline, TelemetryRefreshControl, executeTrackedManagedTask, executeTask } from './ui-shared.jsx';

const MANAGED_STATUS = {
  draft: ["待创建", "warning"],
  validated: ["检查通过", "warning"],
  stopped: ["已停止", ""],
  running: ["运行中", "ok"],
  failed: ["需处理", "bad"],
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
  "NOWHERE_DIAL_VALUE", "NOWHERE_DIAL4_VALUE", "NOWHERE_DIAL6_VALUE", "NOWHERE_SOCKS_VALUE", "NOWHERE_LOG_VALUE", "NOWHERE_TELEMETRY_INTERVAL_VALUE",
  "NOWHERE_VECTOR_SOCKS_VALUE", "NOWHERE_VECTOR_SNI_VALUE", "NOWHERE_VECTOR_PIN_VALUE", "NOWHERE_VECTOR_MUX_VALUE",
  "NOWHERE_TCP_PORT_VALUE", "NOWHERE_UDP_PORT_VALUE", "NOWHERE_TCP_CARRIER_VALUE", "NOWHERE_UDP_CARRIER_VALUE",
  "NOWHERE_MORPH_VALUE", "NOWHERE_TRANSPORT_MEMORY_PROFILE_VALUE", "NOWHERE_CERTIFICATE_MODE_VALUE",
  "NOWHERE_CERTIFICATE_HOST_VALUE", "NOWHERE_CERTIFICATE_DAYS_VALUE", "NOW_TELEMETRY_INTERVAL", "NOW_TRANSPORT_MEMORY_PROFILE",
]);

function NowhereExtensionEditor({ value, onChange, capabilities }) {
  const [keyName, setKeyName] = useState("");
  const [settingValue, setSettingValue] = useState("");
  const [error, setError] = useState("");
  const entries = Object.entries(value || {});
  const add = () => {
    const key = keyName.trim().toUpperCase();
    if (!/^NOW(?:HERE)?_[A-Z0-9_]{1,80}$/.test(key)) return setError("名称必须以 NOW_ 或 NOWHERE_ 开头，并只包含大写字母、数字和下划线");
    if (NOWHERE_RESERVED_EXTENSION_KEYS.has(key)) return setError("该名称已由标准配置项管理，请使用上方对应字段");
    if (!capabilities.eventLog && key === "NOW_REPORT_INTERVAL") return setError("Nowhere 2.1.1 已移除此参数");
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
    <Field label="拨号地址" hint={capabilities.dualStackDial ? "按地址族绑定时，此项保持 auto；生成配置会省略 dial" : "auto 或本机 IP"}><input value={values.dial || "auto"} onChange={(event) => update("dial", event.target.value)} /></Field>
    {capabilities.dualStackDial && <>
      <Field label="IPv4 出站源地址" hint="留空由系统选择"><input value={values.dial4 || ""} onChange={(event) => update("dial4", event.target.value)} /></Field>
      <Field label="IPv6 出站源地址" hint="留空由系统选择"><input value={values.dial6 || ""} onChange={(event) => update("dial6", event.target.value)} /></Field>
    </>}
    <Field label="SOCKS"><input value={values.socks || "none"} onChange={(event) => update("socks", event.target.value)} /></Field>
    <Field label="日志级别"><select value={values.log || "info"} onChange={(event) => update("log", event.target.value)}>{["none", "debug", "info", "warn", "error", ...(capabilities.eventLog ? ["event"] : [])].map((option) => <option key={option}>{option}</option>)}</select></Field>
    <Field label="遥测间隔" hint="允许 250ms–60s"><input value={values.telemetryInterval || "1s"} onChange={(event) => update("telemetryInterval", event.target.value)} placeholder="例如 1s" /></Field>
    <Field label="Vector SOCKS"><input value={values.vectorSocks || "127.0.0.1:1080"} onChange={(event) => update("vectorSocks", event.target.value)} /></Field>
    <Field label="Vector SNI"><input value={values.vectorSni || "none"} onChange={(event) => update("vectorSni", event.target.value)} /></Field>
    {capabilities.vectorPin && <Field label="Vector Pin" hint="原生客户端校验证书；自签证书须填写实际 SHA256。Anywhere 导入不支持此参数"><input value={values.vectorPin || "none"} onChange={(event) => update("vectorPin", event.target.value)} /></Field>}
    {capabilities.vectorMux && <Field label="Vector Mux"><select value={values.vectorMux || 0} onChange={(event) => update("vectorMux", Number(event.target.value))}><option value={0}>关闭</option><option value={1}>开启</option></select></Field>}
    {capabilities.morph && <Field label="Morph" hint={values.morph === 1 && capabilities.morphTcpPrelude ? "2.1 传输格式；所有同路径客户端与下一跳必须使用兼容版本" : "两端必须一致；跨 Morph 传输格式升级需要协同进行"}><select value={values.morph || 0} onChange={(event) => update("morph", Number(event.target.value))}><option value={0}>关闭</option><option value={1}>开启（两端必须一致）</option></select></Field>}
    {capabilities.transportMemoryProfile && <Field label="Transport 内存策略"><select value={values.transportMemoryProfile || "throughput"} onChange={(event) => update("transportMemoryProfile", event.target.value)}><option value="memory">节省内存</option><option value="balanced">平衡</option><option value="throughput">吞吐优先</option></select></Field>}
    <details className="nowhere-experimental">
      <summary>实验性环境变量{Object.keys(values.extensionEnvironment || {}).length ? ` · ${Object.keys(values.extensionEnvironment).length}` : ""}</summary>
      <p>仅在 Nowhere 官方文档明确要求时使用。这里会原样保留尚未进入标准表单的环境变量；普通部署无需填写。</p>
      <NowhereExtensionEditor value={values.extensionEnvironment} capabilities={capabilities} onChange={(next) => update("extensionEnvironment", next)} />
    </details>
  </>;
}

function ManagedNowhereDeploy({ state, setState, clients, me, notify, persist, onNavigate, onDiscover }) {
  const [liveStates, setLiveStates] = useState([]);
  const [telemetryDetail, setTelemetryDetail] = useState("");
  const [telemetryHistory, setTelemetryHistory] = useState({});
  const [telemetrySampleMs, setTelemetrySampleMs] = useState(3000);
  const [discoveryPicker, setDiscoveryPicker] = useState(false);
  const telemetryQueryingRef = useRef(false);
  const statusTargets = state.managedInstances.map(item => `${item.machineId}:${item.id}`).sort().join('|');
  const statusRevision = state.managedInstances.map(item => item.lastOperationId || '').join('|');
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.hidden || telemetryQueryingRef.current) return;
      telemetryQueryingRef.current = true;
      try {
        const cached = await rpc('proxyConsole:listInstanceStates');
        if (!cancelled) setLiveStates(cached);
        if (cancelled || document.hidden || me?.two_factor_enabled) return;
        const allMachineIds = [...new Set(statusTargets.split('|').filter(Boolean).map(value => value.split(':')[0]))];
        const focusedMachineId = telemetryDetail ? state.managedInstances.find((item) => item.id === telemetryDetail)?.machineId : "";
        const machineIds = focusedMachineId ? [focusedMachineId] : allMachineIds;
        const samples = await Promise.all(machineIds.map(async (machineId) => {
          if (cancelled) return null;
          try {
            const spec = await rpc('proxyConsole:prepareInstanceStates', { machineId });
            if (cancelled || document.hidden) return null;
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
      finally { telemetryQueryingRef.current = false; }
    };
    const interval = telemetryDetail ? telemetrySampleMs : 8000;
    const stop = createVisiblePoller(refresh, { interval });
    return () => { cancelled = true; stop(); };
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
    const stop = createVisiblePoller(refresh, { interval: 5000 });
    return () => { cancelled = true; stop(); };
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
    if (nowhereKeyNeedsUpdate(state.nodes.find(node => node.id === instance.nodeId)?.uri, targetVersion)) {
      return notify("请先更新共享密钥，再同步客户端订阅后升级", true);
    }
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
  const editNowhere = async (instance, upgradeTarget = "") => {
    const busyKey = `read:${instance.id}`;
    if ([...busy].some(key => key.split(":").includes(instance.id))) return;
    const otp = operationOtp(); if (otp === null) return;
    beginBusy(busyKey); setConfigError("");
    try {
      const spec = await rpc("proxyConsole:prepareManagedNowhereAction", { instanceId: instance.id, action: "read-config", requestId: crypto.randomUUID() });
      const saved = await executeTrackedManagedTask(spec, otp);
      if (!saved.result.ok) throw new Error(saved.result.error || "读取配置失败");
      if (upgradeTarget) setNowhereManager(null);
      setConfigEdit({ instanceId: instance.id, name: instance.name, upgradeTarget, originalKey: saved.result.configuration.key, readOperationId: spec.operationId, values: { ...saved.result.configuration, name: instance.name, machineId: instance.machineId, certificateAssetId: instance.certificateId || "" } });
    } catch (error) { notify(error.message, true); }
    finally { endBusy(busyKey); }
  };
  const generateNowhereKey = async () => {
    if (!configEdit) return;
    const instanceId = configEdit.instanceId;
    const busyKey = `key:${instanceId}`;
    if (hasBusy(busyKey)) return;
    beginBusy(busyKey);
    try {
      const defaults = await rpc("proxyConsole:newManagedNowhereValues");
      setConfigEdit(current => current?.instanceId === instanceId ? { ...current, values: { ...current.values, key: defaults.key } } : current);
      setConfigError("");
    } catch (error) { setConfigError(error.message); }
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
      const updatedKey = configEdit.values.key !== configEdit.originalKey;
      const upgradeTarget = configEdit.upgradeTarget;
      setConfigEdit(null);
      if (upgradeTarget) {
        const instance = saved.state.managedInstances.find(item => item.id === configEdit.instanceId);
        setNowhereManager({ instance, loading: false, result: saved.result, targetVersion: upgradeTarget });
      }
      notify(updatedKey ? "密钥已更新，旧链接已失效；请在所有客户端更新订阅，并同步下一跳后再升级" : "配置已保存，订阅链接已同步；请在客户端更新订阅");
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
      if (instance.kind === "nowhere" && nowhereVersionCapabilities(instance.version).strictSharedKey) {
        const status = await rpc("proxyConsole:prepareManagedNowhereAction", { instanceId: instance.id, action: "status", requestId: crypto.randomUUID() });
        const refreshed = await executeTrackedManagedTask(status, otp);
        setState(refreshed.state);
        if (!refreshed.result.ok) throw new Error(MANAGED_ERROR[refreshed.result.error] || refreshed.result.error || "读取证书指纹失败");
      }
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
  const nowhereSaving = Boolean(configEdit && (hasBusy(`update:${configEdit.instanceId}`) || hasBusy(`key:${configEdit.instanceId}`)));
  const singSaving = Boolean(singConfigEdit && hasBusy(`update:${singConfigEdit.instanceId}`));
  const formCapabilities = nowhereVersionCapabilities(form.version);
  const configCapabilities = nowhereVersionCapabilities(configEdit?.values?.version || "");
  const managerCurrentCapabilities = nowhereVersionCapabilities(nowhereManager?.instance?.version);
  const managerTargetCapabilities = nowhereVersionCapabilities(nowhereManager?.targetVersion);
  const managerKeyNeedsUpdate = nowhereKeyNeedsUpdate(state.nodes.find(node => node.id === nowhereManager?.instance?.nodeId)?.uri, nowhereManager?.targetVersion);
  const nowhereV2Releases = nowhereReleases.releases.filter((release) => nowhereVersionCapabilities(release.tag).verified);
  const nowhereUnverifiedReleases = nowhereReleases.releases.filter((release) => release.tag !== "v2.2.0" && !nowhereVersionCapabilities(release.tag).verified);
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
        {managerKeyNeedsUpdate && <div className="managed-strip"><KeyRound size={16} /><div><strong>升级前需要更新共享密钥</strong><p>当前密钥不符合 2.2.1 的 32–64 字符小写十六进制要求。先生成并保存新密钥，再在所有客户端更新订阅，并同步下一跳。</p><Button icon={KeyRound} onClick={() => editNowhere(nowhereManager.instance, nowhereManager.targetVersion)}>更新密钥</Button></div></div>}
        <div className="nowhere-upgrade-row">
          <span className="control-label">目标版本</span>
          <select aria-label="目标版本" value={nowhereManager.targetVersion || nowhereManager.instance.version} onChange={(event) => setNowhereManager((current) => ({ ...current, targetVersion: event.target.value }))}>{!managerCurrentCapabilities.verified && <option value={nowhereManager.instance.version}>{nowhereManager.instance.version} · 当前未验证</option>}{!!nowhereV2Releases.length && <optgroup label="已验证">{nowhereV2Releases.map((release, index) => <option key={release.tag} value={release.tag}>{release.tag}{index === 0 ? " · 最新" : ""}</option>)}</optgroup>}{!!nowhereUnverifiedReleases.length && <optgroup label="发现但尚未适配">{nowhereUnverifiedReleases.map((release) => <option key={release.tag} value={release.tag} disabled>{release.tag} · 只读</option>)}</optgroup>}</select>
          <Button icon={RefreshCw} onClick={() => loadNowhereReleases(true)} disabled={nowhereReleases.loading}>{nowhereReleases.loading ? "获取中" : "刷新列表"}</Button>
          <Button icon={Upload} variant="primary" onClick={upgradeNowhere} disabled={managerKeyNeedsUpdate || (!managerCurrentCapabilities.verified && managerCurrentCapabilities.version !== "v2.2.0") || !managerTargetCapabilities.verified || !nowhereManager.targetVersion || nowhereManager.targetVersion === nowhereManager.instance.version}>切换此实例</Button>
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
        <Field label="共享密钥" hint="2.2.1 接受 32–64 字符小写 hex，已有合规密钥无需更换；更换后同步所有客户端与下一跳"><SecretInput value={configEdit.values.key || ""} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, key: event.target.value } }))} /></Field>
        <div><Button icon={KeyRound} onClick={generateNowhereKey} disabled={nowhereSaving}>生成 32 位密钥</Button><p>生成仅修改当前表单；保存后才会应用到实例。</p></div>
        <NowhereCarrierFields values={configEdit.values} onPatch={(patch) => setConfigEdit(old => ({ ...old, values: { ...old.values, ...patch } }))} />
        <Field label="TLS 与证书"><select value={certificateSelection(configEdit.values, "ephemeral")} onChange={event => selectCertificate((updater) => setConfigEdit((old) => ({ ...old, values: updater(old.values) })), event.target.value, "nowhere")}><option value="ephemeral">临时自签</option><option value="managed">为此实例生成稳定自签</option><option value="existing">手动填写已有 PEM</option>{!!usableCertificates(configEdit.values.machineId).length && <optgroup label="证书工作台">{certificateAssetOptions(configEdit.values.machineId)}</optgroup>}</select></Field>
        {!configEdit.values.certificateAssetId && configEdit.values.certificateMode === "managed" && <><Field label="证书名称"><input value={configEdit.values.certificateHost || configEdit.values.publicHost || ""} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, certificateHost: event.target.value } }))} /></Field><Field label="有效天数"><input type="number" min="1" max="3650" value={configEdit.values.certificateDays || 825} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, certificateDays: Number(event.target.value) } }))} /></Field></>}
        {!configEdit.values.certificateAssetId && configEdit.values.certificateMode === "existing" && <><Field label="证书链路径"><input value={configEdit.values.certificatePath || ""} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, certificatePath: event.target.value } }))} /></Field><Field label="私钥路径"><input value={configEdit.values.privateKeyPath || ""} onChange={event => setConfigEdit(old => ({ ...old, values: { ...old.values, privateKeyPath: event.target.value } }))} /></Field></>}
      </div>}
      {configEdit && <details className="deploy-advanced"><summary>高级运行参数</summary><div className="form-grid"><NowhereAdvancedFields values={configEdit.values} capabilities={configCapabilities} onPatch={(patch) => setConfigEdit(old => ({ ...old, values: { ...old.values, ...patch } }))} /></div></details>}
      {configEdit && configEdit.values.key !== configEdit.originalKey && <p role="alert" className="managed-error">共享密钥已修改。保存后旧客户端链接将失效，请在所有客户端更新订阅，并同步下一跳配置。</p>}
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
        <Field label="共享密钥" hint="2.2.1 接受 32–64 字符小写十六进制；更换后须同步客户端" wide><SecretInput autoComplete="new-password" value={form.key || ""} onChange={(event) => update("key", event.target.value)} /></Field>
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

export { MANAGED_STATUS, DEPLOY_PROTOCOL_LABELS, PresetManager, NowhereCarrierFields, NOWHERE_RESERVED_EXTENSION_KEYS, NowhereExtensionEditor, NowhereAdvancedFields, ManagedNowhereDeploy, parseManagedNowhereOutput, parseManagedSingBoxOutput };
