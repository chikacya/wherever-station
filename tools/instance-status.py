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
    'tlsPayloadUp', 'tlsPayloadDown', 'quicPayloadUp', 'quicPayloadDown',
    'tcpActive', 'udpActive', 'tlsCarriersActive', 'quicCarriersActive',
    'pingMs', 'cpuPercent', 'rssBytes', 'openFds',
)
LOSSLESS_COUNTERS = {
    'tcpLogicalUp', 'tcpLogicalDown', 'udpLogicalUp', 'udpLogicalDown',
    'tlsPayloadUp', 'tlsPayloadDown', 'quicPayloadUp', 'quicPayloadDown',
}

IPC_READER = r'''
import json,os,pathlib,re,socket,stat,struct,sys
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
 return json.loads(body.decode('utf-8'))
def send(sock,value):
 body=json.dumps(value,separators=(',',':')).encode('utf-8')
 if not body or len(body)>1024: raise RuntimeError('invalid-command')
 sock.sendall(struct.pack('>I',len(body))+body)
def process_uid(value):
 for line in open('/proc/%d/status'%value,encoding='utf-8'):
  if line.startswith('Uid:'): return int(line.split()[1])
 raise RuntimeError('missing-uid')
def process_incarnation(value):
 raw=open('/proc/%d/stat'%value,encoding='utf-8').read(); close=raw.rfind(')')
 if close<0: raise RuntimeError('invalid-stat')
 return int(raw[close+2:].split()[19])
def namespace(value):
 boot=open('/proc/sys/kernel/random/boot_id',encoding='utf-8').read().strip()
 return '%s;%s;%s'%(boot,os.readlink('/proc/%d/ns/pid'%value),os.readlink('/proc/%d/ns/user'%value))
uid=process_uid(pid); directory=pathlib.Path('/tmp')/('nowhere-telemetry-%d'%uid)
try:
 directory_stat=os.lstat(directory)
 if not stat.S_ISDIR(directory_stat.st_mode) or directory_stat.st_uid!=uid or stat.S_IMODE(directory_stat.st_mode)!=0o700: raise RuntimeError('unsafe-directory')
 paths=sorted(directory.glob('nowhere.*.json'))
except Exception: paths=[]
for path in paths:
 try:
  path_stat=os.lstat(path)
  if not stat.S_ISREG(path_stat.st_mode) or path_stat.st_uid!=uid or stat.S_IMODE(path_stat.st_mode)!=0o600: continue
  descriptor_fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
  with os.fdopen(descriptor_fd,encoding='utf-8') as descriptor_file:
   payload=descriptor_file.read(4097)
  if len(payload)>4096: continue
  entry=json.loads(payload); identity=entry.get('instance',{}); name=identity.get('registry_name','')
  match=re.fullmatch(r'nowhere\.([0-9a-f]{32})',name)
  if not match or path.name!=name+'.json' or identity.get('pid')!=pid or identity.get('uid')!=uid: continue
  if identity.get('incarnation')!=process_incarnation(pid): continue
  if entry.get('protocol')!='nowhere.telemetry' or entry.get('transport')!='unix_socket' or entry.get('namespace')!=namespace(pid): continue
  endpoint=pathlib.Path(entry.get('endpoint',''))
  if endpoint!=directory/(match.group(1)[:16]+'.sock'): continue
  endpoint_stat=os.lstat(endpoint)
  if not stat.S_ISSOCK(endpoint_stat.st_mode) or endpoint_stat.st_uid!=uid or stat.S_IMODE(endpoint_stat.st_mode)!=0o600: continue
  sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); sock.settimeout(1.2); sock.connect(str(endpoint))
  if hasattr(socket,'SO_PEERCRED'):
   peer_pid,peer_uid,_=struct.unpack('3i',sock.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,struct.calcsize('3i')))
   if peer_pid!=pid or peer_uid!=uid: raise RuntimeError('peer-mismatch')
  hello=receive(sock); descriptor=hello.get('data',{}).get('instance',{})
  if hello.get('type')!='hello' or descriptor.get('telemetry_protocol')!='nowhere.telemetry' or descriptor.get('id')!=match.group(1) or descriptor.get('pid')!=pid: raise RuntimeError('hello-mismatch')
  send(sock,{'type':'subscribe','data':{'request_id':1,'subscription':'summary'}})
  subscribed=False; snapshot=None; lifecycle=None
  for _ in range(6):
   message=receive(sock); data=message.get('data',{})
   if message.get('type')=='subscribed' and data.get('request_id')==1 and data.get('subscription')=='summary': subscribed=True
   elif message.get('type')=='snapshot': snapshot=message
   elif message.get('type')=='lifecycle': lifecycle=data
   if subscribed and snapshot is not None and lifecycle is not None: break
  sock.close()
  if not subscribed or snapshot is None: continue
  data=snapshot.get('data',{})
  allowed=['sequence','timestamp_ms','uptime_ms','tcp_logical_up','tcp_logical_down','udp_logical_up','udp_logical_down','tls_payload_up','tls_payload_down','quic_payload_up','quic_payload_down','tcp_active','udp_active','tls_carriers_active','quic_carriers_active','ping_ms','cpu_percent','rss_bytes','open_fds']
  clean={key:data.get(key) for key in allowed}
  for key in ['tcp_logical_up','tcp_logical_down','udp_logical_up','udp_logical_down','tls_payload_up','tls_payload_down','quic_payload_up','quic_payload_down']:
   if isinstance(clean.get(key),int) and not isinstance(clean.get(key),bool) and clean[key]>=0: clean[key]=str(clean[key])
  hello_data=hello.get('data',{})
  clean['lifecycle']=(lifecycle or {}).get('state',hello_data.get('lifecycle',''))
  clean['lifecycle_reason']=(lifecycle or {}).get('reason',hello_data.get('lifecycle_reason',''))
  clean['role']=descriptor.get('role',''); clean['version']=descriptor.get('version','')
  clean['service_endpoint']=descriptor.get('endpoint',''); clean['config_summary']=descriptor.get('config_summary','')
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
        elif output in LOSSLESS_COUNTERS and isinstance(value, str) and re.fullmatch(r'[0-9]{1,20}', value):
            result[output] = value
    lifecycle = str(raw.get('lifecycle', ''))[:16].upper()
    reason = str(raw.get('lifecycle_reason', ''))[:64].upper()
    if lifecycle in ('STARTING', 'READY', 'DRAINING', 'STOPPED'):
        result['lifecycle'] = lifecycle
    if re.fullmatch(r'[A-Z0-9_-]{1,64}', reason):
        result['lifecycleReason'] = reason
    role = str(raw.get('role', '')).lower()
    if role in ('portal', 'vector'):
        result['role'] = role
    version = str(raw.get('version', ''))[:64]
    if re.fullmatch(r'v?2\.[0-9]+\.[0-9]+(?:[.-][A-Za-z0-9._-]+)?', version):
        result['version'] = version
    for source_key, output_key, maximum in (
        ('service_endpoint', 'serviceEndpoint', 512), ('config_summary', 'configSummary', 4096),
    ):
        value = str(raw.get(source_key, ''))[:maximum]
        if value and not any(ord(character) < 32 or ord(character) == 127 for character in value):
            result[output_key] = value
    return result

def read_ipc(pid):
    if pid <= 0 or not shutil.which('nsenter'):
        return None
    try:
        value = subprocess.run(['nsenter', '-t', str(pid), '-m', '--', 'python3', '-c', IPC_READER, str(pid)],
                               capture_output=True, text=True, timeout=3, check=False)
        if value.returncode != 0 or not value.stdout.strip():
            return None
        return clean_telemetry(json.loads(value.stdout.splitlines()[-1]), 'local')
    except Exception:
        return None

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
        item['telemetry'] = read_ipc(pid) or {'source': 'unavailable'}
    elif target.get('kind') == 'sing-box' and item['state'] == 'active':
        def number(name):
            try: return max(0, int(row.get(name, '0')))
            except (TypeError, ValueError): return 0
        item['telemetry'] = {'source': 'systemd', 'cpuUsageNs': number('CPUUsageNSec'), 'rssBytes': number('MemoryCurrent')}
    states.append(item)
print('PCSTATES\t1\t' + base64.b64encode(json.dumps({'states': states}).encode()).decode())
