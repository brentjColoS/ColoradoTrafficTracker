import datetime as dt
import gzip
import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import geo_update


class GeoUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.target=Path(self.temp.name)/'city.mmdb';self.target.write_bytes(b'previous working edition')
        self.now=dt.datetime(2026,11,6,tzinfo=dt.timezone.utc)

    def responses(self,payload,checksum=None):
        checksum=checksum or hashlib.sha1(payload,usedforsecurity=False).hexdigest()
        catalog=f'<p>Format CSV SHA1SUM {"f"*40}</p><p>Format MMDB SHA1SUM {checksum}</p>'
        return [io.BytesIO(catalog.encode()),io.BytesIO(gzip.compress(payload))]

    def test_current_edition_makes_no_network_request(self):
        with patch('geo_update.edition',return_value='2026-11'),patch('urllib.request.build_opener') as network:
            self.assertFalse(geo_update.update(self.target,self.now));network.assert_not_called()

    def test_verified_download_replaces_only_the_completed_database(self):
        with patch('geo_update.edition',side_effect=['2026-10','2026-11']),patch('urllib.request.build_opener') as network:
            network.return_value.open.side_effect=self.responses(b'new city data')
            self.assertTrue(geo_update.update(self.target,self.now))
            self.assertEqual(self.target.read_bytes(),b'new city data')
            self.assertEqual(self.target.stat().st_mode&0o077,0)
            self.assertEqual(len(list(self.target.parent.iterdir())),1)
            self.assertTrue(all(call.kwargs['timeout']==30 for call in network.return_value.open.call_args_list))

    def test_wrong_checksum_or_oversized_download_keeps_previous_data(self):
        for responses,limit in [(self.responses(b'wrong','f'*40),100),(self.responses(b'too large'),2)]:
            with patch('geo_update.edition',return_value='2026-10'),patch('urllib.request.build_opener') as network,patch('geo_update.MAX_BYTES',limit):
                network.return_value.open.side_effect=responses
                with self.assertRaises(ValueError):geo_update.update(self.target,self.now)
                self.assertEqual(self.target.read_bytes(),b'previous working edition')
                self.assertEqual(len(list(self.target.parent.iterdir())),1)

    def test_missing_catalog_checksum_keeps_previous_database_without_download(self):
        with patch('geo_update.edition',return_value='2026-10'),patch('urllib.request.build_opener') as network:
            network.return_value.open.return_value=io.BytesIO(b'publisher unavailable')
            with self.assertRaises(ValueError):geo_update.update(self.target,self.now)
            self.assertEqual(network.return_value.open.call_count,1)
            self.assertEqual(self.target.read_bytes(),b'previous working edition')


if __name__=='__main__':unittest.main()
