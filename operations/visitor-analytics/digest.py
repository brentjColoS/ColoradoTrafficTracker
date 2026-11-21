"""Daily private Discord digest; no intake hooks, polling or traffic DB access."""
import argparse
from contextlib import closing
import datetime as dt
import fcntl
from functools import lru_cache
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import time
import urllib.request

from cryptography.fernet import Fernet
from collector import private_key, event_index_key, decode_event

MST=dt.timezone(dt.timedelta(hours=-7))
OPERATOR='https://coloradotraffictracker.net/operator/visitors/'


def read_digest(filename, key_file, after):
    key=private_key(key_file);cipher=Fernet(key);index=event_index_key(key)
    identity=lambda value:hmac.new(index,value.encode(),hashlib.sha256).hexdigest()
    with closing(sqlite3.connect(Path(filename).resolve().as_uri()+'?mode=ro',uri=True,timeout=2)) as db:
        db.row_factory=sqlite3.Row
        db.execute('PRAGMA query_only=ON');db.execute('PRAGMA cache_size=-1024')
        db.execute('PRAGMA mmap_size=0');db.execute('PRAGMA temp_store=FILE')
        deadline=time.monotonic()+5
        db.set_progress_handler(lambda:int(time.monotonic()>deadline),2000)
        db.execute('BEGIN')
        settings=dict(db.execute("SELECT key,value FROM settings WHERE key IN ('collection_scope','event_key_check')"))
        if settings.get('collection_scope')!='production' or cipher.decrypt(settings['event_key_check'].encode())!=b'visitor-events-v1':
            raise ValueError('Digest requires the matching production visitor database and key')
        source=identity('digest|'+settings['event_key_check'])
        upper=db.execute('SELECT COALESCE(MAX(rowid),0) FROM browser_events').fetchone()[0]
        if after is None:return {'source':source,'sequence':upper}
        if type(after) is not int or not 0<=after<=upper:
            raise ValueError('Digest checkpoint exceeds history; inspect any restore before reinitializing')
        homes=[row[0] for row in db.execute('SELECT ip FROM homes LIMIT 17')]
        if len(homes)>16:raise ValueError('Unexpected Home address count')
        @lru_cache(maxsize=128)
        def home_keys(day):return {identity(f'network|{day}|{home}') for home in homes}
        db.create_function('is_home',2,lambda day,network:int(network in home_keys(day)))
        grouped='''WITH candidates AS (
            SELECT DISTINCT session FROM browser_events WHERE rowid>? AND rowid<=? AND is_page=1),
            eligible AS (SELECT e.session,MIN(CASE WHEN e.is_page=1 THEN e.rowid END) AS first_row,
                SUM(e.is_page) AS views FROM candidates c JOIN browser_events e ON e.session=c.session
                WHERE e.rowid<=? GROUP BY e.session
                HAVING first_row>? AND MAX(is_home(e.day,e.network))=0 AND MAX(e.is_bot)=0) '''
        args=(after,upper,upper,after)
        count,views=db.execute(grouped+'SELECT COUNT(*),COALESCE(SUM(views),0) FROM eligible',args).fetchone()
        rows=db.execute(grouped+'SELECT e.* FROM eligible c JOIN browser_events e ON e.rowid=c.first_row ORDER BY e.rowid LIMIT 5',args).fetchall()
        details=[]
        for row in rows:
            value=decode_event(cipher,row)
            details.append({'area':value.get('area',{}).get('label','Location unavailable'),
                'source':value['source'],'device':value['device']})
        return {'source':source,'sequence':upper,'visits':count,'views':views,'details':details}


def message(digest, user):
    if not re.fullmatch(r'\d{17,20}',user):raise ValueError('A numeric Discord user ID is required')
    def clean(value):return re.sub(r'([\\`*_{}\[\]()<>#|@~])',r'\\\1',' '.join(str(value).split())[:100])
    count=digest['visits'];details=digest['details']
    title=f'{count} new '+('visit' if count==1 else 'visits')
    if count==1 and details and details[0]['area']!='Location unavailable':title+=' from '+clean(details[0]['area'])
    lines=[f'<@{user}> — [{title}]({OPERATOR})']
    for item in details:
        lines.append('• '+' · '.join(clean(item[key]) for key in ('area','source','device')))
    if count>len(details):lines.append(f'+ {count-len(details)} more in the observatory.')
    lines.append('Browser sessions, not verified people. Areas are approximate. [IP data: DB-IP](https://db-ip.com).')
    return {'content':'\n'.join(lines),'allowed_mentions':{'parse':[],'users':[user]},'flags':4}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def deliver(webhook_file, payload):
    url=private_key(webhook_file).decode()
    if not re.fullmatch(r'https://discord\.com/api/webhooks/\d+/[A-Za-z0-9_-]{20,200}',url):
        raise ValueError('Unsupported Discord webhook URL')
    request=urllib.request.Request(url+'?wait=true',data=json.dumps(payload).encode(),
        headers={'Content-Type':'application/json','User-Agent':'CTT-Private-Digest/1.0'},method='POST')
    with urllib.request.build_opener(NoRedirect).open(request,timeout=10) as response:
        data=response.read(8193)
        if response.status!=200 or len(data)>8192 or not re.fullmatch(r'\d+',str(json.loads(data).get('id',''))):
            raise ValueError('Discord did not confirm delivery')


def save_state(path, value):
    descriptor, temporary=tempfile.mkstemp(prefix='.digest-',dir=path.parent)
    try:
        with os.fdopen(descriptor,'w') as output:
            json.dump(value,output);output.flush();os.fsync(output.fileno())
        os.replace(temporary,path)
        directory=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def run(filename, key_file, state_file, webhook_file=None, user='', initialize=False, now=None, sender=deliver):
    now=time.time() if now is None else now
    state_file=Path(state_file);directory=state_file.parent
    directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    info=directory.stat()
    if directory.is_symlink() or info.st_mode&0o077 or info.st_uid!=os.getuid():
        raise ValueError('Digest state directory must be owner-only')
    lock=os.open(directory/'.digest.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(lock,'a') as held:
        fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if initialize:
            if state_file.exists():raise ValueError('Digest already initialized; do not discard its checkpoint')
            save_state(state_file,read_digest(filename,key_file,None));return 'initialized'
        if state_file.stat().st_size>2048:raise ValueError('Digest state is oversized')
        saved=json.loads(private_key(state_file))
        today=dt.datetime.fromtimestamp(now,MST).date().isoformat()
        if saved.get('sentOn')==today:return 'already sent'
        result=read_digest(filename,key_file,saved['sequence'])
        if result['source']!=saved['source']:raise ValueError('Digest database identity changed; inspect before reinitializing')
        if result['visits']:
            sender(webhook_file,message(result,user))
            saved['sentOn']=today
        saved.update(source=result['source'],sequence=result['sequence'])
        save_state(state_file,saved)
        return 'sent' if result['visits'] else 'quiet'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('db','key-file','state-file'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--initialize',action='store_true')
    parser.add_argument('--webhook-file',type=Path)
    parser.add_argument('--mention-user',default=os.environ.get('VISITOR_DISCORD_USER_ID',''))
    args=parser.parse_args();os.umask(0o077)
    try:
        result=run(args.db,args.key_file,args.state_file,args.webhook_file,args.mention_user,args.initialize)
        if result!='quiet':print('Visitor digest: '+result)
    except Exception as error:
        print('Visitor digest failed ('+type(error).__name__+'); checkpoint retained. Inspect private configuration, storage and network; no automatic retry.',file=__import__('sys').stderr)
        raise SystemExit(1) from None


if __name__=='__main__':main()
