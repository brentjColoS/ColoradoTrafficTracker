import copy
import fcntl
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
import uuid
from unittest.mock import patch

from cryptography.fernet import Fernet
from analytics import Store
from collector import CollectedStore, backup_database
from maintenance import archive
from test_collector import body


class HardeningTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.directory=Path(self.temp.name);self.key=self.directory/'event.key'
        self.key.write_bytes(Fernet.generate_key());self.key.chmod(0o600)
        self.store=Store(self.directory/'events.sqlite');self.events=CollectedStore(self.store,self.key)
        self.now=time.time()

    def batch(self, session=None, count=20):
        value=body(self.now)
        if session:value['session']=session
        value['events']=[dict(value['events'][0],id=str(uuid.uuid4())) for _ in range(count)]
        return value

    def test_every_visit_is_reachable_with_bounded_stable_pages_and_ties(self):
        for _ in range(53):self.events.ingest(body(self.now),'192.0.2.10',now=self.now)
        seen=[];cursor='';positions=[]
        with patch.object(self.events,'decode',wraps=self.events.decode) as decode:
            while True:
                start=decode.call_count
                page=self.events.snapshot('127.0.0.1',days=0,now=self.now+2,cursor=cursor)
                self.assertEqual(page['visitors'],53);self.assertEqual(page['views'],53)
                self.assertLessEqual(len(page['activity']),25)
                self.assertLessEqual(decode.call_count-start,25*60)
                seen += [item['label'] for item in page['activity']];positions.append(page['position'])
                cursor=page['nextCursor']
                if not cursor:break
        self.assertEqual(len(seen),53);self.assertEqual(len(set(seen)),53)
        self.assertEqual(positions,[0,25,50])

    def test_cursor_is_authenticated_filter_bound_and_freezes_newer_inserts(self):
        for _ in range(27):self.events.ingest(body(self.now),'192.0.2.10',now=self.now)
        first=self.events.snapshot('127.0.0.1',now=self.now)
        self.events.ingest(body(self.now+60),'192.0.2.10',now=self.now+60)
        self.events.ingest(body(self.now-1),'192.0.2.10',now=self.now+60)
        # A delayed write may have started before the first snapshot's clock cutoff.
        self.events.ingest(body(self.now-2),'192.0.2.10',now=self.now-1)
        second=self.events.snapshot('127.0.0.1',now=self.now+60,cursor=first['nextCursor'])
        self.assertEqual(second['visitors'],27);self.assertEqual(len(second['activity']),2)
        self.assertEqual(self.events.snapshot('127.0.0.1',now=self.now+60)['visitors'],30)
        for args in [dict(cursor=first['nextCursor']+'x'),dict(cursor=first['nextCursor'],days=30),
                     dict(cursor=first['nextCursor'],category='all'),dict(cursor='x'*600)]:
            with self.assertRaises(ValueError):self.events.snapshot('127.0.0.1',now=self.now,**args)

    def test_session_capacity_is_atomic_and_duplicate_retries_are_idempotent_at_the_limit(self):
        session=str(uuid.uuid4())
        for _ in range(24):self.events.ingest(self.batch(session),'192.0.2.10',now=self.now)
        barrier=threading.Barrier(2);results=[];accepted=[]
        def send():
            value=self.batch(session);barrier.wait()
            try:
                results.append(self.events.ingest(value,'192.0.2.10',now=self.now));accepted.append(value)
            except ValueError:results.append('full')
        threads=[threading.Thread(target=send) for _ in range(2)]
        for thread in threads:thread.start()
        for thread in threads:thread.join(timeout=5);self.assertFalse(thread.is_alive())
        self.assertCountEqual(results,[20,'full'])
        self.assertEqual(self.events.ingest(accepted[0],'192.0.2.10',now=self.now),0)
        with self.store.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM browser_events').fetchone()[0],500)

    def test_home_exclusion_pages_outside_visits_and_binds_cursors_to_the_filter(self):
        self.store.home('192.0.2.10',True)
        for index in range(29):
            agent='ExampleBot/1.0' if index==0 else 'Chrome/131'
            self.events.ingest(body(self.now),'192.0.2.11',agent,now=self.now)
        for _ in range(3):self.events.ingest(body(self.now),'192.0.2.10',now=self.now)
        first=self.events.snapshot('127.0.0.1',category='nonhome',now=self.now+2)
        second=self.events.snapshot('127.0.0.1',category='nonhome',now=self.now+2,cursor=first['nextCursor'])
        self.assertEqual((first['visitors'],first['views']),(29,29))
        self.assertEqual([len(first['activity']),len(second['activity'])],[25,4])
        visits=first['activity']+second['activity']
        self.assertEqual(len({visit['label'] for visit in visits}),29)
        self.assertEqual({visit['category'] for visit in visits},{'external','automation'})
        with self.assertRaises(ValueError):
            self.events.snapshot('127.0.0.1',category='all',now=self.now+2,cursor=first['nextCursor'])
        included=self.events.snapshot('127.0.0.1',category='all',now=self.now+2)
        self.assertEqual((included['visitors'],included['views']),(32,32))
        self.assertEqual(first['groupTotals'],included['groupTotals'])
        self.assertEqual(included['homes'],['192.0.2.10'])

    def test_sqlite_cannot_grow_beyond_the_configured_cap_and_failed_batch_is_atomic(self):
        self.events.max_bytes=Path(self.store.filename).stat().st_size
        for _ in range(40):
            with self.store.connect() as db:before=db.execute('SELECT count(*) FROM browser_events').fetchone()[0]
            try:self.events.ingest(self.batch(),'192.0.2.10',now=self.now)
            except (OSError,sqlite3.Error):
                with self.store.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM browser_events').fetchone()[0],before)
                break
        else:self.fail('Expected bounded SQLite growth to stop intake')
        self.assertLessEqual(Path(self.store.filename).stat().st_size,self.events.max_bytes)

    def test_redaction_is_resumable_bounded_and_reads_never_expose_expired_ips(self):
        for _ in range(23):self.events.ingest(self.batch(),'192.0.2.10',now=self.now)
        later=self.now+90000
        self.assertEqual(self.events.redact(later),200)
        with self.store.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM browser_events WHERE has_ip=1').fetchone()[0],260)
        view=self.events.snapshot('127.0.0.1',days=0,now=later)
        self.assertTrue(all(item['ip']=='Expired after 24 hours' for item in view['activity']))
        while self.events.redact(later)==200:pass
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM browser_events WHERE has_ip=1').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM browser_events').fetchone()[0],460)
        self.events.verify_records()

    def test_mutable_redaction_flag_cannot_hide_an_expired_encrypted_ip(self):
        self.events.ingest(body(self.now),'192.0.2.10',now=self.now)
        with self.store.connect() as db:db.execute('UPDATE browser_events SET has_ip=0')
        with self.assertRaises(ValueError):self.events.snapshot('127.0.0.1',days=0,now=self.now+90000)
        with self.assertRaises(ValueError):self.events.redact(self.now+90000)

    def test_legacy_encrypted_upgrade_requires_and_preserves_a_backup(self):
        store=Store(self.directory/'legacy.sqlite');value=body(self.now);event=value['events'][0]
        metadata=[self.events.identity('event|'+event['id']),self.events.identity('session|'+value['session']),
                  self.now,time.strftime('%Y-%m-%d',time.gmtime(self.now)),self.events.identity('network|example')]
        payload=dict(page='/dashboard/',action='',source='resume link',ip='192.0.2.10',browser='Chrome',
                     os='Windows',device='Desktop',bot=False,viewport='393 × 852',_index=metadata)
        with store.connect() as db:
            db.execute('CREATE TABLE browser_events(id TEXT PRIMARY KEY,session TEXT,at REAL,day TEXT,network TEXT,has_ip INTEGER,payload BLOB)')
            db.execute('INSERT INTO browser_events VALUES(?,?,?,?,?,?,?)',(*metadata,1,self.events.cipher.encrypt(json.dumps(payload).encode())))
            db.execute('INSERT INTO settings VALUES(?,?)',('event_key_check',self.events.cipher.encrypt(b'visitor-events-v1').decode()))
        with self.assertRaises(ValueError):CollectedStore(store,self.key)
        backup=self.directory/'before-upgrade.sqlite'
        upgraded=CollectedStore(store,self.key,upgrade_backup=backup)
        self.assertEqual(upgraded.snapshot('127.0.0.1',now=self.now)['views'],1)
        with sqlite3.connect(backup) as db:self.assertNotIn('meta_version',[row[1] for row in db.execute('PRAGMA table_info(browser_events)')])
        CollectedStore(store,self.key).verify_records()

    def test_verified_backup_and_budget_preserve_history_and_report_staleness(self):
        self.events.ingest(body(self.now),'192.0.2.10',now=self.now)
        self.assertTrue(self.events.status(self.now)['warnings'])
        self.events.redact(self.now)
        path=archive(self.events,self.directory/'backups')
        self.assertEqual(CollectedStore(Store(path),self.key).snapshot('127.0.0.1',now=self.now+2)['views'],1)
        self.assertEqual(path.with_suffix('.sha256').read_text().split()[0],hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertFalse(self.events.status(self.now+2)['warnings'])
        with self.assertRaises(OSError):archive(self.events,self.directory/'backups',max_bytes=1)
        self.assertTrue(path.is_file());self.assertEqual(self.events.snapshot('127.0.0.1',now=self.now+2)['views'],1)

    def test_backup_hashing_does_not_read_the_entire_database_into_memory(self):
        with patch.object(Path,'read_bytes',side_effect=AssertionError('Unbounded read')):
            backup_database(self.store.filename,self.directory/'streamed.sqlite')

    def test_weekly_snapshots_rotate_only_after_verification_without_deleting_history(self):
        self.events.ingest(body(self.now),'192.0.2.10',now=self.now)
        directory=self.directory/'backups'
        first=archive(self.events,directory);second=archive(self.events,directory)
        unrelated=directory/'manual.sqlite';unrelated.write_text('preserve manual copy')
        incomplete=directory/'events-20000101T000000000000Z.sqlite';incomplete.write_text('preserve incomplete copy')
        with patch.object(CollectedStore,'verify_records',side_effect=ValueError('Synthetic failed verification')):
            with self.assertRaises(ValueError):archive(self.events,directory)
        self.assertTrue(first.is_file());self.assertTrue(second.is_file())
        third=archive(self.events,directory)
        self.assertFalse(first.exists());self.assertFalse(first.with_suffix('.sha256').exists())
        self.assertTrue(second.is_file());self.assertTrue(third.is_file())
        self.assertTrue(unrelated.is_file());self.assertTrue(incomplete.is_file())
        for path in (second,third):
            self.assertEqual(CollectedStore(Store(path),self.key).snapshot('127.0.0.1',now=self.now+2)['views'],1)
        self.assertEqual(self.events.snapshot('127.0.0.1',now=self.now+2)['views'],1)

    def test_concurrent_snapshot_cannot_rotate_or_copy_while_another_is_running(self):
        directory=self.directory/'backups';directory.mkdir(mode=0o700)
        with (directory/'.archive.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):archive(self.events,directory)
        self.assertFalse(list(directory.glob('*.sqlite')))

    def test_slow_snapshot_stops_at_its_query_budget_without_changing_records(self):
        for _ in range(20):self.events.ingest(self.batch(),'192.0.2.10',now=self.now)
        ticks=iter([0])
        with patch('collector.time.monotonic',side_effect=lambda:next(ticks,10)):
            with self.assertRaisesRegex(sqlite3.OperationalError,'interrupted'):
                self.events.snapshot('127.0.0.1',now=self.now+2)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM browser_events').fetchone()[0],400)
        self.assertEqual(self.events.snapshot('127.0.0.1',now=self.now+2)['visitors'],20)

    def test_home_configuration_is_bounded_without_removing_existing_addresses(self):
        for index in range(16):self.store.home(f'192.0.2.{index+1}',True)
        with self.assertRaises(ValueError):self.store.home('192.0.2.100',True)
        self.store.home('192.0.2.1',True)
        with self.store.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM homes').fetchone()[0],16)
