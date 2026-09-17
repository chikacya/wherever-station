import pathlib
import tempfile
import hashlib
import json
import types
import unittest
from unittest.mock import patch
import os
import sys

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'tools/nowhere-update.py'

class UpdateTest(unittest.TestCase):
    def execute(self, running=False, fail_restart=False, fail_start=False, stale=False, locked=False, interrupted=False):
        with tempfile.TemporaryDirectory(prefix='wherever-update-test-') as directory:
            env = pathlib.Path(directory) / 'nowhere.env'
            unit = pathlib.Path(directory) / 'owned.service'
            env.write_bytes(b'OLD=config\n')
            unit.touch()
            expected = hashlib.sha256(env.read_bytes()).hexdigest()
            if interrupted:
                pathlib.Path(str(env) + '.rollback').write_bytes(b'OLD=config\n')
                pathlib.Path(str(env) + '.transaction').write_text(json.dumps({'schema': 1, 'wasRunning': False}))
                env.write_bytes(b'INTERRUPTED=config\n')
            results, commands = [], []
            current = ['active' if running else 'inactive']
            def run(args, timeout):
                commands.append(args)
                failed = (fail_restart and args[:2] == ['systemctl', 'restart'] and sum(item[:2] == ['systemctl', 'restart'] for item in commands) == 1) or (fail_start and args[:2] == ['systemctl', 'start'])
                if not failed and args[:2] == ['systemctl', 'start']: current[0] = 'active'
                if not failed and args[:2] == ['systemctl', 'stop']: current[0] = 'inactive'
                return types.SimpleNamespace(returncode=1 if failed else 0)
            def stop(error, **extra):
                results.append({'ok': False, 'error': error, **extra})
                raise SystemExit(0)
            scope = dict(os=os, sys=sys, P={
                'environmentPath': str(env), 'unitPath': str(unit), 'unitName': 'owned.service',
                'environment': 'NEW=config\n',
                'expectedHash': '0'*64 if stale else expected,
            }, active=lambda unit: current[0], run=run, stop=stop, emit=results.append)
            import fcntl
            held_lock = open(str(env) + '.update-lock', 'a') if locked else None
            if held_lock:
                fcntl.flock(held_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch('os.geteuid', return_value=0), patch('time.sleep'):
                try:
                    exec(compile(SCRIPT.read_text(), str(SCRIPT), 'exec'), scope)
                except SystemExit:
                    pass
            if held_lock:
                held_lock.close()
            return results[-1], env.read_bytes(), commands

    def test_stopped_update_is_briefly_validated_and_remains_stopped(self):
        result, data, commands = self.execute()
        self.assertTrue(result['ok'])
        self.assertEqual(data, b'NEW=config\n')
        self.assertEqual(commands, [['systemctl', 'start', 'owned.service'], ['systemctl', 'stop', 'owned.service']])
        self.assertEqual(result['state'], 'inactive')

    def test_running_update_only_restarts_owned_unit(self):
        result, data, commands = self.execute(running=True)
        self.assertTrue(result['ok'])
        self.assertEqual(commands, [['systemctl', 'restart', 'owned.service']])

    def test_restart_failure_restores_previous_config(self):
        result, data, commands = self.execute(running=True, fail_restart=True)
        self.assertTrue(result['rolledBack'])
        self.assertEqual(data, b'OLD=config\n')
        self.assertEqual(len(commands), 2)

    def test_stopped_start_failure_restores_previous_config(self):
        result, data, commands = self.execute(fail_start=True)
        self.assertTrue(result['rolledBack'])
        self.assertEqual(data, b'OLD=config\n')
        self.assertEqual(commands[-1], ['systemctl', 'stop', 'owned.service'])

    def test_stale_version_does_not_change_config(self):
        result, data, commands = self.execute(stale=True)
        self.assertEqual(result['error'], 'configuration-changed')
        self.assertEqual(data, b'OLD=config\n')
        self.assertEqual(commands, [])

    def test_concurrent_update_does_not_overwrite(self):
        result, data, commands = self.execute(running=True, locked=True)
        self.assertEqual(result['error'], 'update-in-progress')
        self.assertEqual(data, b'OLD=config\n')
        self.assertEqual(commands, [])

    def test_interrupted_transaction_is_recovered_before_next_update(self):
        result, data, commands = self.execute(interrupted=True)
        self.assertTrue(result['ok'])
        self.assertEqual(data, b'NEW=config\n')
        self.assertEqual(commands[0], ['systemctl', 'stop', 'owned.service'])

if __name__ == '__main__':
    unittest.main()
