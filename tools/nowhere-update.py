"""Isolated managed-instance update. Injected after the common remote helpers."""
import hashlib
import ipaddress
import json
import shlex
import shutil
import time
import fcntl

def replace_private(filename, content):
    temporary = filename + '.next'
    with open(temporary, 'wb') as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, filename)

def public_key_digest(command):
    result = run(command, 8)
    if result.returncode != 0:
        raise RuntimeError('certificate-invalid')
    return hashlib.sha256(result.stdout.encode()).hexdigest()

def parse_environment(content):
    values = {}
    for line in content.decode('utf-8').splitlines():
        name, separator, raw = line.partition('=')
        if not separator:
            continue
        parsed = shlex.split(raw, comments=False)
        if len(parsed) == 1:
            values[name] = parsed[0]
    return values

def validate_certificate_pair(certificate, private_key):
    if not os.path.isfile(certificate) or not os.path.isfile(private_key):
        raise RuntimeError('certificate-file-missing')
    certificate_key = public_key_digest(['openssl', 'x509', '-in', certificate, '-pubkey', '-noout'])
    private_public = public_key_digest(['openssl', 'pkey', '-in', private_key, '-pubout'])
    if certificate_key != private_public:
        raise RuntimeError('certificate-key-mismatch')

def prepare_certificate(previous_values):
    mode = P.get('certificateMode', 'ephemeral')
    if mode == 'ephemeral':
        return {'changed': False, 'previous': {}}
    if not shutil.which('openssl'):
        raise RuntimeError('openssl-not-found')
    certificate = P['certificatePath']
    private_key = P['privateKeyPath']
    if mode == 'managed':
        rotate = (
            not os.path.isfile(certificate)
            or not os.path.isfile(private_key)
            or previous_values.get('NOWHERE_CERTIFICATE_MODE_VALUE') != 'managed'
            or previous_values.get('NOWHERE_CERTIFICATE_HOST_VALUE') != str(P['certificateHost'])
            or previous_values.get('NOWHERE_CERTIFICATE_DAYS_VALUE') != str(P['certificateDays'])
        )
        if not rotate:
            validate_certificate_pair(certificate, private_key)
            return {'changed': False, 'previous': {}}
        os.makedirs(os.path.dirname(certificate), mode=0o700, exist_ok=True)
        os.chmod(os.path.dirname(certificate), 0o700)
        host = P['certificateHost']
        try:
            ipaddress.ip_address(host)
            alternative = 'IP:' + host
        except ValueError:
            alternative = 'DNS:' + host
        certificate_next = certificate + '.next'
        private_key_next = private_key + '.next'
        for filename in (certificate_next, private_key_next):
            try:
                os.unlink(filename)
            except OSError:
                pass
        previous_files = {
            certificate: open(certificate, 'rb').read() if os.path.isfile(certificate) else None,
            private_key: open(private_key, 'rb').read() if os.path.isfile(private_key) else None,
        }
        try:
            generated = run([
                'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes',
                '-days', str(P['certificateDays']), '-subj', '/CN=' + host,
                '-addext', 'subjectAltName=' + alternative,
                '-keyout', private_key_next, '-out', certificate_next,
            ], 30)
            if generated.returncode != 0:
                raise RuntimeError('certificate-generation-failed')
            os.chmod(certificate_next, 0o600)
            os.chmod(private_key_next, 0o600)
            validate_certificate_pair(certificate_next, private_key_next)
            os.replace(certificate_next, certificate)
            os.replace(private_key_next, private_key)
            validate_certificate_pair(certificate, private_key)
            return {'changed': True, 'previous': previous_files}
        except Exception:
            for filename, content in previous_files.items():
                if content is None:
                    try:
                        os.unlink(filename)
                    except OSError:
                        pass
                else:
                    replace_private(filename, content)
            for filename in (certificate_next, private_key_next):
                try:
                    os.unlink(filename)
                except OSError:
                    pass
            raise
    validate_certificate_pair(certificate, private_key)
    return {'changed': False, 'previous': {}}

