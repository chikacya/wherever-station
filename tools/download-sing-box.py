import hashlib
import json
import os
import pathlib
import platform
import shutil
import tarfile
import tempfile
import urllib.request

def install_release(binary, version):
    machine = platform.machine().lower()
    arch = {'x86_64': 'amd64', 'amd64': 'amd64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(machine)
    if not arch:
        raise RuntimeError('unsupported-architecture')
    asset = 'sing-box-' + version + '-linux-' + arch + '.tar.gz'
    url = 'https://github.com/SagerNet/sing-box/releases/download/v' + version + '/' + asset
    api = 'https://api.github.com/repos/SagerNet/sing-box/releases/tags/v' + version
    with tempfile.TemporaryDirectory(prefix='wherever-singbox-') as temporary:
        archive = os.path.join(temporary, asset)
        request = urllib.request.Request(api, headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'Wherever-Station'})
        with urllib.request.urlopen(request, timeout=30) as response:
            release = json.load(response)
        metadata = next((item for item in release.get('assets', []) if item.get('name') == asset), None)
        digest = str((metadata or {}).get('digest') or '')
        if not metadata or not digest.startswith('sha256:'):
            raise RuntimeError('release-digest-unavailable')
        with urllib.request.urlopen(url, timeout=60) as response, open(archive, 'xb') as target:
            shutil.copyfileobj(response, target)
        actual = hashlib.sha256(pathlib.Path(archive).read_bytes()).hexdigest()
        if actual != digest.removeprefix('sha256:'):
            raise RuntimeError('release-digest-mismatch')
        with tarfile.open(archive, 'r:gz') as bundle:
            members = [member for member in bundle.getmembers() if member.isfile() and os.path.basename(member.name) == 'sing-box']
            if len(members) != 1:
                raise RuntimeError('invalid-release-archive')
            with bundle.extractfile(members[0]) as source, open(binary, 'xb') as target:
                shutil.copyfileobj(source, target)
        os.chmod(binary, 0o755)
