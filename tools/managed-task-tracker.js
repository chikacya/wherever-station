const crypto = require('crypto');
const { Buffer } = require('buffer');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

// Execution stays in Komari's authenticated admin:exec transport. This module
// only verifies and observes an already submitted task; it never executes it.
function managedTaskTracker({ store, call, complete, now = Date.now }) {
  const active = new Set();
  const publicTask = (task, includeConfiguration = false) => ({
    operationId: task.operationId, instanceId: task.instanceId, kind: task.kind,
    action: task.action, phase: task.phase, submittedAt: task.submittedAt || '',
    updatedAt: task.updatedAt, error: task.error || '', result: task.action === 'read-config' && !includeConfiguration ? null : task.result || null,
  });
  const observe = id => {
    const task = store.get(id);
    if (!task || task.expiresAt <= now() || active.has(id) || ['completed', 'rejected', 'needs-review'].includes(task.phase)) return;
    active.add(id);
    Promise.resolve().then(() => {
      if (task.remoteTaskId) return;
      // Recover a browser closed between native submission and bind. The unique
      // operation comment prevents matching an older identical status command.
      return call('admin:getTasksByClientId', { uuid: task.clientId }).then(rows => {
        const matches = (Array.isArray(rows) ? rows : []).filter(row => hash(String(row.command || '')) === task.commandHash);
        if (matches.length > 1) { task.phase = 'needs-review'; task.error = '同一操作发现多个远端任务，请核对实例状态'; return; }
        if (matches.length === 1) { task.remoteTaskId = matches[0].task_id; task.submittedAt = new Date(now()).toISOString(); store.set(id, task); }
      });
    }).then(() => task.remoteTaskId ? call('admin:getTaskById', { task_id: task.remoteTaskId }) : null).then(remote => {
      if (!remote) return;
      if (hash(String(remote.command || '')) !== task.commandHash || !Array.isArray(remote.clients) || remote.clients.length !== 1 || remote.clients[0] !== task.clientId) {
        task.phase = 'rejected'; task.error = '远端任务与本次操作不匹配';
        return;
      }
      return call('admin:getSpecificTaskResult', { task_id: task.remoteTaskId, uuid: task.clientId });
    }).then(output => {
      if (!output) return;
      if (output.exit_code === null || output.exit_code === undefined) { task.phase = 'running'; return; }
      const prefix = task.kind === 'nowhere' ? 'PCNOWHERE\t2\t' : task.kind === 'certificate' ? 'PCCERT\t1\t' : 'PCSINGBOX\t1\t';
      const line = String(output.result || '').split(/\r?\n/).find(item => item.startsWith(prefix));
      let result;
      try { result = line && JSON.parse(Buffer.from(line.slice(prefix.length), 'base64').toString('utf8')); } catch (_) {}
      if (!result || typeof result.ok !== 'boolean') {
        task.phase = 'needs-review'; task.error = '远端任务已结束，但没有可识别的结果；请核对实例状态';
        return;
      }
      const saved = complete(task.kind, id, result);
      // Only normalized results are retained; no shell output or config secrets.
      task.result = saved.result; task.phase = 'completed'; task.error = '';
    }).catch(() => {
      if (task.remoteTaskId) { task.phase = 'pending'; task.error = '等待 Komari 返回任务结果'; }
    }).finally(() => {
      task.updatedAt = new Date(now()).toISOString(); store.set(id, task); active.delete(id);
    });
  };
  return {
    prepare(kind, spec) {
      spec.command += '\n# wherever-operation:' + spec.operationId;
      const commandHash = hash(spec.command);
      const existing = store.get(spec.operationId);
      if (existing) {
        if (existing.kind !== kind || existing.instanceId !== spec.instanceId || existing.clientId !== spec.clientId || existing.action !== spec.action || existing.commandHash !== commandHash) {
          throw new Error('requestId 已用于其他操作');
        }
        observe(spec.operationId);
        return { ...spec, command: '', deduplicated: true, task: publicTask(existing) };
      }
      store.set(spec.operationId, {
        operationId: spec.operationId, kind, instanceId: spec.instanceId,
        clientId: spec.clientId, action: spec.action, commandHash,
        phase: 'prepared', updatedAt: new Date(now()).toISOString(), expiresAt: now() + 86400000,
      });
      return { ...spec, deduplicated: false };
    },
    bind({ operationId, taskId }) {
      const task = store.get(operationId);
      if (!task || task.expiresAt <= now()) throw new Error('操作记录已过期');
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(taskId || ''))) throw new Error('任务编号无效');
      if (task.remoteTaskId && task.remoteTaskId !== taskId) throw new Error('该操作已经关联其他任务，不能重复提交');
      task.remoteTaskId = taskId; task.phase = task.phase === 'completed' ? 'completed' : 'pending';
      task.submittedAt = task.submittedAt || new Date(now()).toISOString(); store.set(operationId, task);
      observe(operationId); return publicTask(task);
    },
    get(id) { const task = store.get(id); if (!task) throw new Error('任务不存在'); observe(id); return publicTask(task, true); },
    list() { return [...store].filter(([, task]) => task.expiresAt > now()).map(([id, task]) => { observe(id); return publicTask(task); }); },
    resume() { for (const [id] of store) observe(id); },
  };
}
module.exports = { managedTaskTracker };
