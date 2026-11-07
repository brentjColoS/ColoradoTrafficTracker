import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet
from analytics import Store
from collector import CollectedStore
from digest import MST, OPERATOR, deliver, message, run
from geo import area_from_record
from test_collector import body
from test_geo import record

USER='123456789012345678'


class DigestTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.directory=Path(self.temp.name);self.key=self.directory/'event.key'
        self.key.write_bytes(Fernet.generate_key());self.key.chmod(0o600)
        self.store=Store(self.directory/'events.sqlite')
        self.events=CollectedStore(self.store,self.key,scope='production',area_lookup=lambda _:area_from_record(record()))
        self.state=self.directory/'digest'/'checkpoint.json';self.now=time.time();self.sent=[]

    def visit(self,ip='192.0.2.1',agent='',value=None):
        value=copy.deepcopy(value) if value else body(self.now)
        for event in value['events']:event['page']='/dashboard/'
        self.events.ingest(value,ip,agent,now=self.now)
        return value

    def digest(self,**options):
        return run(self.store.filename,self.key,self.state,user=USER,now=self.now,
            sender=lambda _,payload:self.sent.append(payload),**options)

    def test_initialize_ignores_history_then_sends_once_and_never_changes_event_database(self):
        self.visit();self.assertEqual(self.digest(initialize=True),'initialized');self.assertEqual(self.sent,[])
        self.visit();before=hashlib.sha256(Path(self.store.filename).read_bytes()).digest()
        self.assertEqual(self.digest(),'sent');self.assertEqual(self.digest(),'already sent')
        self.assertEqual(hashlib.sha256(Path(self.store.filename).read_bytes()).digest(),before)
        self.assertEqual(len(self.sent),1)
        self.assertIn('1 new visit from Greenbelt, Maryland',self.sent[0]['content'])
        self.assertIn(OPERATOR,self.sent[0]['content'])
        self.assertEqual(self.state.stat().st_mode&0o077,0)
        with self.assertRaises(ValueError):self.digest(initialize=True)

    def test_home_bots_actions_only_and_existing_sessions_are_quiet_even_across_network_changes(self):
        old=self.visit();self.digest(initialize=True)
        self.visit(value=old)
        self.store.home('192.0.2.2',True)
        home=self.visit('192.0.2.2');self.visit('192.0.2.3',value=home)
        self.visit(agent='example crawler')
        action=body(self.now);action['events']=action['events'][1:];self.visit(value=action)
        self.assertEqual(self.digest(),'quiet');self.assertEqual(self.sent,[])

    def test_failed_delivery_retains_checkpoint_and_later_retry_sends_catchup_once(self):
        self.digest(initialize=True);self.visit();before=self.state.read_bytes()
        with self.assertRaises(OSError):
            run(self.store.filename,self.key,self.state,user=USER,now=self.now,
                sender=lambda *_:(_ for _ in ()).throw(OSError('delivery failed')))
        self.assertEqual(self.state.read_bytes(),before)
        self.assertEqual(self.digest(),'sent');self.assertEqual(len(self.sent),1)

    def test_backdated_new_rows_count_and_completed_sessions_never_realert_tomorrow(self):
        self.digest(initialize=True)
        backdated=body(self.now-200);self.visit(value=backdated)
        self.assertEqual(self.digest(),'sent')
        self.now+=20*3600
        later=body(self.now);later['session']=backdated['session'];self.visit(value=later)
        self.assertEqual(self.digest(),'quiet');self.assertEqual(len(self.sent),1)

    def test_details_are_bounded_and_only_configured_user_can_be_mentioned(self):
        self.digest(initialize=True)
        for _ in range(12):self.visit()
        self.assertEqual(self.digest(),'sent');payload=self.sent[0]
        self.assertIn('12 new visits',payload['content']);self.assertIn('+ 7 more',payload['content'])
        self.assertEqual(payload['content'].count('\n• '),5)
        self.assertEqual(payload['allowed_mentions'],{'parse':[],'users':[USER]})
        self.assertNotIn('192.0.2.',payload['content'])
        self.assertLess(len(payload['content']),2000)
        unknown=message({'visits':1,'details':[{'area':'Location unavailable','source':'@everyone [evil](https://evil.test)','device':'Unknown'}]},USER)
        self.assertIn('Location unavailable',unknown['content'])
        self.assertIn('\\@everyone',unknown['content'])
        with self.assertRaises(ValueError):message({'visits':1,'details':[]},'@username')

    def test_database_identity_change_fails_closed(self):
        self.digest(initialize=True)
        state=json.loads(self.state.read_text());state['source']='other';self.state.write_text(json.dumps(state))
        with self.assertRaises(ValueError):self.digest()
        self.assertEqual(self.sent,[])

    def test_webhook_transport_is_bounded_disallows_redirects_and_requires_confirmation(self):
        secret=self.directory/'webhook';secret.write_text('https://discord.com/api/webhooks/123/'+'x'*40);secret.chmod(0o600)
        with patch('urllib.request.build_opener') as opener:
            response=opener.return_value.open.return_value.__enter__.return_value
            response.status=200;response.read.return_value=b'{"id":"123456"}'
            deliver(secret,message({'visits':1,'details':[]},USER))
            self.assertEqual(opener.return_value.open.call_args.kwargs['timeout'],10)
            self.assertEqual(response.read.call_args.args,(8193,))
            response.status=429
            with self.assertRaises(ValueError):deliver(secret,message({'visits':1,'details':[]},USER))
        secret.write_text('https://other.example/api/webhooks/123/'+'x'*40)
        with self.assertRaises(ValueError):deliver(secret,{})

    def test_daily_utc_timer_is_fixed_five_pm_mst_not_daylight_saving(self):
        timer=(Path(__file__).parent/'ctt-visitors-digest.timer.example').read_text()
        self.assertIn('OnCalendar=*-*-* 00:00:00 UTC',timer)
        self.assertIn('Persistent=false',timer)
        for month in (1,7):
            scheduled=dt.datetime(2026,month,2,tzinfo=dt.timezone.utc).astimezone(MST)
            self.assertEqual(scheduled.hour,17)


if __name__=='__main__':unittest.main()