changed = False
previous = None
was_running = False
update_lock = None
rollback_file = None
transaction_file = None
certificate_change = {'changed': False, 'previous': {}}
try:
    if os.geteuid() != 0:
        stop('root-required')
    filename = P['environmentPath']
    unit = P['unitName']
    rollback_file = filename + '.rollback'
    transaction_file = filename + '.transaction'
    if not os.path.isfile(filename) or not os.path.isfile(P['unitPath']):
        stop('managed-instance-missing')
    update_lock = open(filename + '.update-lock', 'a')
    os.fchmod(update_lock.fileno(), 0o600)
    try:
        fcntl.flock(update_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        stop('update-in-progress')
    if os.path.isfile(transaction_file):
        try:
            with open(transaction_file, 'r', encoding='utf-8') as handle:
                interrupted = json.load(handle)
            if interrupted.get('schema') != 1 or not os.path.isfile(rollback_file):
                stop('recovery-failed')
            os.replace(rollback_file, filename)
            if interrupted.get('wasRunning'):
                recovered = run(['systemctl', 'restart', unit], 25)
                time.sleep(1)
                if recovered.returncode != 0 or active(unit) != 'active':
                    stop('recovery-failed')
            else:
                recovered = run(['systemctl', 'stop', unit], 25)
                if recovered.returncode != 0 or active(unit) == 'active':
                    stop('recovery-failed')
            os.unlink(transaction_file)
        except (OSError, ValueError, json.JSONDecodeError):
            stop('recovery-failed')
    with open(filename, 'rb') as handle:
        previous = handle.read()
    previous_values = parse_environment(previous)
    digest = hashlib.sha256(previous).hexdigest()
    if digest != P['expectedHash']:
        stop('configuration-changed', configurationHash=digest)
    state = active(unit)
    if state not in ('active', 'inactive', 'failed'):
        stop('service-busy', state=state)
    was_running = state == 'active'
    candidate = P['environment'].encode('utf-8')
    if candidate == previous:
        emit({'ok': True, 'state': state, 'configurationHash': digest, 'changed': False})
        sys.exit(0)
    replace_private(rollback_file, previous)
    replace_private(transaction_file, json.dumps({'schema': 1, 'wasRunning': was_running}, separators=(',', ':')).encode('utf-8'))
    changed = True
    certificate_change = prepare_certificate(previous_values)
    replace_private(filename, candidate)
    if was_running:
        result = run(['systemctl', 'restart', unit], 25)
        if result.returncode != 0:
            raise RuntimeError('restart-failed')
        time.sleep(1)
        if active(unit) != 'active':
            raise RuntimeError('start-failed')
    else:
        result = run(['systemctl', 'start', unit], 25)
        if result.returncode != 0:
            raise RuntimeError('start-failed')
        time.sleep(1)
        if active(unit) != 'active':
            raise RuntimeError('start-failed')
        result = run(['systemctl', 'stop', unit], 25)
        if result.returncode != 0 or active(unit) == 'active':
            raise RuntimeError('stop-failed')
    for completed_file in (transaction_file, rollback_file):
        try:
            os.unlink(completed_file)
        except OSError:
            pass
    emit({'ok': True, 'state': active(unit), 'changed': True,
          'configurationHash': hashlib.sha256(candidate).hexdigest(),
          'certificateRotated': certificate_change['changed']})
except Exception:
    restored = False
    if changed and previous is not None:
        try:
            replace_private(filename, previous)
            if was_running:
                result = run(['systemctl', 'restart', unit], 25)
                restored = result.returncode == 0 and active(unit) == 'active'
            else:
                result = run(['systemctl', 'stop', unit], 25)
                restored = result.returncode == 0 and active(unit) != 'active'
        except Exception:
            restored = False
    if certificate_change['changed']:
        try:
            for certificate_file, content in certificate_change['previous'].items():
                if content is None:
                    try:
                        os.unlink(certificate_file)
                    except OSError:
                        pass
                else:
                    replace_private(certificate_file, content)
        except Exception:
            restored = False
    if restored:
        for completed_file in (transaction_file, rollback_file):
            try:
                os.unlink(completed_file)
            except OSError:
                pass
    stop('update-failed', rolledBack=restored)
finally:
    if update_lock is not None:
        update_lock.close()
