"""Create a private Nowhere instance without touching an existing system service."""
import hashlib
import ipaddress
import json
import os
import platform
import shutil
import tarfile
import tempfile
import urllib.error
import urllib.request


def release_asset(version):
    machine = platform.machine().lower()
    arch = 'x86_64' if machine in ('x86_64', 'amd64') else 'aarch64' if machine in ('aarch64', 'arm64') else ''
    if not arch:
        raise RuntimeError('unsupported-architecture')
    libc = 'musl' if os.path.exists('/etc/alpine-release') else 'gnu'
    asset = 'nowhere-' + arch + '-unknown-linux-' + libc + '.tar.gz'
    request = urllib.request.Request(
        'https://api.github.com/repos/NodePassProject/Nowhere/releases/tags/' + P['version'],
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
    digest = str(metadata.get('digest') or '')
    if not digest.startswith('sha256:'):
        raise RuntimeError('release-checksum-missing')
    return metadata['browser_download_url'], digest.split(':', 1)[1].lower()


def download_binary(destination):
    url, expected = release_asset(P['version'])
    archive = destination + '.archive'
    with urllib.request.urlopen(url, timeout=45) as response, open(archive, 'xb') as target:
        shutil.copyfileobj(response, target)
    digest = hashlib.sha256()
    with open(archive, 'rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != expected:
        raise RuntimeError('release-checksum-mismatch')
    with tarfile.open(archive, 'r:gz') as bundle:
        member = next((item for item in bundle.getmembers() if item.isfile() and os.path.basename(item.name) == 'nowhere' and not item.name.startswith('/') and '..' not in item.name.split('/')), None)
        if not member:
            raise RuntimeError('binary-not-found')
        source = bundle.extractfile(member)
        with open(destination, 'xb') as target:
            shutil.copyfileobj(source, target)
    os.chmod(destination, 0o755)
    os.unlink(archive)


def copy_binary(destination):
    requested = str(P.get('sourceBinaryPath') or '')
    source = os.path.realpath(requested) if requested.startswith('/') else ''
    if source and (not os.path.isfile(source) or not os.access(source, os.X_OK)):
        source = ''
    pid = run(['systemctl', 'show', 'nowhere.service', '-p', 'MainPID', '--value'], 5).stdout.strip()
    if pid.isdigit() and pid != '0':
        if not source:
            try:
                source = os.path.realpath('/proc/' + pid + '/exe')
            except OSError:
                source = ''
    if not source or not os.path.isfile(source):
        source = shutil.which('nowhere') or ''
    if not source or not os.path.isfile(source):
        raise RuntimeError('binary-not-found')
    shutil.copy2(source, destination)
    os.chmod(destination, 0o755)


def public_key_digest(command):
    result = run(command, 8)
    if result.returncode != 0:
        raise RuntimeError('certificate-invalid')
    return hashlib.sha256(result.stdout.encode()).hexdigest()


def prepare_certificate():
    mode = P.get('certificateMode', 'ephemeral')
    if mode == 'ephemeral':
        return
    if not shutil.which('openssl'):
        raise RuntimeError('openssl-not-found')
    certificate = P['certificatePath']
    private_key = P['privateKeyPath']
    if mode == 'managed':
        os.makedirs(os.path.dirname(certificate), mode=0o700, exist_ok=False)
        host = P['certificateHost']
        try:
            ipaddress.ip_address(host)
            alternative = 'IP:' + host
        except ValueError:
            alternative = 'DNS:' + host
        generated = run([
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes',
            '-days', str(P['certificateDays']), '-subj', '/CN=' + host,
            '-addext', 'subjectAltName=' + alternative,
            '-keyout', private_key, '-out', certificate,
        ], 30)
        if generated.returncode != 0:
            raise RuntimeError('certificate-generation-failed')
        os.chmod(certificate, 0o600)
        os.chmod(private_key, 0o600)
    if not os.path.isfile(certificate) or not os.path.isfile(private_key):
        raise RuntimeError('certificate-file-missing')
    certificate_key = public_key_digest(['openssl', 'x509', '-in', certificate, '-pubkey', '-noout'])
    private_public = public_key_digest(['openssl', 'pkey', '-in', private_key, '-pubout'])
    if certificate_key != private_public:
        raise RuntimeError('certificate-key-mismatch')


created_root = False
created_unit = False
try:
    if os.geteuid() != 0:
        stop('root-required')
    if os.path.lexists(P['directory']):
        stop('instance-exists')
    if os.path.lexists(P['unitPath']):
        stop('unit-exists')
    os.makedirs(P['directory'], mode=0o700)
    os.chmod(P['directory'], 0o700)
    os.makedirs(os.path.dirname(P['binaryPath']), mode=0o700)
    created_root = True
    if P.get('sourceMode') == 'download':
        download_binary(P['binaryPath'])
    elif P.get('sourceMode') == 'copy':
        copy_binary(P['binaryPath'])
    else:
        raise RuntimeError('invalid-source-mode')
    prepare_certificate()
    with open(P['environmentPath'], 'x', encoding='utf-8') as handle:
        handle.write(P['environment'])
        os.fchmod(handle.fileno(), 0o600)
    with open(P['unitPath'], 'x', encoding='utf-8') as handle:
        handle.write(P['unit'])
        os.fchmod(handle.fileno(), 0o644)
    created_unit = True
    reloaded = run(['systemctl', 'daemon-reload'], 15)
    if reloaded.returncode != 0:
        raise RuntimeError('daemon-reload-failed')
    checked = run([P['binaryPath'], '--version'], 8)
    version = ((checked.stdout or '') + '\n' + (checked.stderr or '')).strip()[:240]
    if checked.returncode != 0 or (P.get('sourceMode') == 'download' and P['version'].lstrip('v') not in version):
        raise RuntimeError('binary-version-mismatch')
    emit({
        'ok': True,
        'state': 'stopped',
        'created': True,
        'binaryVersion': version,
        'certificateMode': P.get('certificateMode', 'ephemeral'),
        'existingNowhere': active('nowhere.service'),
        'existingSingBox': active('sing-box.service'),
    })
except subprocess.TimeoutExpired:
    error = 'timeout'
except Exception as exc:
    known = {
        'binary-not-found', 'unsupported-architecture', 'invalid-source-mode',
        'release-not-found', 'release-asset-not-found', 'release-checksum-missing', 'release-checksum-mismatch',
        'daemon-reload-failed', 'binary-version-mismatch', 'openssl-not-found',
        'certificate-generation-failed', 'certificate-file-missing', 'certificate-invalid',
        'certificate-key-mismatch',
    }
    error = str(exc) if str(exc) in known else 'create-failed'
finally:
    if 'error' in locals():
        if created_unit:
            try:
                os.unlink(P['unitPath'])
            except OSError:
                pass
        if created_root:
            shutil.rmtree(P['directory'], ignore_errors=True)
        try:
            run(['systemctl', 'daemon-reload'], 15)
        except Exception:
            pass
        stop(error, cleaned=True)
