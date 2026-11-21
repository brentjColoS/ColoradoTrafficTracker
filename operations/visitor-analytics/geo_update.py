"""Refresh the public city database monthly; never reads visitor data or keys."""
import argparse
import datetime as dt
import gzip
import hashlib
import html
import os
from pathlib import Path
import re
import tempfile
import urllib.request

MAX_BYTES=256*1024*1024
CATALOG='https://db-ip.com/db/download/ip-to-city-lite'
HEADERS={'User-Agent':'ColoradoTrafficTracker/1.0 (+https://coloradotraffictracker.net)'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def edition(path):
    import maxminddb
    with maxminddb.open_database(str(path),mode=maxminddb.MODE_FILE) as reader:
        metadata=reader.metadata()
        if metadata.database_type!='DBIP-City-Lite':raise ValueError('Unexpected city database type')
        return dt.datetime.fromtimestamp(metadata.build_epoch,dt.timezone.utc).strftime('%Y-%m')


def update(target,now=None):
    target=Path(target);month=(now or dt.datetime.now(dt.timezone.utc)).strftime('%Y-%m')
    if target.is_file() and not target.is_symlink():
        try:
            if edition(target)==month:return False
        except (OSError,ValueError,RuntimeError):pass
    target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    if target.is_symlink() or target.parent.is_symlink():raise ValueError('Use a regular city database path')
    opener=urllib.request.build_opener(NoRedirect)
    with opener.open(urllib.request.Request(CATALOG,headers=HEADERS),timeout=30) as response:
        catalog=response.read(512001)
        if len(catalog)>512000:raise ValueError('City catalog is oversized')
    text=html.unescape(re.sub('<[^>]+>',' ',catalog.decode()))
    checksum=re.search(r'\bFormat\s+MMDB\b.*?\bSHA1SUM\b\s*([a-fA-F0-9]{40})',text,re.S)
    if not checksum:raise ValueError('Published MMDB checksum is unavailable')
    descriptor,temporary=tempfile.mkstemp(prefix='.city-',dir=target.parent)
    try:
        # SHA1 is the publisher's integrity checksum; HTTPS authenticates its source.
        digest=hashlib.sha1(usedforsecurity=False);size=0
        url=f'https://download.db-ip.com/free/dbip-city-lite-{month}.mmdb.gz'
        with os.fdopen(descriptor,'wb') as output, opener.open(urllib.request.Request(url,headers=HEADERS),timeout=30) as response, gzip.GzipFile(fileobj=response) as data:
            while chunk:=data.read(262144):
                size+=len(chunk)
                if size>MAX_BYTES:raise ValueError('City database exceeds disk budget')
                digest.update(chunk);output.write(chunk)
            output.flush();os.fsync(output.fileno())
        if digest.hexdigest()!=checksum[1].lower() or edition(temporary)!=month:
            raise ValueError('City database checksum or edition differs from the publisher')
        os.replace(temporary,target)
        return True
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--database',type=Path,required=True)
    args=parser.parse_args();os.umask(0o077)
    try:
        if update(args.database):print('Verified city database refreshed')
    except Exception as error:
        print('City refresh failed ('+type(error).__name__+'); previous database retained. Check publisher availability and disk headroom.')
        raise SystemExit(1) from None
