"""Restore the V1 snapshot retained by a successful V1-to-V2 migration."""
import json
import os
import shutil
import time


def write_atomic(filename, content, mode):
    candidate = filename + '.next'
    try:
        os.unlink(candidate)
    except OSError:
        pass
    with open(candidate, 'wb') as handle:
        os.fchmod(handle.fileno(), mode)
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(candidate, filename)


def restore_from(directory, was_running):
    binary = os.path.join(directory, 'nowhere')
    environment = os.path.join(directory, 'nowhere.env')
    if not os.path.isfile(binary) or not os.path.isfile(environment):
        return False
    run(['systemctl', 'stop', P['unitName']], 25)
    shutil.copy2(binary, P['binaryPath'] + '.restore')
    os.chmod(P['binaryPath'] + '.restore', 0o755)
    os.replace(P['binaryPath'] + '.restore', P['binaryPath'])
    with open(environment, 'rb') as source:
        write_atomic(P['environmentPath'], source.read(), 0o600)
    if was_running:
        restored = run(['systemctl', 'start', P['unitName']], 25)
        time.sleep(1)
        return restored.returncode == 0 and active(P['unitName']) == 'active'
    stopped = run(['systemctl', 'stop', P['unitName']], 25)
    return stopped.returncode == 0 and active(P['unitName']) != 'active'


transaction_file = P['environmentPath'] + '.transaction'
snapshot_directory = os.path.join(P['directory'], '.rollback-v2')
was_running = False
transaction_started = False
try:
    if os.geteuid() != 0:
        stop('root-required')
    instance_root = os.path.realpath(P['directory'])
    backup_root = os.path.realpath(os.path.join(P['directory'], 'migrations'))
    backup_directory = os.path.realpath(str(P.get('backupDirectory') or ''))
    if not backup_directory.startswith(backup_root + os.sep) or not backup_root.startswith(instance_root + os.sep):
        stop('invalid-backup-directory')
    metadata_file = os.path.join(backup_directory, 'metadata.json')
    if not all(os.path.isfile(os.path.join(backup_directory, name)) for name in ('nowhere', 'nowhere.env')) or not os.path.isfile(metadata_file):
        stop('migration-backup-missing')
    with open(metadata_file, 'r', encoding='utf-8') as handle:
        metadata = json.load(handle)
    if metadata.get('schema') != 1 or not str(metadata.get('fromVersion') or '').lstrip('v').startswith('1.'):
        stop('migration-backup-invalid')
    state = active(P['unitName'])
    if state not in ('active', 'inactive', 'failed'):
        stop('service-busy', state=state)
    was_running = state == 'active'
    shutil.rmtree(snapshot_directory, ignore_errors=True)
    os.makedirs(snapshot_directory, mode=0o700)
    shutil.copy2(P['binaryPath'], os.path.join(snapshot_directory, 'nowhere'))
    shutil.copy2(P['environmentPath'], os.path.join(snapshot_directory, 'nowhere.env'))
    write_atomic(transaction_file, json.dumps({'schema': 3, 'restoreDirectory': snapshot_directory, 'wasRunning': was_running}, separators=(',', ':')).encode(), 0o600)
    transaction_started = True
    if not restore_from(backup_directory, was_running):
        raise RuntimeError('rollback-start-failed')
    checked = run([P['binaryPath'], '--version'], 8)
    version_text = ((checked.stdout or '') + '\n' + (checked.stderr or '')).strip()[:240]
    if checked.returncode != 0 or str(metadata['fromVersion']).lstrip('v') not in version_text:
        raise RuntimeError('binary-version-mismatch')
    os.unlink(transaction_file)
    transaction_started = False
    shutil.rmtree(snapshot_directory, ignore_errors=True)
    emit({'ok': True, 'state': active(P['unitName']), 'version': metadata['fromVersion'],
          'binaryVersion': version_text, 'rolledBack': True})
except Exception as exc:
    restored = False
    try:
        if os.path.isdir(snapshot_directory):
            restored = restore_from(snapshot_directory, was_running)
        if restored and os.path.isfile(transaction_file):
            os.unlink(transaction_file)
            transaction_started = False
    except Exception:
        restored = False
    known = {'invalid-backup-directory', 'migration-backup-missing', 'migration-backup-invalid',
             'rollback-start-failed', 'binary-version-mismatch'}
    error = str(exc) if str(exc) in known else 'rollback-failed'
    stop(error, restoredV2=restored, recoveryPending=transaction_started, state=active(P['unitName']))
