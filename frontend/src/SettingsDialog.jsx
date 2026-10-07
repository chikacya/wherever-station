import { useEffect, useState } from "react";
import { Copy, Download, Save, Moon, Sun, Monitor, Upload } from "lucide-react";
import { rpc, readSessionDraft, writeSessionDraft, clearSessionDraft, Button, DraftStatus, Field, Modal } from './ui-shared.jsx';

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

export { SettingsDialog };
