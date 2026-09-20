function instanceStatusCache(now = Date.now) {
  const hosts = new Map();
  const numericTelemetry = ['sequence', 'timestampMs', 'uptimeMs', 'tcpActive', 'udpActive', 'tlsCarriersActive', 'quicCarriersActive', 'pingMs', 'cpuPercent', 'cpuUsageNs', 'rssBytes', 'openFds'];
  const counterTelemetry = ['tcpLogicalUp', 'tcpLogicalDown', 'udpLogicalUp', 'udpLogicalDown', 'tlsPayloadUp', 'tlsPayloadDown', 'quicPayloadUp', 'quicPayloadDown'];
  const UINT64_MAX = 18446744073709551615n;
  const counter = (value) => {
    const text = typeof value === 'bigint' ? value.toString() : String(value ?? '');
    if (!/^\d{1,20}$/.test(text)) return undefined;
    const parsed = BigInt(text);
    return parsed <= UINT64_MAX ? parsed : undefined;
  };
  const total = (item, suffix) => {
    const tcp = counter(item?.[`tcpLogical${suffix}`]) || 0n;
    const udp = counter(item?.[`udpLogical${suffix}`]) || 0n;
    return tcp + udp;
  };
  function telemetry(value, prior, observedAt, pid) {
    if (!value || !['local', 'unavailable', 'systemd'].includes(value.source)) return undefined;
    const clean = { source: value.source };
    for (const key of numericTelemetry) if (Number.isFinite(value[key]) && value[key] >= 0) clean[key] = Number(value[key]);
    for (const key of counterTelemetry) {
      const parsed = counter(value[key]);
      if (parsed !== undefined) clean[key] = parsed.toString();
    }
    if (['STARTING', 'READY', 'DRAINING', 'STOPPED'].includes(value.lifecycle)) clean.lifecycle = value.lifecycle;
    if (/^[A-Z0-9_-]{1,64}$/.test(value.lifecycleReason || '')) clean.lifecycleReason = value.lifecycleReason;
    if (['portal', 'vector'].includes(value.role)) clean.role = value.role;
    if (/^v?2\.\d+\.\d+(?:[.-][A-Za-z0-9._-]+)?$/.test(value.version || '')) clean.version = value.version;
    if (typeof value.serviceEndpoint === 'string' && value.serviceEndpoint.length <= 512 && !/[\x00-\x1f\x7f]/.test(value.serviceEndpoint)) clean.serviceEndpoint = value.serviceEndpoint;
    if (typeof value.configSummary === 'string' && value.configSummary.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value.configSummary)) clean.configSummary = value.configSummary;
    const previous = prior?.telemetry;
    const wallElapsed = (Date.parse(observedAt) - Date.parse(prior?.observedAt || '')) / 1000;
    const uptimeElapsed = Number.isFinite(clean.uptimeMs) && Number.isFinite(previous?.uptimeMs)
      ? (clean.uptimeMs - previous.uptimeMs) / 1000 : 0;
    const elapsed = clean.source === 'local' ? uptimeElapsed : wallElapsed;
    const up = total(clean, 'Up'); const down = total(clean, 'Down');
    const oldUp = total(previous, 'Up'); const oldDown = total(previous, 'Down');
    if (clean.source === 'systemd' && pid > 0 && pid === prior?.pid && wallElapsed > 0 && wallElapsed <= 30 && previous && clean.cpuUsageNs >= previous.cpuUsageNs) {
      clean.cpuPercent = (clean.cpuUsageNs - previous.cpuUsageNs) / (wallElapsed * 1e7);
    }
    if (pid > 0 && pid === prior?.pid && elapsed > 0 && elapsed <= 30 && previous && up >= oldUp && down >= oldDown) {
      clean.upBytesPerSecond = Math.round(Number(up - oldUp) / elapsed);
      clean.downBytesPerSecond = Math.round(Number(down - oldDown) / elapsed);
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
