"""Build a Komari plugin source from one verified release archive."""
import hashlib
import json
import pathlib
import sys
import zipfile


def build(archive_path, tag):
    archive = pathlib.Path(archive_path)
    with zipfile.ZipFile(archive) as bundle:
        manifest = json.loads(bundle.read('komari-plugin.json'))
    version = manifest['version']
    if tag != f'v{version}' or archive.name != f'wherever-station-{version}.zip':
        raise ValueError('tag, archive, and manifest versions disagree')
    entry = {
        'name': {'zh-CN': manifest['name']['zh_CN'], 'en': manifest['name']['en']},
        'short': manifest['short'],
        'description': {'zh-CN': manifest['description']['zh_CN'], 'en': manifest['description']['en']},
        'version': version,
        'author': manifest['author'],
        'url': manifest['url'],
        'download': f"{manifest['url'].rstrip('/')}/releases/download/{tag}/{archive.name}",
        'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'komari': manifest['komari'],
    }
    return {'schema': 1, 'plugins': [entry]}


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('Usage: build-market-catalog.py RELEASE_ZIP TAG OUTPUT_JSON')
    catalog = build(sys.argv[1], sys.argv[2])
    pathlib.Path(sys.argv[3]).write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
