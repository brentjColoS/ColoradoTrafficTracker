"""Private, streaming visitor backups; never deletes records, keys or old backups."""
import datetime as dt
import hashlib
import os
import grp
from pathlib import Path
import sqlite3
import time

from analytics import Store
from collector import CollectedStore, backup_database


def archive(events, directory, max_bytes=1024*1024*1024, read_group=None):
    directory=Path(directory)
    directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    group=grp.getgrnam(read_group).gr_gid if read_group else None
    info=directory.stat()
    if directory.is_symlink() or info.st_mode & (0o027 if read_group else 0o077) or info.st_uid!=os.getuid() or (
            read_group and info.st_gid!=group):
        raise ValueError('Visitor backup directory must be private or explicitly read-only to the backup group')
    used=sum(file.stat().st_size for file in directory.iterdir() if file.is_file())
    reserve=max(events.max_bytes,Path(events.store.filename).stat().st_size)+1024
    if used+reserve>max_bytes:
        raise OSError('Private backup budget reached; preserve backups and archive them off-host before retrying')
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
    if read_group:
        for file in (target,pending):
            os.chown(file,-1,group);file.chmod(0o640)
    else:pending.chmod(0o600)
    os.link(pending,receipt)
    pending.unlink()
    with events.store.connect() as db:
        db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('last_backup',str(time.time())))
    return target
