import base64
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "tools/sing-box-update.py"

class SingBoxUpdateTest(unittest.TestCase):
    def execute(self, running=False, stale=False, reject=False, fail_restart=False, locked=False):
        with tempfile.TemporaryDirectory(prefix="wherever-sing-update-") as directory:
            root = pathlib.Path(directory).resolve()
            config = root / "config.json"
            binary = root / "sing-box"
            old = b'{"inbounds":[{"type":"vmess","listen_port":10001}]}\n'
            new = b'{"inbounds":[{"type":"vmess","listen_port":10002}]}\n'
            config.write_bytes(old); binary.touch(); binary.chmod(0o755)
            results, commands = [], []
            def run(args, timeout):
                commands.append(args)
                failed = reject and args[0] == str(binary)
                if fail_restart and args[:2] == ["systemctl", "restart"]: failed = True
                return types.SimpleNamespace(returncode=1 if failed else 0)
            def stop(error, **extra):
                results.append({"ok": False, "error": error, **extra})
                raise SystemExit(0)
            scope = dict(os=os, json=json, base64=base64, subprocess=subprocess, P={
                "directory": str(root), "configPath": str(config), "binaryPath": str(binary),
                "unitName": "proxy-console-singbox@test.service",
                "expectedHash": "0" * 64 if stale else hashlib.sha256(old).hexdigest(),
                "configuration": base64.b64encode(new).decode(),
            }, active=lambda _: "active" if running else "inactive", run=run, stop=stop, emit=results.append)
            import fcntl
            held = open(str(config) + ".update-lock", "a") if locked else None
            if held: fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch("os.geteuid", return_value=0), patch("time.sleep"):
                try: exec(compile(SCRIPT.read_text(), str(SCRIPT), "exec"), scope)
                except SystemExit: pass
            if scope.get("lock"): scope["lock"].close()
            if held: held.close()
            return results[-1], config.read_bytes(), commands

    def test_stopped_candidate_is_checked_without_restart(self):
        result, data, commands = self.execute()
        self.assertTrue(result["ok"])
        self.assertIn("configurationHash", result)
        self.assertEqual(data, b'{"inbounds":[{"type":"vmess","listen_port":10002}]}\n')
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0][1:3], ["check", "-c"])

    def test_running_update_restarts_only_owned_unit(self):
        result, _, commands = self.execute(running=True)
        self.assertTrue(result["ok"])
        self.assertEqual(commands[-1], ["systemctl", "restart", "proxy-console-singbox@test.service"])

    def test_kernel_rejection_keeps_old_config(self):
        result, data, commands = self.execute(reject=True)
        self.assertEqual(result["error"], "kernel-rejected")
        self.assertIn(b"10001", data)
        self.assertEqual(len(commands), 1)

    def test_restart_failure_rolls_back(self):
        result, data, commands = self.execute(running=True, fail_restart=True)
        self.assertTrue(result["rolledBack"])
        self.assertIn(b"10001", data)
        self.assertEqual(sum(item[:2] == ["systemctl", "restart"] for item in commands), 2)

    def test_stale_and_locked_updates_do_not_write(self):
        for options, error in [({"stale": True}, "configuration-changed"), ({"locked": True}, "update-in-progress")]:
            result, data, _ = self.execute(**options)
            self.assertEqual(result["error"], error)
            self.assertIn(b"10001", data)

if __name__ == "__main__":
    unittest.main()
