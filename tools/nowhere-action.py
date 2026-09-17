"""Run a lifecycle action on one plugin-owned systemd unit."""
try:
    if os.geteuid() != 0:
        stop('root-required')
    if not P['unitName'].startswith('proxy-console-nowhere@'):
        stop('managed-instance-missing')
    if not os.path.isfile(P['unitPath']) or not os.path.isdir(P['directory']):
        stop('managed-instance-missing')
    result = run(['systemctl', P['action'], P['unitName']], 25)
    if result.returncode != 0:
        stop('service-action-failed', state=active(P['unitName']))
    emit({
        'ok': True,
        'state': active(P['unitName']),
        'existingNowhere': active('nowhere.service'),
        'existingSingBox': active('sing-box.service'),
    })
except subprocess.TimeoutExpired:
    stop('timeout')
except Exception:
    stop('service-action-failed')
