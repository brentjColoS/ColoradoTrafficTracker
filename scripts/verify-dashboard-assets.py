#!/usr/bin/env python3
"""Check the packaged dashboard contract without executing browser code."""
import argparse
from contextlib import contextmanager
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
import urllib.request
import zipfile

PREFIX = 'BOOT-INF/classes/static/dashboard/'
LIMIT = 8 * 1024 * 1024
SCRIPTS = re.compile(r'<script src="([^\"]+)"(?: defer)?></script>')
STYLES = re.compile(r'<link rel="stylesheet" href="([a-z0-9./-]+\.css)(?:\?[^\"]*)?">')


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.css, self.scripts, self.styles = [], [], []
        self.title, self.in_title, self.in_style = '', False, False
        self.feed(html)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'link' and 'stylesheet' in attrs.get('rel', '').split():
            self.css.append(attrs.get('href', ''))
        if tag == 'script' and 'src' in attrs:
            self.scripts.append(attrs['src'])
        if tag == 'style':
            self.styles.append('')
            self.in_style = True
        if tag == 'title':
            self.in_title = True

    def handle_endtag(self, tag):
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
            if not expected.title or not any(file for _, file in css) or not scripts:
                raise ValueError(f'Incomplete packaged page contract: {name}')
            if read is None:
                continue
            served = read(name).decode('utf8')
            normalized = re.sub(r'<html data-replay-enabled="(?:true|false)" ', '<html ', served, count=1)
            normalized = re.sub(r'<script id="dashboardBootstrap" type="application/json">.*?</script>', '', normalized, flags=re.S)
            if normalized != template:
                if name != 'index.html' or any(file is None for _, file in scripts):
                    raise ValueError(f'Served HTML differs from the packaged page: {name}')
                bundle_body = b''.join(asset(local_asset(reference)) + b'\n;\n'
                                       for reference in SCRIPTS.findall(template))
                bundled = SCRIPTS.sub('', template).replace('</head>',
                    '<script src="dashboard-scripts.js?v=' + hashlib.sha256(bundle_body).hexdigest() + '" defer></script>\n</head>')
                inlined = STYLES.sub(lambda match: '<style>\n' + asset(match[1]).decode('utf8') + '\n</style>', bundled)
                if normalized != inlined:
                    raise ValueError(f'Served HTML differs from the packaged page: {name}')
            actual = Page(served)
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
    container = subprocess.check_output([docker, 'create', '--network', 'none', '--read-only', image], text=True, timeout=20).strip()
    if not re.fullmatch(r'[a-f0-9]{64}', container):
        raise ValueError('Invalid audit container identity')
    try:
        with tempfile.TemporaryDirectory(prefix='ctt-sidecar-audit-') as directory:
            jar = Path(directory) / 'app.jar'
            subprocess.run([docker, 'cp', container + ':/app/app.jar', str(jar)], check=True, stdout=subprocess.DEVNULL, timeout=20)
            yield jar
    finally:
        primary_failure = sys.exc_info()[0] is not None
        try:
            subprocess.run([docker, 'rm', container], check=True, stdout=subprocess.DEVNULL, timeout=20)
        except subprocess.SubprocessError:
            if not primary_failure:
                raise
            print('Audit cleanup also failed; inspect only owned container ' + container, file=sys.stderr)


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
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        print('Dashboard asset verification failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
