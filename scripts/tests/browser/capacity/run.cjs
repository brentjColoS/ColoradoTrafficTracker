#!/usr/bin/env node
'use strict';
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {createHash} = require('node:crypto');
const {chromium} = require('@playwright/test');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../../../..');
const runtime = path.resolve(root, process.env.BROWSER_RUNTIME_DIR || 'browser-runtime');
const databaseImage = 'timescale/timescaledb:2.28.0-pg16@sha256:68faf0bca42125ff98228a8f5a379bcf0ac588d8156f716be8aaf9befd65857f';
const javaImage = 'eclipse-temurin:21.0.12_8-jre-jammy@sha256:eebd356ad7358b7094758e5787a6726f332917cfd56feab6457c56dab895cdbf';
const proxyImage = 'caddy:2-alpine@sha256:de23def33b17fb5d1290b0f6c2add1d70780e52341896c00a4c8a2a2fe9d355e';
const prefix = 'ctt-capacity-' + randomUUID();
const owned = [], pages = [], contexts = [], samples = [], failures = [];
const output = path.resolve(process.env.CAPACITY_OUTPUT || path.join(root, 'capacity-results'));
const days = Number(process.env.CAPACITY_DAYS || 180);
const selectedScene = process.env.CAPACITY_SCENE || 'all';
const rateLimit = Number(process.env.CAPACITY_RATE_LIMIT || 120);
const clientMode = process.env.CAPACITY_CLIENT_MODE || 'shared';
if (!Number.isInteger(rateLimit) || rateLimit < 120 || rateLimit > 600) throw new Error('CAPACITY_RATE_LIMIT must be 120–600');
if (!['shared', 'distinct'].includes(clientMode)) throw new Error('CAPACITY_CLIENT_MODE must be shared/distinct');
const scenes = ['open', 'history', 'summary', 'stream', 'shared', 'legacy', 'refresh'];
if (!Number.isInteger(days) || days < 60 || days > 365 || !['all', 'reads', 'expiry', ...scenes].includes(selectedScene)) {
  throw new Error('CAPACITY_DAYS must be 60–365; CAPACITY_SCENE must be all/reads/expiry/'+scenes.join('/'));
}
if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://')) throw new Error('Capacity setup requires local Docker');
fs.mkdirSync(output, {recursive:true});
let browser, target, db, api, routes, stopping, fixture;
const networks=[];
const report = {revision:null, resourcePrefix:prefix, synthetic:true, databaseImage, javaImage, proxyImage, days, sessions:10,
  clientMode, apiLimits:{cpus:1.5,memoryMiB:1536,rateLimit,pool:12},
  cacheState:'new application process; database/OS cache state uncontrolled',
  colocatedGenerator:true, samples, failures};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
