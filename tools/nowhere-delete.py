"""Remove one stopped plugin-owned Nowhere instance."""
import shutil

try:
    if os.geteuid() != 0:
        stop('root-required')
    if not P['unitName'].startswith('proxy-console-nowhere@'):
        stop('managed-instance-missing')
    state = active(P['unitName'])
    if state in ('active', 'activating', 'deactivating'):
        stop('stop-before-delete', state=state)
    unit_exists = os.path.lexists(P['unitPath'])
    directory_exists = os.path.lexists(P['directory'])
    if not unit_exists and not directory_exists:
        emit({'ok': True, 'state': 'deleted', 'draftOnly': True})
        sys.exit(0)
    if not os.path.isfile(P['unitPath']) or not os.path.isdir(P['directory']):
        stop('managed-instance-incomplete')
    os.unlink(P['unitPath'])
    shutil.rmtree(P['directory'])
    reloaded = run(['systemctl', 'daemon-reload'], 15)
    if reloaded.returncode != 0:
        stop('daemon-reload-failed')
    emit({
        'ok': True,
        'state': 'deleted',
        'existingNowhere': active('nowhere.service'),
        'existingSingBox': active('sing-box.service'),
    })
except Exception as exc:
    known = {'stop-before-delete', 'managed-instance-incomplete', 'daemon-reload-failed'}
    stop(str(exc) if str(exc) in known else 'delete-failed')
