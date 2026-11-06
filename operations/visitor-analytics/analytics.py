"""Small, offline page-request summaries. Never reads the traffic database."""
import datetime as dt
import base64
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
import sqlite3
import time
from functools import lru_cache
from collections import Counter
from contextlib import closing, contextmanager
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

PAGES = {'/dashboard/': 'Dashboard', '/dashboard/system.html': 'System',
         '/dashboard/data.html': 'About the data', '/dashboard/api.html': 'API'}
CAMPAIGNS = {'resume', 'linkedin', 'github', 'portfolio'}
BOT = re.compile(r'bot\b|crawler|spider|preview|slackbot|facebookexternalhit|headless|curl/|wget/', re.I)

def encode_page(key, value):
    data=base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
    return data+'.'+hmac.new(key,('cursor|'+data).encode(),hashlib.sha256).hexdigest()

class InvalidPage(ValueError):
    pass

def decode_page(key, token, days, category):
    try:
        if not isinstance(token,str) or len(token)>512:raise ValueError()
        data,signature=token.split('.')
        expected=hmac.new(key,('cursor|'+data).encode(),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature,expected):raise ValueError()
        page=json.loads(base64.urlsafe_b64decode(data+'='*(-len(data)%4)))
        if page['days']!=days or page['category']!=category:raise ValueError()
        return page
    except (ValueError,KeyError,TypeError):
        raise InvalidPage('Invalid visitor page cursor') from None


def privacy_requested(headers, signals=('sec-gpc', 'dnt')):
    values = {key.lower(): value for key, value in headers.items()}
    return any(str((values.get(key) or [''])[0] if isinstance(values.get(key), list)
                   else values.get(key, '')).strip().lower() in ('1', 'yes') for key in signals)


def address(value):
    ip = ipaddress.ip_address(value)
    return str(ip.ipv4_mapped if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped else ip)


def agent_details(ua):
    browser = next((name for pattern, name in [('Edg/', 'Edge'), ('Firefox/', 'Firefox'),
        ('Chrome/', 'Chrome'), ('Safari/', 'Safari')] if pattern in ua), 'Unknown')
    os = next((name for pattern, name in [('Android', 'Android'), ('iPhone|iPad', 'iOS'),
        ('Windows', 'Windows'), ('Macintosh', 'macOS'), ('Linux', 'Linux')]
        if re.search(pattern, ua)), 'Unknown')
    device = 'Tablet' if 'iPad' in ua or ('Android' in ua and 'Mobile' not in ua) else (
        'Mobile' if 'Mobile' in ua or 'iPhone' in ua else 'Desktop' if os != 'Unknown' else 'Unknown')
    return browser, os, device


