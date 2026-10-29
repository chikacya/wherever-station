const { nowhereCapabilities } = require('./nowhere-capabilities');
function requiresPreludeConfirmation(instance, targetVersion) {
  return Boolean(instance.role !== 'egress' && Number(instance.morph) === 1 && Number(instance.tcpPort) > 0
    && nowhereCapabilities(targetVersion).requiresAuthenticatedPrelude
    && !nowhereCapabilities(instance.version).requiresAuthenticatedPrelude);
}
module.exports = { requiresPreludeConfirmation };
