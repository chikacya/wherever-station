const { planManagedNowhere } = require('./managed-nowhere');
const { nowhereCapabilities } = require('./nowhere-capabilities');
function planNowhereMigration(configuration, { instanceId, name, targetVersion, key }) {
  if (!/^v?2\./.test(configuration.version) || nowhereCapabilities(targetVersion).protocolGeneration !== 3 || !nowhereCapabilities(targetVersion).verified) throw new Error('仅支持 NW2 → 已验证 NW3 的迁移');
  if (configuration.nativeNext && configuration.nativeNext !== 'none') throw new Error('当前配置使用原生 next；请先重新设计链路出口，不能自动转换成 NW3');
  const extensions = Object.fromEntries(Object.entries(configuration.extensionEnvironment || {}).filter(([k]) => !['NOW_REPORT_INTERVAL','NOW_TELEMETRY_INTERVAL','NOW_QUIC_MEMORY_PROFILE','NOWHERE_POOL_VALUE','NOWHERE_QUIC_MEMORY_PROFILE_VALUE'].includes(k)));
  const input = { ...configuration, id: instanceId, name, version: targetVersion, role: 'portal', key,
    out: configuration.socks && configuration.socks !== 'none' ? configuration.socks : 'direct',
    vectorMux: 0, log: 'info', telemetryInterval: '1s', extensionEnvironment: extensions };
  delete input.nativeNext;
  const plan = planManagedNowhere(input);
  return { input, plan, changes: ['协议改为 NW3，所有客户端必须支持 NW3', '移除 split up/down 与 TLS Mux，每条客户端连接只选择一种 carrier',
    'SOCKS 出口转换为 out=；监听端口、限速、证书和 Morph 开关保留', '遥测切换为 NW3 被动 Snapshot', '密钥使用迁移表单中的 32 字符值，成功后发布新订阅链接'] };
}
module.exports = { planNowhereMigration };
