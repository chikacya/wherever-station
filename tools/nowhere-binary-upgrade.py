"""Atomically replace one plugin-owned Nowhere binary and restore it on failure."""
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


previous = P['binaryPath'] + '.rollback'
candidate = P['binaryPath'] + '.next'
was_running = False
replaced = False
environment_previous = None
environment_replaced = False
environment_candidate = P['environmentPath'] + '.version-next'
try:
    if os.geteuid() != 0:
        stop('root-required')
    if not os.path.isfile(P['binaryPath']) or not os.path.isfile(P['unitPath']):
        stop('managed-instance-missing')
    state = active(P['unitName'])
    if state not in ('active', 'inactive', 'failed'):
        stop('service-busy', state=state)
    was_running = state == 'active'
    for filename in (candidate, candidate + '.archive', previous):
        try:
            os.unlink(filename)
        except OSError:
            pass
    download_release(P['targetVersion'], candidate)
    checked = run([candidate, '--version'], 8)
    version_text = ((checked.stdout or '') + '\n' + (checked.stderr or '')).strip()[:240]
    if checked.returncode != 0 or P['targetVersion'].lstrip('v') not in version_text:
        raise RuntimeError('binary-version-mismatch')
    with open(P['environmentPath'], 'rb') as handle:
        environment_previous = handle.read()
    environment_text = environment_previous.decode('utf-8')
    replacement = 'NOWHERE_VERSION_VALUE="' + P['targetVersion'] + '"'
    if re.search(r'^NOWHERE_VERSION_VALUE=.*$', environment_text, re.MULTILINE):
        environment_text = re.sub(r'^NOWHERE_VERSION_VALUE=.*$', replacement, environment_text, flags=re.MULTILINE)
    else:
        environment_text = environment_text.rstrip('\n') + '\n' + replacement + '\n'
    with open(environment_candidate, 'x', encoding='utf-8') as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(environment_text)
        handle.flush()
        os.fsync(handle.fileno())
    if was_running:
        stopped = run(['systemctl', 'stop', P['unitName']], 25)
        if stopped.returncode != 0 or active(P['unitName']) == 'active':
            raise RuntimeError('stop-failed')
    os.replace(P['binaryPath'], previous)
    os.replace(candidate, P['binaryPath'])
    replaced = True
    os.replace(environment_candidate, P['environmentPath'])
    environment_replaced = True
    if was_running:
        started = run(['systemctl', 'start', P['unitName']], 25)
        time.sleep(1)
        if started.returncode != 0 or active(P['unitName']) != 'active':
            raise RuntimeError('start-failed')
    os.unlink(previous)
    try:
        os.unlink(candidate + '.archive')
    except OSError:
        pass
    emit({'ok': True, 'state': active(P['unitName']), 'version': P['targetVersion'],
          'binaryVersion': version_text, 'rolledBack': False})
except Exception as exc:
    restored = not replaced
    try:
        if environment_replaced and environment_previous is not None:
            with open(environment_candidate, 'wb') as handle:
                os.fchmod(handle.fileno(), 0o600)
                handle.write(environment_previous)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(environment_candidate, P['environmentPath'])
        if replaced and os.path.isfile(previous):
            try:
                os.unlink(P['binaryPath'])
            except OSError:
                pass
            os.replace(previous, P['binaryPath'])
            if was_running:
                result = run(['systemctl', 'start', P['unitName']], 25)
                time.sleep(1)
                restored = result.returncode == 0 and active(P['unitName']) == 'active'
            else:
                restored = active(P['unitName']) != 'active'
    except Exception:
        restored = False
    for filename in (candidate, candidate + '.archive', environment_candidate):
        try:
            os.unlink(filename)
        except OSError:
            pass
    known = {
        'unsupported-architecture', 'release-not-found', 'release-asset-not-found', 'release-checksum-missing',
        'release-checksum-mismatch', 'binary-not-found', 'binary-version-mismatch',
        'stop-failed', 'start-failed',
    }
    error = str(exc) if str(exc) in known else 'upgrade-failed'
    stop(error, rolledBack=restored, state=active(P['unitName']))
