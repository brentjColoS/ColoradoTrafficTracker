"""Bounded first-party events, isolated from traffic storage and provider requests."""
import datetime as dt
import base64
import hashlib
import hmac
import json
import os
import re
import stat
import threading
import time
import uuid
import sqlite3
from collections import Counter
from contextlib import closing
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from analytics import CAMPAIGNS, PAGES, BOT, address, agent_details, encode_page, decode_page

EVENT_PATH = '/dashboard-experimental-events'
EXPERIMENTAL = '/dashboard-experimental/'
SCOPES = {'experimental':(EVENT_PATH,EXPERIMENTAL),'production':('/visitor-events','/dashboard/')}
ACTIONS = {
    **{f'corridor:{key}': f'Selected {label}' for key, label in [('ALL','both corridors'),('I25','I-25'),('I70','I-70')]},
    **{f'range:{key}': f'Selected {label}' for key, label in [('2','2 hours'),('6','6 hours'),('24','24 hours'),('168','7 days'),('720','30 days')]},
    'view:overall': 'Selected overall graphs', 'view:zones': 'Selected speed zones',
    'zone-finder:on': 'Enabled zone finder', 'zone-finder:off': 'Disabled zone finder',
    'zone:select': 'Located a speed zone', 'zone:reset': 'Showed whole corridor',
    'history:older': 'Moved to older history', 'history:newer': 'Moved to newer history',
    'history:first': 'Opened earliest history', 'history:current': 'Returned to current graphs',
    'history:scroll-on': 'Enabled historical scrolling', 'history:scroll-off': 'Disabled historical scrolling',
    'incident:details': 'Opened incident details', 'incident:all': 'Toggled incident list',
    'incident:types': 'Toggled incident types', 'sync:manual': 'Requested manual sync',
    'sigma:wider': 'Widened reference band', 'sigma:narrower': 'Narrowed reference band',
    'theme:light': 'Selected light theme', 'theme:dark': 'Selected dark theme',
    'api:run': 'Ran API example', 'api:copy': 'Copied API example',
    'api:recipe': 'Loaded history example', 'system:details': 'Opened technical health details',
    'navigation:github': 'Opened project GitHub', 'navigation:dashboard': 'Opened dashboard',
    'navigation:system': 'Opened system page', 'navigation:data': 'Opened data information',
    'navigation:api': 'Opened API page',
}


