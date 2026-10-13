import ast
import hashlib
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import types

SOURCE=pathlib.Path(__file__).resolve().parents[1]/'tools/nowhere-binary-upgrade.py'

class MigrationTransactionTest(unittest.TestCase):
    def execute(self,running=False,fail_start=False,stale=False):
        with tempfile.TemporaryDirectory(prefix='nw3-migration-') as tmp:
            binary=pathlib.Path(tmp)/'nowhere';env=pathlib.Path(tmp)/'nowhere.env';unit=pathlib.Path(tmp)/'unit.service'
            binary.write_text('old binary');unit.touch();old='NOWHERE_PORTAL="portal://'+'a'*64+'@localhost:2077"\n';env.write_text(old)
            new='NOWHERE_PORTAL="portal://'+'b'*32+'@localhost:2077?tls=1&morph=0&out=direct"\nNOWHERE_VERSION_VALUE="v3.0.0"\n'
            payload={'binaryPath':str(binary),'environmentPath':str(env),'unitPath':str(unit),'unitName':'fixture.service','targetVersion':'v3.0.0','migration':True,'targetEnvironment':new,'expectedHash':('0'*64 if stale else hashlib.sha256(old.encode()).hexdigest())}
            states=['active' if running else 'inactive'];calls=[];outputs=[];starts=[0]
            def run(args,timeout):
                calls.append(args)
                if args[1]=='--version':return types.SimpleNamespace(returncode=0,stdout='nowhere-v3.0.0',stderr='')
                if args[:2]==['systemctl','stop']:states[0]='inactive'
                if args[:2]==['systemctl','start']:
                    starts[0]+=1
                    if fail_start and starts[0]==1:return types.SimpleNamespace(returncode=1,stdout='',stderr='')
                    states[0]='active'
                return types.SimpleNamespace(returncode=0,stdout='',stderr='')
            def stop(error,**extra):outputs.append({'ok':False,'error':error,**extra});raise SystemExit()
            tree=ast.parse(SOURCE.read_text());tree.body=[node for node in tree.body if not isinstance(node,ast.FunctionDef) or node.name!='download_release']
            globals={'P':payload,'run':run,'active':lambda unit:states[0],'stop':stop,'emit':outputs.append,'download_release':lambda version,destination:pathlib.Path(destination).write_text('new binary')}
            with patch('os.geteuid',return_value=0),patch('time.sleep'):
                try:exec(compile(tree,str(SOURCE),'exec'),globals)
                except SystemExit:pass
            if stale or fail_start:
                self.assertEqual(env.read_text(),old);self.assertEqual(binary.read_text(),'old binary')
            else:
                self.assertIn('out=direct',env.read_text());self.assertEqual(binary.read_text(),'new binary');self.assertEqual(pathlib.Path(str(env)+'.nw2-backup').read_text(),old);self.assertEqual(pathlib.Path(str(binary)+'.nw2-backup').read_text(),'old binary')
            self.assertEqual(states[0],'active' if running else 'inactive')
            if stale:self.assertFalse(any(cmd[0]=='systemctl' for cmd in calls))
            return outputs[-1],calls
    def test_running_success(self):self.assertTrue(self.execute(running=True)[0]['ok'])
    def test_stopped_success_validates_then_stops(self):
        result,calls=self.execute();self.assertTrue(result['ok']);self.assertTrue(any(c[:2]==['systemctl','start'] for c in calls))
    def test_running_failure_restores_both(self):self.assertTrue(self.execute(running=True,fail_start=True)[0]['rolledBack'])
    def test_stopped_failure_restores_both(self):self.assertTrue(self.execute(fail_start=True)[0]['rolledBack'])
    def test_configuration_changed_before_stop(self):self.assertEqual(self.execute(stale=True)[0]['error'],'configuration-changed')
