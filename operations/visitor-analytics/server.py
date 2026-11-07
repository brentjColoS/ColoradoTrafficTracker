"""Private operator viewer with explicitly enabled experimental event intake."""
import argparse
import base64
import getpass
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import secrets
import sys
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from analytics import Store, address, seed_demo, illustrate_demo_actions, privacy_requested, InvalidPage

PREFIX = '/operator/visitors/'
WEB = Path(__file__).parent / 'web'
FILES = {'': ('index.html', 'text/html'), 'visitors.css': ('visitors.css', 'text/css'),
         'visitors.js': ('visitors.js', 'text/javascript')}
for font in ('archivo-latin', 'ibm-plex-mono-latin', 'ibm-plex-mono-semibold-latin'):
    FILES[f'fonts/{font}.woff2'] = (f'fonts/{font}.woff2', 'font/woff2')


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600000).hex()
    return f'pbkdf2-sha256${salt}${digest}'


def authorized(header, encoded):
    try:
        scheme, value = header.split(' ', 1)
        user, password = base64.b64decode(value, validate=True).decode().split(':', 1)
        kind, salt, digest = encoded.split('$')
        return scheme == 'Basic' and kind == 'pbkdf2-sha256' and hmac.compare_digest(user, 'operator') and (
            hmac.compare_digest(password_hash(password, salt).split('$')[-1], digest))
    except (ValueError, UnicodeError, TypeError):
        return False


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    slots = threading.BoundedSemaphore(16)

    def process_request(self, request, client_address):
        if not self.slots.acquire(False):
            request.close(); return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release(); raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def make_server(store, port=8191, demo=False, credential='', origin='', trust_proxy=False,
                collect=False, key_file=None, operator_networks=(), local_test=False,
                operator_ip_only=False, collection_scope='experimental'):
    if demo and (collect or local_test):
        raise ValueError('Synthetic demo cannot be mixed with collected events')
    if not demo and not local_test and not credential and not operator_ip_only:
        raise ValueError('Authenticated mode requires VISITOR_ADMIN_PASSWORD_HASH; no public fallback')
    origin = origin or f'http://127.0.0.1:{port}'
    parsed = urlsplit(origin)
    if not demo and not local_test and (parsed.scheme != 'https' or not parsed.netloc or parsed.path not in ('', '/')
                     or parsed.username or parsed.query or parsed.fragment):
        raise ValueError('Authenticated mode requires an HTTPS --origin')
    action_token = secrets.token_hex(32)
    networks = [ipaddress.ip_network(value) for value in operator_networks]
    if operator_ip_only and (demo or local_test or not trust_proxy or not networks or any(
            network.prefixlen!=network.max_prefixlen or not network.network_address.is_global for network in networks)):
        raise ValueError('IP-only access requires exact public host addresses and a validated loopback proxy')
    if collection_scope not in ('experimental','production'):
        raise ValueError('Unsupported collection scope')
    event_path='/visitor-events' if collection_scope=='production' else '/dashboard-experimental-events'
    collection_prefix='/dashboard/' if collection_scope=='production' else '/dashboard-experimental/'
    if collect and not local_test and (not networks or not trust_proxy):
        raise ValueError('Collection requires operator networks and validated loopback proxy forwarding')
    collected = limiter = None
    snapshot_slots = threading.BoundedSemaphore(2)
    failures = {'intakeFailures':0,'snapshotFailures':0}
    failure_lock = threading.Lock()
    if collect:
        if not key_file: raise ValueError('Collection requires an external owner-only encryption key file')
        from collector import CollectedStore, RateLimit
        with store.connect() as db:
            if db.execute('SELECT count(*) FROM visits').fetchone()[0]:
                raise ValueError('Use a fresh collection database; preserve the legacy/demo database separately')
        collected = CollectedStore(store, key_file,scope=collection_scope); limiter = RateLimit()

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(3)
            super().setup()

        def log_message(self, *args):
            pass

        def failure(self, component, error):
            with failure_lock: failures[component+'Failures'] += 1
            logging.error('Visitor %s failed (%s); check private storage, capacity and key',component,type(error).__name__)

        def reply(self, status, body=b'', content_type='application/json', extra=None):
            self.send_response(status)
            charset = '; charset=utf-8' if content_type.startswith('text/') or content_type == 'application/json' else ''
            for key, value in {'Content-Type': content_type + charset, 'Cache-Control': 'no-store',
                'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
                'Content-Security-Policy': "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
                **(extra or {})}.items():
                self.send_header(key, value)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def access(self):
            if self.headers.get('Host') != parsed.netloc:
                self.reply(403)
                return False
            try:
                allowed=not networks or any(ipaddress.ip_address(self.current_ip()) in network for network in networks)
            except ValueError:
                allowed=False
            if not allowed:
                self.reply(403); return False
            if not demo and not local_test and not operator_ip_only and not authorized(self.headers.get('Authorization', ''), credential):
                self.reply(401, extra={'WWW-Authenticate': 'Basic realm="Visitor observatory", charset="UTF-8"'})
                return False
            return True

        def current_ip(self):
            # Enable only behind a loopback proxy that overwrites this header.
            if trust_proxy:
                values=self.headers.get_all('X-Visitor-Client-IP',[])
                if len(values)!=1:raise ValueError('Missing or repeated proxy address')
                return address(values[0])
            return address(self.client_address[0])

        def do_GET(self):
            if urlsplit(self.path).path == event_path:
                self.reply(404); return
            if not self.access():
                return
            url = urlsplit(self.path)
            if url.path == '/':
                self.reply(302, extra={'Location': PREFIX})
                return
            if not url.path.startswith(PREFIX):
                self.reply(404)
                return
            name = url.path[len(PREFIX):]
            if name in FILES:
                file, content_type = FILES[name]
                self.reply(200, (WEB / file).read_bytes(), content_type)
            elif name == 'data':
                if not snapshot_slots.acquire(False):
                    self.reply(503, extra={'Retry-After':'5'}); return
                try:
                    query = parse_qs(url.query)
                    try: days=int(query.get('days',['7'])[0])
                    except ValueError: raise InvalidPage('Invalid period') from None
                    category=query.get('category',['external'])[0]
                    if days not in (0, 1, 7, 30) or category not in ('external', 'home', 'automation', 'all', 'nonhome'):
                        raise InvalidPage('Invalid filter')
                    cursor = query.get('cursor',[''])[0]
                    result = (collected or store).snapshot(self.current_ip(),days,category,cursor=cursor)
                    if collected: result['collectorStatus']={**collected.status(),**failures}
                    if demo:
                        illustrate_demo_actions(result)
                    result.update(demo=demo, actionToken=action_token,
                                  sourceBase=origin.rstrip('/')+('/' if collection_scope=='production' and not local_test else collection_prefix),
                                  localTest=local_test,collectionScope=collection_scope,
                                  homeAllowed=demo or local_test or not ipaddress.ip_address(self.current_ip()).is_loopback)
                    self.reply(200, json.dumps(result).encode())
                except InvalidPage:
                    self.reply(400)
                except Exception as error:
                    self.failure('snapshot',error)
                    self.reply(503, b'{"error":"Private snapshot unavailable; check storage and event key"}')
                finally:
                    snapshot_slots.release()
            else:
                self.reply(404)

        def do_POST(self):
            if self.path == event_path:
                self.collect_events(); return
            if not self.access():
                return
            if self.path != PREFIX + 'home':
                self.reply(404)
                return
            if self.headers.get('Origin') != origin.rstrip('/') or not hmac.compare_digest(
                    self.headers.get('X-Visitor-Action', ''), action_token):
                self.reply(403)
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 1024 or self.headers.get('Content-Type') != 'application/json':
                    raise ValueError('Invalid body')
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict) or type(body.get('enabled')) is not bool or set(body) not in ({'enabled'},{'enabled','remove'}):
                    raise ValueError('Invalid action')
                ip = self.current_ip()
                if not demo and not local_test and ipaddress.ip_address(ip).is_loopback:
                    self.reply(409)
                    return
                if 'remove' in body:
                    if body['enabled'] or not isinstance(body['remove'],str):
                        raise ValueError('Only saved Home addresses may be removed')
                    ip=address(body['remove'])
                    with store.connect() as db:
                        if not db.execute('SELECT 1 FROM homes WHERE ip=?',(ip,)).fetchone():
                            raise ValueError('Unknown Home address')
                store.home(ip, body['enabled'])
                self.reply(200, b'{"saved":true}')
            except (ValueError, TypeError):
                self.reply(400)
            except (OSError,sqlite3.Error) as error:
                self.failure('snapshot',error)
                self.reply(503,extra={'Retry-After':'5'})

        def collect_events(self):
            if not collected:
                self.reply(404); return
            if self.headers.get('Host') != parsed.netloc or self.headers.get('Origin') != origin.rstrip('/') or (
                    self.headers.get('Sec-Fetch-Site', 'same-origin') != 'same-origin'):
                self.reply(403); return
            if privacy_requested(self.headers, signals=('sec-gpc',)):
                self.reply(204); return
            try:
                if self.headers.get('Content-Type') != 'application/json' or self.headers.get('Content-Encoding'):
                    self.reply(415); return
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 16384:
                    self.reply(413); return
                ip = self.current_ip()
                if not limiter.allow(collected.identity(ip)):
                    self.reply(429, extra={'Retry-After':'60'}); return
                body = json.loads(self.rfile.read(size))
                collected.ingest(body, ip, self.headers.get('User-Agent', ''), parsed.hostname)
                self.reply(204)
            except (ValueError, TypeError, KeyError, OverflowError):
                self.reply(400)
            except (OSError, sqlite3.Error) as error:
                self.failure('intake',error)
                self.reply(503, extra={'Retry-After':'60'})

    server = BoundedServer(('127.0.0.1', port), Handler)
    if port == 0:
        parsed = urlsplit(f'http://127.0.0.1:{server.server_port}' if demo or local_test else origin)
        origin = f'http://127.0.0.1:{server.server_port}' if demo or local_test else origin
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('serve', 'import', 'prune', 'password', 'key', 'backup', 'upgrade', 'archive', 'check'))
    parser.add_argument('--db', type=Path)
    parser.add_argument('--demo', action='store_true')
    parser.add_argument('--local-test', action='store_true', help='Unauthenticated loopback-only test mode; never deploy')
    parser.add_argument('--collect', action='store_true', help='Enable write-only event intake for the selected scope')
    parser.add_argument('--collection-scope',choices=('experimental','production'),default='experimental')
    parser.add_argument('--operator-ip-only',action='store_true',help='Require exact public IP allowlisting instead of a password')
    parser.add_argument('--key-file', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--backup-directory', type=Path)
    parser.add_argument('--operator-network', action='append', default=[])
    parser.add_argument('--port', type=int, default=8191)
    parser.add_argument('--origin', default='')
    parser.add_argument('--trust-loopback-proxy', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    if args.action == 'key':
        if not args.key_file: parser.error('key requires --key-file')
        from cryptography.fernet import Fernet
        with args.key_file.open('xb') as output: output.write(Fernet.generate_key())
        print('Created owner-only event key file; keep it with the private VPS configuration')
        return
    if args.action == 'password':
        print(password_hash(getpass.getpass('Operator password: ')))
        return
    if not args.db:
        parser.error('--db must point to a private analytics file, not the traffic database')
    if args.action == 'backup':
        if not args.output: parser.error('backup requires --output; existing files are never overwritten')
        from collector import backup_database
        print('Backup SHA256: '+backup_database(args.db,args.output))
        return
    store = Store(args.db)
    if args.action == 'upgrade':
        if not args.key_file or not args.output: parser.error('upgrade requires --key-file and a new --output backup path')
        from collector import CollectedStore
        upgraded=CollectedStore(store,args.key_file,upgrade_backup=args.output,scope=args.collection_scope)
        upgraded.verify_records()
        print('Visitor database upgraded; pre-upgrade backup retained')
        return
    if args.action in ('archive','check'):
        if not args.key_file: parser.error('private maintenance requires --key-file')
        from collector import CollectedStore
        events=CollectedStore(store,args.key_file,scope=args.collection_scope)
        if args.action=='archive':
            if not args.backup_directory: parser.error('archive requires --backup-directory')
            from maintenance import archive
            archive(events,args.backup_directory)
            print('Verified private visitor backup completed')
        else:
            warnings=events.status()['warnings']
            print(json.dumps({'warnings':warnings}))
            if warnings: raise SystemExit(1)
        return
    if args.action == 'prune':
        store.prune()
        if args.key_file:
            from collector import CollectedStore
            import time
            events=CollectedStore(store,args.key_file,scope=args.collection_scope)
            deadline=time.monotonic()+55
            while events.redact(time.time())==events.REDACTION_BATCH:
                if time.monotonic()>deadline:
                    raise RuntimeError('Visitor redaction budget reached; retry maintenance to resume its saved cursor')
        return
    if args.action == 'import':
        accepted = rejected = 0
        for line in sys.stdin:
            try:
                if len(line) > 65536:
                    raise ValueError('Oversized log record')
                accepted += store.ingest(json.loads(line))
            except (ValueError, TypeError):
                rejected += 1
        store.prune()
        print(json.dumps({'added': accepted, 'malformed': rejected}))
        return
    if args.demo:
        seed_demo(store)
    server = make_server(store, args.port, args.demo, os.environ.get('VISITOR_ADMIN_PASSWORD_HASH', ''),
                         args.origin, args.trust_loopback_proxy, args.collect, args.key_file,
                         args.operator_network, args.local_test,args.operator_ip_only,args.collection_scope)
    print(f'Visitor observatory: http://127.0.0.1:{server.server_port}{PREFIX} '
          + ('(synthetic, loopback only; no collection)' if args.demo else
             '(local browser test; never deploy)' if args.local_test else
             '(exact IP allowlist required)' if args.operator_ip_only else '(authentication required)'), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
