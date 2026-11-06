"""Receipts for encrypted visitor copies, separate from traffic backup receipts."""
import argparse
import datetime as dt
import fcntl
import hmac
import json
import os
from pathlib import Path
import re
import tempfile


def snapshot_time(filename):
    if not re.fullmatch(r'events-\d{8}T\d{12}Z\.sqlite',filename):
        raise ValueError('Invalid visitor snapshot name')
    return dt.datetime.strptime(filename,'events-%Y%m%dT%H%M%S%fZ.sqlite').replace(tzinfo=dt.timezone.utc).timestamp()


def record(directory, receipt, filename, checksum):
    captured=snapshot_time(filename)
    if not re.fullmatch('[a-f0-9]{64}',checksum):raise ValueError('Invalid checksum')
    directory=Path(directory);receipt=Path(receipt)
    manifest=(directory/filename).with_suffix('.sha256')
    if manifest.stat().st_size>256:raise ValueError('Invalid manifest size')
    fields=manifest.read_text().split()
    if len(fields)!=2 or fields[1]!=filename or not hmac.compare_digest(fields[0],checksum) or not (directory/filename).is_file():
        raise ValueError('Receipt does not match a verified server snapshot')
    parent=receipt.parent
    if parent.is_symlink() or parent.stat().st_uid!=os.getuid() or parent.stat().st_mode & 0o027:
        raise ValueError('Receipt directory must be owned by the backup account and not writable by others')
    with receipt.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        # A late transfer must not replace a newer snapshot's receipt.
        if receipt.exists():
            if receipt.stat().st_size>4096:raise ValueError('Invalid existing receipt')
            previous=json.loads(receipt.read_text())
            if snapshot_time(previous['filename'])>captured:return
        with tempfile.NamedTemporaryFile(mode='w',prefix='visitor-receipt-',suffix='.partial',dir=parent,delete=False) as output:
            pending=Path(output.name)
            json.dump({'filename':filename,'sha256':checksum,'verifiedAt':dt.datetime.now(dt.timezone.utc).timestamp()},output)
            output.flush();os.fsync(output.fileno())
        try:
            pending.chmod(0o640)
            os.replace(pending,receipt)
        finally:
            pending.unlink(missing_ok=True)


def warning(receipt,now):
    try:
        path=Path(receipt)
        if path.stat().st_size>4096:raise ValueError('Invalid receipt size')
        value=json.loads(path.read_text())
        if not re.fullmatch('[a-f0-9]{64}',value['sha256']):raise ValueError('Invalid checksum')
        age=now-snapshot_time(value['filename'])
        if not 0<=age<=8*86400:raise ValueError('Snapshot is not current')
        return None
    except (OSError,ValueError,KeyError,TypeError):
        return 'No current verified off-site visitor backup; check the separate Windows visitor task.'


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',required=True,type=Path)
    parser.add_argument('--receipt',required=True,type=Path)
    parser.add_argument('filename');parser.add_argument('checksum')
    args=parser.parse_args()
    os.umask(0o027)
    record(args.directory,args.receipt,args.filename,args.checksum)
    print('Verified off-site visitor receipt recorded')
