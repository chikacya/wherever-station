import ast
import json
import os
import pathlib
import socket
import struct
import subprocess
import tempfile
import threading
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'tools/instance-status.py'
TREE = ast.parse(SOURCE.read_text())
READER = next(ast.literal_eval(node.value) for node in TREE.body if isinstance(node, ast.Assign) and any(getattr(n, 'id', '') == 'IPC_READER' for n in node.targets))

class PassiveTelemetryTest(unittest.TestCase):
    def sample(self, bad_id=False):
        with tempfile.TemporaryDirectory(prefix='nw3-', dir='/tmp') as tmp:
            uid, pid = os.getuid(), os.getpid()
            instance = 'a' * 32
            directory = pathlib.Path(tmp) / ('nowhere-telemetry-%d' % uid)
            directory.mkdir(mode=0o700)
            endpoint = directory / (instance[:16] + '.sock')
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            server.bind(str(endpoint)); os.chmod(endpoint, 0o600); server.listen(1)
            entry = {'protocol':'nowhere.telemetry', 'transport':'unix_socket', 'namespace':'fixture', 'endpoint':str(endpoint), 'instance':{'registry_name':'nowhere.'+instance, 'uid':uid, 'pid':pid, 'incarnation':123}}
            registry = directory / ('nowhere.'+instance+'.json')
            registry.write_text(json.dumps(entry)); os.chmod(registry,0o600)
            writes = []
            def serve():
                conn, _ = server.accept()
                with conn:
                    frames=[{'type':'hello','data':{'instance':{'contract':'nowhere.telemetry','id':'b'*32 if bad_id else instance,'pid':pid,'role':'egress','version':'3.0.0','endpoint':'127.0.0.1:2077'}}}, {'type':'snapshot','data':{'tcp_upload_bytes':2**64-1,'tcp_download_bytes':1,'udp_upload_bytes':2,'udp_download_bytes':3,'tcp_active':2,'udp_active':1}}]
                    try:
                        for frame in frames:
                            body=json.dumps(frame).encode(); wire=struct.pack('>I',len(body))+body
                            for part in (wire[:2],wire[2:5],wire[5:]): conn.sendall(part)
                        conn.settimeout(.5); writes.append(conn.recv(1024))
                    except (OSError, socket.timeout): pass
            thread=threading.Thread(target=serve); thread.start()
            injection="process_uid=lambda value:%d\nprocess_incarnation=lambda value:123\nnamespace=lambda value:'fixture'\n" % uid
            reader=READER.replace("uid=process_uid(pid);",injection+"uid=process_uid(pid);").replace("pathlib.Path('/tmp')", "pathlib.Path(%r)" % tmp)
            try: result=subprocess.run(['python3','-c',reader,str(pid)],capture_output=True,text=True,timeout=3)
            finally: thread.join(timeout=2); server.close()
            self.assertTrue(all(value == b'' for value in writes), 'NW3 collector sent a command')
            return result

    def test_passive_fragmented_snapshot_keeps_uint64(self):
        result=self.sample()
        self.assertEqual(result.returncode,0,result.stderr)
        sample=json.loads(result.stdout)
        self.assertEqual(sample['tcp_logical_up'],str(2**64-1))
        self.assertEqual(sample['wire_protocol'],'nw3')
        self.assertEqual(sample['role'],'egress')
        self.assertIsNone(sample['cpu_percent'])

    def test_hello_identity_mismatch_rejects_statistics(self):
        result=self.sample(bad_id=True)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(result.stdout)