class Store:
    def __init__(self, filename):
        self.filename = str(filename)
        Path(filename).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS homes (ip TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS visits (
                    id TEXT PRIMARY KEY, at REAL NOT NULL, visitor TEXT NOT NULL, ip TEXT,
                    path TEXT NOT NULL, source TEXT NOT NULL, browser TEXT, os TEXT, device TEXT,
                    bot INTEGER NOT NULL, location TEXT NOT NULL DEFAULT 'Not resolved',
                    viewport TEXT NOT NULL DEFAULT 'Not collected',
                    timezone TEXT NOT NULL DEFAULT 'Not collected',
                    language TEXT NOT NULL DEFAULT 'Not collected');
                CREATE INDEX IF NOT EXISTS visits_at ON visits(at);
                CREATE INDEX IF NOT EXISTS visits_visitor_at ON visits(visitor,at DESC,id DESC);
            ''')
            db.execute('INSERT OR IGNORE INTO settings VALUES (?,?)', ('key', secrets.token_hex(32)))
            self.key = db.execute("SELECT value FROM settings WHERE key='key'").fetchone()[0].encode()
        Path(filename).chmod(0o600)

    @contextmanager
    def connect(self):
        with closing(sqlite3.connect(self.filename, timeout=2)) as db:
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA secure_delete=ON')
            db.execute('PRAGMA cache_size=-1024')
            db.execute('PRAGMA temp_store=FILE')
            db.execute('PRAGMA mmap_size=0')
            with db:
                yield db

    def identity(self, ip, at):
        day = dt.datetime.fromtimestamp(at, dt.timezone.utc).date().isoformat()
        return hmac.new(self.key, f'{day}|{address(ip)}'.encode(), hashlib.sha256).hexdigest()

    def home(self, ip, enabled):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if enabled and db.execute('SELECT count(*) FROM homes WHERE ip<>?',(address(ip),)).fetchone()[0]>=16:
                raise ValueError('Home address limit reached; remove an old address first')
            db.execute('INSERT OR IGNORE INTO homes VALUES (?)' if enabled else
                       'DELETE FROM homes WHERE ip=?', (address(ip),))

    def prune(self, now=None):
        """Redact expired raw IPs without deleting visit history."""
        now = time.time() if now is None else now
        with self.connect() as db:
            db.execute('UPDATE visits SET ip=NULL WHERE at<? AND ip IS NOT NULL', (now - 86400,))

    def ingest(self, entry, now=None):
        """Accept Caddy JSON navigation records, not arbitrary browser identities."""
        now = time.time() if now is None else now
        try:
            if not isinstance(entry, dict) or not isinstance(entry.get('request'), dict):
                return False
            request = entry['request']
            at = float(entry['ts'])
            ip = address(request['remote_ip'])
            uri = urlsplit(request['uri'])
            if uri.scheme or uri.netloc or request.get('method') != 'GET':
                return False
            if uri.path not in PAGES or not 200 <= int(entry['status']) < 400:
                return False
            if not 0 <= at <= now + 300:
                return False
            supplied = request.get('headers', {})
            if not isinstance(supplied, dict):
                return False
            if privacy_requested(supplied):
                return False
            headers = {k.lower(): v for k, v in supplied.items()}
            header = lambda key: str((headers.get(key) or [''])[0])[:512]
            destination = header('sec-fetch-dest')
            if destination and destination != 'document':
                return False
            ua = header('user-agent')
            browser, os, device = agent_details(ua)
            campaign = parse_qs(uri.query).get('src', [''])[0]
            referrer = urlsplit(header('referer')).hostname or ''
            if referrer == urlsplit('http://' + str(request.get('host', ''))).hostname:
                referrer = ''
            source = f'{campaign} link' if campaign in CAMPAIGNS else referrer[:100] or 'Direct / unknown'
            identifier = hashlib.sha256(json.dumps([at, ip, request['uri'], ua],
                separators=(',', ':')).encode()).hexdigest()
            with self.connect() as db:
                changed = db.execute('INSERT OR IGNORE INTO visits '
                    '(id,at,visitor,ip,path,source,browser,os,device,bot) VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (identifier, at, self.identity(ip, at), ip if at >= now - 86400 else None,
                     uri.path, source, browser, os, device, bool(BOT.search(ua)))).rowcount
            return bool(changed)
        except (KeyError, TypeError, ValueError, OverflowError):
            return False

    def snapshot(self, current_ip, days=7, category='external', now=None, cursor=''):
        now = time.time() if now is None else now
        page=decode_page(self.key,cursor,days,category) if cursor else {'until':now+30,'position':0}
        cutoff=0 if days==0 else page['until']-30-days*86400
        with self.connect() as db:
            homes = [row[0] for row in db.execute('SELECT ip FROM homes ORDER BY ip')]
            deadline=time.monotonic()+5
            db.set_progress_handler(lambda:int(time.monotonic()>deadline),2000)
            @lru_cache(maxsize=128)
            def home_keys(day):return frozenset(self.identity(ip,day*86400) for ip in homes)
            db.create_function('is_home',2,lambda at,visitor:int(visitor in home_keys(int(at//86400))))
            grouped='''WITH groups AS (SELECT visitor,MAX(at) AS latest,MIN(at) AS first,COUNT(*) AS views,
                SUM(source<>'Direct / unknown') AS referred,
                CASE WHEN MAX(is_home(at,visitor)) THEN 'home' WHEN MAX(bot) THEN 'automation' ELSE 'external' END AS category
                FROM visits WHERE at>=? AND at<=? GROUP BY visitor) '''
            args=[cutoff,page['until']]
            counts=db.execute(grouped+'SELECT category,COUNT(*) AS groups,SUM(views) AS views,SUM(referred) AS referred FROM groups GROUP BY category',args).fetchall()
            condition="WHERE (?='all' OR category=?)";params=args+[category,category]
            if cursor:
                condition+=' AND (latest,visitor)<(?,?)';params += [page['at'],page['session']]
            selected=db.execute(grouped+'SELECT * FROM groups '+condition+' ORDER BY latest DESC,visitor DESC LIMIT 26',params).fetchall()
            activity=[];pages=Counter()
            for summary in selected[:25]:
                rows=db.execute('SELECT * FROM visits WHERE visitor=? AND at>=? AND at<=? ORDER BY at DESC,id DESC LIMIT 60',
                                (summary['visitor'],cutoff,page['until'])).fetchall()
                item=dict(rows[0]);item.pop('visitor')
                source=db.execute("SELECT source FROM visits WHERE visitor=? AND at>=? AND at<=? AND source<>'Direct / unknown' ORDER BY at DESC LIMIT 1",
                                  (summary['visitor'],cutoff,page['until'])).fetchone()
                if source:item['source']=source[0]
                item['events']=[{'at':row['at'],'kind':'page','label':PAGES[row['path']]} for row in reversed(rows)]
                item.update(category=summary['category'],views=summary['views'],first=summary['first'],
                    label='Visit '+summary['visitor'][:6].upper(),eventsLimited=summary['views']>len(rows))
                item['ip']=item['ip'] if item['at']>=now-86400 and item['ip'] else 'Expired after 24 hours'
                item['pages']=list(dict.fromkeys(event['label'] for event in item['events']))
                pages.update(row['path'] for row in rows);activity.append(item)
        matching=[row for row in counts if category=='all' or row['category']==category]
        last=selected[24] if len(selected)>25 else None
        next_cursor=encode_page(self.key,dict(days=days,category=category,until=page['until'],at=last['latest'],
            session=last['visitor'],position=page['position']+len(activity))) if last else ''
        return {'demo': False, 'generatedAt': now, 'days': days, 'category': category,
                'currentIp': address(current_ip), 'currentIsHome': address(current_ip) in homes,
                'homes': homes, 'totals':{row['category']:row['views'] for row in counts},
                'groupTotals':{row['category']:row['groups'] for row in counts},'views':sum(row['views'] for row in matching),
                'visitors':sum(row['groups'] for row in matching),'referred':sum(row['referred'] for row in matching),
                'sources': [{'label': key, 'count': count} for key, count in
                    Counter(item['source'] for item in activity).most_common(5)],
                'position':page['position'],'nextCursor':next_cursor,'activity':activity,
                'pages':[{'label':key,'count':count} for key,count in pages.most_common(5)]}


def seed_demo(store, now=None):
    now = time.time() if now is None else now
    with store.connect() as db:
        if db.execute('SELECT count(*) FROM visits').fetchone()[0]:
            return
    agents = ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15',
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
              'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
              'Mozilla/5.0 (Linux; Android 15; Mobile) Chrome/131.0.0.0 Mobile Safari/537.36']
    locations = ['Denver, CO · demo', 'Seattle, WA · demo', 'Austin, TX · demo', 'London, UK · demo']
    scenarios = [
        ('198.51.100.10', 600, 0, 'resume', ['', '/system.html', '/api.html']),
        ('198.51.100.11', 7200, 2, 'linkedin', ['', '/data.html']),
        ('198.51.100.12', 18000, 1, 'github', ['/api.html']),
        ('198.51.100.13', 40000, 3, '', ['']),
        ('127.0.0.1', 5000, 0, '', ['', '/api.html', '/system.html']),
        ('198.51.100.14', 24000, 4, '', ['']),
        ('198.51.100.15', 2 * 86400, 1, 'portfolio', ['', '/data.html']),
    ]
    for ip, ago, device, source, paths in scenarios:
        for index, path in enumerate(paths):
            at = now - ago + index * 90
            store.ingest({'ts': at, 'status': 200, 'request': {'remote_ip': ip,
                'method': 'GET', 'uri': '/dashboard' + (path or '/') + (f'?src={source}' if index == 0 and source else ''),
                'headers': {'User-Agent': ['ExamplePreviewBot/1.0' if device == 4 else agents[device]]}}}, now)
            with store.connect() as db:
                db.execute('UPDATE visits SET location=?,viewport=?,timezone=?,language=? WHERE at=? AND visitor=?',
                    ('Local preview' if ip == '127.0.0.1' else locations[device % 4],
                     ['1440 × 900', '1920 × 1080', '393 × 852', '412 × 915'][device % 4],
                     'America/Denver', 'en-US', at, store.identity(ip, at)))


def illustrate_demo_actions(snapshot):
    """Design fixtures only; never infer button presses from imported page logs."""
    actions = {'Dashboard': ['Selected I-70', 'Enabled speed zones', 'Opened incident details'],
               'API': ['Loaded history example', 'Copied request example'],
               'System': ['Expanded how it works']}
    for item in snapshot['activity']:
        events = []
        pages = item['events']
        for index, page in enumerate(pages):
            events.append(page)
            if item['bot']:
                continue
            labels = actions.get(page['label'], [])
            available = pages[index + 1]['at'] - page['at'] if index + 1 < len(pages) else 60
            for offset, label in enumerate(labels, 1):
                events.append({'at': page['at'] + available * offset / (len(labels) + 1),
                               'kind': 'action', 'label': label})
        item['events'] = events
        item['at'] = events[-1]['at']
    return snapshot
