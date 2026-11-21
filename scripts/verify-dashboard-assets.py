#!/usr/bin/env python3
"""Check the packaged dashboard contract without executing browser code."""
import argparse
from contextlib import contextmanager
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import signal
import subprocess
import sys
import tempfile
import time
from uuid import uuid4
from urllib.parse import urlsplit
import urllib.request
import zipfile

PREFIX = 'BOOT-INF/classes/static/dashboard/'
LIMIT = 8 * 1024 * 1024


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.css, self.scripts, self.styles = [], [], []
        self.title, self.in_title, self.in_style = '', False, False
        self.html = html
        self.line_offsets = [0] + [index+1 for index, value in enumerate(html) if value == '\n']
        self.links, self.script_elements = [], []
        self.root, self.head_close, self.active_script = None, None, None
        self.feed(html)

    def character_position(self):
        line, column = self.getpos()
        return self.line_offsets[line-1] + column

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        start = self.character_position()
        end = start + len(self.get_starttag_text())
        if tag == 'html':
            self.root = (start, end, attrs)
        if tag == 'link' and 'stylesheet' in attrs.get('rel', '').split():
            self.css.append(attrs.get('href', ''))
            self.links.append((start, end, attrs.get('href', '')))
        if tag == 'script':
            self.active_script = {'start': start, 'body_start': end, 'attrs': attrs}
        if tag == 'script' and 'src' in attrs:
            self.scripts.append(attrs['src'])
        if tag == 'style':
            self.styles.append('')
            self.in_style = True
        if tag == 'title':
            self.in_title = True

    def handle_endtag(self, tag):
        if tag == 'head':
            self.head_close = self.character_position()
        if tag == 'script' and self.active_script is not None:
            element = self.active_script
            element['end'] = self.html.index('>', self.character_position()) + 1
            element['body'] = self.html[element['body_start']:self.character_position()]
            self.script_elements.append(element)
            self.active_script = None
        if tag == 'style':
            self.in_style = False
        if tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if self.in_style:
            self.styles[-1] += data
        if self.in_title:
            self.title += data


def local_asset(reference):
    if not isinstance(reference, str) or not reference:
        raise ValueError('Missing asset reference')
    url = urlsplit(reference)
    if url.scheme or url.netloc:
        return None
    path = url.path
    for prefix in ['/dashboard/', '/dashboard-old/', '/dashboard-experimental/']:
        if path.startswith(prefix):
            path = path[len(prefix):]
            break
    if not re.fullmatch(r'[a-z0-9][a-z0-9./-]*\.(css|js)', path) or '..' in PurePosixPath(path).parts:
        raise ValueError('Unsupported local asset path')
    return path


def edited(html, edits):
    for start, end, replacement in sorted(edits, reverse=True):
        html = html[:start] + replacement + html[end:]
    return html


def normalized_page(actual, expected):
    edits = []
    if actual.root and expected.root and 'data-replay-enabled' not in expected.root[2]:
        start, end, attrs = actual.root
        if 'data-replay-enabled' in attrs:
            value = attrs['data-replay-enabled']
            if value not in {'true', 'false'}:
                raise ValueError('Unexpected replay metadata')
            edits.append((start, end, actual.html[start:end].replace(' data-replay-enabled="'+value+'"', '', 1)))
    expected_bootstrap = any(item['attrs'].get('id') == 'dashboardBootstrap' for item in expected.script_elements)
    for element in actual.script_elements:
        if not expected_bootstrap and element['attrs'].get('id') == 'dashboardBootstrap':
            if element['attrs'].get('type') != 'application/json' or not isinstance(json.loads(element['body']), dict):
                raise ValueError('Bootstrap must be non-executable JSON data')
            edits.append((element['start'], element['end'], ''))
    return edited(actual.html, edits)


def rendered_page(expected, actual, asset):
    edits = []
    for start, end, reference in expected.links:
        file = local_asset(reference)
        if file and reference not in actual.css:
            edits.append((start, end, '<style>\n' + asset(file).decode('utf8') + '\n</style>'))
    if actual.scripts != expected.scripts:
        files = [local_asset(reference) for reference in expected.scripts]
        if any(file is None for file in files):
            raise ValueError('External scripts cannot become a local bundle')
        body = b''.join(asset(file) + b'\n;\n' for file in files)
        digest = hashlib.sha256(body).hexdigest()
        edits.append((expected.head_close, expected.head_close,
                      '<script src="dashboard-scripts.js?v='+digest+'" defer></script>\n'))
        for element in expected.script_elements:
            if 'src' in element['attrs']:
                edits.append((element['start'], element['end'], ''))
    return edited(expected.html, edits)


