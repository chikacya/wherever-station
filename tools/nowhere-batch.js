const { requiresPreludeConfirmation } = require('./nowhere-upgrade-policy');
const { compatibilityCatalog, nowhereCapabilities, compareNowhereVersions } = require('./nowhere-capabilities');

function nowhereBatchVersions() {
  return compatibilityCatalog().adapters.filter(adapter=>adapter.generation===3)
    .flatMap(adapter=>adapter.verifiedVersions.map(version=>({version,prerelease:(adapter.previewVersions||[]).includes(version)})))
    .sort((a,b)=>compareNowhereVersions(b.version,a.version)).slice(0,2);
}
function resolveNowhereBatchVersion(value) {
  const versions=nowhereBatchVersions();
  const version=value || versions.find(item=>!item.prerelease)?.version || '';
  if(!version)throw new Error('请手动选择预发布目标版本');
  if(!versions.some(item=>item.version===version))throw new Error('批量更新仅支持最新两个已适配的 NW3 版本');
  return version;
}
function planNowhereBatch(state, tasks = [], preludeClientsReady = false, selectedVersion) {
  const selected=resolveNowhereBatchVersion(selectedVersion);
  return state.managedInstances.filter(instance => instance.kind === 'nowhere').map(instance => {
    const capabilities = nowhereCapabilities(instance.version);
    const generation = capabilities.protocolGeneration;
    const targetVersion = generation===3 ? selected : '';
    const machine = state.machines.find(item => item.id === instance.machineId);
    let reason = '';
    if (['draft', 'validated'].includes(instance.status)) reason = '尚未部署';
    else if (!machine?.monitorClientId) reason = '宿主未绑定 Agent';
    else if (!targetVersion) reason = '没有已验证的同代际目标';
    else if (capabilities.version === targetVersion) reason = '已经是目标版本';
    else if (compareNowhereVersions(instance.version, targetVersion) > 0) reason = '当前版本更高，批量更新不降级';
    else if (requiresPreludeConfirmation(instance, targetVersion) && !preludeClientsReady) reason = '需要确认 Morph TCP 客户端支持认证 Prelude（原生 Vector ≥3.1.0）';
    else if (instance.adoptionState === 'staged') reason = '尚未切换接管';
    else if (tasks.some(task => task.instanceId === instance.id && !['completed', 'rejected'].includes(task.phase))) reason = '已有任务待完成或核对';
    return { instanceId: instance.id, name: instance.name, machineName: machine?.name || '未知宿主', currentVersion: instance.version,
      targetVersion, phase: reason ? 'skipped' : 'queued', reason };
  });
}

function summarizeNowhereBatch(batch, lookup, now = Date.now()) {
  const terminal = new Set(['success', 'failed', 'skipped', 'needs-review']);
  const rows = batch.rows.map(row => {
    if (!row.operationId) return row.phase === 'queued' && now - Date.parse(batch.createdAt) > 120000 ? { ...row, phase: 'needs-review', reason: '批次准备未完成，请核对后重新检查清单' } : { ...row };
    let task;
    try { task = lookup(row.operationId); } catch (_) { return { ...row, phase: 'needs-review', reason: '任务记录不可用，请核对实例状态' }; }
    if (task.phase === 'completed') return { ...row, phase: task.result?.ok ? 'success' : 'failed', reason: task.result?.ok ? '更新完成' : task.result?.error || '更新失败', rolledBack: task.result?.rolledBack === true };
    if (['rejected', 'needs-review'].includes(task.phase) || batch.expiresAt <= now || (task.phase === 'prepared' && now - Date.parse(batch.createdAt) > 120000)) return { ...row, phase: 'needs-review', reason: task.error || '结果未确认，请核对实例状态' };
    return { ...row, phase: task.phase === 'prepared' ? 'prepared' : 'running', reason: task.error || row.submissionError || (task.phase === 'prepared' ? '等待提交' : '下载、校验并更新中') };
  });
  const counts = { total: rows.length, completed: rows.filter(row => terminal.has(row.phase)).length };
  for (const phase of ['success', 'failed', 'skipped', 'needs-review']) counts[phase] = rows.filter(row => row.phase === phase).length;
  return { id: batch.id, targetVersion:batch.targetVersion || batch.rows.find(row=>row.targetVersion)?.targetVersion || '', createdAt: batch.createdAt, rows, counts, done: counts.completed === counts.total };
}
module.exports = { planNowhereBatch, summarizeNowhereBatch, nowhereBatchVersions, resolveNowhereBatchVersion };
