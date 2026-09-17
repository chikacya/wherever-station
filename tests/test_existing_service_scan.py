import base64
import json
import os
import pathlib
import stat
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCANNER = ROOT / "tools" / "existing-service-scan.py"


class ExistingServiceScanTests(unittest.TestCase):
    def test_nowhere_sh_and_sing_box_are_discovered_without_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            nowhere_env = root / "nowhere.env"
            nowhere_env.write_text(
                "\n".join([
                    "NOWHERE_VERSION_VALUE='v1.8.1'",
                    "NOWHERE_PUBLIC_HOST_VALUE='nowhere.example.com'",
                    "NOWHERE_PORT_VALUE='2077'",
                    "NOWHERE_KEY_VALUE='secret value'",
                    "NOWHERE_NET_VALUE='mix'",
                    "NOWHERE_ALPN_VALUE='now/1'",
                ]) + "\n",
                encoding="utf-8",
            )
            sing_config = root / "sing-box.json"
            sing_config.write_text(json.dumps({"inbounds": [{"type": "shadowsocks", "tag": "SS 2022", "listen": "::", "listen_port": 8388, "method": "2022-blake3-aes-128-gcm", "password": "password"}]}), encoding="utf-8")
            nowhere_unit = root / "nowhere.service"
            nowhere_unit.write_text(f"[Service]\nEnvironmentFile={nowhere_env}\nExecStart=/usr/local/bin/nowhere\n", encoding="utf-8")
            sing_unit = root / "sing-box.service"
            sing_unit.write_text(f"[Service]\nExecStart=/usr/bin/sing-box run -c {sing_config}\n", encoding="utf-8")
            systemctl = bin_dir / "systemctl"
            systemctl.write_text(
                "#!/bin/sh\n"
                "if [ \"$1\" = list-unit-files ]; then printf 'nowhere.service enabled\\nsing-box.service enabled\\n'; exit 0; fi\n"
                "unit=$2\n"
                "printf 'LoadState=loaded\\nActiveState=active\\nSubState=running\\nMainPID=0\\n'\n"
                "if [ \"$unit\" = nowhere.service ]; then printf 'FragmentPath=%s/nowhere.service\\n' \"$DISCOVERY_FIXTURE_ROOT\"; else printf 'FragmentPath=%s/sing-box.service\\n' \"$DISCOVERY_FIXTURE_ROOT\"; fi\n",
                encoding="utf-8",
            )
            systemctl.chmod(systemctl.stat().st_mode | stat.S_IXUSR)
            payload = base64.b64encode(json.dumps({"publicHost": "agent.example.com", "machineName": "测试 VPS"}).encode()).decode()
            environment = {**os.environ, "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}", "DISCOVERY_FIXTURE_ROOT": str(root)}
            result = subprocess.run(["python3", str(SCANNER), payload], capture_output=True, text=True, env=environment, timeout=10, check=True)
            line = next(item for item in result.stdout.splitlines() if item.startswith("PCDISCOVERY\t1\t"))
            document = json.loads(base64.b64decode(line.split("\t", 2)[2]).decode())
            self.assertTrue(document["ok"])
            self.assertEqual({item["protocol"] for item in document["candidates"]}, {"nowhere", "shadowsocks"})
            nowhere = next(item for item in document["candidates"] if item["protocol"] == "nowhere")
            self.assertIn("nowhere.example.com:2077", nowhere["uri"])
            self.assertIn("up=udp&down=udp", nowhere["uri"])
            self.assertEqual(document["needsReview"], [])
            self.assertEqual(nowhere_env.read_text(encoding="utf-8").count("NOWHERE_KEY_VALUE"), 1)


if __name__ == "__main__":
    unittest.main()
