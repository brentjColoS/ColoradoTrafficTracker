"""Private, verified VPS snapshots; retain the two latest completed copies."""
import datetime as dt
import fcntl
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import time

from analytics import Store
from collector import CollectedStore, backup_database


def archive(events, directory, max_bytes=1024*1024*1024):
    directory=Path(directory)
    directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    info=directory.stat()
    if directory.is_symlink() or info.st_mode & 0o077 or info.st_uid!=os.getuid():
        raise ValueError('Visitor backup directory must be owner-only')
    with (directory/'.archive.lock').open('a') as lock:
        os.fchmod(lock.fileno(),0o600)
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        return _archive(events,directory,max_bytes)


def _archive(events,directory,max_bytes):
    used=sum(file.stat().st_size for file in directory.iterdir() if file.is_file())
    reserve=max(events.max_bytes,Path(events.store.filename).stat().st_size)+1024
    if used+reserve>max_bytes:
        raise OSError('Private snapshot budget reached; inspect incomplete copies and disk headroom before retrying')
    stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target=directory/f'events-{stamp}.sqlite'
    checksum=backup_database(events.store.filename,target)
    with sqlite3.connect(f'file:{target}?mode=ro',uri=True) as db:
        if db.execute('PRAGMA quick_check').fetchone()[0]!='ok':
            raise ValueError('Visitor backup integrity check failed; preserve files for inspection')
    restored=CollectedStore(Store(target),events.key_file,scope=events.scope)
    restored.verify_records()
    with target.open('rb') as saved:
        if hashlib.file_digest(saved,'sha256').hexdigest()!=checksum:
            raise ValueError('Visitor backup changed during verification; preserve files for inspection')
    receipt=target.with_suffix('.sha256')
    pending=receipt.with_suffix('.sha256.partial')
    with pending.open('x') as output:
        output.write(checksum+'  '+target.name+'\n');output.flush();os.fsync(output.fileno())
    pending.chmod(0o600)
    os.link(pending,receipt)
    pending.unlink()
    completed=sorted(file for file in directory.iterdir() if
        re.fullmatch(r'events-\d{8}T\d{12}Z\.sqlite',file.name) and not file.is_symlink() and
        file.is_file() and not file.with_suffix('.sha256').is_symlink() and file.with_suffix('.sha256').is_file())
    # Never remove an earlier recovery copy until the new copy passes verification.
    for old in [file for file in completed if file!=target][:-1]:
        old.with_suffix('.sha256').unlink()
        old.unlink()
    with events.store.connect() as db:
        db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('last_backup',str(time.time())))
    return target
