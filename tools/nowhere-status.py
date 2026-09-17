"""Read lifecycle, binary and certificate state for one managed instance."""
import datetime
import hashlib
import shlex
import shutil
import socket
import ssl


def environment_values(filename):
    values = {}
    try:
        with open(filename, 'r', encoding='utf-8') as handle:
            for line in handle:
                name, separator, raw = line.partition('=')
                if not separator or not name.startswith('NOWHERE_'):
                    continue
                parsed = shlex.split(raw, comments=False)
                if len(parsed) == 1:
                    values[name] = parsed[0]
    except OSError:
        pass
    return values


def public_key_pin(certificate, inform='PEM'):
    try:
        with open(certificate, 'rb') as handle:
            source = handle.read()
    except (OSError, TypeError):
        source = certificate if isinstance(certificate, bytes) else b''
    if not source:
        return ''
    public = subprocess.run(
        ['openssl', 'x509', '-inform', inform, '-pubkey', '-noout'], input=source,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8, check=False,
    )
    spki = subprocess.run(
        ['openssl', 'pkey', '-pubin', '-outform', 'DER'], input=public.stdout,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8, check=False,
    )
    if public.returncode or spki.returncode:
        return ''
    return base64.b64encode(hashlib.sha256(spki.stdout).digest()).decode()


def certificate_time(value):
    try:
        parsed = datetime.datetime.strptime(value, '%b %d %H:%M:%S %Y %Z').replace(tzinfo=datetime.timezone.utc)
        return parsed.isoformat().replace('+00:00', 'Z')
    except (TypeError, ValueError):
        return ''


def certificate_details(values, state):
    mode = values.get('NOWHERE_CERTIFICATE_MODE_VALUE', 'ephemeral')
    certificate = values.get('NOWHERE_CRT_VALUE', '')
    key = values.get('NOWHERE_TLS_KEY_VALUE', '')
    result = {'mode': mode, 'certificatePath': certificate, 'privateKeyPath': key, 'valid': mode == 'ephemeral'}
    if mode == 'ephemeral':
        network = values.get('NOWHERE_NET_VALUE', 'mix')
        if state != 'active':
            result['note'] = 'start-to-read-fingerprint'
            return result
        if network == 'udp':
            result['note'] = 'fingerprint-unavailable-udp-only'
            return result
        host = values.get('NOWHERE_LISTEN_HOST_VALUE') or '127.0.0.1'
        if host in ('0.0.0.0', '::', ''):
            host = '127.0.0.1'
        port = int(values.get('NOWHERE_PORT_VALUE') or 0)
        try:
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            with socket.create_connection((host, port), timeout=5) as raw:
                with context.wrap_socket(raw, server_hostname=values.get('NOWHERE_PUBLIC_HOST_VALUE') or None) as secure:
                    leaf = secure.getpeercert(binary_form=True)
            result['fingerprint'] = hashlib.sha256(leaf).hexdigest()
            result['publicKeySha256'] = public_key_pin(leaf, 'DER')
            result['ephemeral'] = True
        except (OSError, ValueError, ssl.SSLError):
            result['note'] = 'fingerprint-probe-failed'
        return result
    if not shutil.which('openssl'):
        result['error'] = 'openssl-not-found'
        return result
    if not os.path.isfile(certificate) or not os.path.isfile(key):
        result['error'] = 'certificate-file-missing'
        return result
    checked = run(['openssl', 'x509', '-in', certificate, '-noout', '-subject', '-enddate', '-fingerprint', '-sha256'], 8)
    certificate_public = run(['openssl', 'x509', '-in', certificate, '-pubkey', '-noout'], 8)
    private_public = run(['openssl', 'pkey', '-in', key, '-pubout'], 8)
    key_matches = (
        certificate_public.returncode == 0
        and private_public.returncode == 0
        and hashlib.sha256(certificate_public.stdout.encode()).digest()
        == hashlib.sha256(private_public.stdout.encode()).digest()
    )
    result['keyMatches'] = key_matches
    result['valid'] = checked.returncode == 0 and key_matches
    result['publicKeySha256'] = public_key_pin(certificate)
    for line in checked.stdout.splitlines():
        if line.startswith('notAfter='):
            result['expiresAt'] = certificate_time(line.split('=', 1)[1])
        elif line.startswith('subject='):
            result['subject'] = line.split('=', 1)[1].strip()
        elif 'Fingerprint=' in line:
            result['fingerprint'] = line.split('=', 1)[1].replace(':', '').lower()
    san_checked = run(['openssl', 'x509', '-in', certificate, '-noout', '-ext', 'subjectAltName'], 8)
    if san_checked.returncode == 0:
        result['sans'] = [
            item.strip().removeprefix('DNS:').removeprefix('IP Address:')
            for line in san_checked.stdout.splitlines()
            if 'Subject Alternative Name' not in line
            for item in line.strip().split(',')
            if item.strip()
        ]
    if not result['valid']:
        result['error'] = 'certificate-key-mismatch' if not key_matches else 'certificate-invalid'
    return result


try:
    state = active(P['unitName'])
    installed = os.path.isfile(P['unitPath']) and os.path.isdir(P['directory'])
    payload = {
        'ok': True,
        'state': state,
        'installed': installed,
        'existingNowhere': active('nowhere.service'),
        'existingSingBox': active('sing-box.service'),
    }
    if installed:
        values = environment_values(P['environmentPath'])
        payload['certificate'] = certificate_details(values, state)
        checked = run([P['binaryPath'], '--version'], 8)
        payload['binaryVersion'] = ((checked.stdout or '') + '\n' + (checked.stderr or '')).strip()[:240]
        with open(P['environmentPath'], 'rb') as handle:
            payload['configurationHash'] = hashlib.sha256(handle.read()).hexdigest()
    if P.get('includeLogs'):
        journal = run(['journalctl', '-u', P['unitName'], '-n', '80', '--no-pager', '--output=short-iso'], 10)
        payload['logs'] = (journal.stdout or journal.stderr)[-24000:]
    emit(payload)
except subprocess.TimeoutExpired:
    stop('timeout')
except Exception:
    stop('status-failed')
