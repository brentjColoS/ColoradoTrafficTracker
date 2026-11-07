import hashlib
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch

import maxminddb
from cryptography.fernet import Fernet
from analytics import Store
from collector import CollectedStore, backup_database
from geo import AreaLookup, area_from_record, illustrate_areas
from test_collector import body


def record():
    return {'city':{'names':{'en':'Greenbelt'}},'country':{'names':{'en':'United States'}},
        'subdivisions':[{'names':{'en':'Maryland'}}],
        'location':{'latitude':38.9954,'longitude':-76.8782}}


class GeoTests(unittest.TestCase):
    def test_only_city_area_and_rounded_center_are_retained(self):
        area=area_from_record(record())
        self.assertEqual(area['label'],'Greenbelt, Maryland')
        self.assertEqual(area['coordinates'],[-76.88,39.0])
        self.assertTrue(area['approximate'])
        self.assertEqual(set(area),{'label','coordinates','source','approximate'})

    def test_state_only_missing_and_overbroad_records_do_not_become_city_pins(self):
        value=record();del value['city'];self.assertIsNone(area_from_record(value))
        value=record();value['location']['accuracy_radius']=500;self.assertIsNone(area_from_record(value))
        for point in [float('nan'),float('inf'),91,True]:
            value=record();value['location']['latitude']=point
            self.assertIsNone(area_from_record(value)['coordinates'])
        value=record();del value['subdivisions']
        self.assertEqual(area_from_record(value)['label'],'Greenbelt, United States')

    def test_disk_reader_skips_private_ips_and_missing_corrupt_or_stale_data_is_optional(self):
        lookup=AreaLookup('/nonexistent/city.mmdb')
        with patch('maxminddb.open_database') as opened:
            for ip in ['127.0.0.1','192.168.1.1','192.0.2.1','::1']:
                self.assertIsNone(lookup(ip))
            opened.assert_not_called()
            reader=MagicMock();opened.return_value.__enter__.return_value=reader
            reader.metadata.return_value.database_type='DBIP-City-Lite'
            reader.metadata.return_value.build_epoch=time.time()
            reader.get.return_value=record()
            self.assertEqual(lookup('8.8.8.8')['label'],'Greenbelt, Maryland')
            self.assertEqual(opened.call_args.kwargs['mode'],maxminddb.MODE_FILE)
            reader.metadata.return_value.build_epoch=time.time()-101*86400
            with self.assertLogs('geo',level='WARNING') as logged:
                self.assertIsNone(lookup('8.8.8.8'))
            self.assertNotIn('8.8.8.8',''.join(logged.output))
            opened.side_effect=OSError('private path or IP must not leak')
            self.assertIsNone(lookup('8.8.8.8'))

    def test_encrypted_area_survives_ip_redaction_and_disposable_restore_without_backfill(self):
        with tempfile.TemporaryDirectory() as directory:
            key=Path(directory)/'key';key.write_bytes(Fernet.generate_key());key.chmod(0o600)
            store=Store(Path(directory)/'events.sqlite');now=time.time()
            before=CollectedStore(store,key)
            before.ingest(body(now),'192.0.2.2',now=now)
            lookup=MagicMock(return_value=area_from_record(record()))
            events=CollectedStore(store,key,area_lookup=lookup)
            events.ingest(body(now),'192.0.2.3',now=now)
            lookup.assert_called_once_with('192.0.2.3')
            self.assertNotIn(b'Greenbelt',Path(store.filename).read_bytes())
            events.redact(now+90000)
            page=events.snapshot('127.0.0.1',days=0,now=now+90000)
            self.assertEqual({item['location'] for item in page['activity']},
                {'Location unavailable','Greenbelt, Maryland (approx.)'})
            self.assertTrue(all(item['ip']=='Expired after 24 hours' for item in page['activity']))
            target=Path(directory)/'restored.sqlite'
            checksum=backup_database(store.filename,target)
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(),checksum)
            restored=CollectedStore(Store(target),key);restored.verify_records()
            self.assertEqual(restored.snapshot('127.0.0.1',days=0,now=now+90000)['views'],2)

    @unittest.skipUnless(os.environ.get('VISITOR_GEO_TEST_DATABASE'),'Optional official database smoke test')
    def test_real_official_database_uses_public_resolver_address_without_network_lookup(self):
        area=AreaLookup(os.environ['VISITOR_GEO_TEST_DATABASE'])('8.8.8.8')
        self.assertEqual(area['source'],'DB-IP City Lite')
        self.assertTrue(area['label']);self.assertFalse(area['label'].endswith(' area'))
        self.assertEqual(len(area['coordinates']),2)

    def test_illustrated_locations_are_explicitly_synthetic(self):
        data={'activity':[{'label':'one','category':'home'},{'label':'two','category':'external'}]}
        illustrate_areas(data)
        self.assertEqual(data['activity'][0]['area']['source'],'Synthetic demo')
        self.assertIn('illustration',data['activity'][0]['location'])


if __name__=='__main__': unittest.main()
