import io
import hashlib
import json
import os
import pathlib
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCOPE = {'os': os, 'shutil': shutil}
exec((pathlib.Path(__file__).resolve().parents[1] / 'tools/download-sing-box.py').read_text(), SCOPE)

class DownloadTest(unittest.TestCase):
    def test_installs_only_private_binary(self):
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w:gz') as bundle:
            content = b'test executable'
            member = tarfile.TarInfo('sing-box-1.13.11-linux-amd64/sing-box')
            member.size = len(content)
            bundle.addfile(member, io.BytesIO(content))
        with tempfile.TemporaryDirectory() as directory:
            binary = os.path.join(directory, 'sing-box')
            release = json.dumps({'assets': [{'name': 'sing-box-1.13.11-linux-amd64.tar.gz', 'digest': 'sha256:' + hashlib.sha256(archive.getvalue()).hexdigest()}]}).encode()
            calls = []
            def response(request, **_kwargs):
                calls.append(request.full_url if hasattr(request, 'full_url') else request)
                return io.BytesIO(release if hasattr(request, 'full_url') else archive.getvalue())
            with patch('platform.machine', return_value='x86_64'), patch('urllib.request.urlopen', side_effect=response):
                SCOPE['install_release'](binary, '1.13.11')
            self.assertEqual(pathlib.Path(binary).read_bytes(), content)
            self.assertEqual(os.stat(binary).st_mode & 0o777, 0o755)
            self.assertTrue(any('/SagerNet/sing-box/releases/download/v1.13.11/' in url for url in calls))

    def test_download_failure_leaves_no_binary(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = os.path.join(directory, 'sing-box')
            with patch('platform.machine', return_value='arm64'), patch('urllib.request.urlopen', side_effect=OSError('offline')):
                with self.assertRaises(OSError):
                    SCOPE['install_release'](binary, '1.13.11')
            self.assertFalse(os.path.exists(binary))

    def test_digest_mismatch_is_rejected(self):
        release = json.dumps({'assets': [{'name': 'sing-box-1.13.11-linux-amd64.tar.gz', 'digest': 'sha256:' + '0' * 64}]}).encode()
        def response(request, **_kwargs):
            return io.BytesIO(release if hasattr(request, 'full_url') else b'not-the-official-archive')
        with tempfile.TemporaryDirectory() as directory:
            with patch('platform.machine', return_value='x86_64'), patch('urllib.request.urlopen', side_effect=response):
                with self.assertRaisesRegex(RuntimeError, 'release-digest-mismatch'):
                    SCOPE['install_release'](os.path.join(directory, 'sing-box'), '1.13.11')

if __name__ == '__main__':
    unittest.main()
