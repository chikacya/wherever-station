import pathlib
import types
import unittest

SOURCE = (pathlib.Path(__file__).resolve().parents[1] / 'tools/nowhere-status.py').read_text()


class FingerprintTest(unittest.TestCase):
    def details(self, values, stdout='a' * 64 + '\n', returncode=0):
        calls = []
        namespace = {'P': {'binaryPath': '/owned/bin/nowhere'},
                     'run': lambda args, timeout: calls.append((args, timeout)) or types.SimpleNamespace(stdout=stdout, returncode=returncode)}
        exec(SOURCE[:SOURCE.index('\ntry:\n    state =')], namespace)
        result = namespace['certificate_details'](values, 'active')
        return result, calls

    def test_morph_fingerprint_uses_local_agent_binary_and_tcp_port(self):
        result, calls = self.details({'NOWHERE_VERSION_VALUE': 'v2.2.0', 'NOWHERE_LISTEN_HOST_VALUE': '::',
                                     'NOWHERE_KEY_VALUE': 'a' * 64, 'NOWHERE_PORT_VALUE': '52077',
                                     'NOWHERE_TCP_PORT_VALUE': '52078', 'NOWHERE_MORPH_VALUE': '1'})
        self.assertEqual(result['fingerprint'], 'a' * 64)
        self.assertEqual(calls[0][0][:2], ['/owned/bin/nowhere', 'fingerprint'])
        self.assertIn('@[::1]/tcp:52078?morph=1', calls[0][0][2])

    def test_invalid_fingerprint_is_not_persisted(self):
        result, _ = self.details({'NOWHERE_VERSION_VALUE': 'v2.2.0'}, stdout='untrusted output')
        self.assertNotIn('fingerprint', result)
        self.assertEqual(result['note'], 'fingerprint-probe-failed')

    def test_udp_only_does_not_probe_tcp(self):
        result, calls = self.details({'NOWHERE_VERSION_VALUE': 'v2.2.0', 'NOWHERE_NET_VALUE': 'udp'})
        self.assertEqual(result['note'], 'fingerprint-unavailable-udp-only')
        self.assertEqual(calls, [])
