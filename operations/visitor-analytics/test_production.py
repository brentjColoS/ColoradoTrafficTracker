import copy
import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from cryptography.fernet import Fernet
from analytics import Store
from collector import CollectedStore
from maintenance import archive
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
        self.assertEqual(data['sourceBase'],'https://operator.example.test/')
        self.assertEqual(data['collectionScope'],'production')
        self.assertEqual(self.request('/visitor-events')[0],404)
        self.assertEqual(self.request('/visitor-events','POST',body())[0],400)
        self.assertEqual(self.request('/dashboard-experimental-events','POST',body())[0],404)
        for headers in [{'Sec-GPC':'1'},{'Sec-GPC':'1','DNT':'1'}]:
            self.assertEqual(self.request('/visitor-events','POST',{'private':'ignored'},headers=headers)[0],204)
        self.assertEqual(json.loads(self.request()[1])['views'],1)
        self.assertEqual(self.request('/visitor-events','POST',production_body(),headers={'Origin':'https://attacker.test'})[0],403)

    def test_production_dnt_records_valid_journeys_without_relaxing_validation(self):
        for signal in ['1','yes']:
            self.assertEqual(self.request('/visitor-events','POST',production_body(),headers={'DNT':signal})[0],204)
        data=json.loads(self.request()[1])
        self.assertEqual(data['views'],2)
        self.assertTrue(all([event['label'] for event in visit['events']]==['Dashboard','Selected I-70']
                            for visit in data['activity']))
        self.assertEqual(self.request('/visitor-events','POST',{'private':'invalid'},headers={'DNT':'1'})[0],400)
        self.assertEqual(self.request('/visitor-events','POST',production_body(),headers={'DNT':'1','Origin':'https://attacker.test'})[0],403)
        self.assertEqual(json.loads(self.request()[1])['views'],2)

    def test_home_still_requires_same_origin_and_action_token(self):
        token=json.loads(self.request()[1])['actionToken']
        self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':True})[0],403)
        self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':True},headers={'X-Visitor-Action':token,'Origin':'https://other.test'})[0],403)
        self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':True},headers={'X-Visitor-Action':token})[0],200)
        self.assertEqual(json.loads(self.request()[1])['homes'],['8.8.4.4'])

    def test_home_inclusion_changes_totals_and_rows_without_reclassifying_visits(self):
        self.store.home('8.8.4.4',True)
        for ip,agent in [('8.8.4.4','Chrome/131'),('8.8.8.8','Chrome/131'),('1.1.1.1','ExampleBot/1.0')]:
            self.assertEqual(self.request('/visitor-events','POST',production_body(),ip=ip,headers={'User-Agent':agent})[0],204)
        outside=json.loads(self.request(PREFIX+'data?category=nonhome')[1])
        self.assertEqual((outside['visitors'],outside['views']),(2,2))
        self.assertCountEqual([visit['category'] for visit in outside['activity']],['external','automation'])
        included=json.loads(self.request(PREFIX+'data?category=all')[1])
        self.assertEqual((included['visitors'],included['views']),(3,3))
        self.assertEqual(outside['groupTotals'],included['groupTotals'])
        self.assertEqual(included['homes'],['8.8.4.4'])
        self.assertEqual(json.loads(self.request(PREFIX+'data?category=home')[1])['visitors'],1)

    def test_manual_home_addresses_normalize_reclassify_and_grant_view_only_access(self):
        self.request('/visitor-events','POST',production_body(),ip='8.8.8.8')
        token=json.loads(self.request()[1])['actionToken']
        headers={'X-Visitor-Action':token}
        for ip in [' ::ffff:8.8.8.8 ','2606:4700:4700:0000:0000:0000:0000:1111']:
            self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':True,'add':ip},headers=headers)[0],200)
        snapshot=json.loads(self.request()[1])
        self.assertEqual(snapshot['homes'],['2606:4700:4700::1111','8.8.8.8'])
        self.assertEqual(snapshot['views'],0)
        self.assertEqual(json.loads(self.request(PREFIX+'data?category=home')[1])['views'],1)
        for ip in ['8.8.8.8','2606:4700:4700::1111']:
            self.assertEqual(self.request(ip=ip)[0],200)
            viewer=json.loads(self.request(ip=ip)[1])
            self.assertFalse(viewer['homeManageAllowed']);self.assertFalse(viewer['homeAllowed'])
            self.assertEqual(viewer['actionToken'],'')
            self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':True,'add':'1.1.1.1'},ip=ip,headers=headers)[0],403)

    def test_home_viewer_assets_revoke_immediately_and_primary_access_survives_home_removal(self):
        self.store.home('8.8.8.8',True)
        for suffix in ['', 'data','visitors.js','visitor-map.js','visitors.css','fonts/archivo-latin.woff2']:
            self.assertEqual(self.request(PREFIX+suffix,ip='8.8.8.8')[0],200)
        token=json.loads(self.request()[1])['actionToken']
        for value in [{'enabled':False},{'enabled':False,'remove':'8.8.8.8'}, {'enabled':True,'add':'1.1.1.1'}]:
            self.assertEqual(self.request(PREFIX+'home','POST',value,ip='8.8.8.8',headers={'X-Visitor-Action':token})[0],403)
        self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':False,'remove':'8.8.8.8'},headers={'X-Visitor-Action':token})[0],200)
        for suffix in ['', 'data','visitor-map.js']:
            self.assertEqual(self.request(PREFIX+suffix,ip='8.8.8.8')[0],403)
        self.store.home('8.8.4.4',True);self.store.home('8.8.4.4',False)
        self.assertTrue(json.loads(self.request()[1])['homeManageAllowed'])

    def test_home_access_persists_but_spoofed_or_private_home_clients_do_not_get_access(self):
        self.store.home('8.8.8.8',True);self.store.home('127.0.0.1',True)
        self.assertIn('8.8.8.8',Store(self.store.filename).snapshot('8.8.4.4')['homes'])
        self.assertEqual(self.request(ip='1.1.1.1',headers={'X-Forwarded-For':'8.8.8.8'})[0],403)
        self.assertEqual(self.request(ip='8.8.8.8',headers={'Host':'other.test'})[0],403)
        self.assertEqual(self.request(ip='127.0.0.1')[0],403)

    def test_manual_home_addresses_require_existing_security_and_reject_ranges_or_invalid_targets(self):
        token=json.loads(self.request()[1])['actionToken']
        value={'enabled':True,'add':'8.8.8.8'}
        self.assertEqual(self.request(PREFIX+'home','POST',value)[0],403)
        self.assertEqual(self.request(PREFIX+'home','POST',value,ip='8.8.8.8',headers={'X-Visitor-Action':token})[0],403)
        self.assertEqual(self.request(PREFIX+'home','POST',value,headers={'X-Visitor-Action':token,'Origin':'https://other.test'})[0],403)
        for ip in ['',123,'not-an-ip','https://example.test','8.8.8.0/24','127.0.0.1','192.168.1.1','::1','fe80::1%en0','224.0.0.1']:
            self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':True,'add':ip},headers={'X-Visitor-Action':token})[0],400)
        for value in [{'enabled':False,'add':'8.8.8.8'}, {'enabled':True,'add':'8.8.8.8','remove':'8.8.4.4'}]:
            self.assertEqual(self.request(PREFIX+'home','POST',value,headers={'X-Visitor-Action':token})[0],400)
        self.assertEqual(json.loads(self.request()[1])['homes'],[])

    def test_manual_home_address_cap_preserves_saved_addresses_and_duplicate_add_is_idempotent(self):
        for index in range(1,17):self.store.home(f'11.0.0.{index}',True)
        token=json.loads(self.request()[1])['actionToken']
        headers={'X-Visitor-Action':token}
        self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':True,'add':'8.8.8.8'},headers=headers)[0],400)
        self.assertEqual(self.request(PREFIX+'home','POST',{'enabled':True,'add':'11.0.0.1'},headers=headers)[0],200)
        self.assertEqual(len(json.loads(self.request()[1])['homes']),16)

    def test_local_production_links_still_point_to_the_local_dashboard_scope(self):
        local=make_server(self.store,0,collect=True,key_file=self.key,local_test=True,collection_scope='production')
        thread=threading.Thread(target=local.serve_forever,daemon=True);thread.start()
        try:
            connection=http.client.HTTPConnection('127.0.0.1',local.server_port,timeout=5)
            connection.request('GET',PREFIX+'data')
            reply=connection.getresponse();self.assertEqual(reply.status,200)
            self.assertEqual(json.load(reply)['sourceBase'],f'http://127.0.0.1:{local.server_port}/dashboard/')
            connection.close()
        finally:
            local.shutdown();local.server_close();thread.join()

    def test_scope_is_pinned_to_storage_and_local_snapshots_remain_owner_only(self):
        self.request('/visitor-events','POST',production_body())
        with self.assertRaises(ValueError):CollectedStore(self.store,self.key)
        events=CollectedStore(self.store,self.key,scope='production')
        directory=self.root/'backups'
        snapshot=archive(events,directory)
        self.assertEqual(directory.stat().st_mode&0o777,0o700)
        self.assertEqual(snapshot.stat().st_mode&0o777,0o600)
        self.assertEqual(snapshot.with_suffix('.sha256').stat().st_mode&0o777,0o600)
        self.assertEqual(self.key.stat().st_mode&0o777,0o600)
        restored=CollectedStore(Store(snapshot),self.key,scope='production')
        self.assertEqual(restored.snapshot('8.8.4.4')['views'],1)
        for mode in (0o750,0o770):
            directory.chmod(mode)
            with self.assertRaises(ValueError):archive(events,directory)
