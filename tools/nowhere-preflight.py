"""Check whether a blank VPS can host a plugin-owned Nowhere instance."""
import os
import platform
import shutil

try:
    if os.geteuid() != 0:
        stop('root-required')
    if not shutil.which('systemctl'):
        stop('systemd-required')
    if os.path.lexists(P['directory']):
        stop('instance-exists')
    if os.path.lexists(P['unitPath']):
        stop('unit-exists')
    ports = P.get('ports') or [{'transport': P.get('network', 'mix'), 'port': P['port']}]
    normalized_ports = []
    for item in ports:
        transport = str(item.get('transport') or '').lower()
        port = int(item.get('port') or 0)
        if transport not in ('tcp', 'udp') or port < 1 or port > 65535:
            stop('invalid-port-plan')
        pair = (transport, port)
        if pair not in normalized_ports:
            normalized_ports.append(pair)
    occupied = []
    if shutil.which('ss'):
        output = run(['ss', '-H', '-lntup'], 8).stdout
        for line in output.splitlines():
            fields = line.split()
            if len(fields) <= 4:
                continue
            socket_transport = 'tcp' if fields[0].startswith('tcp') else 'udp' if fields[0].startswith('udp') else ''
            socket_port = fields[4].rsplit(':', 1)[-1]
            if any(socket_transport == transport and socket_port == str(port) for transport, port in normalized_ports):
                occupied.append(line[:240])
    if occupied:
        stop('port-in-use', occupied=len(occupied))
    pid = run(['systemctl', 'show', 'nowhere.service', '-p', 'MainPID', '--value'], 5).stdout.strip()
    source = ''
    if pid.isdigit() and pid != '0':
        try:
            source = os.path.realpath('/proc/' + pid + '/exe')
        except OSError:
            source = ''
    if not source or not os.path.isfile(source):
        source = shutil.which('nowhere') or ''
    version = ''
    if source:
        checked = run([source, '--version'], 5)
        version = ((checked.stdout or '') + '\n' + (checked.stderr or '')).strip().splitlines()[0][:160]
    emit({
        'ok': True,
        'root': True,
        'systemd': True,
        'portAvailable': True,
        'portsAvailable': [{'transport': transport, 'port': port} for transport, port in normalized_ports],
        'binaryAvailable': bool(source),
        'binaryVersion': version,
        'architecture': platform.machine().lower(),
        'certificateToolAvailable': bool(shutil.which('openssl')),
        'existingNowhere': active('nowhere.service'),
        'existingSingBox': active('sing-box.service'),
    })
except subprocess.TimeoutExpired:
    stop('timeout')
except Exception:
    stop('preflight-failed')