def verify(jar, read=None):
    checked = {}
    with zipfile.ZipFile(jar) as archive:
        def asset(name):
            entry = archive.getinfo(PREFIX + name)
            if entry.file_size > LIMIT:
                raise ValueError('Packaged dashboard asset exceeds the size bound')
            return archive.read(entry)
        if PREFIX + 'index.html' not in archive.namelist():
            raise ValueError('Packaged dashboard index is missing')
        pages = [name for name in ['index.html', 'why.html', 'system.html', 'data.html', 'api.html']
                 if PREFIX + name in archive.namelist()]
        for name in pages:
            template = asset(name).decode('utf8')
            expected = Page(template)
            css = [(ref, local_asset(ref)) for ref in expected.css]
            scripts = [(ref, local_asset(ref)) for ref in expected.scripts]
            for _, file in css + scripts:
                if file:
                    asset(file).decode('utf8')
            if not expected.title or expected.head_close is None or not any(file for _, file in css) or not scripts:
                raise ValueError(f'Incomplete packaged page contract: {name}')
            if read is None:
                continue
            served = read(name).decode('utf8')
            actual = Page(served)
            normalized = normalized_page(actual, expected)
            if normalized != template and (name != 'index.html' or normalized != rendered_page(expected, actual, asset)):
                raise ValueError(f'Served HTML differs from the packaged page: {name}')
            if actual.title != expected.title:
                raise ValueError(f'Served page title differs: {name}')
            for reference, file in css:
                if file is None:
                    if reference not in actual.css:
                        raise ValueError(f'External stylesheet reference differs: {name}')
                elif reference in actual.css:
                    body = read(file + ('?' + urlsplit(reference).query if urlsplit(reference).query else ''))
                    if body != asset(file):
                        raise ValueError(f'Served stylesheet differs: {file}')
                elif '\n' + asset(file).decode('utf8') + '\n' not in actual.styles:
                    raise ValueError(f'Served inline stylesheet differs or is missing: {file}')
            if actual.scripts == expected.scripts:
                for reference, file in scripts:
                    if file and read(file + ('?' + urlsplit(reference).query if urlsplit(reference).query else '')) != asset(file):
                        raise ValueError(f'Served script differs: {file}')
            else:
                if any(file is None for _, file in scripts):
                    raise ValueError('An external script cannot be accepted inside a local bundle')
                bundle = b''.join(asset(file) + b'\n;\n' for _, file in scripts)
                digest = hashlib.sha256(bundle).hexdigest()
                if actual.scripts != ['dashboard-scripts.js?v=' + digest]:
                    raise ValueError(f'Served script order or bundle version differs: {name}')
                if read(actual.scripts[0]) != bundle:
                    raise ValueError('Served script bundle bytes differ')
            checked[name] = {'styles': len(css), 'scripts': len(scripts)}
    return {'pages': pages, 'checked': checked, 'packagedContractValid': True}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Dashboard verification refuses redirected asset reads')


def http_reader(origin):
    parsed = urlsplit(origin)
    if parsed.scheme not in {'http', 'https'} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Use a credential-free HTTP(S) dashboard origin')
    opener = urllib.request.build_opener(NoRedirect())
    deadline = time.monotonic() + 60
    cache = {}
    def read(relative):
        if relative not in cache:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Dashboard asset verification exceeded its sixty-second deadline')
            request = urllib.request.Request(origin.rstrip('/') + '/' + relative,
                headers={'Accept-Encoding': 'identity', 'User-Agent': 'ColoradoTrafficTracker-release-verification'})
            with opener.open(request, timeout=min(10, remaining)) as response:
                body = bytearray()
                while True:
                    if time.monotonic() >= deadline:
                        raise TimeoutError('Dashboard asset verification exhausted its sixty-second request budget')
                    chunk = response.read1(65536)
                    if not chunk:
                        break
                    body.extend(chunk)
                    if len(body) > LIMIT:
                        raise ValueError('Served dashboard asset exceeds the size bound')
                cache[relative] = bytes(body)
        return cache[relative]
    return read


@contextmanager
def image_jar(image, docker):
    name = 'ctt-sidecar-audit-' + uuid4().hex
    try:
        subprocess.run([docker, 'create', '--name', name,
            '--label', 'io.coloradotraffictracker.audit-owner='+name,
            '--network', 'none', '--read-only', image], check=True, stdout=subprocess.DEVNULL, timeout=20)
        with tempfile.TemporaryDirectory(prefix='ctt-sidecar-audit-') as directory:
            jar = Path(directory) / 'app.jar'
            subprocess.run([docker, 'cp', name + ':/app/app.jar', str(jar)], check=True, stdout=subprocess.DEVNULL, timeout=20)
            yield jar
    finally:
        primary_failure = sys.exc_info()[0] is not None
        try:
            def owned():
                identity = subprocess.check_output([docker, 'ps', '--all', '--quiet', '--no-trunc',
                    '--filter', 'name=^/'+name+'$', '--filter', 'label=io.coloradotraffictracker.audit-owner='+name],
                    text=True, timeout=10).strip()
                if identity and not re.fullmatch(r'[a-f0-9]{64}', identity):
                    raise ValueError('Unexpected owned audit identity')
                return identity
            container = owned()
            if container:
                try:
                    removal_failed = subprocess.run([docker, 'rm', container], capture_output=True, timeout=10).returncode != 0
                except (OSError, subprocess.SubprocessError):
                    removal_failed = True
                if removal_failed and owned():
                    raise ValueError('Docker could not remove the owned audit container')
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            message = 'Audit cleanup could not be confirmed for '+name+': '+str(error)+'. Inspect only this labelled container.'
            if not primary_failure:
                raise ValueError(message) from error
            print(message, file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--jar', type=Path)
    source.add_argument('--image')
    parser.add_argument('--docker', default='docker')
    parser.add_argument('--origin')
    args = parser.parse_args()
    reader = http_reader(args.origin) if args.origin else None
    if args.jar:
        result = verify(args.jar, reader)
    else:
        with image_jar(args.image, args.docker) as jar:
            result = verify(jar, reader)
    print(json.dumps(result))


if __name__ == '__main__':
    def terminate(signum, _frame):
        raise SystemExit(128+signum)
    signal.signal(signal.SIGTERM, terminate)
    try:
        main()
    except KeyboardInterrupt:
        print('Dashboard asset verification interrupted.', file=sys.stderr)
        sys.exit(130)
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        print('Dashboard asset verification failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
