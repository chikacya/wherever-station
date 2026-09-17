"""Read only the plugin-owned environment file; never source shell content."""
import hashlib
import shlex

try:
    if os.geteuid() != 0:
        stop('root-required')
    with open(P['environmentPath'], 'rb') as handle:
        content = handle.read(262145)
    if len(content) > 262144:
        stop('configuration-too-large')
    values = {}
    for line in content.decode('utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        name, separator, raw = line.partition('=')
        if not separator or not name.startswith(('NOWHERE_', 'NOW_')):
            continue
        parsed = shlex.split(raw, comments=False)
        if len(parsed) != 1:
            stop('configuration-unrecognized')
        values[name] = parsed[0]
    emit({'ok': True, 'state': active(P['unitName']),
          'configurationHash': hashlib.sha256(content).hexdigest(), 'configuration': values})
except Exception:
    stop('configuration-read-failed')