def backup_database(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or not source.is_file(): raise ValueError('Invalid backup paths')
    with destination.open('xb'): pass
    destination.chmod(0o600)
    with closing(sqlite3.connect(f'file:{source}?mode=ro', uri=True)) as reader, closing(sqlite3.connect(destination)) as writer:
        deadline=time.monotonic()+30
        def progress(*_):
            if time.monotonic()>deadline:
                raise OSError('Visitor backup time budget reached; preserve the incomplete file and retry when writes settle')
        reader.backup(writer,pages=128,progress=progress,sleep=0.05)
    with destination.open('rb') as saved:
        return hashlib.file_digest(saved, 'sha256').hexdigest()


def canonical_page(value, scope='experimental'):
    prefix=SCOPES[scope][1]
    if not isinstance(value, str) or not value.startswith(prefix):
        raise ValueError('Unsupported page')
    suffix = value[len(prefix):]
    page = '/dashboard/' + ('' if suffix == 'index.html' else suffix)
    if page not in PAGES:
        raise ValueError('Unsupported page')
    return page


def private_key(filename):
    path = Path(filename)
    info = path.stat()
    if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise ValueError('Event key must be an owner-only regular file')
    return path.read_bytes().strip()


class RateLimit:
    def __init__(self):
        self.clients = {}; self.minute = -1; self.total = 0; self.lock = threading.Lock()

    def allow(self, identity):
        with self.lock:
            minute = int(time.monotonic() // 60)
            if minute != self.minute:
                self.clients.clear(); self.total = 0; self.minute = minute
            if self.total >= 600 or len(self.clients) >= 1024 and identity not in self.clients:
                return False
            count = self.clients.get(identity, 0)
            if count >= 60:
                return False
            self.clients[identity] = count + 1; self.total += 1
            return True


class CollectedStore:
    PAGE_SIZE = 25
    EVENTS_PER_SESSION = 60
    REDACTION_BATCH = 200

    def __init__(self, store, key_file, max_bytes=256*1024*1024, upgrade_backup=None, scope='experimental'):
        if scope not in SCOPES:raise ValueError('Unsupported collection scope')
        self.scope=scope
        self.store = store; self.key = private_key(key_file); self.cipher = Fernet(self.key)
        self.key_file = key_file
        self.index_key = hmac.new(base64.urlsafe_b64decode(self.key), b'ctt-visitor-index-v1', hashlib.sha256).digest()
        self.max_bytes = max_bytes
        with store.connect() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS browser_events (
                id TEXT PRIMARY KEY, session TEXT NOT NULL, at REAL NOT NULL,
                day TEXT NOT NULL, network TEXT NOT NULL, has_ip INTEGER NOT NULL,
                payload BLOB NOT NULL);
                CREATE INDEX IF NOT EXISTS browser_events_at ON browser_events(at);
                CREATE INDEX IF NOT EXISTS browser_events_session ON browser_events(session);''')
            marker = db.execute("SELECT value FROM settings WHERE key='event_key_check'").fetchone()
            if marker:
                try:
                    if self.cipher.decrypt(marker[0].encode()) != b'visitor-events-v1':
                        raise ValueError('Wrong event key')
                except InvalidToken as error:
                    raise ValueError('Wrong event key; preserve the original key and database') from error
            else:
                if db.execute('SELECT count(*) FROM browser_events').fetchone()[0]:
                    raise ValueError('Event key metadata is missing; preserve the database for recovery')
                db.execute('INSERT INTO settings VALUES (?,?)', ('event_key_check', self.cipher.encrypt(b'visitor-events-v1').decode()))
            saved_scope=db.execute("SELECT value FROM settings WHERE key='collection_scope'").fetchone()
            existing=db.execute('SELECT EXISTS(SELECT 1 FROM browser_events)').fetchone()[0]
            if scope != (saved_scope[0] if saved_scope else 'experimental' if existing else scope):
                raise ValueError('Collection scope differs from this database; preserve it and use separate storage')
            db.execute('INSERT OR IGNORE INTO settings VALUES (?,?)',('collection_scope',scope))
        with store.connect() as db:
            columns = {row['name'] for row in db.execute('PRAGMA table_info(browser_events)')}
            legacy = db.execute('SELECT EXISTS(SELECT 1 FROM browser_events'+
                (' WHERE meta_version=1' if 'meta_version' in columns else '')+')').fetchone()[0]
        if legacy:
            if not upgrade_backup:
                raise ValueError('Legacy visitor database requires upgrade with an explicit backup destination')
            backup_database(store.filename, upgrade_backup)
        with store.connect() as db:
            for name, default in [('is_page',0),('is_bot',0),('is_referred',0),('meta_version',1)]:
                if name not in columns:
                    db.execute(f'ALTER TABLE browser_events ADD COLUMN {name} INTEGER NOT NULL DEFAULT {default}')
            db.execute('CREATE INDEX IF NOT EXISTS browser_events_session_at ON browser_events(session,at DESC,id DESC)')
            db.execute('CREATE INDEX IF NOT EXISTS browser_events_version ON browser_events(meta_version)')
        if legacy:
            self._upgrade_records()

    def _write(self, db):
        pages = self.max_bytes // db.execute('PRAGMA page_size').fetchone()[0]
        if pages < 1 or db.execute(f'PRAGMA max_page_count={pages}').fetchone()[0] > pages:
            raise OSError('Visitor storage limit reached; preserve history and review disk use')
        db.execute('BEGIN IMMEDIATE')

    def _upgrade_records(self):
        while True:
            with self.store.connect() as db:
                self._write(db)
                rows = db.execute('SELECT * FROM browser_events WHERE meta_version=1 LIMIT ?', (self.REDACTION_BATCH,)).fetchall()
                if not rows: return
                for row in rows:
                    value = self.decode(row)
                    flags = [row['has_ip'],int(not value['action']),int(value['bot']),int(value['source'] != 'Direct / unknown'),2]
                    value['_index'] += flags
                    db.execute('UPDATE browser_events SET payload=?,is_page=?,is_bot=?,is_referred=?,meta_version=2 WHERE id=?',
                        (self.cipher.encrypt(json.dumps(value).encode()),*flags[1:4],row['id']))

    def identity(self, value):
        return hmac.new(self.index_key, value.encode(), hashlib.sha256).hexdigest()

    def decode(self, row):
        value = json.loads(self.cipher.decrypt(row['payload']))
        expected = [row[field] for field in ('id','session','at','day','network')]
        if row['meta_version'] == 2:
            expected += [row[field] for field in ('has_ip','is_page','is_bot','is_referred','meta_version')]
        elif row['meta_version'] != 1:
            raise ValueError('Unsupported visitor metadata version')
        if value.get('_index') != expected or bool(value.get('ip')) != bool(row['has_ip']):
            raise ValueError('Event metadata integrity check failed; preserve storage for recovery')
        return value

    def ingest(self, body, ip, agent='', host='', now=None):
        now = time.time() if now is None else now
        if not isinstance(body, dict) or set(body) != {'session','source','referrer','viewport','events'}:
            raise ValueError('Invalid envelope')
        session = body['session']
        if not isinstance(session, str) or str(uuid.UUID(session)) != session:
            raise ValueError('Invalid session')
        source, referrer, viewport, events = (body[k] for k in ('source','referrer','viewport','events'))
        if source not in CAMPAIGNS | {''} or not isinstance(referrer, str) or len(referrer) > 100 or (
                referrer and not re.fullmatch(r'[a-zA-Z0-9.-]+', referrer)):
            raise ValueError('Invalid source')
        if not isinstance(viewport, dict) or set(viewport) != {'width','height'} or any(
                type(value) is not int or not 1 <= value <= 10000 for value in viewport.values()):
            raise ValueError('Invalid viewport')
        if not isinstance(events, list) or not 1 <= len(events) <= 20:
            raise ValueError('Invalid batch')
        ip = address(ip); browser, os_name, device = agent_details(agent[:512])
        source = f'{source} link' if source else referrer if referrer != host else ''
        pending = []
        for event in events:
            if not isinstance(event, dict) or set(event) != {'id','at','page','action'}:
                raise ValueError('Invalid event')
            event_id, at, action = event['id'], event['at'], event['action']
            if not isinstance(event_id, str) or str(uuid.UUID(event_id)) != event_id:
                raise ValueError('Invalid event ID')
            if type(at) not in (int, float) or not now-600 <= at/1000 <= now+30:
                raise ValueError('Invalid event time')
            page = canonical_page(event['page'],self.scope)
            if not isinstance(action, str) or action and action not in ACTIONS:
                raise ValueError('Unsupported action')
            observed = at/1000; day = dt.datetime.fromtimestamp(observed, dt.timezone.utc).date().isoformat()
            payload = {'page': page, 'action': action, 'source': source or 'Direct / unknown',
                       'ip': ip, 'browser': browser, 'os': os_name, 'device': device,
                       'bot': bool(BOT.search(agent[:512])), 'viewport': f"{viewport['width']} × {viewport['height']}"}
            metadata = [self.identity('event|'+event_id), self.identity('session|'+session), observed,
                        day, self.identity(f'network|{day}|{ip}')]
            flags = [1,int(not action),int(payload['bot']),int(payload['source'] != 'Direct / unknown'),2]
            payload['_index'] = metadata + flags
            pending.append((*metadata,1,self.cipher.encrypt(json.dumps(payload).encode()),*flags[1:]))
        with self.store.connect() as db:
            self._write(db)
            key = pending[0][1]
            existing = db.execute('SELECT min(at),count(*) FROM browser_events WHERE session=?', (key,)).fetchone()
            known = {row[0] for row in db.execute('SELECT id FROM browser_events WHERE id IN ('+','.join('?' for _ in pending)+')',
                                                 [row[0] for row in pending])}
            pending = list({row[0]:row for row in pending if row[0] not in known}.values())
            if pending and existing[0] is not None and (now-existing[0] > 86400 or existing[1]+len(pending) > 500):
                raise ValueError('Session limit reached')
            before = db.total_changes
            db.executemany('INSERT INTO browser_events VALUES (?,?,?,?,?,?,?,?,?,?,?)', pending)
            return db.total_changes-before

    def redact(self, now):
        with self.store.connect() as db:
            self._write(db)
            saved = db.execute("SELECT value FROM settings WHERE key='redaction_cursor'").fetchone()
            after = json.loads(saved[0]) if saved else [0,'']
            # Scan aged records, not a mutable has_ip flag that could hide a tampered payload.
            rows = db.execute('SELECT * FROM browser_events WHERE at<? AND (at,id)>(?,?) ORDER BY at,id LIMIT ?',
                              (now-86400,*after,self.REDACTION_BATCH)).fetchall()
            for row in rows:
                value = self.decode(row)
                if row['has_ip']:
                    value['ip'] = None
                    value['_index'][5] = 0
                    db.execute('UPDATE browser_events SET payload=?,has_ip=0 WHERE id=?',
                               (self.cipher.encrypt(json.dumps(value).encode()), row['id']))
            marker = [rows[-1]['at'],rows[-1]['id']] if len(rows)==self.REDACTION_BATCH else [0,'']
            db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('redaction_cursor',json.dumps(marker)))
            if len(rows)<self.REDACTION_BATCH:
                db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('last_redaction',str(now)))
            return len(rows)

    def verify_records(self):
        last = 0
        while True:
            with self.store.connect() as db:
                rows=db.execute('SELECT rowid AS sequence,* FROM browser_events WHERE rowid>? ORDER BY rowid LIMIT ?',
                                (last,self.REDACTION_BATCH)).fetchall()
            if not rows:return
            for row in rows:self.decode(row)
            last=rows[-1]['sequence']

    def status(self, now=None):
        now=time.time() if now is None else now
        with self.store.connect() as db:
            stamps=dict(db.execute("SELECT key,value FROM settings WHERE key IN ('last_backup','last_redaction')"))
        warnings=[]
        if not stamps.get('last_backup') or now-float(stamps['last_backup'])>8*86400:
            warnings.append('No verified backup within eight days; run the private backup service.')
        if not stamps.get('last_redaction') or now-float(stamps['last_redaction'])>7200:
            warnings.append('Redaction maintenance has not completed within two hours; check its timer.')
        size=Path(self.store.filename).stat().st_size
        if size>=self.max_bytes*0.9:warnings.append('Visitor storage is near its cap; preserve history and review capacity.')
        return {'databaseBytes':size,'limitBytes':self.max_bytes,'lastBackupAt':float(stamps.get('last_backup',0)),
                'lastRedactionAt':float(stamps.get('last_redaction',0)),'warnings':warnings}

    def _cursor(self, value):
        return encode_page(self.index_key,value)

    def _read_cursor(self, token, days, category):
        return decode_page(self.index_key,token,days,category)

    def snapshot(self, ip, days=7, category='external', now=None, cursor=''):
        now = time.time() if now is None else now
        page = self._read_cursor(cursor,days,category) if cursor else {'until':now+30,'position':0}
        cutoff = 0 if days==0 else page['until']-30-days*86400
        with self.store.connect() as db:
            deadline=time.monotonic()+5
            db.set_progress_handler(lambda:int(time.monotonic()>deadline),2000)
            if not cursor:
                # Freeze committed rows, including against delayed writes with older event times.
                page['sequence']=db.execute('SELECT COALESCE(MAX(rowid),0) FROM browser_events').fetchone()[0]
            homes = [row[0] for row in db.execute('SELECT ip FROM homes ORDER BY ip')]
            @lru_cache(maxsize=128)
            def home_keys(day):
                return frozenset(self.identity(f'network|{day}|{home}') for home in homes)
            db.create_function('is_home',2,lambda day,network:int(network in home_keys(day)))
            grouped = '''WITH sessions AS (
                SELECT session,MAX(at) AS latest,MIN(at) AS first,COUNT(*) AS events,
                  SUM(is_page) AS views,SUM(is_page*is_referred) AS referred,
                  CASE WHEN MAX(is_home(day,network))=1 THEN 'home'
                    WHEN MAX(is_bot)=1 THEN 'automation' ELSE 'external' END AS category
                FROM browser_events WHERE at>=? AND at<=? AND rowid<=? GROUP BY session) '''
            args = [cutoff,page['until'],page['sequence']]
            counts = db.execute(grouped+'SELECT category,COUNT(*) AS groups,SUM(views) AS views,SUM(referred) AS referred FROM sessions GROUP BY category',args).fetchall()
            conditions = 'WHERE (?=\'all\' OR category=?)'
            query_args = args+[category,category]
            if cursor:
                conditions += ' AND (latest,session)<(?,?)'
                query_args += [page['at'],page['session']]
            selected = db.execute(grouped+'SELECT * FROM sessions '+conditions+' ORDER BY latest DESC,session DESC LIMIT ?',
                                  query_args+[self.PAGE_SIZE+1]).fetchall()
            more = len(selected)>self.PAGE_SIZE
            activity=[];pages=Counter()
            for summary in selected[:self.PAGE_SIZE]:
                rows = db.execute('SELECT * FROM browser_events WHERE session=? AND at>=? AND at<=? AND rowid<=? ORDER BY at DESC,id DESC LIMIT ?',
                    (summary['session'],cutoff,page['until'],page['sequence'],self.EVENTS_PER_SESSION)).fetchall()
                values = [self.decode(row) for row in rows]
                latest = values[0];latest.pop('_index',None)
                latest['ip'] = latest['ip'] if rows[0]['at']>=now-86400 and latest['ip'] else 'Expired after 24 hours'
                timeline = [{'at':row['at'],'kind':'action' if value['action'] else 'page',
                    'label':ACTIONS[value['action']] if value['action'] else PAGES[value['page']]} for row,value in reversed(list(zip(rows,values)))]
                for row,value in zip(rows,values):
                    if not value['action']:pages[value['page']]+=1
                activity.append({**latest,'label':'Session '+summary['session'][:6].upper(),
                    'category':summary['category'],'views':summary['views'],'first':summary['first'],'at':summary['latest'],
                    'eventCount':summary['events'],'events':timeline,'eventsLimited':summary['events']>len(timeline),
                    'pages':list(dict.fromkeys(event['label'] for event in timeline if event['kind']=='page')),
                    'location':'Not resolved','timezone':'Not collected','language':'Not collected'})
        totals = {row['category']:row['views'] for row in counts}
        group_totals = {row['category']:row['groups'] for row in counts}
        matching = [row for row in counts if category=='all' or row['category']==category]
        last = selected[self.PAGE_SIZE-1] if more else None
        next_cursor = self._cursor({'days':days,'category':category,'until':page['until'],'sequence':page['sequence'],
            'at':last['latest'],'session':last['session'],'position':page['position']+len(activity)}) if more else ''
        return {'demo':False,'collected':True,'generatedAt':now,'days':days,'category':category,
                'currentIp':address(ip),'currentIsHome':address(ip) in homes,'homes':homes,
                'totals':totals,'groupTotals':group_totals,
                'views':sum(row['views'] for row in matching),'visitors':sum(row['groups'] for row in matching),
                'referred':sum(row['referred'] for row in matching),'position':page['position'],'nextCursor':next_cursor,
                'sources':[{'label':k,'count':v} for k,v in Counter(i['source'] for i in activity).most_common(5)],
                'pages':[{'label':k,'count':v} for k,v in pages.most_common(5)],'activity':activity}
