import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { QRCodeSVG } from "qrcode.react";
import { Activity, Check, ChevronDown, Copy, Edit3, Import, ListFilter, QrCode, Save, Search, Trash2 } from "lucide-react";
import { buildRepairUri, flag, hostFromUri, inferNodeCountryCode, NAME_TEMPLATES, randomId, splitTags, templateNodeNames } from "./lib.js";
import { rpc, IconButton, Button, Status, Field, SecretInput, Modal, Empty, PageHead, MANAGED_ERROR, executeTask, readSessionDraft, writeSessionDraft, clearSessionDraft, DraftStatus } from './ui-shared.jsx';

function Nodes({ state, setState, persist, notify, parseUris, clients, me }) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [country, setCountry] = useState("");
  const [protocol, setProtocol] = useState("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState("name-asc");
  const [selected, setSelected] = useState({});
  const [listRevision, setListRevision] = useState(0);
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
          (!source || (source === "local" ? ["manual", "import"].includes(node.source) : node.source === source))
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
      setListRevision((value) => value + 1);
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
            {row.original.providerMissing ? "远端已不存在" : ({ manual: "本地", import: "本地", external: "订阅源", provider: "外部面板" }[
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
    setSelected({});
    setListRevision((value) => value + 1);
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
        <Button
          icon={Import}
          variant="primary"
          onClick={() => setImporting(true)}
        >
          导入节点
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
            ["local", "本地导入"],
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
          <tbody key={listRevision} className={listRevision ? "bulk-refreshed" : ""}>
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
          setSelected({});
          setListRevision((value) => value + 1);
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

export { Nodes, Filter, NodeEditor, ImportDialog, BatchDialog };
