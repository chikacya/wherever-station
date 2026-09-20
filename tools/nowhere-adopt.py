"""Atomically switch an existing Nowhere service to a plugin-owned instance."""
import re
import time


def enabled(unit):
    return run(['systemctl', 'is-enabled', unit], 5).stdout.strip() == 'enabled'


def set_enabled(unit, should_enable):
    verb = 'enable' if should_enable else 'disable'
    return run(['systemctl', verb, unit], 15).returncode == 0


def start_and_verify(unit):
    started = run(['systemctl', 'start', unit], 25)
    time.sleep(1)
    return started.returncode == 0 and active(unit) == 'active'


def stop_and_verify(unit):
    stopped = run(['systemctl', 'stop', unit], 25)
    return stopped.returncode == 0 and active(unit) != 'active'


def restore_source(source, was_enabled):
    enabled_ok = set_enabled(source, was_enabled)
    running_ok = start_and_verify(source)
    return enabled_ok and running_ok


try:
    if os.geteuid() != 0:
        stop('root-required')
    source = str(P.get('sourceUnit') or '')
    if not re.fullmatch(r'[A-Za-z0-9_.@:-]+\.service', source) or source.startswith('proxy-console-nowhere@'):
        stop('adoption-source-invalid')
    if not P['unitName'].startswith('proxy-console-nowhere@'):
        stop('managed-instance-missing')
    if not os.path.isfile(P['unitPath']) or not os.path.isdir(P['directory']):
        stop('managed-instance-missing')

    action = P.get('action')
    if action == 'adopt':
        if active(P['unitName']) == 'active':
            stop('adoption-managed-already-running')
        if active(source) != 'active':
            stop('adoption-source-not-running', sourceState=active(source))
        source_was_enabled = enabled(source)
        if not stop_and_verify(source):
            stop('adoption-source-stop-failed', sourceState=active(source))
        if not start_and_verify(P['unitName']):
            run(['systemctl', 'stop', P['unitName']], 25)
            restored = restore_source(source, source_was_enabled)
            stop('adoption-start-failed', state=active(P['unitName']), sourceState=active(source), sourceWasEnabled=source_was_enabled, rolledBack=restored)
        persistence_ok = set_enabled(P['unitName'], True) and set_enabled(source, False)
        if not persistence_ok:
            run(['systemctl', 'stop', P['unitName']], 25)
            set_enabled(P['unitName'], False)
            restored = restore_source(source, source_was_enabled)
            stop('adoption-persistence-failed', state=active(P['unitName']), sourceState=active(source), sourceWasEnabled=source_was_enabled, rolledBack=restored)
        emit({'ok': True, 'state': active(P['unitName']), 'sourceState': active(source), 'sourceWasEnabled': source_was_enabled})
    elif action == 'rollback-adoption':
        source_was_enabled = P.get('sourceWasEnabled') is True
        if not stop_and_verify(P['unitName']):
            stop('adoption-managed-stop-failed', state=active(P['unitName']), sourceState=active(source), sourceWasEnabled=source_was_enabled)
        if not restore_source(source, source_was_enabled):
            set_enabled(source, False)
            restored = start_and_verify(P['unitName'])
            if restored:
                set_enabled(P['unitName'], True)
            stop('adoption-rollback-failed', state=active(P['unitName']), sourceState=active(source), sourceWasEnabled=source_was_enabled, rolledBack=restored)
        set_enabled(P['unitName'], False)
        emit({'ok': True, 'state': active(P['unitName']), 'sourceState': active(source), 'sourceWasEnabled': source_was_enabled})
    else:
        stop('invalid-adoption-action')
except subprocess.TimeoutExpired:
    stop('timeout')
except Exception:
    stop('adoption-failed', state=active(P.get('unitName', '')), sourceState=active(P.get('sourceUnit', '')))