async function command(file, args, options = {}) {
  const result = await exec(file,args,{cwd:root,timeout:100_000,maxBuffer:8*1024*1024,...options});
  return result.stdout.trim();
}
const docker = (...args) => command('docker', args);
async function start(name, args, network=prefix) {
  if(stopping) throw new Error('Capacity run is stopping; no new containers will start');
  owned.push(name);
  await docker('run','--detach','--name',name,'--label','io.coloradotraffictracker.capacity='+prefix,
    '--network',network,'--log-opt','max-size=5m','--log-opt','max-file=1',...args);
  return name;
}
async function readiness(url, seconds=60, container=null) {
  const until=Date.now()+seconds*1000;
  let attempts=0;
  while (Date.now()<until) {
    try {const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.ok && (await r.json()).status==='UP') return;} catch {}
    if(container && attempts++%8===0 && await docker('inspect','--format','{{.State.Running}}',container)!=='true')
      throw new Error('Target exited before readiness: '+container);
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Readiness deadline exceeded for '+url);
}
async function remove(name) {
  await docker('rm','--force','--volumes',name);
  owned.splice(owned.indexOf(name),1);
}
async function cleanup() {
  if(stopping) return stopping;
  stopping=(async()=>{
    await browser?.close().catch(()=>{});
    for(const name of [...owned].reverse()) {
      try {fs.writeFileSync(path.join(output,name.replace(prefix,'target')+'.log'),await docker('logs','--tail','300',name));} catch {}
      try {await remove(name);} catch(error) {failures.push('Cleanup failed: '+name+': '+error.message);}
    }
    for(const network of [...networks].reverse()) {
      try {await docker('network','rm',network);} catch(error) {failures.push('Network cleanup failed: '+error.message);}
    }
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  })();
  return stopping;
}
const watchdog=setTimeout(()=>{failures.push('Seven-minute hard deadline reached');void cleanup().finally(()=>process.exit(124));},420_000);
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{failures.push(signal);void cleanup().finally(()=>process.exit(130));});
async function apiStart(migrate) {
  api=prefix+'-api';
  await start(api,['--cpus','1.5','--memory','1536m','--pids-limit','128',
    '--mount',`type=bind,src=${runtime}/api-service.jar,dst=/app.jar,readonly`,
    '-e','SPRING_PROFILES_ACTIVE=cloud','-e',`SPRING_DATASOURCE_URL=jdbc:postgresql://${db}:5432/postgres`,
    '-e','SPRING_DATASOURCE_USERNAME='+(migrate?'postgres':'capacity_reader'),
    '-e','SPRING_DATASOURCE_PASSWORD=','-e','SPRING_FLYWAY_ENABLED='+migrate,
    '-e','SPRING_DATASOURCE_HIKARI_READ_ONLY='+!migrate,'-e',`ROUTES_BASE_URL=http://${routes}:8081`,
    '-e','API_SECURITY_KEYS=capacity-fixture-key','-e','DASHBOARD_PUBLIC_DATA_ENABLED=true',
    '-e','DASHBOARD_REPLAY_ENABLED=false','-e','API_RATE_LIMIT_REQUESTS_PER_MINUTE='+rateLimit,
    '-e','API_RATE_LIMIT_TRUST_FORWARDED_FOR=true','-e','MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE=health,info,metrics',
    javaImage,'java','-jar','/app.jar']);
  await readiness(target+'/actuator/health/readiness',60,api);
}
async function setup() {
  report.revision=await command('git',['rev-parse','HEAD']);
  const expected=process.env.CAPACITY_REVISION||report.revision;
  if(!/^[0-9a-f]{40}$/.test(expected)) throw new Error('CAPACITY_REVISION must be an exact commit SHA');
  await command('python3',['scripts/ci/browser_runtime.py','verify',runtime],
    {env:{...process.env,GITHUB_SHA:expected}});
  report.applicationRevision=expected;
  report.runtimeManifest=JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json'),'utf8'));
  report.harnessDirty=Boolean(await command('git',['status','--porcelain']));
  report.fixtureSha256=createHash('sha256').update(fs.readFileSync(path.join(__dirname,'seed.sql'))).digest('hex');
  const endpoint=await docker('context','inspect','--format','{{.Endpoints.docker.Host}}');
  if(!endpoint.startsWith('unix://') && !endpoint.startsWith('npipe://')) throw new Error('Capacity setup refuses a remote Docker context');
  report.docker=JSON.parse(await docker('info','--format','{"cpus":{{.NCPU}},"memory":{{.MemTotal}}}'));
  await docker('network','create','--internal','--label','io.coloradotraffictracker.capacity='+prefix,prefix);
  networks.push(prefix);
  await docker('network','create','--label','io.coloradotraffictracker.capacity='+prefix,prefix+'-entry');
  networks.push(prefix+'-entry');
  const clientRoutes=clientMode==='distinct' ? Array.from({length:10},(_,n)=>`
 @session${n} header X-Capacity-Session ${n}
 handle @session${n} {
  reverse_proxy ${prefix}-api:8080 {
   header_up X-Forwarded-For 192.0.2.${10+n}
  }
 }`).join('\n') : '';
  fs.writeFileSync(path.join(output,'Caddyfile'),`:8080 {${clientRoutes}\n handle {\n  reverse_proxy ${prefix}-api:8080 {\n   header_up X-Forwarded-For 192.0.2.10\n  }\n }\n}\n`);
  const proxy=await start(prefix+'-proxy',['--memory','128m','--cpus','0.5','--pids-limit','64',
    '-p','127.0.0.1::8080','--mount',`type=bind,src=${output}/Caddyfile,dst=/etc/caddy/Caddyfile,readonly`,proxyImage],prefix+'-entry');
  await docker('network','connect',prefix,proxy);
  const mapping=await docker('port',proxy,'8080');
  target='http://127.0.0.1:'+mapping.match(/:(\d+)$/)[1];
  db=await start(prefix+'-db',['--memory','2g','--cpus','2','--pids-limit','128',
    '-e','POSTGRES_HOST_AUTH_METHOD=trust',databaseImage,'postgres','-c','shared_buffers=256MB',
    '-c','max_connections=50','-c','shared_preload_libraries=timescaledb,pg_stat_statements']);
  await docker('exec',db,'sh','-c','for attempt in $(seq 1 60); do pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && exit 0; sleep 0.5; done; exit 1');
  routes=await start(prefix+'-routes',['--memory','384m','--cpus','0.5','--pids-limit','96',
    '--mount',`type=bind,src=${runtime}/routes-service.jar,dst=/app.jar,readonly`,javaImage,'java','-jar','/app.jar']);
  await apiStart(true);
  const seed=fs.readFileSync(path.join(__dirname,'seed.sql'),'utf8');
  const child=require('node:child_process').spawn('docker',['exec','-i',db,'psql','-X','-U','postgres','-v','days='+days,'-At'],{stdio:['pipe','pipe','pipe']});
  const seedResult=await new Promise((resolve,reject)=>{
    let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new Error('Seed exceeded 100 seconds'));},100_000);
    child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);
    child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error('Seed failed: '+err));});
    child.stdin.end(seed);
  });
  fixture=JSON.parse(seedResult.trim().split('\n').at(-1)); report.fixture=fixture;
  await docker('exec',db,'psql','-X','-U','postgres','-c','create extension if not exists pg_stat_statements');
  await remove(api);await apiStart(false);
  await docker('exec',db,'psql','-X','-U','postgres','-c','select pg_stat_statements_reset()');
  console.log('Target ready:',JSON.stringify({fixture,limits:report.apiLimits,deadlineSeconds:420}));
  const origin=target;
  browser=await chromium.launch();
  if(stopping) {await browser.close();throw new Error('Capacity run stopped during browser startup');}
  for(let n=0;n<10;n++) {
    const context=await browser.newContext({viewport:{width:1100,height:800},extraHTTPHeaders:{'X-Capacity-Session':String(n)}});contexts.push(context);
    const page=await context.newPage();pages.push(page);
    page.on('response',response=>{
      const url=new URL(response.url());
      if(url.origin===origin) countRequest(url.pathname,response.status());
    });
    page.on('pageerror',error=>failures.push('Browser '+n+': '+error.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin || ['data:','blob:'].includes(url.protocol)) return route.continue();
      if(url.hostname==='fonts.googleapis.com') return route.fulfill({contentType:'text/css',body:''});
      if(url.hostname==='basemap.nationalmap.gov' && url.pathname.includes('/tile/')) return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
      failures.push('Unexpected external presentation request: '+url.origin+url.pathname);return route.abort();
    });
  }
  return origin;
}
async function measure(scene, action) {
  console.log('Starting bounded scene:',scene);
  (report.sceneStartedAt||={})[scene]=new Date().toISOString();
  const results=await Promise.allSettled(pages.map(async(page,session)=>{
    const before=performance.now();await action(page,session);
    samples.push({scene,session,milliseconds:Math.round(performance.now()-before)});
  }));
  results.forEach((result,session)=>{if(result.status==='rejected') failures.push({scene,session,reason:String(result.reason)});});
  const sorted=samples.filter(s=>s.scene===scene).map(s=>s.milliseconds).sort((a,b)=>a-b);
  const percentile=p=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null;
  (report.timings||={})[scene]={completed:sorted.length,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),max:sorted.at(-1)??null};
  console.log('Scene result:',scene,JSON.stringify(report.timings[scene]),'totalFailures',failures.length);
}
async function read(page,origin,path) {
  const response=await page.request.get(origin+path,{timeout:15_000});
  countRequest(new URL(origin+path).pathname,response.status());
  const headers=response.headers(),session=pages.indexOf(page);
  const remaining=Number(headers['x-ratelimit-remaining']);
  if(headers['x-ratelimit-limit'] && Number.isFinite(remaining)) {
    report.rateLimits||={};
    report.rateLimits[session]={limit:Number(headers['x-ratelimit-limit']),
      minimumRemaining:Math.min(report.rateLimits[session]?.minimumRemaining??Infinity,remaining)};
  }
  if(!response.ok()) throw new Error('HTTP '+response.status()+' '+path);
  return response.json();
}
function countRequest(path,status) {
  if(path.startsWith('/dashboard-api/') && status>=400) failures.push({scene:'http',path,status});
  report.requests||={};const key=status+' '+path;
  report.requests[key]=(report.requests[key]||0)+1;
}
function sections(value) {
  for(const [key,section] of Object.entries(value)) if(section.status!==200) throw new Error('Failed section '+key+': '+section.status);
}
function summary(value,corridor) {
  const entry=Object.entries(value).find(([key])=>key.startsWith('/traffic/summary?')&&key.includes('corridor='+corridor));
  if(!entry) throw new Error('Missing summary section '+corridor);
  return entry[1];
}
async function expiry(origin) {
  const snapshot='/dashboard-api/traffic/dashboard/snapshot?ranges=24';
  const original=[];
  const before=failures.length;
  await measure('expiry-prime',async(page,n)=>{
    const value=await read(page,origin,snapshot);sections(value);original[n]=value;
  });
  if(failures.length!==before) throw new Error('Expiry prime failed; skipping the wait');
  await docker('exec',db,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-c',
    `insert into traffic_sample(corridor,avg_current_speed,avg_freeflow_speed,min_current_speed,confidence,polled_at,source_mode,speed_sample_count)
     values ('I25',62,70,50,0.95,now(),'tile',8),('I70',55,70,45,0.95,now(),'tile',8)`);
  console.log('Waiting 61 seconds for one real cache-expiry boundary; no polling or provider calls.');
  await new Promise(resolve=>setTimeout(resolve,61_000));
  let retained=0;
  const current=new Set();
  function inspect(value,n) {
    sections(value);let ready=true;
    for(const corridor of ['I25','I70']) {
      const old=summary(original[n],corridor),next=summary(value,corridor);
      if(next.version===old.version) {
        if(!next.refreshing || next.fetchedAt!==old.fetchedAt) throw new Error('Retained section lost original fetch evidence');
        retained++;ready=false;
      } else if(next.data?.latest?.avgCurrentSpeed!==(corridor==='I25'?62:55)) throw new Error('Refresh did not load the new controlled observation');
    }
    if(ready) current.add(n);
  }
  const known=Object.values(original[0]).map(section=>section.version).filter(Boolean).join(',');
  await measure('expiry-pending',async(page,n)=>inspect(await read(page,origin,snapshot+'&known='+encodeURIComponent(known)),n));
  if(retained===0) failures.push('No retained section was served while refreshing');
  for(let round=1;round<=3 && current.size<10;round++) {
    await new Promise(resolve=>setTimeout(resolve,1000));
    await measure('expiry-followup-'+round,async(page,n)=>inspect(await read(page,origin,snapshot),n));
  }
  report.expiry={retainedSections:retained,updatedSessions:current.size};
  if(current.size!==10) failures.push('Not all ten sessions received refreshed observations within three follow-ups');
}
async function main() {
  const origin=await setup(),anchor=Date.parse(fixture.anchor);
  if(selectedScene==='expiry') await expiry(origin);
  for(const scene of scenes.filter(s=>selectedScene==='all'||s===selectedScene
    || selectedScene==='reads' && !['open','refresh'].includes(s))) {
    await measure(scene,async(page,n)=>{
      if(scene==='open') {
        await page.goto(origin+'/dashboard/',{waitUntil:'domcontentloaded',timeout:20_000});
        await page.waitForFunction(()=>document.querySelector('#i25AverageSpeed')?.textContent?.trim()==='61'
          && document.querySelector('#i70AverageSpeed')?.textContent?.trim()==='54',{},{timeout:15_000});
        (report.navigation||=[]).push({session:n,...await page.evaluate(()=>{
          const timing=performance.getEntriesByType('navigation')[0];
          return {firstByteMs:Math.round(timing.responseStart),domReadyMs:Math.round(timing.domContentLoadedEventEnd),decodedBytes:timing.decodedBodySize,encodedBytes:timing.encodedBodySize};
        })});
      } else if(scene==='refresh') {
        const value=await read(page,origin,'/dashboard-api/traffic/dashboard/snapshot?ranges=2,6,24,168,720');sections(value);
        for(const corridor of ['I25','I70']) for(const hours of [168,720]) {
          const section=Object.entries(value).find(([key])=>key.startsWith('/traffic/map/flow-cells/frequency?')
            && key.includes('corridor='+corridor) && key.includes('windowHours='+hours))?.[1];
          if(!section?.data?.cells?.length || section.data.cells.some(cell=>cell.direction!=='COMBINED'))
            throw new Error('Missing combined seeded map-frequency cells '+corridor+' '+hours);
        }
      } else {
        const end=new Date(anchor-((scene==='history'?2+n*12:scene==='legacy'?40+n:scene==='shared'?4:scene==='stream'?3:2)*24
          +(['history','legacy','shared'].includes(scene)?0:n*2))*3_600_000).toISOString();
        if(scene==='history') {
          const hours=[2,6,24,168,720][n%5];
          const value=await read(page,origin,'/dashboard-api/traffic/dashboard/history?corridors=I25,I70&hours='+hours+'&asOf='+encodeURIComponent(end));sections(value);
          const trends=Object.values(value).filter(s=>s.data?.buckets);
          if(trends.length!==2 || trends.some(s=>!s.data.buckets.length)) throw new Error('Missing seeded historical trends');
        } else {
          const route='/dashboard-api/traffic/dashboard/window-summary?hours=24&asOf='+encodeURIComponent(end);
          let value;
          if(scene==='stream' || scene==='shared') {
            const response=await page.request.get(origin+route+'&progressive=true',{headers:{Accept:'application/x-ndjson'},timeout:15_000});
            countRequest('/dashboard-api/traffic/dashboard/window-summary',response.status());
            if(!response.ok()) throw new Error('Streaming HTTP '+response.status());
            const frames=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
            if(!frames.at(-1)?.complete) throw new Error('Incomplete summary stream');
            value=frames.at(-1).summaries;
          } else value=await read(page,origin,route);
          for(const corridor of ['I25','I70']) {
            const summary=value[corridor];
            if(!summary || summary.busy || !summary.speedAvailable || !summary.zonesAvailable || !summary.incidentsAvailable)
              throw new Error('Incomplete seeded summary '+corridor+': '+JSON.stringify(summary));
            if(Date.parse(summary.end)!==Date.parse(end) || !(summary.averageSpeed>50) || !(summary.averageTravelMinutes>0))
              throw new Error('Wrong window or seeded metric '+corridor);
            const firstMinute=Math.round((anchor-Date.parse(end))/60_000);
            let speedSum=0;for(let minute=firstMinute;minute<=firstMinute+1440;minute++) speedSum+=(corridor==='I25'?61:54)+(minute%5)*0.25;
            if(Math.abs(summary.averageSpeed-speedSum/1441)>0.000001) throw new Error('Average differs from raw seeded observations');
          }
        }
      }
    });
  }
  if(selectedScene==='all' || selectedScene==='open') {
    report.bootstrap=await pages[0].evaluate(()=>{
      const node=document.getElementById('dashboardBootstrap');
      return Object.entries(JSON.parse(node?.textContent||'{}')).map(([key,value])=>({key,bytes:new TextEncoder().encode(JSON.stringify(value)).length}));
    });
  }
  report.resources=await docker('stats','--no-stream','--format','{{json .}}',...owned);
  report.queries=await docker('exec',db,'psql','-X','-U','postgres','-At','-c',
    'select json_agg(q) from (select calls,round(total_exec_time::numeric,1) as total_ms,round(mean_exec_time::numeric,1) as mean_ms,left(query,300) as query from pg_stat_statements order by total_exec_time desc limit 12) q');
  const until=new Date(anchor-2*86_400_000).toISOString(),since=new Date(anchor-3*86_400_000).toISOString();
  report.zoneQueryPlan=JSON.parse(await docker('exec',db,'psql','-X','-U','postgres','-At','-c',
    `explain (analyze,buffers,format json) select zone_key,zone_order,zone_label,zone_description,start_mile_marker,end_mile_marker,
      posted_speed_mph,date_bin(interval '15 minutes',polled_at,timestamptz '1970-01-01') as bucket_start,
      sum(avg_current_speed*speed_sample_count)/nullif(sum(speed_sample_count) filter(where avg_current_speed is not null),0) as avg_current_speed,
      min(min_current_speed),sum(speed_sample_count) from traffic_speed_zone_sample
      where corridor='I25' and polled_at >= '${since}'::timestamptz and polled_at <= '${until}'::timestamptz
      group by zone_key,zone_order,zone_label,zone_description,start_mile_marker,end_mile_marker,posted_speed_mph,bucket_start
      order by bucket_start,zone_order`));
}
void main().catch(error=>{failures.push(error.stack||String(error));console.error(error.message);}).finally(async()=>{
  await cleanup();clearTimeout(watchdog);console.log('Report:',path.join(output,'report.json'),'Failures:',failures.length);process.exitCode=failures.length?1:0;
});
