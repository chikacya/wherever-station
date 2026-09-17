const fs = require('fs');
const path = require('path');
const { cleanInstanceId } = require('./managed-nowhere');
function commandForTargets(targets) {
  const code = Buffer.from(fs.readFileSync(path.join(__dirname, 'instance-status.py'), 'utf8')).toString('base64');
  const payload = Buffer.from(JSON.stringify(targets)).toString('base64');
  return `python3 -c "$(printf '%s' '${code}' | base64 -d)" '${payload}'`;
}
function buildInstanceStatus(instances) {
  if (!Array.isArray(instances) || !instances.length || instances.length > 200) throw new Error('状态查询需要 1–200 个实例');
  return commandForTargets(instances.map(instance => {
    const id = cleanInstanceId(instance.id);
    if (!['nowhere', 'sing-box'].includes(instance.kind)) throw new Error('Unknown instance kind');
    return { instanceId: id, kind: instance.kind, unit: `proxy-console-${instance.kind === 'nowhere' ? 'nowhere' : 'singbox'}@${id}.service` };
  }));
}
function buildServiceStatus() {
  return commandForTargets([
    { instanceId: 'service-sing-box', kind: 'sing-box', unit: 'sing-box.service' },
    { instanceId: 'service-nowhere', kind: 'nowhere', unit: 'nowhere.service' },
  ]);
}
module.exports = { buildInstanceStatus, buildServiceStatus };
