import base64
import datetime
import json
import re
import shutil
import subprocess
import sys

TELEMETRY_FIELDS = (
    'sequence', 'timestampMs', 'uptimeMs',
    'tcpLogicalUp', 'tcpLogicalDown', 'udpLogicalUp', 'udpLogicalDown',
    'tlsWireUp', 'tlsWireDown', 'quicWireUp', 'quicWireDown',
    'tcpActive', 'udpActive', 'tlsCarriersActive', 'quicCarriersActive',
    'pingMs', 'cpuPercent', 'rssBytes', 'openFds',
)

IPC_READER = r'''
import glob,json,ipaddress,re,socket,struct,sys
pid=int(sys.argv[1]); maximum=65536
def receive(sock):
 head=b''
 while len(head)<4:
  part=sock.recv(4-len(head))
  if not part: raise RuntimeError('short-frame')
  head+=part
 size=struct.unpack('>I',head)[0]
 if size<2 or size>maximum: raise RuntimeError('invalid-frame')
 body=b''
 while len(body)<size:
  part=sock.recv(size-len(body))
  if not part: raise RuntimeError('short-frame')
  body+=part
 return json.loads(body)
for path in sorted(glob.glob('/tmp/nowhere-telemetry-v2-*/*.json')):
 try:
  entry=json.load(open(path,encoding='utf-8')); identity=entry['instance']
  name=identity['registry_name']
  if identity['pid']!=pid or not re.fullmatch(r'nowhere\.v2\.\d+\.%d\.\d+'%pid,name): continue
  host,port=entry['address'].rsplit(':',1)
  if not ipaddress.ip_address(host).is_loopback: continue
  sock=socket.create_connection((host,int(port)),timeout=.8); sock.settimeout(.8)
  hello=receive(sock); snapshot=receive(sock); sock.close()
  descriptor=hello.get('data',{}).get('instance',{})
  if hello.get('type')!='hello' or snapshot.get('type')!='snapshot': continue
  if descriptor.get('protocol_version')!=2 or descriptor.get('pid')!=pid: continue
  data=snapshot.get('data',{})
  allowed=['sequence','timestamp_ms','uptime_ms','tcp_logical_up','tcp_logical_down','udp_logical_up','udp_logical_down','tls_wire_up','tls_wire_down','quic_wire_up','quic_wire_down','tcp_active','udp_active','tls_carriers_active','quic_carriers_active','ping_ms','cpu_percent','rss_bytes','open_fds']
  clean={key:data.get(key) for key in allowed}
  clean['lifecycle']=hello.get('data',{}).get('lifecycle','')
  clean['lifecycle_reason']=hello.get('data',{}).get('lifecycle_reason','')
  print(json.dumps(clean,separators=(',',':'))); raise SystemExit(0)
 except SystemExit: raise
 except Exception: continue
raise SystemExit(1)
'''

def camel(name):
    parts = name.split('_')
    return parts[0] + ''.join(part.title() for part in parts[1:])

def clean_telemetry(raw, source):
    result = {'source': source}
    for key, value in raw.items():
        output = camel(key)
        if output in TELEMETRY_FIELDS and isinstance(value, (int, float)) and not isinstance(value, bool):
            result[output] = value
    lifecycle = str(raw.get('lifecycle', ''))[:16].upper()
    reason = str(raw.get('lifecycle_reason', ''))[:32].upper()
    if lifecycle in ('STARTING', 'READY', 'DRAINING', 'STOPPED'):
        result['lifecycle'] = lifecycle
    if re.fullmatch(r'[A-Z0-9_-]{1,32}', reason):
        result['lifecycleReason'] = reason
    return result

def read_ipc(pid):
    if pid <= 0 or not shutil.which('nsenter'):
        return None
    try:
        value = subprocess.run(['nsenter', '-t', str(pid), '-m', '--', 'python3', '-c', IPC_READER, str(pid)],
                               capture_output=True, text=True, timeout=3, check=False)
        if value.returncode != 0 or not value.stdout.strip():
            return None
        return clean_telemetry(json.loads(value.stdout.splitlines()[-1]), 'ipc')
    except Exception:
        return None

def read_checkpoint(unit):
    try:
        value = subprocess.run(['journalctl', '--unit', unit, '--no-pager', '-n', '40', '-o', 'cat'],
                               capture_output=True, text=True, timeout=3, check=False)
    except Exception:
        return None
    line = next((item for item in reversed(value.stdout.splitlines()) if 'CHECK_POINT|' in item), '')
    fields = dict(re.findall(r'(PING|TCPS|UDPS|TCPRX|TCPTX|UDPRX|UDPTX)=([0-9]+)', line))
    if not all(key in fields for key in ('TCPRX', 'TCPTX', 'UDPRX', 'UDPTX')):
        return None
    return clean_telemetry({
        'tcp_logical_up': int(fields['TCPRX']), 'tcp_logical_down': int(fields['TCPTX']),
        'udp_logical_up': int(fields['UDPRX']), 'udp_logical_down': int(fields['UDPTX']),
        'tcp_active': int(fields.get('TCPS', 0)), 'udp_active': int(fields.get('UDPS', 0)),
        'ping_ms': int(fields.get('PING', 0)),
    }, 'checkpoint')

targets = json.loads(base64.b64decode(sys.argv[1]))
units = [target['unit'] for target in targets]
result = subprocess.run(['systemctl', 'show', '--no-pager', '--property=Id,LoadState,ActiveState,SubState,MainPID,CPUUsageNSec,MemoryCurrent'] + units,
                        capture_output=True, text=True, timeout=10, check=False)
records = {}
for block in result.stdout.strip().split('\n\n'):
    row = dict(line.split('=', 1) for line in block.splitlines() if '=' in line)
    if row.get('Id'):
        records[row['Id']] = row
observed = datetime.datetime.now(datetime.timezone.utc).isoformat()
states = []
for target in targets:
    row = records.get(target['unit'])
    pid = int(row.get('MainPID', '0')) if row else 0
    item = {'instanceId': target['instanceId'], 'observedAt': observed,
            'state': row.get('ActiveState', 'unknown') if row else 'unknown',
            'loaded': row.get('LoadState') == 'loaded' if row else False,
            'subState': row.get('SubState', '') if row else '', 'pid': pid}
    if target.get('kind') == 'nowhere' and item['state'] == 'active':
        item['telemetry'] = read_ipc(pid) or read_checkpoint(target['unit']) or {'source': 'unavailable'}
    elif target.get('kind') == 'sing-box' and item['state'] == 'active':
        def number(name):
            try: return max(0, int(row.get(name, '0')))
            except (TypeError, ValueError): return 0
        item['telemetry'] = {'source': 'systemd', 'cpuUsageNs': number('CPUUsageNSec'), 'rssBytes': number('MemoryCurrent')}
    states.append(item)
print('PCSTATES\t1\t' + base64.b64encode(json.dumps({'states': states}).encode()).decode())
