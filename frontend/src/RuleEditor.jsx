import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { randomId } from "./lib.js";

export default function RuleEditor({ rules, policyMode, onChange, onPreview }) {
  const [preview, setPreview] = useState(null);
  const [format, setFormat] = useState("mihomo");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusId, setFocusId] = useState("");
  const revision = useRef(0);
  const root = useRef(null);
  useEffect(() => { revision.current += 1; setPreview(null); setError(""); setLoading(false); }, [rules, policyMode]);
  useEffect(() => {
    if (!focusId) return;
    const input = root.current?.querySelector(`[data-rule-id="${focusId}"] input`);
    input?.focus(); input?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusId]);
  const change = (id, patch) => onChange({ customRules: rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule) });
  const move = (index, offset) => { const next = [...rules]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange({ customRules: next }); };
  const check = async () => {
    const request = ++revision.current; setLoading(true); setError("");
    try { const result = await onPreview({ policyMode, customRules: rules }); if (request === revision.current) setPreview(result); }
    catch (failure) { if (request === revision.current) setError(failure.message); }
    finally { if (request === revision.current) setLoading(false); }
  };
  return <div className="rule-editor" ref={root}>
    <div className="rule-base">
      <label><span>基础模板</span><select value={policyMode} onChange={(event) => onChange({ policyMode: event.target.value })}>
        <option value="proxy-all">全部走代理</option><option value="private-direct">局域网直连</option><option value="cn-direct">中国大陆直连</option>
      </select></label>
      <p>按顺序先匹配自定义规则，再应用基础模板，未匹配的请求走默认代理组。{policyMode === "cn-direct" && "中国大陆直连目前仅适用于 Mihomo / Surge；sing-box 不自动下载地理规则库。"}</p>
    </div>
    <div className="rule-heading"><div><strong>自定义规则</strong><span>{rules.length}/200 条 · 越靠上优先级越高</span></div>
      <button type="button" className="button" disabled={rules.length >= 200} onClick={() => { const id = randomId(); onChange({ customRules: [...rules, { id, type: "domain-suffix", value: "", action: "proxy" }] }); setFocusId(id); }}><Plus size={16} />添加规则</button>
    </div>
    {!rules.length && <p className="rule-empty">没有自定义规则，直接使用基础模板。可添加某个域名走代理、某段 IP 直连，或拒绝指定关键词。</p>}
    <div className="rule-rows">
      {rules.map((rule, index) => <div className="rule-row" key={rule.id} data-rule-id={rule.id}>
        <span className="rule-number">{index + 1}</span>
        <label><span>匹配条件</span><select value={rule.type} onChange={(event) => change(rule.id, { type: event.target.value })}><option value="domain-suffix">域名及子域名</option><option value="domain-keyword">域名关键词</option><option value="ip-cidr">IP 网段</option></select></label>
        <label className="rule-match"><span>匹配值</span><input value={rule.value} onChange={(event) => change(rule.id, { value: event.target.value })} placeholder={rule.type === "ip-cidr" ? "192.168.0.0/16 或 fc00::/7" : rule.type === "domain-keyword" ? "例如 ads（包含即匹配）" : "example.com（不含 https://）"} /></label>
        <label><span>动作</span><select value={rule.action} onChange={(event) => change(rule.id, { action: event.target.value })}><option value="proxy">代理</option><option value="direct">直连</option><option value="reject">拒绝</option></select></label>
        <div className="rule-actions"><button type="button" className="icon-button" aria-label={`上移第 ${index + 1} 条规则`} disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp size={16} /></button><button type="button" className="icon-button" aria-label={`下移第 ${index + 1} 条规则`} disabled={index === rules.length - 1} onClick={() => move(index, 1)}><ChevronDown size={16} /></button><button type="button" className="icon-button" aria-label={`删除第 ${index + 1} 条规则`} onClick={() => onChange({ customRules: rules.filter((item) => item.id !== rule.id) })}><Trash2 size={16} /></button></div>
      </div>)}
    </div>
    <div className="rule-preview-head"><button type="button" className="button" disabled={loading} onClick={check}>{loading ? "检查中…" : "检查并预览规则"}</button><span>预览当前规则在各客户端中的输出结果。</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {preview && <div className="rule-preview"><div className="editor-tabs" role="tablist" aria-label="规则预览格式">{preview.formats.map((item) => <button type="button" key={item.format} role="tab" aria-selected={format === item.format} onClick={() => setFormat(item.format)}>{item.format}</button>)}</div><pre>{preview.formats.find((item) => item.format === format)?.content}</pre><p>“默认代理组”在实际输出时替换为第一个可用代理组。IP 规则不主动触发 DNS 查询；Anywhere 不输出这些规则。</p></div>}
  </div>;
}
