import copy
import http.client
import json
import hashlib
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path

from cryptography.fernet import Fernet
from analytics import Store
from collector import CollectedStore, RateLimit, backup_database
from server import make_server, password_hash


def body(now=None):
    now = time.time() if now is None else now
    return {'session':str(uuid.uuid4()),'source':'resume','referrer':'linkedin.com',
        'viewport':{'width':393,'height':852},'events':[
            {'id':str(uuid.uuid4()),'at':now*1000,'page':'/dashboard-experimental/','action':''},
            {'id':str(uuid.uuid4()),'at':(now+1)*1000,'page':'/dashboard-experimental/','action':'corridor:I70'}]}


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.key=Path(self.temp.name)/'event.key';self.key.write_bytes(Fernet.generate_key());self.key.chmod(0o600)
        self.store=Store(Path(self.temp.name)/'events.sqlite')
        self.events=CollectedStore(self.store,self.key)
        self.now=time.time()

    def test_encrypted_deduplicated_events_make_a_real_ordered_journey(self):
        value=body(self.now)
        self.assertEqual(self.events.ingest(value,'192.0.2.10','Chrome/131.0 Windows',now=self.now),2)
        self.assertEqual(self.events.ingest(value,'192.0.2.10',now=self.now),0)
        snapshot=self.events.snapshot('127.0.0.1',now=self.now+2)
        self.assertTrue(snapshot['collected']);self.assertEqual(snapshot['views'],1)
        self.assertEqual(snapshot['activity'][0]['source'],'resume link')
        self.assertEqual([event['label'] for event in snapshot['activity'][0]['events']],['Dashboard','Selected I-70'])
        raw=Path(self.store.filename).read_bytes()
        for private in [b'192.0.2.10',b'linkedin.com',b'resume link',value['session'].encode(),self.key.read_bytes()]:
            self.assertNotIn(private,raw)

    def test_validation_rejects_arbitrary_fields_and_primary_pages_atomically(self):
        examples=[]
        value=body(self.now);value['typedText']='private';examples.append(value)
        value=body(self.now);value['events'][1]['action']='arbitrary user text';examples.append(value)
        value=body(self.now);value['events'][1]['page']='/dashboard/';examples.append(value)
        value=body(self.now);value['events'][1]['page']='/dashboard-experimental/?secret=private';examples.append(value)
        value=body(self.now);value['events'][1]['at']=float('nan');examples.append(value)
        value=body(self.now);value['viewport']['width']=True;examples.append(value)
        value=body(self.now);value['events']*=11;examples.append(value)
        value=body(self.now);value['referrer']='https://example.test/private?secret=private';examples.append(value)
        for value in examples:
            with self.assertRaises((ValueError,TypeError)):self.events.ingest(value,'192.0.2.10',now=self.now)
        self.assertEqual(self.events.snapshot('127.0.0.1',now=self.now)['views'],0)

    def test_home_wins_for_a_session_across_network_changes_and_survives_redaction(self):
        value=body(self.now);self.events.ingest(value,'192.0.2.10',now=self.now)
        later=copy.deepcopy(value);later['events']=[dict(later['events'][1],id=str(uuid.uuid4()),at=(self.now+2)*1000)]
        self.events.ingest(later,'192.0.2.11',now=self.now+2)
        self.store.home('192.0.2.10',True)
        self.assertEqual(self.events.snapshot('192.0.2.10',now=self.now+3)['visitors'],0)
        home=self.events.snapshot('192.0.2.10',days=0,category='home',now=self.now+400*86400)
        self.assertEqual(home['views'],1);self.assertEqual(home['visitors'],1)
        self.assertEqual(home['activity'][0]['ip'],'Expired after 24 hours')

    def test_wrong_key_and_insecure_permissions_fail_without_replacing_history(self):
        self.events.ingest(body(self.now),'192.0.2.10',now=self.now)
        other=Path(self.temp.name)/'other.key';other.write_bytes(Fernet.generate_key());other.chmod(0o600)
        with self.assertRaises(ValueError):CollectedStore(self.store,other)
        self.assertEqual(self.events.snapshot('127.0.0.1',now=self.now+2)['views'],1)
        other.chmod(0o644)
        with self.assertRaises(ValueError):CollectedStore(self.store,other)

    def test_disposable_backup_restore_needs_the_original_key(self):
        self.events.ingest(body(self.now),'192.0.2.10',now=self.now)
        restored=Path(self.temp.name)/'restored.sqlite'
        checksum=backup_database(self.store.filename,restored)
        self.assertEqual(checksum,hashlib.sha256(restored.read_bytes()).hexdigest())
        with self.assertRaises(FileExistsError):backup_database(self.store.filename,restored)
        reader=CollectedStore(Store(restored),self.key)
        self.assertEqual(reader.snapshot('127.0.0.1',now=self.now+2)['views'],1)
        self.assertEqual(reader.snapshot('127.0.0.1',days=0,now=self.now+400*86400)['views'],1)

    def test_event_metadata_tampering_fails_closed(self):
        self.events.ingest(body(self.now),'192.0.2.10',now=self.now)
        with self.store.connect() as db: db.execute('UPDATE browser_events SET at=at+1')
        with self.assertRaises(ValueError):self.events.snapshot('127.0.0.1',now=self.now+2)

    def test_storage_and_rate_limits_are_bounded_without_deleting_history(self):
        self.events.max_bytes=1
        with self.assertRaises(OSError):self.events.ingest(body(self.now),'192.0.2.10',now=self.now)
        rate=RateLimit()
        self.assertTrue(all(rate.allow('one') for _ in range(60)));self.assertFalse(rate.allow('one'))
        self.assertLessEqual(len(rate.clients),1024)


class CollectorHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.key=Path(self.temp.name)/'event.key';self.key.write_bytes(Fernet.generate_key());self.key.chmod(0o600)
        self.store=Store(Path(self.temp.name)/'events.sqlite')
        self.server=make_server(self.store,0,credential=password_hash('synthetic'),origin='https://operator.example.test',
            trust_proxy=True,collect=True,key_file=self.key,operator_networks=['192.0.2.10/32'])
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown();self.server.server_close();self.thread.join()

    def request(self,path='/dashboard-experimental-events',headers=None,data=None,method='POST'):
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        conn.request(method,path,json.dumps(body() if data is None else data),
            {'Host':'operator.example.test','Origin':'https://operator.example.test','Content-Type':'application/json',
             'X-Visitor-Client-IP':'192.0.2.11',**(headers or {})})
        reply=conn.getresponse();result=(reply.status,reply.read(),dict(reply.getheaders()));conn.close();return result

    def test_public_write_only_route_does_not_grant_operator_access_or_cors(self):
        self.assertEqual(self.request()[0],204)
        self.assertEqual(self.request(method='GET')[0],404)
        self.assertEqual(self.request('/operator/visitors/data',method='GET')[0],403)
        self.assertEqual(self.request('/operator/visitors/data',method='GET',headers={'X-Visitor-Client-IP':'192.0.2.10'})[0],401)
        self.assertEqual(self.request(headers={'Origin':'https://other.test'})[0],403)
        reply=self.request(headers={'Sec-Fetch-Site':'cross-site'})
        self.assertEqual(reply[0],403);self.assertNotIn('Access-Control-Allow-Origin',reply[2])

    def test_privacy_headers_skip_all_event_writes_even_for_malformed_body(self):
        for headers in [{'Sec-GPC':'1'},{'DNT':'1'}]:
            self.assertEqual(self.request(headers=headers,data={'secret':'do not persist'})[0],204)
        self.assertEqual(CollectedStore(self.store,self.key).snapshot('127.0.0.1')['views'],0)
        self.assertEqual(self.request(headers={'DNT':'0'})[0],204)
        self.assertEqual(CollectedStore(self.store,self.key).snapshot('127.0.0.1')['views'],1)

    def test_invalid_content_and_schema_never_reach_storage(self):
        self.assertEqual(self.request(headers={'Content-Type':'text/plain'})[0],415)
        self.assertEqual(self.request(data={'filler':'x'*17000})[0],413)
        self.assertEqual(self.request(data={'unsupported':'private'})[0],400)
        self.assertEqual(self.request(headers={'Host':'other.test'})[0],403)

    def test_production_collection_requires_key_allowlist_and_proxy_validation(self):
        for options in [{},{'operator_networks':['192.0.2.10/32']},{'trust_proxy':True}]:
            with self.assertRaises(ValueError):
                make_server(self.store,0,credential='set',origin='https://operator.example.test',collect=True,**options)
        with self.assertRaises(ValueError):make_server(self.store,0,demo=True,collect=True)


if __name__=='__main__': unittest.main()
