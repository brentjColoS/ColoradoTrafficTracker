'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function events(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
}

async function run(c) {
  const {report,output,root,runtime,fixture,pages,origin,command,docker,start,db,api,prefix,javaImage,apiKey,control} = c;
  const profiling = c.scene === 'backlog-probe';
  const seconds = profiling ? 60 : c.scene === 'soak' ? 1800 : c.scene === 'backlog' ? 360 : 180;
  const oldSamples = ['backlog','backlog-probe'].includes(c.scene) ? 6000 : 600;
  const observationAgeBudgetMs=3*60_000+15_000;
  const jar = path.resolve(process.env.CAPACITY_INGEST_JAR || '');
  const expected = process.env.CAPACITY_INGEST_SHA256 || '';
  if (!/^[a-f0-9]{64}$/.test(expected) || !fs.statSync(jar).isFile() || hash(jar)!==expected)
    throw new Error('An explicitly hashed, verified ingest-service JAR is required');
  const worker = path.join(output,'worker'), classes = path.join(worker,'compiled');
  fs.mkdirSync(classes,{recursive:true});
  await command('python3',['-c',`import zipfile,pathlib,sys
r=pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for n in z.namelist():
  if n.endswith('/') or not (n.startswith('BOOT-INF/classes/') or n.startswith('BOOT-INF/lib/') and n.endswith('.jar')): continue
  d=(r/n.removeprefix('BOOT-INF/')).resolve()
  if not d.is_relative_to(r): raise ValueError('Unsafe archive path')
  d.parent.mkdir(parents=True,exist_ok=True);d.write_bytes(z.read(n))`,jar,worker]);
  const source = path.join(__dirname,'CapacityCoexistenceWorker.java');
  await command(path.join(process.env.JAVA_HOME || '', 'bin/javac'),['-cp',path.join(worker,'classes')+path.delimiter+path.join(worker,'lib','*'),'-d',classes,source]);
  report.coexistence = {ingestRevision:report.applicationRevision,ingestSha256:expected,workerSourceSha256:hash(source),
    providerCalls:false,writer:'TrafficSampleWriter.saveSampleWithZones',retention:'TrafficRetentionJob.archiveAndCleanup',
    ingestLimits:{cpus:0.5,memoryMiB:512,pool:4,pids:96},oldSamples,seconds,profiling,observationAgeBudgetMs,checkpoints:[]};
  const journal=path.join(output,'coexistence.ndjson'), gate=path.join(output,'coexistence.start'), stop=path.join(output,'coexistence.stop');
  const env = {
    SPRING_DATASOURCE_URL:`jdbc:postgresql://${db}:5432/postgres`,SPRING_DATASOURCE_USERNAME:'postgres',SPRING_DATASOURCE_PASSWORD:'',
    SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE:'4',SPRING_FLYWAY_ENABLED:'false',SPRING_JPA_HIBERNATE_DDL_AUTO:'validate',
    TRAFFIC_FLOW_ENABLED:'false',TRAFFIC_INCIDENTS_ENABLED:'false',CDOT_VSL_ENABLED:'false',TOMTOM_RESET_PROBE_ENABLED:'false',
    TRAFFIC_STARTUP_VALIDATION_ENABLED:'false',TRAFFIC_MILE_MARKER_CALIBRATION_ENABLED:'false',
    TRAFFIC_MILE_MARKER_CALIBRATION_RUN_ON_STARTUP:'false',TRAFFIC_TIMESERIES_ENABLED:'false',TRAFFIC_RETENTION_ENABLED:'false',
    ROUTES_BASE_URL:`http://${prefix}-routes:8081`,CDOT_BASE_URL:'http://127.0.0.1:9'};
  const ingest=await start(prefix+'-ingest',['--cpus','0.5','--memory','512m','--pids-limit','96',
    '--mount',`type=bind,src=${jar},dst=/ingest.jar,readonly`,
    '--mount',`type=bind,src=${classes},dst=/fixture,readonly`,
    '--mount',`type=bind,src=${output},dst=/evidence`,
    ...Object.entries(env).flatMap(([key,value])=>['-e',key+'='+value]),javaImage,
    'java','-Dloader.path=/fixture','-Dloader.main=com.example.ingest_service.CapacityCoexistenceWorker',
    '-cp','/ingest.jar','org.springframework.boot.loader.launch.PropertiesLauncher',
    '/evidence/coexistence.ndjson','/evidence/coexistence.start','/evidence/coexistence.stop',String(seconds+60),String(oldSamples)]);
  const checkpoint = () => {
    const tmp=path.join(output,'progress.tmp');fs.writeFileSync(tmp,JSON.stringify(report,null,2)+'\n');fs.renameSync(tmp,path.join(output,'progress.json'));
  };
  const workerEvents = () => {
    const result=events(journal);
    if(result.some(e=>e.event==='failure'||e.event==='stopped'&&e.detail.failed)) throw new Error('Packaged writer/retention fixture failed; inspect its bounded journal');
    return result;
  };
  let ready=false;
  for(let n=0;n<120;n++) {
    if(workerEvents().some(e=>e.event==='ready')) {ready=true;break;}
    if(await docker('inspect','--format','{{.State.Running}}',ingest)!=='true') throw new Error('Ingest fixture exited before ready');
    await delay(1000);
  }
  if(!ready) throw new Error('Packaged writer readiness exceeded 120 seconds');
  const sql = async query => JSON.parse(await docker('exec',db,'psql','-X','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-c',
    "set statement_timeout='15s'; set timezone='UTC'; "+query));
  const protectedTables=['traffic_incident_event','traffic_incident_event_corridor','traffic_incident_event_transition',
    'traffic_incident_event_corridor_transition','traffic_provider_request_budget','traffic_provider_request_budget_monthly',
    'tomtom_account_reset_probe','tomtom_reset_probe_run'];
  async function inventory() {
    const result=await sql(`select json_build_object(
      'sampleTotal',(select count(*) from traffic_sample_all),
      'incidentTotal',(select count(*) from traffic_incident_all),
      'zoneTotal',(select count(*) from traffic_speed_zone_sample),
      'oldLive',(select count(*) from traffic_sample s join capacity_coexistence_ids k on k.sample_id=s.id where k.kind='old'),
      'oldArchived',(select count(*) from traffic_sample_archive s join capacity_coexistence_ids k on k.sample_id=s.source_id where k.kind='old'),
      'currentWritten',(select count(*) from capacity_coexistence_ids where kind='current'),
      'currentZones',(select coalesce(sum(zone_count),0) from capacity_coexistence_ids where kind='current'),
      'sampleHash',(select md5(string_agg((to_jsonb(s)-'history_id'-'is_archived'-'archived_at')::text,'' order by s.sample_ref_id))
        from traffic_sample_all s join capacity_coexistence_ids k on k.sample_id=s.sample_ref_id where k.kind='old'),
      'incidentHash',(select md5(string_agg((to_jsonb(s)-'history_id'-'is_archived'-'archived_at')::text,'' order by s.incident_ref_id))
        from traffic_incident_all s join capacity_coexistence_ids k on k.sample_id=s.sample_ref_id where k.kind='old'),
      'zoneHash',(select md5(string_agg(to_jsonb(s)::text,'' order by s.id))
        from traffic_speed_zone_sample s join capacity_coexistence_ids k on k.sample_id=s.sample_id where k.kind='old'))`);
    result.protected={};
    for(const table of protectedTables) result.protected[table]=await sql(`select json_build_object('rows',count(*),'hash',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from ${table} t) q`);
    return result;
  }
  const statistics=()=>sql(`select json_object_agg(c.relname,json_build_object('estimatedRows',c.reltuples,
    'modifications',s.n_mod_since_analyze,'lastAnalyze',s.last_analyze,'lastAutoanalyze',s.last_autoanalyze))
    from pg_class c join pg_stat_user_tables s on s.relid=c.oid
    where c.relname in ('traffic_sample','traffic_incident','traffic_speed_zone_sample')`);
  report.coexistence.fixtureStatisticsBefore=await statistics();
  await docker('exec',db,'psql','-X','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-c',
    "set statement_timeout='15s'; analyze traffic_sample; analyze traffic_incident; analyze traffic_speed_zone_sample; analyze capacity_coexistence_ids");
  report.coexistence.fixtureStatisticsAfter=await statistics();
  const before=await inventory();report.coexistence.before=before;
  if(before.oldLive!==oldSamples || before.oldArchived!==0) throw new Error('Retention canaries were not initially live');
  const profileSql=async phase=>{
    if(!profiling) return;
    (report.coexistence.sqlProfiles||=[]).push({phase,queries:await sql(`select coalesce(json_agg(q),'[]') from
      (select calls,round(total_exec_time::numeric,2) total_ms,round(max_exec_time::numeric,2) max_ms,
        rows,shared_blks_read,temp_blks_written,left(query,1000) query from pg_stat_statements
        where query not like '%pg_stat_statements%' order by total_exec_time desc limit 12) q`)});
    await docker('exec',db,'psql','-X','-U','postgres','-qAt','-c','select pg_stat_statements_reset()');
  };
  await profileSql('setup');
  async function openPages(phase) {
    await c.measure(phase,async page=>{
      await page.goto(origin+'/dashboard/',{waitUntil:'domcontentloaded',timeout:20000});
      await page.waitForFunction(()=>document.getElementById('i25AverageSpeed')?.textContent==='61'
        && document.getElementById('i70AverageSpeed')?.textContent==='54' && state.snapshots.size===5
        && chartHistory.bounds?.size===2,{},{timeout:20000});
      const navigation=await page.evaluate(()=>{const t=performance.getEntriesByType('navigation')[0];return {protocol:t.nextHopProtocol,firstUsefulMs:Math.round(window.__capacityUsefulAt||0),
        ttfbMs:Math.round(t.responseStart),transferMs:Math.round(t.responseEnd-t.responseStart),
        afterResponseMs:Math.round(window.__capacityUsefulAt-t.responseEnd),
        longTasks:(window.__capacityLongTasks||[]).filter(x=>x.start<=window.__capacityUsefulAt),
        resourceTimings:performance.getEntriesByType('resource').filter(x=>x.startTime<=window.__capacityUsefulAt).map(x=>({path:new URL(x.name).pathname,start:Math.round(x.startTime),end:Math.round(x.responseEnd),duration:Math.round(x.duration),bytes:x.decodedBodySize})),
        rendererResources:performance.getEntriesByType('resource').filter(x=>x.name.includes('/maplibre-gl/')).map(x=>({path:new URL(x.name).pathname,start:Math.round(x.startTime),end:Math.round(x.responseEnd),bytes:x.decodedBodySize})),
        encodedBytes:t.encodedBodySize,decodedBytes:t.decodedBodySize};});
      (report.navigation||=[]).push({phase,session:pages.indexOf(page),...navigation});
      if(navigation.protocol!=='h2'||navigation.encodedBytes>=navigation.decodedBytes) throw new Error('Soak requires compressed HTTP/2 navigation');
    });
    if(report.failures.length) throw new Error('Opening failed: '+phase);
  }
  await openPages('open');
  await profileSql('opening');
  fs.writeFileSync(gate,'start\n');
  report.coexistence.startedAt=new Date().toISOString();
  checkpoint();
  const started=Date.now(), destinationSamples=[], memorySamples=[];
  report.coexistence.destinations=destinationSamples;report.coexistence.resources=memorySamples;
  const probe = page=>page.evaluate(()=>{
    window.__soakProbe=null;
    const ready=()=>{
      const selected=state.focusedCorridor==='ALL'?['I25','I70']:[state.focusedCorridor];
      const end=chartHistory.endTime;
      if(end===null || window.ContinuousHistory?.moving) return {graph:false,cards:false};
      const graph=document.getElementById('chartSummary').textContent.includes(document.getElementById('chartHistoryWindow').textContent)
        && document.getElementById('chartHistoryWindow').textContent.startsWith('Historical') && selected.every(c=>{
        const route=chartRouteData(c);if(!route || route.chartUnavailable) return false;
        let cursor=end-state.selectedHours*3600000;
        for(const part of [...(route.parts||[])].filter(p=>!p.value.chartUnavailable).sort((a,b)=>a.start-b.start)) {
          if(part.start>cursor+60000) break;cursor=Math.max(cursor,part.end);
        }
        return cursor>=end-60000;
      });
      const frame=HISTORY_WINDOW_FORMATTER.format(new Date(Math.floor(end/60000)*60000));
      const cards=selected.every(c=>{
        const card=document.getElementById(c.toLowerCase()+'Summary');
        return card?.getAttribute('aria-busy')==='false' && card.title.startsWith('Observed data in the selected window')
          && card.title.includes(frame) && Number(document.getElementById(c.toLowerCase()+'AverageSpeed').textContent)>0
          && Number(document.getElementById(c.toLowerCase()+'TravelTime').textContent)>0
          && /^\d+$/.test(document.getElementById(c.toLowerCase()+'ActiveIncidents').textContent);
      });
      return {graph,cards};
    };
    const inspect=()=>{
      const sample=window.__soakProbe;if(!sample) return;const status=ready();
      if(status.graph && sample.graphAt===null) sample.graphAt=performance.now();
      if(status.graph&&status.cards&&sample.cardsAt===null) sample.cardsAt=performance.now();
    };
    window.__soakInspect=inspect;
    new MutationObserver(inspect).observe(document,{subtree:true,childList:true,characterData:true,attributes:true,
      attributeFilter:['aria-busy','title','data-summary-mode']});
  });
  for(const page of pages) await probe(page);
  async function resourceSample(round) {
    const response=await control.get(origin+'/actuator/metrics/jvm.memory.used?tag=area:heap',
      {headers:{'X-API-Key':apiKey},timeout:10000});
    if(!response.ok()) throw new Error('JVM heap metric unavailable');
    const heap=(await response.json()).measurements.find(m=>m.statistic==='VALUE').value;
    const stats=(await docker('stats','--no-stream','--format','{{json .}}',api,db,ingest)).split('\n').map(line=>JSON.parse(line));
    const pids=Number(await docker('exec',api,'cat','/sys/fs/cgroup/pids.current'));
    const value={round,elapsedSeconds:Math.round((Date.now()-started)/1000),jvmHeapBytes:heap,pids,stats};
    if(round%5===0) {
      value.browserHeaps=[];
      for(const page of pages) {
        const session=await page.context().newCDPSession(page);
        try {await session.send('HeapProfiler.collectGarbage');value.browserHeaps.push((await session.send('Runtime.getHeapUsage')).usedSize);}
        finally {await session.detach();}
      }
    }
    memorySamples.push(value);report.coexistence.resources=memorySamples;
  }
  async function navigateRound(round,scene) {
      const end=Date.parse(fixture.anchor)-(29-round%15)*86400000;
      await c.measure(scene,async(page,n)=>{
        try {
        if(round>0) {
          const note=await page.locator('#chartHistoryMarkerNotice').getAttribute('title');
          if(note?.includes('unavailable')||note?.includes('loading')) throw new Error('Deferred incident markers did not settle between rounds: '+note);
        }
        const current=page.getByRole('button',{name:'Current',exact:true});
        if(await current.isEnabled()) await current.click();
        const focus=(n+round)%5===0?'ALL':(n+round)%2?'I70':'I25';
        await page.locator('[data-corridor-focus="'+focus+'"]').click();
        await page.getByRole('button',{name:['2H','6H','24H','7D','30D'][(n+round)%5],exact:true}).click();
        const view=focus==='ALL'?'overall':round%2===0?'zones':'overall';
        const viewControl=page.locator('button[data-chart-view="'+view+'"]');
        if(await viewControl.isVisible() && await viewControl.isEnabled()) await viewControl.click();
        await page.waitForFunction(({hours,focus,view})=>state.selectedHours===hours && state.focusedCorridor===focus
          && state.chartView===view && historyLimits().available,{hours:[2,6,24,168,720][(n+round)%5],focus,view},{timeout:15000});
        await page.evaluate(end=>{
          window.__soakProbe={startedAt:performance.now(),graphAt:null,cardsAt:null};
          if(!setHistoryEnd(end) && chartHistory.endTime===null) throw new Error('Historical test navigation was unavailable');
          window.__soakInspect();
        },end);
        await page.waitForFunction(()=>window.__soakProbe?.cardsAt!=null && window.__soakProbe?.graphAt!=null,{},{timeout:20000});
        const result=await page.evaluate(()=>({chartMs:Math.round(window.__soakProbe.graphAt-window.__soakProbe.startedAt),
          cardsMs:Math.round(window.__soakProbe.cardsAt-window.__soakProbe.startedAt),hours:state.selectedHours,view:state.chartView,
          focus:state.focusedCorridor,markerNote:document.getElementById('chartHistoryMarkerNotice').title,
          freshness:CORRIDOR_IDS.map(c=>({corridor:c,observedAt:state.routeData.get(c)?.summary?.latest?.polledAt}))}));
        destinationSamples.push({round,scene,session:n,...result});
        if(result.chartMs>10000 || result.cardsMs>10000) throw new Error('Visible window latency exceeded ten-second target: '+JSON.stringify(result));
        if(round>=2 && result.freshness.some(x=>!Number.isFinite(Date.parse(x.observedAt))||Date.now()-Date.parse(x.observedAt)>observationAgeBudgetMs))
          throw new Error('Browser live observations stopped refreshing during historical navigation');
        } catch(error) {
          const diagnostic=await page.evaluate(()=>({hours:state.selectedHours,view:state.chartView,focus:state.focusedCorridor,
            end:chartHistory.endTime,probe:window.__soakProbe,bounds:chartHistory.bounds?.size,
            help:document.getElementById('chartHistoryHelp')?.textContent,
            cards:CORRIDOR_IDS.map(c=>({corridor:c,title:document.getElementById(c.toLowerCase()+'Summary')?.title,
              busy:document.getElementById(c.toLowerCase()+'Summary')?.getAttribute('aria-busy')}))}));
          (report.coexistence.failedWindows||=[]).push({round,session:n,...diagnostic});throw error;
        }
      });
  }
  try {
    for(let round=0;Date.now()-started<seconds*1000;round++) {
      const roundStart=Date.now();
      await navigateRound(round,'soak-round-'+round);
      await profileSql('history-'+round);
      workerEvents();
      if(report.failures.length && !profiling) throw new Error('Soak round failed; stopping instead of running out the clock');
      await resourceSample(round);
      report.coexistence.rounds=round+1;report.coexistence.destinations=destinationSamples;
      const current=workerEvents();report.coexistence.writerCycles=current.filter(e=>e.event==='ingestion').length;
      report.coexistence.retentionCycles=current.filter(e=>e.event==='retention').length;
      checkpoint();
      console.log('Coexistence checkpoint:',JSON.stringify({round,elapsedSeconds:Math.round((Date.now()-started)/1000),
        writers:report.coexistence.writerCycles,retention:report.coexistence.retentionCycles,
        maxCardsMs:Math.max(...destinationSamples.filter(x=>x.round===round).map(x=>x.cardsMs)),pids:memorySamples.at(-1).pids}));
      if(profiling) break;
      await delay(Math.max(0,Math.min(60000-(Date.now()-roundStart),seconds*1000-(Date.now()-started))));
    }
    await resourceSample(Math.round(seconds/60));
    checkpoint();
  } finally { fs.writeFileSync(stop,'stop\n'); }
  let stopped=false;
  for(let n=0;n<25;n++) {if(workerEvents().some(e=>e.event==='stopped')) {stopped=true;break;}await delay(1000);}
  if(!stopped) throw new Error('Packaged writers did not stop within25 seconds');
  const after=await inventory();report.coexistence.after=after;
  for(const key of ['sampleHash','incidentHash','zoneHash']) if(before[key]!==after[key]) throw new Error('Retention changed canary content: '+key);
  if(profiling ? after.oldArchived<1000 || after.oldLive+after.oldArchived!==oldSamples : after.oldLive!==0 || after.oldArchived!==oldSamples) throw new Error('Retention did not move every canary into queryable archive');
  if(after.sampleTotal!==before.sampleTotal+after.currentWritten || after.zoneTotal!==before.zoneTotal+after.currentZones
      || after.incidentTotal!==before.incidentTotal) throw new Error('Archive-inclusive row continuity failed');
  if(JSON.stringify(before.protected)!==JSON.stringify(after.protected)) throw new Error('Durable event, quota or reset evidence changed');
  if(after.currentWritten<2*Math.floor(seconds/60)) throw new Error('Actual packaged writer did not sustain both corridors');
  const gc=memorySamples.filter(x=>x.browserHeaps&&x.elapsedSeconds>=600);
  if(gc.length>=3) {
    const baseline=gc[0].browserHeaps, final=gc.at(-1).browserHeaps;
    report.coexistence.browserGrowth={baseline,final,allowance:'max(32MiB,25% of warmed baseline),after explicit GC outside timed reads'};
    if(final.some((bytes,n)=>bytes-baseline[n]>Math.max(32*1024*1024,baseline[n]*0.25))) throw new Error('Retained browser heap kept growing past warmed cache allowance');
  }
  const journalEvents=workerEvents();
  if(c.scene==='backlog') {
    const batches=journalEvents.filter(e=>e.event==='retention');
    report.coexistence.retentionBatches=batches.map(e=>e.detail);
    if(batches.length<6 || batches.slice(0,6).some(e=>e.detail.archivedOld!==1000))
      throw new Error('Sustained backlog did not exercise six full 1,000-canary retention cycles');
    const restartStarted=Date.now();
    await c.restart();
    await openPages('restart-open');
    for(const page of pages) await probe(page);
    await navigateRound(6,'restart-history');
    if(report.failures.length) throw new Error('Post-restart browser checks failed');
    const opening=report.navigation.filter(n=>n.phase==='restart-open');
    report.coexistence.restart={seconds:Math.round((Date.now()-restartStarted)/1000),opening,historyChecks:10};
    if(opening.some(n=>n.firstUsefulMs<=0 || n.firstUsefulMs>2000))
      throw new Error('Post-restart cold opening exceeded two-second target');
    const restarted=await inventory();
    if(JSON.stringify(after)!==JSON.stringify(restarted)) throw new Error('API restart changed retained data');
    report.coexistence.restart.inventoryUnchanged=true;
  }
  report.coexistence.writerCycles=journalEvents.filter(e=>e.event==='ingestion').length;
  report.coexistence.retentionCycles=journalEvents.filter(e=>e.event==='retention').length;
  report.coexistence.elapsedSeconds=Math.round((Date.now()-started)/1000);
  if(profiling && report.navigation.some(n=>n.firstUsefulMs<=0 || n.firstUsefulMs>2000))
    report.failures.push('Initial useful opening exceeded two-second target');
  report.coexistence.completed=true;checkpoint();
}
module.exports={run};
