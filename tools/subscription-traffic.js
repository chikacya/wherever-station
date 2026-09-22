// Shared ownership check for the editor and public subscription output.
function subscriptionMachine(subscription, nodes, machines) {
  const ids = new Set(subscription.nodeIds || []);
  for (const group of subscription.groups || []) for (const entry of group.entries || []) if (entry.kind === 'node') ids.add(entry.id);
  const output = nodes.filter(node => ids.has(node.id) && node.enabled !== false);
  if (!output.length || output.some(node => !node.machineId)) return null;
  const id = output[0].machineId;
  return output.every(node => node.machineId === id) ? machines.find(machine => machine.id === id && machine.monitorClientId) || null : null;
}

function cycleStart(resetDay, now = Date.now()) {
  const d = new Date(now), day = Math.min(31, Math.max(1, Number(resetDay) || 1));
  const boundary = month => Date.UTC(d.getUTCFullYear(), month, Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate()));
  const start = boundary(d.getUTCMonth());
  return start <= now ? start : boundary(d.getUTCMonth() - 1);
}

function validSample(row) {
  return row && ['net_total_up', 'net_total_down'].every(key => row[key] !== null && row[key] !== undefined && Number.isFinite(Number(row[key])) && Number(row[key]) >= 0);
}

function serverTraffic(machine, latest, records = [], now = Date.now()) {
  if (!validSample(latest) || !Number.isFinite(Date.parse(latest.time)) || now - Date.parse(latest.time) > 120000) return null;
  const result = { upload: Number(latest.net_total_up), download: Number(latest.net_total_down), total: 0, basis: 'agent', machineName: machine.name, observedAt: latest.time };
  const plan = machine.trafficPlan || {};
  if (!plan.enabled || !(plan.limitBytes > 0)) return result;
  const start = cycleStart(plan.resetDay, now);
  const rows = records.filter(validSample).filter(row => Date.parse(row.time) <= Date.parse(latest.time)).concat(latest).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const baseline = rows.filter(row => Date.parse(row.time) <= start).at(-1);
  // Never subtract an unrelated lifetime counter or invent missing history.
  if (!baseline || start - Date.parse(baseline.time) > 20 * 60000) return result;
  let previous = baseline, upload = 0, download = 0;
  for (const row of rows.filter(row => Date.parse(row.time) > start)) {
    if (Date.parse(row.time) - Date.parse(previous.time) > 30 * 60000) return result;
    for (const key of ['net_total_up', 'net_total_down']) {
      const current = Number(row[key]), old = Number(previous[key]);
      const delta = current >= old ? current - old : current;
      if (key === 'net_total_up') upload += delta; else download += delta;
    }
    previous = row;
  }
  const used = plan.accounting === 'up' ? upload : plan.accounting === 'down' ? download : plan.accounting === 'max' ? Math.max(upload, download) : upload + download;
  // Subscription-Userinfo adds both directions. Map one-direction/max billing
  // to a single counter; expose the raw directions separately to the admin UI.
  return { ...result, rawUpload: upload, rawDownload: download, upload: plan.accounting === 'sum' || !plan.accounting ? upload : 0, download: plan.accounting === 'sum' || !plan.accounting ? download : used, total: Number(plan.limitBytes), basis: 'cycle-estimate', cycleStart: start, accounting: plan.accounting || 'sum' };
}

module.exports = { subscriptionMachine, cycleStart, serverTraffic };
