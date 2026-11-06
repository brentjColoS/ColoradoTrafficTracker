import copy
import grp
import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import shutil

from cryptography.fernet import Fernet
from analytics import Store
from collector import CollectedStore
from maintenance import archive
from offsite import record,warning
from server import make_server,PREFIX
from test_collector import body


def production_body():
    value=body()
    for event in value['events']:event['page']=event['page'].replace('/dashboard-experimental/','/dashboard/')
    return value


class ProductionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.key=self.root/'event.key'
        self.key.write_bytes(Fernet.generate_key());self.key.chmod(0o600)
        self.store=Store(self.root/'events.sqlite')
        self.options=dict(origin='https://operator.example.test',trust_proxy=True,collect=True,key_file=self.key,
            operator_networks=['8.8.4.4/32'],operator_ip_only=True,collection_scope='production')
        self.server=make_server(self.store,0,**self.options)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown();self.server.server_close();self.thread.join()

    def request(self,path=PREFIX+'data',method='GET',value=None,ip='8.8.4.4',headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        values={'Host':'operator.example.test','Origin':'https://operator.example.test','Content-Type':'application/json',**(headers or {})}
        if ip is not None:values['X-Visitor-Client-IP']=ip
        connection.request(method,path,json.dumps(value) if value is not None else None,values)
        reply=connection.getresponse();result=reply.status,reply.read(),dict(reply.getheaders());connection.close();return result

    def test_exact_owner_reads_without_password_but_all_other_operator_requests_fail(self):
        for suffix in ['', 'data','visitors.js','visitors.css','fonts/archivo-latin.woff2']:
            self.assertEqual(self.request(PREFIX+suffix)[0],200)
            for ip in ['8.8.8.8',None,'invalid','8.8.4.4, 8.8.8.8']:
                self.assertEqual(self.request(PREFIX+suffix,ip=ip,headers={'X-Forwarded-For':'8.8.4.4'})[0],403)
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        connection.putrequest('GET',PREFIX+'data',skip_host=True)
        connection.putheader('Host','operator.example.test')
        connection.putheader('X-Visitor-Client-IP','8.8.4.4');connection.putheader('X-Visitor-Client-IP','8.8.4.4')
        connection.endheaders();reply=connection.getresponse();self.assertEqual(reply.status,403);reply.read();connection.close()

    def test_ip_only_rejects_missing_broad_private_or_untrusted_allowlists(self):
        examples=[{'operator_networks':[]},{'operator_networks':['0.0.0.0/0']},
            {'operator_networks':['8.8.4.0/24']},{'operator_networks':['127.0.0.1/32']},
            {'operator_networks':['192.168.1.1/32']},{'trust_proxy':False},{'origin':'http://operator.example.test'}]
        for changes in examples:
            with self.assertRaises(ValueError):make_server(self.store,0,**{**self.options,**changes})

    def test_public_prod_intake_cannot_read_operator_data_and_never_accepts_other_scopes(self):
        value=production_body()
        self.assertEqual(self.request('/visitor-events','POST',value,ip='8.8.8.8')[0],204)
        status,raw,_=self.request();self.assertEqual(status,200)
        data=json.loads(raw);self.assertEqual(data['views'],1)
        self.assertEqual(data['sourceBase'],'https://operator.example.test/dashboard/')
        self.assertEqual(data['collectionScope'],'production')
        self.assertEqual(self.request('/visitor-events')[0],404)
        self.assertEqual(self.request('/visitor-events','POST',body())[0],400)
        self.assertEqual(self.request('/dashboard-experimental-events','POST',body())[0],404)
        for headers in [{'Sec-GPC':'1'},{'DNT':'1'}]:
            self.assertEqual(self.request('/visitor-events','POST',{'private':'ignored'},headers=headers)[0],204)
        self.assertEqual(json.loads(self.request()[1])['views'],1)
        self.assertEqual(self.request('/visitor-events','POST',production_body(),headers={'Origin':'https://attacker.test'})[0],403)

    def test_home_still_requires_same_origin_and_action_token(self):
        token=json.loads(self.request()[1])['actionToken']
        self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':True})[0],403)
        self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':True},headers={'X-Visitor-Action':token,'Origin':'https://other.test'})[0],403)
        self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':True},headers={'X-Visitor-Action':token})[0],200)
        self.assertEqual(json.loads(self.request()[1])['homes'],['8.8.4.4'])

    def test_scope_is_pinned_to_storage_and_shared_backup_never_shares_the_key(self):
        self.request('/visitor-events','POST',production_body())
        with self.assertRaises(ValueError):CollectedStore(self.store,self.key)
        events=CollectedStore(self.store,self.key,scope='production')
        directory=self.root/'backups';directory.mkdir(mode=0o750)
        group=grp.getgrgid(directory.stat().st_gid).gr_name
        snapshot=archive(events,directory,read_group=group)
        self.assertEqual(snapshot.stat().st_mode&0o777,0o640)
        self.assertEqual(snapshot.with_suffix('.sha256').stat().st_mode&0o777,0o640)
        self.assertEqual(self.key.stat().st_mode&0o777,0o600)
        restored=CollectedStore(Store(snapshot),self.key,scope='production')
        self.assertEqual(restored.snapshot('8.8.4.4')['views'],1)
        directory.chmod(0o770)
        with self.assertRaises(ValueError):archive(events,directory,read_group=group)

    def test_offsite_receipts_validate_manifest_and_age_of_snapshot_not_latest_transfer(self):
        events=CollectedStore(self.store,self.key,scope='production')
        snapshot=archive(events,self.root/'backups')
        directory=self.root/'receipts';directory.mkdir(mode=0o750)
        receipt=directory/'offsite.json';checksum=snapshot.with_suffix('.sha256').read_text().split()[0]
        record(snapshot.parent,receipt,snapshot.name,checksum)
        self.assertIsNone(warning(receipt,time.time()))
        self.assertIsNotNone(warning(receipt,time.time()+9*86400))
        self.assertEqual(receipt.stat().st_mode&0o777,0o640)
        with self.assertRaises(ValueError):record(snapshot.parent,receipt,snapshot.name,'0'*64)
        self.assertIsNone(warning(receipt,time.time()))
        self.assertIsNotNone(warning(directory/'missing.json',time.time()))
        older=snapshot.parent/'events-20200101T000000000000Z.sqlite'
        shutil.copyfile(snapshot,older)
        older.with_suffix('.sha256').write_text(checksum+'  '+older.name+'\n')
        record(older.parent,receipt,older.name,checksum)
        self.assertEqual(json.loads(receipt.read_text())['filename'],snapshot.name)
        # An abandoned temporary file must not prevent later receipts from advancing.
        (directory/'offsite.partial').write_text('interrupted synthetic receipt')
        record(snapshot.parent,receipt,snapshot.name,checksum)
        self.assertIsNone(warning(receipt,time.time()))
