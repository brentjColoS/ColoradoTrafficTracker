"""Retain and verify the exact executable JARs used by browser integration checks."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def revision():
    return os.environ.get('GITHUB_SHA') or subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], text=True).strip()


def record(root, destination):
    destination.mkdir(parents=True, exist_ok=True)
    files = {}
    for service in ['api-service', 'routes-service']:
        jars = list((root / service / 'target').glob('*.jar'))
        if len(jars) != 1:
            raise ValueError(f'Exactly one verified executable JAR is required for {service}')
        name = service + '.jar'
        shutil.copyfile(jars[0], destination / name)
        files[name] = hashlib.sha256((destination / name).read_bytes()).hexdigest()
    (destination / 'manifest.json').write_text(json.dumps({'revision': revision(), 'files': files}, indent=2) + '\n')


def verify(destination):
    manifest = json.loads((destination / 'manifest.json').read_text())
    expected = {'api-service.jar', 'routes-service.jar'}
    if manifest['revision'] != revision() or set(manifest['files']) != expected:
        raise ValueError('Browser runtime revision or JAR set differs from the verified build')
    for name, digest in manifest['files'].items():
        if hashlib.sha256((destination / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f'Browser runtime JAR differs from the verified build: {name}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['record', 'verify'])
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    if args.command == 'record':
        record(Path.cwd(), args.directory)
    else:
        verify(args.directory)
