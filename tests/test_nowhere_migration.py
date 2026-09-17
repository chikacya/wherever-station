import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]


class Stopped(Exception):
    def __init__(self, error, extra):
        super().__init__(error)
        self.error = error
        self.extra = extra


class NowhereMigrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp(prefix='wherever-migration-'))
        self.instance = self.temp / 'instance'
        (self.instance / 'bin').mkdir(parents=True)
        self.binary = self.instance / 'bin' / 'nowhere'
        self.environment = self.instance / 'nowhere.env'
        self.unit = self.temp / 'owned.service'
        self.binary.write_text('v1-binary')
        self.binary.chmod(0o755)
        self.v1_environment = 'NOWHERE_VERSION_VALUE="v1.8.3"\nNOWHERE_PORT_VALUE="32077"\n'
        self.v2_environment = 'NOWHERE_VERSION_VALUE="v2.0.0"\nNOWHERE_TCP_PORT_VALUE="32077"\nNOWHERE_UDP_PORT_VALUE="32077"\n'
        self.environment.write_text(self.v1_environment)
        self.unit.write_text('owned')
        self.state = 'active'
        self.emitted = []

    def tearDown(self):
        shutil.rmtree(self.temp, ignore_errors=True)

    def payload(self):
        return {
            'directory': str(self.instance), 'binaryPath': str(self.binary), 'environmentPath': str(self.environment),
            'unitPath': str(self.unit), 'unitName': 'owned.service', 'previousVersion': 'v1.8.3',
            'targetVersion': 'v2.0.0', 'environment': self.v2_environment,
        }

    def fake_run(self, args, timeout=15):
        if args[:2] == ['systemctl', 'stop']:
            self.state = 'inactive'
            return subprocess.CompletedProcess(args, 0, '', '')
        if args[:2] == ['systemctl', 'start']:
            self.state = 'active'
            return subprocess.CompletedProcess(args, 0, '', '')
        if args[0] == str(self.binary) or str(args[0]).endswith('.v2-next'):
            version = 'nowhere 2.0.0' if pathlib.Path(args[0]).read_text() == 'v2-binary' else 'nowhere 1.8.3'
            return subprocess.CompletedProcess(args, 0, version, '')
        return subprocess.CompletedProcess(args, 0, '', '')

    def execute(self, filename, payload, run=None):
        source = (ROOT / 'tools' / filename).read_text()
        if filename == 'nowhere-migrate-v2.py':
            marker = "candidate = P['binaryPath'] + '.v2-next'"
            replacement = "def download_release(version, destination):\n    pathlib.Path(destination).write_text('v2-binary')\n    os.chmod(destination, 0o755)\n\n" + marker
            source = source.replace(marker, replacement)
        namespace = {
            'P': payload, 'active': lambda _unit: self.state, 'run': run or self.fake_run,
            'emit': self.emitted.append, 'stop': lambda error, **extra: (_ for _ in ()).throw(Stopped(error, extra)),
            'subprocess': subprocess, 'pathlib': pathlib,
        }
        with mock.patch('os.geteuid', return_value=0):
            exec(compile(source, filename, 'exec'), namespace)

    def test_successful_migration_retains_v1_snapshot_and_can_rollback(self):
        self.execute('nowhere-migrate-v2.py', self.payload())
        migrated = self.emitted[-1]
        self.assertTrue(migrated['ok'])
        self.assertEqual(self.binary.read_text(), 'v2-binary')
        self.assertEqual(self.environment.read_text(), self.v2_environment)
        backup = pathlib.Path(migrated['backupDirectory'])
        self.assertEqual((backup / 'nowhere').read_text(), 'v1-binary')
        self.assertEqual((backup / 'nowhere.env').read_text(), self.v1_environment)
        self.assertFalse(pathlib.Path(str(self.environment) + '.transaction').exists())
        self.emitted.clear()
        rollback_payload = {**self.payload(), 'backupDirectory': str(backup)}
        self.execute('nowhere-rollback-v1.py', rollback_payload)
        self.assertTrue(self.emitted[-1]['ok'])
        self.assertTrue(self.emitted[-1]['rolledBack'])
        self.assertEqual(self.binary.read_text(), 'v1-binary')
        self.assertEqual(self.environment.read_text(), self.v1_environment)

    def test_failed_v2_start_restores_v1_and_original_running_state(self):
        def fail_v2(args, timeout=15):
            if args[:2] == ['systemctl', 'start'] and self.binary.read_text() == 'v2-binary':
                self.state = 'failed'
                return subprocess.CompletedProcess(args, 1, '', 'failed')
            return self.fake_run(args, timeout)
        with self.assertRaises(Stopped) as caught:
            self.execute('nowhere-migrate-v2.py', self.payload(), fail_v2)
        self.assertEqual(caught.exception.error, 'start-failed')
        self.assertTrue(caught.exception.extra['rolledBack'])
        self.assertEqual(self.state, 'active')
        self.assertEqual(self.binary.read_text(), 'v1-binary')
        self.assertEqual(self.environment.read_text(), self.v1_environment)


if __name__ == '__main__':
    unittest.main()
