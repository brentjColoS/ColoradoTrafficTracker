"""Require real cache reuse, not merely a successful dependency rebuild."""

import json
import os
import re
import subprocess


SERVICES = {'routes-service': 'ROUTES_METADATA', 'ingest-service': 'INGEST_METADATA',
            'api-service': 'API_METADATA'}


def build_reference(metadata):
    parts = metadata.get('buildx.build.ref', '').split('/')
    if len(parts) != 3 or any(part in {'.', '..'} or not re.fullmatch(r'[A-Za-z0-9_.-]+', part) for part in parts):
        raise ValueError('Missing or invalid Buildx build reference')
    return parts[0], parts[2]


def require_dependency_hit(log, service):
    if service not in SERVICES:
        raise ValueError('Unexpected service')
    vertices = {}
    for line in log.splitlines():
        if not line.startswith('{'):
            continue
        for vertex in json.loads(line).get('vertexes', []):
            digest = vertex['digest']
            vertices[digest] = {**vertices.get(digest, {}), **vertex}
    matches = [vertex for vertex in vertices.values()
               if 'RUN mvn ' in vertex.get('name', '')
               and f'-pl {service} -am dependency:go-offline' in vertex['name']]
    if len(matches) != 1 or not matches[0].get('completed') or matches[0].get('cached') is not True or matches[0].get('error'):
        raise ValueError(f'{service}: dependency RUN was not restored from cache')


def verify_service(metadata, service):
    builder, record = build_reference(metadata)
    result = subprocess.run(
        ['docker', 'buildx', '--builder', builder, 'history', 'logs', '--progress', 'rawjson', record],
        capture_output=True, text=True, timeout=30, check=True)
    require_dependency_hit(result.stdout + '\n' + result.stderr, service)
    print(f'{service}: dependency RUN restored CACHED on a fresh runner')


if __name__ == '__main__':
    for service, key in SERVICES.items():
        verify_service(json.loads(os.environ[key]), service)
