"""Migrate one plugin-owned Nowhere V1 instance to V2 with a durable V1 backup."""
import hashlib
import json
import os
import platform
import re
import shutil
import tarfile
import time
import urllib.error
import urllib.request


def download_release(version, destination):
    machine = platform.machine().lower()
    arch = 'x86_64' if machine in ('x86_64', 'amd64') else 'aarch64' if machine in ('aarch64', 'arm64') else ''
    if not arch:
        raise RuntimeError('unsupported-architecture')
    libc = 'musl' if os.path.exists('/etc/alpine-release') else 'gnu'
    asset = 'nowhere-' + arch + '-unknown-linux-' + libc + '.tar.gz'
    request = urllib.request.Request(
        'https://api.github.com/repos/NodePassProject/Nowhere/releases/tags/' + version,
        headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'Wherever-Station'},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            release = json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise RuntimeError('release-not-found') from exc
        raise
    metadata = next((item for item in release.get('assets', []) if item.get('name') == asset), None)
    if not metadata:
        raise RuntimeError('release-asset-not-found')
    expected = str(metadata.get('digest') or '')
    if not expected.startswith('sha256:'):
        raise RuntimeError('release-checksum-missing')
    archive = destination + '.archive'
    with urllib.request.urlopen(metadata['browser_download_url'], timeout=45) as response, open(archive, 'xb') as target:
        shutil.copyfileobj(response, target)
    digest = hashlib.sha256()
    with open(archive, 'rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != expected.split(':', 1)[1].lower():
        raise RuntimeError('release-checksum-mismatch')
    with tarfile.open(archive, 'r:gz') as bundle:
        member = next((item for item in bundle.getmembers() if item.isfile() and os.path.basename(item.name) == 'nowhere' and not item.name.startswith('/') and '..' not in item.name.split('/')), None)
        if not member:
            raise RuntimeError('binary-not-found')
        source = bundle.extractfile(member)
        with open(destination, 'xb') as target:
            shutil.copyfileobj(source, target)
    os.chmod(destination, 0o755)


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


candidate = P['binaryPath'] + '.v2-next'
transaction_file = P['environmentPath'] + '.transaction'
backup_directory = ''
was_running = False
transaction_started = False
try:
    if os.geteuid() != 0:
        stop('root-required')
    if not os.path.isfile(P['binaryPath']) or not os.path.isfile(P['environmentPath']) or not os.path.isfile(P['unitPath']):
        stop('managed-instance-missing')
    if not re.match(r'^v?1\.', str(P.get('previousVersion') or '')) or not re.match(r'^v?2\.', str(P.get('targetVersion') or '')):
        stop('invalid-major-migration')
    with open(P['environmentPath'], 'rb') as handle:
        previous_environment = handle.read()
    configured = re.search(rb'^NOWHERE_VERSION_VALUE="?([^"\r\n]+)', previous_environment, re.MULTILINE)
    if not configured or not re.match(rb'v?1\.', configured.group(1)):
        stop('source-version-mismatch')
    state = active(P['unitName'])
    if state not in ('active', 'inactive', 'failed'):
        stop('service-busy', state=state)
    was_running = state == 'active'
    for filename in (candidate, candidate + '.archive'):
        try:
            os.unlink(filename)
        except OSError:
            pass
    download_release(P['targetVersion'], candidate)
    checked = run([candidate, '--version'], 8)
    version_text = ((checked.stdout or '') + '\n' + (checked.stderr or '')).strip()[:240]
    if checked.returncode != 0 or P['targetVersion'].lstrip('v') not in version_text:
        raise RuntimeError('binary-version-mismatch')
    backup_root = os.path.join(P['directory'], 'migrations')
    os.makedirs(backup_root, mode=0o700, exist_ok=True)
    os.chmod(backup_root, 0o700)
    backup_directory = os.path.join(backup_root, time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-v1-to-v2')
    os.makedirs(backup_directory, mode=0o700)
    shutil.copy2(P['binaryPath'], os.path.join(backup_directory, 'nowhere'))
    shutil.copy2(P['environmentPath'], os.path.join(backup_directory, 'nowhere.env'))
    os.chmod(os.path.join(backup_directory, 'nowhere'), 0o755)
    os.chmod(os.path.join(backup_directory, 'nowhere.env'), 0o600)
    with open(os.path.join(backup_directory, 'metadata.json'), 'x', encoding='utf-8') as handle:
        os.fchmod(handle.fileno(), 0o600)
        json.dump({'schema': 1, 'fromVersion': P['previousVersion'], 'toVersion': P['targetVersion'], 'wasRunning': was_running}, handle, separators=(',', ':'))
    write_atomic(transaction_file, json.dumps({'schema': 2, 'restoreDirectory': backup_directory, 'wasRunning': was_running}, separators=(',', ':')).encode(), 0o600)
    transaction_started = True
    if was_running:
        stopped = run(['systemctl', 'stop', P['unitName']], 25)
        if stopped.returncode != 0 or active(P['unitName']) == 'active':
            raise RuntimeError('stop-failed')
    os.replace(candidate, P['binaryPath'])
    write_atomic(P['environmentPath'], P['environment'].encode(), 0o600)
    started = run(['systemctl', 'start', P['unitName']], 25)
    time.sleep(1)
    if started.returncode != 0 or active(P['unitName']) != 'active':
        raise RuntimeError('start-failed')
    if not was_running:
        stopped = run(['systemctl', 'stop', P['unitName']], 25)
        if stopped.returncode != 0 or active(P['unitName']) == 'active':
            raise RuntimeError('stop-failed')
    os.unlink(transaction_file)
    transaction_started = False
    try:
        os.unlink(candidate + '.archive')
    except OSError:
        pass
    configuration_hash = hashlib.sha256(P['environment'].encode()).hexdigest()
    emit({'ok': True, 'state': active(P['unitName']), 'version': P['targetVersion'], 'binaryVersion': version_text,
          'backupDirectory': backup_directory, 'configurationHash': configuration_hash, 'rolledBack': False})
except Exception as exc:
    restored = False
    try:
        if backup_directory:
            restored = restore_from(backup_directory, was_running)
        if restored and os.path.isfile(transaction_file):
            os.unlink(transaction_file)
            transaction_started = False
    except Exception:
        restored = False
    for filename in (candidate, candidate + '.archive', P['binaryPath'] + '.restore', P['environmentPath'] + '.next'):
        try:
            os.unlink(filename)
        except OSError:
            pass
    known = {
        'unsupported-architecture', 'release-not-found', 'release-asset-not-found', 'release-checksum-missing',
        'release-checksum-mismatch', 'binary-not-found', 'binary-version-mismatch',
        'stop-failed', 'start-failed', 'invalid-major-migration', 'source-version-mismatch',
    }
    error = str(exc) if str(exc) in known else 'migration-failed'
    stop(error, rolledBack=restored, recoveryPending=transaction_started, state=active(P['unitName']))
