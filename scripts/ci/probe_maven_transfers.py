"""Exercise native Maven transfer recovery against a loopback repository."""

import hashlib
import http.server
import io
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import uuid
import zipfile


ROOT = Path(__file__).resolve().parents[2]
GOAL = 'org.apache.maven.plugins:maven-dependency-plugin:3.11.0:'


def maven(*arguments):
    result = subprocess.run(['./mvnw', '-B', '-ntp', '-U', *arguments],
                            cwd=ROOT, text=True, capture_output=True, timeout=100)
    return result


def main():
    prepared = maven('-s', '.mvn/public-repositories.xml', GOAL + 'help')
    if prepared.returncode:
        raise RuntimeError(prepared.stdout[-6000:] + prepared.stderr[-1000:])
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, 'w') as jar:
        jar.writestr('META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\n')
    body = payload.getvalue()
    counts = {}

    class Repository(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            name = self.path.rsplit('/', 1)[-1]
            counts[name] = counts.get(name, 0) + 1
            if name.endswith('.jar'):
                status = (404 if name.startswith('missing-') else
                          503 if name.startswith('unavailable-') else
                          429 if name.startswith('limited-') or counts[name] <= 2 else 200)
                if status != 200:
                    self.send_response(status)
                    self.send_header('Retry-After', '0')
                    self.end_headers()
                    return
                content = body
            elif name.endswith('.sha1'):
                content = hashlib.sha1(body).hexdigest().encode()
            else:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, *_):
            pass

    results = {}
    version = 'probe-' + uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix='ctt-maven-transfer-') as directory, \
            http.server.ThreadingHTTPServer(('127.0.0.1', 0), Repository) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        settings = Path(directory) / 'settings.xml'
        settings.write_text('<settings><mirrors><mirror><id>public-central</id>'
                            '<mirrorOf>*</mirrorOf><url>'
                            f'http://127.0.0.1:{server.server_port}/'
                            '</url></mirror></mirrors></settings>')
        try:
            for artifact, success, requests in [('transient', True, 3), ('limited', False, 5),
                                               ('unavailable', False, 5), ('missing', False, 1)]:
                result = maven('-s', str(settings), GOAL + 'get',
                               f'-Dartifact=io.ctt.transferprobe:{artifact}:{version}',
                               '-Dtransitive=false')
                count = counts.get(f'{artifact}-{version}.jar', 0)
                results[artifact] = {'success': result.returncode == 0, 'requests': count}
                if (result.returncode == 0) != success or count != requests:
                    raise RuntimeError(json.dumps(results) + '\n' + result.stdout[-6000:]
                                       + result.stderr[-1000:])
        finally:
            server.shutdown()
            thread.join()
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
