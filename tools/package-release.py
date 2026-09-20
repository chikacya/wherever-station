"""Build a deterministic Komari plugin ZIP from explicit runtime files."""
import json
import pathlib
import stat
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'komari-plugin.json').read_text())
files = [root / name for name in ('komari-plugin.json', 'icon.svg', 'script.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.zh-CN.md')]
files += [path for path in (root / 'pages').rglob('*') if path.is_file()]
runtime_tools = (
    'certificate-manager.js', 'connectivity-check.js', 'conversion-contract.js', 'existing-service-discovery.js',
    'existing-service-scan.py', 'instance-status-cache.js', 'instance-status.js', 'ip-profile-check.js',
    'instance-status.py', 'managed-nowhere-remote.js', 'managed-nowhere.js',
    'managed-sing-box-config.js', 'managed-sing-box-remote.js', 'managed-sing-box.js',
    'managed-task-tracker.js', 'nowhere-action.py', 'nowhere-binary-upgrade.py',
    'nowhere-capabilities.js', 'nowhere-compatibility.json', 'nowhere-config.js',
    'nowhere-create.py', 'nowhere-delete.py',
    'nowhere-adopt.py',
    'nowhere-preflight.py', 'nowhere-read.py', 'nowhere-recover.py',
    'nowhere-status.py', 'nowhere-update.py',
    'operation-store.js', 'protocol-capabilities.js', 'provider-s-ui.js',
    'rule-set.js', 'download-sing-box.py', 'sing-box-read.py', 'sing-box-update.py',
)
files += [root / 'tools' / name for name in runtime_tools]
missing_tools = [path.name for path in files if not path.exists()]
if missing_tools:
    raise SystemExit('Missing release runtime files: ' + ', '.join(missing_tools))
for dependency in ('js-yaml', 'argparse'):
    directory = root / 'node_modules' / dependency
    if not (directory / 'package.json').exists():
        raise SystemExit('Run npm ci before packaging: missing ' + dependency)
    files += [path for path in directory.rglob('*') if path.is_file() and not path.is_symlink()]
if not (root / 'pages/admin.html').exists():
    raise SystemExit('Build the frontend first')
destination = root / 'dist' / ('wherever-station-' + manifest['version'] + '.zip')
destination.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(set(files)):
        if path.is_symlink() or path.name.startswith('.') or '.tmp.' in path.name or path.name.endswith(('.tmp', '.swp')):
            continue
        name = path.relative_to(root).as_posix()
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        mode = stat.S_IFREG | (0o755 if path.suffix == '.py' else 0o644)
        info.external_attr = mode << 16
        archive.writestr(info, path.read_bytes())
with zipfile.ZipFile(destination) as archive:
    names = archive.namelist()
    assert 'komari-plugin.json' in names and 'icon.svg' in names and 'pages/admin.html' in names
    assert 'LICENSE' in names and 'tools/nowhere-compatibility.json' in names
    assert not any(name.startswith(('.deployment/', 'frontend/', 'tests/')) or name == 'seed.json' or '/e2e-' in name for name in names)
print(destination)
