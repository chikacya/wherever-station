function instanceStatusCache(now = Date.now) {
  const hosts = new Map();
  const numericTelemetry = ['sequence', 'timestampMs', 'uptimeMs', 'tcpLogicalUp', 'tcpLogicalDown', 'udpLogicalUp', 'udpLogicalDown', 'tlsWireUp', 'tlsWireDown', 'quicWireUp', 'quicWireDown', 'tcpActive', 'udpActive', 'tlsCarriersActive', 'quicCarriersActive', 'pingMs', 'cpuPercent', 'cpuUsageNs', 'rssBytes', 'openFds'];
  function telemetry(value, prior, observedAt, pid) {
    if (!value || !['ipc', 'checkpoint', 'unavailable', 'systemd'].includes(value.source)) return undefined;
    const clean = { source: value.source };
    for (const key of numericTelemetry) if (Number.isFinite(value[key]) && value[key] >= 0) clean[key] = Number(value[key]);
    if (['STARTING', 'READY', 'DRAINING', 'STOPPED'].includes(value.lifecycle)) clean.lifecycle = value.lifecycle;
    if (/^[A-Z0-9_-]{1,32}$/.test(value.lifecycleReason || '')) clean.lifecycleReason = value.lifecycleReason;
    const previous = prior?.telemetry;
    const elapsed = (Date.parse(observedAt) - Date.parse(prior?.observedAt || '')) / 1000;
    const total = item => Number(item?.tcpLogicalUp || 0) + Number(item?.udpLogicalUp || 0);
    const totalDown = item => Number(item?.tcpLogicalDown || 0) + Number(item?.udpLogicalDown || 0);
    const up = total(clean); const down = totalDown(clean); const oldUp = total(previous); const oldDown = totalDown(previous);
    if (clean.source === 'systemd' && pid > 0 && pid === prior?.pid && elapsed > 0 && elapsed <= 30 && previous && clean.cpuUsageNs >= previous.cpuUsageNs) {
      clean.cpuPercent = (clean.cpuUsageNs - previous.cpuUsageNs) / (elapsed * 1e7);
    }
    if (pid > 0 && pid === prior?.pid && elapsed > 0 && elapsed <= 30 && previous && up >= oldUp && down >= oldDown) {
      clean.upBytesPerSecond = Math.round((up - oldUp) / elapsed);
      clean.downBytesPerSecond = Math.round((down - oldDown) / elapsed);
    }
    return clean;
  }
  return {
    record(machineId, allowedIds, states) {
      if (!Array.isArray(states)) throw new Error('Invalid status response');
      const allowed = new Set(allowedIds);
      const previous = hosts.get(machineId) || new Map();
      for (const row of states) {
        if (!allowed.has(row.instanceId)) continue;
        const time = Date.parse(row.observedAt);
        if (!Number.isFinite(time) || time > now() + 60000) continue;
        if (Date.parse(previous.get(row.instanceId)?.observedAt || '') > time) continue;
        const prior = previous.get(row.instanceId);
        const pid = Number.isSafeInteger(row.pid) && row.pid >= 0 ? row.pid : 0;
        previous.set(row.instanceId, {
          instanceId: row.instanceId, observedAt: new Date(time).toISOString(),
          state: ['active', 'inactive', 'failed', 'activating', 'deactivating'].includes(row.state) ? row.state : 'unknown',
          loaded: row.loaded === true, pid, telemetry: telemetry(row.telemetry, prior, new Date(time).toISOString(), pid),
        });
      }
      for (const id of previous.keys()) if (!allowed.has(id)) previous.delete(id);
      hosts.set(machineId, previous);
    },
    get(machineId, ids) {
      const values = hosts.get(machineId);
      return ids.map(instanceId => {
        const row = values?.get(instanceId);
        return row ? { ...row, stale: now() - Date.parse(row.observedAt) > 15000 }
          : { instanceId, state: 'unknown', observedAt: '', stale: true, loaded: false, pid: 0 };
      });
    },
  };
}
module.exports = { instanceStatusCache };
