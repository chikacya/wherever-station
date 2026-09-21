import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ip_profile', Path(__file__).resolve().parents[1] / 'tools/ip-profile-check.py')
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)


class IpProfileTests(unittest.TestCase):
    def test_http_status_does_not_claim_service_support(self):
        for code, expected in [(200, 'REACHABLE'), (403, 'BLOCKED'), (429, 'UNKNOWN'), (500, 'UNKNOWN'), (0, 'UNKNOWN')]:
            with patch.object(profile, 'fetch', return_value=(code, '', '')):
                self.assertEqual(profile.endpoint('Claude', 'unused')['status'], expected)

    def test_identity_is_bound_to_selected_address(self):
        for ipv4, ipv6 in [('203.0.113.1', '2001:db8::1'), ('', '2001:db8::1')]:
            def fake_json(url, *args):
                if 'api4.ipify' in url:
                    return 200, {'ip': ipv4}, ''
                if 'api6.ipify' in url:
                    return 200, {'ip': ipv6}, ''
                if 'proxycheck' in url:
                    return 200, {}, ''
                return 200, {'ip': '2001:db8::99', 'country': 'Wrong country', 'fraudScore': 0}, ''
            output = io.StringIO()
            with patch.object(profile, 'fetch_json', side_effect=fake_json), patch.object(profile, 'fetch', return_value=(0, '', '')), contextlib.redirect_stdout(output):
                profile.main()
            result = json.loads(base64.b64decode(output.getvalue().strip().split('\t')[-1]))
            self.assertEqual(result['public_ip'], ipv4 or ipv6)
            self.assertEqual(result['addresses']['ipv4'], ipv4)
            self.assertEqual(result['location']['country'], '')
            self.assertIsNone(result['purity']['score'])
            self.assertNotIn('confidenceScore', result['purity'])


if __name__ == '__main__':
    unittest.main()
