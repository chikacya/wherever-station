import base64
import json
import os
import pathlib
import shutil
import stat
import subprocess
import tempfile
import unittest
import urllib.parse


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCANNER = ROOT / "tools" / "existing-service-scan.py"


class ExistingServiceScanTests(unittest.TestCase):
    def test_nowhere_sh_and_sing_box_are_discovered_without_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            nowhere_env = root / "nowhere.env"
            nowhere_binary = bin_dir / "nowhere"
            nowhere_binary.write_text("#!/bin/sh\nprintf 'nowhere 2.0.2\\n'\n", encoding="utf-8")
            nowhere_binary.chmod(nowhere_binary.stat().st_mode | stat.S_IXUSR)
            nowhere_env.write_text(
                "\n".join([
                    "NOWHERE_VERSION_VALUE='v2.0.2'",
                    "NOWHERE_PUBLIC_HOST_VALUE='nowhere.example.com'",
                    "NOWHERE_PORT_VALUE='2077'",
                    "NOWHERE_TCP_PORT_VALUE='2077'",
                    "NOWHERE_UDP_PORT_VALUE='2077'",
                    "NOWHERE_TCP_CARRIER_VALUE='tcp'",
                    "NOWHERE_UDP_CARRIER_VALUE='udp'",
                    "NOWHERE_KEY_VALUE='secret value'",
                    "NOWHERE_NET_VALUE='mix'",
                    "NOWHERE_ALPN_VALUE='nw2'",
                ]) + "\n",
                encoding="utf-8",
            )
            certificate = root / "server.crt"
            private_key = root / "server.key"
            certificate.write_text("fixture certificate", encoding="utf-8")
            private_key.write_text("fixture key", encoding="utf-8")
            tls = {"enabled": True, "server_name": "tls.example.com", "certificate_path": str(certificate), "key_path": str(private_key), "alpn": ["h3"]}
            sing_config = root / "sing-box.json"
            sing_config.write_text(json.dumps({"inbounds": [
                {"type": "shadowsocks", "tag": "SS 2022", "listen": "::", "listen_port": 8388, "method": "2022-blake3-aes-128-gcm", "password": "password"},
                {"type": "vless", "tag": "VLESS TLS", "listen_port": 443, "users": [{"name": "vless", "uuid": "00000000-0000-4000-8000-000000000001"}], "tls": tls},
                {"type": "vmess", "tag": "VMess TLS", "listen_port": 8443, "users": [{"name": "vmess", "uuid": "00000000-0000-4000-8000-000000000002"}], "transport": {"type": "ws", "path": "/ws"}, "tls": tls},
                {"type": "trojan", "tag": "Trojan", "listen_port": 9443, "users": [{"name": "trojan", "password": "trojan secret"}], "tls": tls},
                {"type": "hysteria2", "tag": "Hysteria2", "listen_port": 10443, "users": [{"name": "hy2", "password": "hy2 secret"}], "tls": tls},
                {"type": "tuic", "tag": "TUIC", "listen_port": 11443, "users": [{"name": "tuic", "uuid": "00000000-0000-4000-8000-000000000003", "password": "tuic secret"}], "tls": tls},
                {"type": "anytls", "tag": "AnyTLS", "listen_port": 12443, "users": [{"name": "anytls", "password": "anytls secret"}], "tls": tls},
            ]}), encoding="utf-8")
            nowhere_unit = root / "nowhere.service"
            nowhere_unit.write_text(f"[Service]\nEnvironmentFile={nowhere_env}\nExecStart={nowhere_binary}\n", encoding="utf-8")
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
            openssl = bin_dir / "openssl"
            openssl.write_text(
                "#!/bin/sh\n"
                "case \" $* \" in\n"
                "  *\" pkey \"*|*\" -pubkey \"*) printf 'PUBLIC KEY FIXTURE\\n';;\n"
                "  *) printf 'notAfter=Dec 31 23:59:59 2030 GMT\\nsubject=CN = tls.example.com\\nissuer=CN = tls.example.com\\nsha256 Fingerprint=AA:BB:CC:DD\\nX509v3 Subject Alternative Name:\\n    DNS:tls.example.com\\n';;\n"
                "esac\n",
                encoding="utf-8",
            )
            openssl.chmod(openssl.stat().st_mode | stat.S_IXUSR)
            payload = base64.b64encode(json.dumps({"publicHost": "agent.example.com", "machineName": "测试 VPS"}).encode()).decode()
            environment = {**os.environ, "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}", "DISCOVERY_FIXTURE_ROOT": str(root)}
            result = subprocess.run(["python3", str(SCANNER), payload], capture_output=True, text=True, env=environment, timeout=10, check=True)
            line = next(item for item in result.stdout.splitlines() if item.startswith("PCDISCOVERY\t1\t"))
            document = json.loads(base64.b64decode(line.split("\t", 2)[2]).decode())
            self.assertTrue(document["ok"])
            self.assertEqual({item["protocol"] for item in document["candidates"]}, {"nowhere", "shadowsocks", "vless", "vmess", "trojan", "hysteria2", "tuic", "anytls"})
            nowhere = next(item for item in document["candidates"] if item["protocol"] == "nowhere")
            self.assertIn("nowhere.example.com:2077", nowhere["uri"])
            self.assertIn("up=tcp&down=tcp", nowhere["uri"])
            self.assertTrue(nowhere["adoption"]["eligible"])
            self.assertEqual(nowhere["adoption"]["sourceUnit"], "nowhere.service")
            self.assertEqual(nowhere["adoption"]["sourceBinaryPath"], str(nowhere_binary.resolve()))
            self.assertEqual(nowhere["adoption"]["input"]["key"], "secret value")
            hysteria = next(item for item in document["candidates"] if item["protocol"] == "hysteria2")
            self.assertIn("pinSHA256=aabbccdd", hysteria["uri"])
            self.assertNotIn("insecure=1", hysteria["uri"])
            trojan = next(item for item in document["candidates"] if item["protocol"] == "trojan")
            self.assertIn("insecure=1", trojan["uri"])
            self.assertIn("sni=tls.example.com", trojan["uri"])
            vmess = next(item for item in document["candidates"] if item["protocol"] == "vmess")
            vmess_payload = json.loads(base64.b64decode(vmess["uri"].split("://", 1)[1]).decode("utf-8"))
            self.assertEqual(vmess_payload["allowInsecure"], "1")
            self.assertEqual(document["needsReview"], [])
            self.assertEqual(nowhere_env.read_text(encoding="utf-8").count("NOWHERE_KEY_VALUE"), 1)

    def test_vless_reality_public_key_falls_back_to_openssl(self):
        if not shutil.which("openssl"):
            self.skipTest("OpenSSL is required for the Reality fallback test")
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            private_key = base64.urlsafe_b64encode(bytes(range(1, 33))).decode().rstrip("=")
            config = root / "sing-box.json"
            config.write_text(json.dumps({"inbounds": [{
                "type": "vless", "tag": "Reality", "listen_port": 443,
                "users": [{"uuid": "00000000-0000-4000-8000-000000000001", "flow": "xtls-rprx-vision"}],
                "tls": {"enabled": True, "reality": {"enabled": True, "handshake": {"server": "www.example.com:443"}, "private_key": private_key, "short_id": ["0123456789abcdef"]}},
            }]}), encoding="utf-8")
            unit = root / "sing-box.service"
            unit.write_text(f"[Service]\nExecStart=/missing/sing-box run -c {config}\n", encoding="utf-8")
            systemctl = bin_dir / "systemctl"
            systemctl.write_text(
                "#!/bin/sh\n"
                "if [ \"$1\" = list-unit-files ]; then printf 'sing-box.service enabled\\n'; exit 0; fi\n"
                "printf 'LoadState=loaded\\nActiveState=active\\nSubState=running\\nMainPID=0\\nFragmentPath=%s/sing-box.service\\n' \"$DISCOVERY_FIXTURE_ROOT\"\n",
                encoding="utf-8",
            )
            systemctl.chmod(systemctl.stat().st_mode | stat.S_IXUSR)
            payload = base64.b64encode(json.dumps({"publicHost": "agent.example.com", "machineName": "Reality VPS"}).encode()).decode()
            environment = {**os.environ, "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}", "DISCOVERY_FIXTURE_ROOT": str(root)}
            result = subprocess.run(["python3", str(SCANNER), payload], capture_output=True, text=True, env=environment, timeout=10, check=True)
            line = next(item for item in result.stdout.splitlines() if item.startswith("PCDISCOVERY\t1\t"))
            document = json.loads(base64.b64decode(line.split("\t", 2)[2]).decode())
            self.assertFalse(any(item["protocol"] == "vless" for item in document["needsReview"]))
            reality = next(item for item in document["candidates"] if item["protocol"] == "vless")
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(reality["uri"]).query)
            self.assertEqual(query["sni"], ["www.example.com"])
            self.assertEqual(len(query["pbk"][0]), 43)


if __name__ == "__main__":
    unittest.main()
