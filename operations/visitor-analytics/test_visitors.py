import base64
import http.client
import json
import tempfile
import threading
import time
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch

from analytics import Store, address, seed_demo, illustrate_demo_actions, CAMPAIGNS
from server import PREFIX, authorized, make_server, password_hash


def entry(ip='192.0.2.10', at=None, uri='/dashboard/?src=resume&token=do-not-store', agent=None):
    return {'ts':time.time() if at is None else at, 'status':200, 'request':{
        'remote_ip':ip, 'method':'GET', 'uri':uri, 'headers':{
            'User-Agent':[agent or 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36'],
            'Referer':['https://example.test/private/path?secret=do-not-store'],
            'Cookie':['private-cookie-do-not-store'], 'Authorization':['private-header-do-not-store']}}}


class AnalyticsTests(unittest.TestCase):
    def test_source_link_reference_matches_recognized_tags_and_copy_targets(self):
        class Links(HTMLParser):
            def __init__(self):
                super().__init__();self.links={};self.buttons=set()
            def handle_starttag(self, tag, attrs):
                attrs=dict(attrs)
                if tag=='a' and 'data-source' in attrs:self.links[attrs['data-source']]=attrs['href']
                if tag=='button' and 'data-copy-source' in attrs:self.buttons.add(attrs['data-copy-source'])
        parser=Links();parser.feed((Path(__file__).parent/'web/index.html').read_text())
        self.assertEqual(set(parser.links),CAMPAIGNS);self.assertEqual(parser.buttons,CAMPAIGNS)
        for source, url in parser.links.items():
            self.assertEqual(url,f'https://coloradotraffictracker.net/dashboard/?src={source}')

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store=Store(Path(self.temp.name)/'visits.sqlite')

    def test_dedup_and_only_page_navigations(self):
        row=entry();self.assertTrue(self.store.ingest(row));self.assertFalse(self.store.ingest(row))
        for uri in ['/dashboard/dashboard.js','/actuator/health','/dashboard-api/traffic/latest',
                    '/operator/visitors/','/dashboard/../.env','https://other.test/dashboard/']:
            self.assertFalse(self.store.ingest(entry(uri=uri)))
        row=entry();row['request']['headers']['Sec-Fetch-Dest']=['empty']
        self.assertFalse(self.store.ingest(row))
        self.assertEqual(self.store.snapshot('127.0.0.1')['views'],1)

    def test_query_secrets_and_request_headers_never_persist(self):
        self.store.ingest(entry())
        with self.store.connect() as db:
            serialized=json.dumps([dict(r) for r in db.execute('SELECT * FROM visits')])
        for secret in ['do-not-store','private-cookie','private-header','secret=']:
            self.assertNotIn(secret,serialized)
        self.assertEqual(self.store.snapshot('127.0.0.1')['activity'][0]['source'],'resume link')

    def test_home_is_excluded_and_separate_and_survives_restart_and_redaction(self):
        now=time.time();old=now-2*86400
        self.store.ingest(entry(at=old),now)
        self.store.ingest(entry(ip='192.0.2.11',at=old),now)
        self.store.home('::ffff:192.0.2.10',True)
        self.store=Store(self.store.filename)
        external=self.store.snapshot('192.0.2.10',now=now)
        self.assertTrue(external['currentIsHome']);self.assertEqual(external['views'],1)
        home=self.store.snapshot('192.0.2.10',category='home',now=now)
        self.assertEqual(home['views'],1);self.assertEqual(home['totals']['home'],1)
        self.assertEqual(home['activity'][0]['ip'],'Expired after 24 hours')
        self.store.home('192.0.2.10',False)
        self.assertEqual(self.store.snapshot('192.0.2.10',now=now)['views'],2)

    def test_history_survives_redaction_and_age_without_cross_day_fingerprints(self):
        now=1780000000
        self.assertNotEqual(self.store.identity('192.0.2.10',now),self.store.identity('192.0.2.10',now-86400))
        self.assertTrue(self.store.ingest(entry(at=now-365*86400),now))
        self.store.ingest(entry(at=now),now)
        self.store.prune(now+86401)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM visits WHERE ip IS NOT NULL').fetchone()[0],0)
        self.store.prune(now+400*86400)
        self.store=Store(self.store.filename)
        all_time=self.store.snapshot('127.0.0.1',days=0,now=now+400*86400)
        self.assertEqual(all_time['views'],2)
        self.assertTrue(all(item['ip']=='Expired after 24 hours' for item in all_time['activity']))
        self.assertEqual(self.store.snapshot('127.0.0.1',days=30,now=now+400*86400)['views'],0)

    def test_all_time_keeps_older_imports_deduplicated_and_home_separate(self):
        now=1780000000;old=entry(at=now-90*86400)
        self.assertTrue(self.store.ingest(old,now));self.assertFalse(self.store.ingest(old,now))
        self.store.ingest(entry(at=now),now)
        self.assertEqual(self.store.snapshot('127.0.0.1',days=30,now=now)['views'],1)
        self.assertEqual(self.store.snapshot('127.0.0.1',days=0,now=now)['views'],2)
        self.store.home('192.0.2.10',True)
        self.assertEqual(self.store.snapshot('127.0.0.1',days=0,now=now)['views'],0)
        self.assertEqual(self.store.snapshot('127.0.0.1',days=0,category='home',now=now)['views'],2)

    def test_bots_separate_and_home_takes_precedence(self):
        self.store.ingest(entry(agent='ExamplePreviewBot/1.0'))
        self.assertEqual(self.store.snapshot('127.0.0.1')['views'],0)
        self.assertEqual(self.store.snapshot('127.0.0.1',category='automation')['views'],1)
        self.store.home('192.0.2.10',True)
        self.assertEqual(self.store.snapshot('127.0.0.1',category='home')['views'],1)

    def test_ignores_forwarded_addresses_in_imported_logs(self):
        row=entry();row['request']['headers']['X-Forwarded-For']=['203.0.113.1']
        self.store.ingest(row)
        self.assertEqual(self.store.snapshot('127.0.0.1')['activity'][0]['ip'],'192.0.2.10')
        self.assertEqual(address('::ffff:192.0.2.10'),'192.0.2.10')

    def test_legacy_import_still_excludes_dnt_and_gpc_without_backfilling(self):
        for headers in [{'DNT':['1']},{'DNT':['yes']},{'Sec-GPC':['1']},{'Sec-GPC':['1'],'DNT':['1']}]:
            row=entry();row['request']['headers'].update(headers)
            self.assertFalse(self.store.ingest(row))
        self.assertEqual(self.store.snapshot('127.0.0.1')['views'],0)

    def test_internal_navigation_is_not_an_external_referral(self):
        row=entry(uri='/dashboard/api.html');row['request']['host']='traffic.example.test'
        row['request']['headers']['Referer']=['https://traffic.example.test/dashboard/?token=private']
        self.store.ingest(row)
        data=self.store.snapshot('127.0.0.1')
        self.assertEqual(data['referred'],0)
        self.assertEqual(data['activity'][0]['source'],'Direct / unknown')

    def test_broken_records_and_invalid_filters_do_not_invent_visits(self):
        for row in [{},None,{'request':{}},{'request':[]},entry(ip='not-an-ip'),entry(at=float('nan'))]:
            self.assertFalse(self.store.ingest(row))
        self.assertEqual(self.store.snapshot('127.0.0.1')['views'],0)

    def test_fixture_is_idempotent_and_separate_from_real_tracking(self):
        seed_demo(self.store);first=self.store.snapshot('127.0.0.1',category='all')['views']
        seed_demo(self.store);self.assertEqual(self.store.snapshot('127.0.0.1',category='all')['views'],first)
        self.assertEqual(first,13)
        self.store.home('127.0.0.1',True)
        homes=self.store.snapshot('127.0.0.1',category='home')['activity']
        self.assertTrue(all(row['location']=='Local preview' and row['browser']!='Unknown' for row in homes))

    def test_page_paths_preserve_chronology_and_repeated_pages_without_invented_clicks(self):
        now=time.time()
        for offset, uri in [(90,'/dashboard/'), (30,'/dashboard/'), (60,'/dashboard/system.html')]:
            self.store.ingest(entry(at=now-offset,uri=uri),now)
        item=self.store.snapshot('127.0.0.1',now=now)['activity'][0]
        self.assertEqual([event['label'] for event in item['events']],['Dashboard','System','Dashboard'])
        self.assertTrue(all(event['kind']=='page' for event in item['events']))
        self.assertFalse(item['eventsLimited'])

    def test_page_timeline_is_bounded_without_losing_summary_count(self):
        now=time.time()
        for offset in range(80):self.store.ingest(entry(at=now-offset),now)
        item=self.store.snapshot('127.0.0.1',now=now)['activity'][0]
        self.assertEqual(item['views'],80);self.assertEqual(len(item['events']),60)
        self.assertTrue(item['eventsLimited'])
        self.assertEqual(item['events'][0]['at'],now-59)

    def test_small_demo_journeys_have_ordered_sample_actions_only_in_explicit_projection(self):
        now=20000*86400+12*3600;seed_demo(self.store,now);self.store.home('127.0.0.1',True)
        raw=self.store.snapshot('127.0.0.1',now=now)
        self.assertEqual(raw['views'],9);self.assertEqual(raw['visitors'],5)
        self.assertEqual(raw['totals']['home'],3)
        self.assertEqual(raw['groupTotals'],{'external':5,'home':1,'automation':1})
        self.assertEqual(sum(source['count'] for source in raw['sources']),5)
        self.assertTrue(all(event['kind']=='page' for item in raw['activity'] for event in item['events']))
        demo=illustrate_demo_actions(raw)
        resume=next(item for item in demo['activity'] if item['source']=='resume link')
        self.assertEqual(resume['pages'],['Dashboard','System','API'])
        self.assertIn('Enabled speed zones',[event['label'] for event in resume['events']])
        self.assertEqual([event['at'] for event in resume['events']],sorted(event['at'] for event in resume['events']))
        self.assertTrue(all(event['kind']=='page' for item in self.store.snapshot('127.0.0.1',now=now)['activity'] for event in item['events']))


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.credential=password_hash('synthetic-test-password')
        cls.auth='Basic '+base64.b64encode(b'operator:synthetic-test-password').decode()

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.store=Store(Path(self.temp.name)/'visits.sqlite')
        self.server=make_server(self.store,0,False,self.credential,'https://operator.example.test',True)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown();self.server.server_close();self.thread.join()

    def request(self,path='data',method='GET',body=None,headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        values={'Host':'operator.example.test','Authorization':self.auth,'X-Visitor-Client-IP':'192.0.2.10',**(headers or {})}
        connection.request(method,PREFIX+path,body,values)
        response=connection.getresponse();result=(response.status,dict(response.getheaders()),response.read())
        connection.close();return result

    def test_assets_and_data_require_auth_and_host_and_never_cache(self):
        for path in ['', 'data','visitors.js','visitors.css','fonts/archivo-latin.woff2',
                     'fonts/ibm-plex-mono-latin.woff2','fonts/ibm-plex-mono-semibold-latin.woff2']:
            self.assertEqual(self.request(path,headers={'Authorization':''})[0],401)
            status,headers,_=self.request(path)
            self.assertEqual(status,200);self.assertEqual(headers['Cache-Control'],'no-store')
            self.assertIn('noindex',headers['X-Robots-Tag'])
            if path.endswith('.woff2'):
                self.assertEqual(headers['Content-Type'],'font/woff2')
        self.assertEqual(self.request(headers={'Host':'attacker.test'})[0],403)
        self.assertEqual(self.request('../server.py')[0],404)
        self.assertEqual(self.request('data?days=999')[0],400)
        self.assertFalse(authorized('Basic '+base64.b64encode('外:wrong'.encode()).decode(),self.credential))

    def test_home_action_requires_origin_token_and_server_derived_ip(self):
        token=json.loads(self.request()[2])['actionToken']
        headers={'Origin':'https://operator.example.test','Content-Type':'application/json','X-Visitor-Action':token}
        self.assertEqual(self.request('home','POST','{"enabled":true}',{**headers,'Origin':'https://attacker.test'})[0],403)
        self.assertEqual(self.request('home','POST','{"enabled":true}',{**headers,'X-Visitor-Action':'wrong'})[0],403)
        self.assertEqual(self.request('home','POST','{"enabled":true,"ip":"203.0.113.1"}',headers)[0],400)
        self.assertEqual(self.request('home','POST','{"enabled":true}',headers)[0],200)
        data=json.loads(self.request()[2]);self.assertEqual(data['homes'],['192.0.2.10'])
        self.assertTrue(data['currentIsHome'])
        self.assertEqual(self.request('home','POST','{"enabled":true}',{**headers,'X-Visitor-Client-IP':'127.0.0.1'})[0],409)

    def test_all_time_is_authenticated_and_includes_older_records(self):
        self.store.ingest(entry(at=time.time()-90*86400))
        self.assertEqual(json.loads(self.request()[2])['views'],0)
        status,_,body=self.request('data?days=0')
        self.assertEqual(status,200);self.assertEqual(json.loads(body)['views'],1)
        self.assertEqual(self.request('data?days=0',headers={'Authorization':''})[0],401)
        self.assertEqual(self.request('data?days=-1')[0],400)

    def test_saved_home_removal_cannot_mark_an_arbitrary_address_or_delete_visits(self):
        self.store.home('192.0.2.20',True)
        self.store.ingest(entry(ip='192.0.2.20'))
        token=json.loads(self.request()[2])['actionToken']
        headers={'Origin':'https://operator.example.test','Content-Type':'application/json','X-Visitor-Action':token}
        self.assertEqual(self.request('home','POST','{"enabled":true,"remove":"192.0.2.20"}',headers)[0],400)
        self.assertEqual(self.request('home','POST','{"enabled":false,"remove":"192.0.2.99"}',headers)[0],400)
        self.assertEqual(self.request('home','POST','{"enabled":false,"remove":"192.0.2.20"}',headers)[0],200)
        snapshot=json.loads(self.request()[2])
        self.assertEqual(snapshot['homes'],[]);self.assertEqual(snapshot['views'],1)

    def test_snapshot_failures_return_safe_diagnostics_and_do_not_consume_read_slots(self):
        for invalid in ['data?days=broken','data?cursor=bad']:
            self.assertEqual(self.request(invalid)[0],400)
        with patch.object(self.store,'snapshot',side_effect=ValueError('192.0.2.50 secret-payload')), self.assertLogs(level='ERROR') as logs:
            for _ in range(3):self.assertEqual(self.request()[0],503)
        self.assertIn('ValueError',str(logs.output))
        self.assertNotIn('192.0.2.50',str(logs.output));self.assertNotIn('secret-payload',str(logs.output))
        self.assertEqual(self.request()[0],200)

    def test_only_two_operator_snapshots_run_at_once_and_excess_can_retry(self):
        entered=threading.Barrier(3);release=threading.Event();results=[]
        original=self.store.snapshot
        def wait(*args,**kwargs):
            entered.wait(timeout=5);release.wait(timeout=5)
            return original(*args,**kwargs)
        with patch.object(self.store,'snapshot',side_effect=wait):
            workers=[threading.Thread(target=lambda:results.append(self.request()[0])) for _ in range(2)]
            for worker in workers:worker.start()
            try:
                entered.wait(timeout=5)
                status,headers,_=self.request()
                self.assertEqual(status,503);self.assertEqual(headers['Retry-After'],'5')
            finally:
                release.set()
                for worker in workers:worker.join(timeout=5)
        self.assertEqual(results,[200,200]);self.assertEqual(self.request()[0],200)

    def test_no_anonymous_mode_without_explicit_local_demo(self):
        with self.assertRaises(ValueError):make_server(self.store,0)
        with self.assertRaises(ValueError):make_server(self.store,0,False,self.credential,'http://operator.example.test')
        demo=make_server(self.store,0,True);self.addCleanup(demo.server_close)
        self.assertEqual(demo.server_address[0],'127.0.0.1')


if __name__=='__main__':unittest.main()
