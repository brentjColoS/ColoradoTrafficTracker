const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const path=require('node:path');

test('actual PostgreSQL episode endpoints preserve identities, gaps and weekly boundaries',()=>{
  const root=path.resolve(__dirname,'../..');
  const image=readFileSync(path.join(root,'docker-compose.yml'),'utf8').match(/image: (timescale\/timescaledb:\S+)/)[1];
  const source=readFileSync(path.join(root,'api-service/src/main/java/com/example/api_service/HistoricalIncidentEpisodes.java'),'utf8');
  const template=source.match(/static final String QUERY = """([\s\S]*?)""";/)[1];
  let container;
  try {
    container=execFileSync('docker',['run','-d','--network','none','--cpus','1','--memory','768m',
      '--pids-limit','128','--tmpfs','/var/lib/postgresql/data:size=256m',
      '--tmpfs','/docker-entrypoint-initdb.d:size=1m',
      '--label','io.coloradotraffictracker.fixture=historical-incident-sql',
      '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','NO_TS_TUNE=true',image,'postgres','-c','shared_preload_libraries=',
      '-c','shared_buffers=16MB','-c','max_connections=10'],{encoding:'utf8'}).trim();
    assert.match(container,/^[0-9a-f]{64}$/);
    // The entrypoint's temporary bootstrap server accepts Unix sockets before final startup.
    try {
      execFileSync('docker',['exec',container,'sh','-c','for attempt in $(seq 1 60); do pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && exit 0; sleep 0.5; done; exit 1']);
    } catch(error) {
      console.error(execFileSync('docker',['inspect','--format','{{json .State}}',container],{encoding:'utf8'}));
      console.error(execFileSync('docker',['logs','--tail','40',container],{encoding:'utf8'}));
      throw error;
    }
    const sql=query=>execFileSync('docker',['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-U','postgres','-v','ON_ERROR_STOP=1'],
      {encoding:'utf8',input:query,maxBuffer:2*1024*1024}).trim();
    sql(`create table corridor_ref(code text,start_mile_marker double precision,end_mile_marker double precision);
      insert into corridor_ref values('I25',0,20),('I70',206,274);
      create table traffic_incident_all(history_id bigint,corridor text,polled_at timestamptz,provider_event_id text,
        incident_provider text,travel_direction text,normalized_category text,incident_description text,
        icon_category int,closest_mile_marker double precision,mile_marker_method text);
      insert into traffic_incident_all values
       (1,'I25','2026-06-21T23:58:00Z',null,'tomtom','N','CRASH',null,1,10.01,'exact'),
       (2,'I25','2026-06-21T23:59:30Z',null,'tomtom','N','CRASH',null,1,10.04,'exact'),
       (3,'I25','2026-06-22T00:00:30Z',null,'tomtom','N','CRASH',null,1,10.01,'exact'),
       (4,'I25','2026-06-22T00:03:00Z',null,'tomtom','N','CRASH',null,1,10.04,'exact'),
       (5,'I25','2026-06-22T00:06:01Z',null,'tomtom','N','CRASH',null,1,10.01,'exact'),
       (6,'I25','2026-06-22T00:06:01Z',null,'tomtom','N','CRASH',null,1,10.01,'exact'),
       (7,'I25','2026-06-22T00:01:00Z','event','cdot','N','CONSTRUCTION',null,9,3,'exact'),
       (8,'I25','2026-06-22T00:02:00Z','event','cdot','S','CLOSURE',null,8,4,'exact'),
       (9,'I25','2026-06-22T00:02:00Z',null,'tomtom','S','CRASH',null,1,10.01,'exact'),
       (10,'I25','2026-06-22T00:02:00Z',null,'tomtom','N','CRASH',null,1,30,'exact'),
       (11,'I25','2026-06-22T00:02:00Z',null,'tomtom','N','CRASH',null,1,5,'off_corridor'),
       (12,'I25','2026-06-22T00:02:00Z',null,'tomtom','N','JAM',null,5,6,'exact'),
       (13,'I70','2026-06-22T00:02:00Z',null,'tomtom','N','CRASH',null,1,220,'exact');`);
    const query=template.replace('%s',"timestamptz '2026-06-15T00:00:00Z',timestamptz '2026-06-22T00:00:00Z'");
    const parameters=["'I25'","timestamptz '2026-06-15T00:00:00Z'","timestamptz '2026-06-29T00:00:00Z'"];
    const bound=query.replace(/'(?:''|[^'])*'|\?/g,token=>token==='?'?parameters.shift():token);assert.equal(parameters.length,0);
    const rows=JSON.parse(sql(`begin read only;set local timezone='America/Denver';set local statement_timeout=5000;select coalesce(json_agg(t),'[]'::json) from (${bound}) t;rollback;`));
    const starts=rows.filter(row=>row.first),ends=rows.filter(row=>row.last);
    assert.equal(starts.length,5);assert.equal(ends.length,5);
    assert.equal(rows.filter(row=>row.identity==='provider|cdot|event').length,2);
    assert.equal(rows.filter(row=>row.identity.includes('legacy|I25|S|CRASH')).length,1);
    assert.equal(rows.filter(row=>Date.parse(row.polled_at)===Date.parse('2026-06-22T00:06:01Z')).length,2);
    assert.ok(rows.every(row=>[Date.parse('2026-06-15T00:00:00Z'),Date.parse('2026-06-22T00:00:00Z')].includes(Date.parse(row.week))));
    assert.ok(rows.every(row=>!row.identity.includes('30.0')&&!row.identity.includes('5.0')&&!row.identity.includes('JAM')));
  } finally { if(container)execFileSync('docker',['rm','--force',container],{stdio:'ignore'}); }
});
