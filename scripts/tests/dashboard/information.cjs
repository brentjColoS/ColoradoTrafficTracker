const { test } = require('node:test');
const { assert, indexSource, informationPages, informationStyles, readFileSync, path, dashboard, informationSource } = require('../fixtures/core.cjs');
const { borderTraceFixture, dataHero, dataHeroSource, informationPage } = require('../fixtures/information.cjs');
const { testDirectory } = require('../fixtures/core.cjs');

test('primary navigation stays within the dashboard for project information pages', () => {
  assert.match(indexSource, /href="system\.html">System/);
  assert.match(indexSource, /href="data\.html">About the Data/);
  assert.match(indexSource, /href="api\.html">API/);
  assert.doesNotMatch(indexSource, /href="#system-health">System/);
  assert.match(informationPages.system, /class="active" href="system\.html" aria-current="page"/);
  assert.match(informationPages.data, /class="active" href="data\.html" aria-current="page"/);
  assert.match(informationPages.api, /class="active" href="api\.html" aria-current="page"/);
});

test('panel traces draw two bounded halves after batched geometry reads and then settle',()=>{
  const f=borderTraceFixture();
  assert.equal(f.frames.size,1);f.flush();
  assert.equal(f.frames.size,0);
  assert.ok(f.order.lastIndexOf('read')<f.order.indexOf('write'));
  for(const panel of f.panels){
    assert.ok(panel.classes.has('has-border-trace'));
    const svg=panel.children[0];assert.equal(svg.attributes['aria-hidden'],'true');
    assert.equal(svg.children.length,2);
    assert.ok(svg.children.every(path=>path.attributes.pathLength==='1'&&!/NaN|Infinity/.test(path.attributes.d)));
    assert.notEqual(svg.children[0].attributes.d,svg.children[1].attributes.d);
  }
  f.order.length=0;
  f.observers[0].callback(f.panels.map(target=>({target})));
  f.observers[0].callback(f.panels.map(target=>({target})));
  assert.equal(f.frames.size,1);f.flush();assert.ok(!f.order.includes('write'));
});

test('panel trace resizing is cancelled on disposal but preserved through back-forward caching',()=>{
  const f=borderTraceFixture();
  f.events.pagehide({persisted:true});assert.equal(f.frames.size,1);
  f.events.pagehide({persisted:false});assert.equal(f.frames.size,0);
  assert.equal(f.observers[0].disconnected,true);
  f.observers[0].callback(f.panels.map(target=>({target})));
  assert.equal(f.frames.size,0);
});

test('drawn borders preserve timed travel without hover shadows or reduced-motion transitions',()=>{
  assert.match(informationStyles,/stroke-dashoffset 720ms/);
  assert.match(informationStyles,/\.has-border-trace::after\s*\{\s*display: none/);
  assert.match(informationStyles,/\.panel-border-trace path\s*\{\s*transition: none/);
  const panelRule=informationStyles.match(/\.architecture-node,\s*\.pipeline-card,\s*\.provider-control\s*\{([^}]+)\}/)[1];
  assert.doesNotMatch(panelRule,/transition:[^;]*(box-shadow|filter)/);
});

test('information heroes use one shared title scale across pages and breakpoints', () => {
  assert.match(informationStyles,/\.information-hero h1\s*\{[^}]*font-size: clamp\(32px, 6vw, 58px\)/s);
  assert.doesNotMatch(informationStyles,/\.(?:data|api)-hero h1\s*\{[^}]*font-size:/s);
});

test('Data hero uses tracked geometry, normal overview tiles and six bounded startup reads', async()=>{
  const hero=dataHero();await hero.settle();
  assert.equal(hero.state.maps.length,1);
  assert.equal(hero.state.reads.length,6);
  assert.ok(hero.state.reads.every(read=>read.url.startsWith('/dashboard-experimental-api/') && read.options.signal instanceof AbortSignal));
  const style=hero.state.options.style;
  assert.equal(style.sources['base-map-overview'].tiles[0],'https://example.test/normal/{z}/{x}/{y}.png');
  assert.equal(style.layers.find(layer=>layer.id==='hero-base-map-overview').maxzoom,10);
  assert.equal(style.layers.find(layer=>layer.id==='hero-base-map').minzoom,10);
  assert.equal(style.layers.find(layer=>layer.id==='hero-i25').paint['line-color'],'#4fbe7d');
  assert.equal(style.layers.find(layer=>layer.id==='hero-i70').paint['line-color'],'#df7680');
  assert.equal(hero.state.options.interactive,false);
  assert.match(hero.status.textContent,/2 corridors/);
  hero.flushFrames();assert.equal(hero.frames.size,0);
  assert.equal(hero.timers.size,1);
  assert.ok([...hero.timers.values()][0].ms <= 60000);
  assert.doesNotMatch(dataHeroSource,/setInterval|requestAnimationFrame\(animate|pulse-opacity|line-gradient/);
});

test('Data hero rejects empty, malformed and out-of-world lines before allocating WebGL', async()=>{
  for(const coordinates of [[],[[-105,40]],[[NaN,40],[-105,40]],[[181,40],[-105,40]],[[-105,91],[-105,40]]]){
    const hero=dataHero({features:[{properties:{corridor:'I25'},geometry:{type:'LineString',coordinates}}]});
    await hero.settle();assert.equal(hero.state.maps.length,0);
    assert.match(hero.status.textContent,/Refresh this page to retry/);
  }
});

test('Data hero coalesces resize notifications without an ongoing render loop', async()=>{
  const hero=dataHero();await hero.settle();hero.flushFrames();
  const resize=hero.observers[1];
  resize.callback();resize.callback();resize.callback();
  assert.equal(hero.frames.size,1);
  const count=hero.state.resized;hero.flushFrames();
  assert.equal(hero.state.resized,count+1);assert.equal(hero.frames.size,0);
});

test('Data hero preserves its renderer through the back-forward cache and cleans up real navigation', async()=>{
  const hero=dataHero();await hero.settle();hero.flushFrames();
  hero.events.pagehide({persisted:true});assert.equal(hero.state.removed,0);
  hero.events.pageshow({persisted:true});assert.equal(hero.frames.size,1);hero.flushFrames();
  hero.events.pagehide({persisted:false});assert.equal(hero.state.removed,1);
  assert.ok(hero.observers.every(observer=>observer.disconnected));
  assert.equal(hero.frames.size,0);
});

test('Data hero cannot allocate a renderer after geometry resolves on a departed page', async()=>{
  let release;
  const hero=dataHero({delayedGeometry:()=>new Promise(resolve=>release=resolve)});
  await hero.settle();hero.events.pagehide({persisted:false});
  release({features:[{properties:{corridor:'I25'},geometry:{type:'LineString',coordinates:[[-105,39],[-105,40]]}}]});
  await hero.settle();assert.equal(hero.state.maps.length,0);
});

test('Data hero explains missing WebGL without interfering with other page content', async()=>{
  const hero=dataHero({loader:async()=>{throw new Error('No WebGL');}});
  await hero.settle();assert.match(hero.status.textContent,/Geometry could not be loaded/);
  assert.ok(hero.classes.has('is-unavailable'));assert.equal(hero.state.maps.length,0);
});

test('Data hero keeps raster failure truthful and falls back from unavailable configuration', async()=>{
  const hero=dataHero({pathname:'/dashboard/data.html',fetch:async(url)=>url.endsWith('/map/config')
    ? {ok:false}
    : {ok:true,json:async()=>({features:[{properties:{corridor:'I25'},geometry:{type:'LineString',coordinates:[[-105,39],[-105,40]]}}]})}});
  await hero.settle();
  assert.ok(hero.state.reads.every(read=>read.url.startsWith('/dashboard-api/')));
  assert.equal(new URL(hero.state.options.style.sources['base-map'].tiles[0]).hostname,'basemap.nationalmap.gov');
  hero.state.maps[0].handlers.error({sourceId:'base-map'});
  assert.match(hero.status.textContent,/Basemap unavailable; tracked geometry remains visible/);
});

test('Data hero renderer loading has an eight-second deadline and rejects late initialization', async()=>{
  let release;
  const hero=dataHero({loader:()=>new Promise(resolve=>release=resolve)});
  await hero.settle();
  assert.equal(hero.timers.size,1);const deadline=[...hero.timers.values()][0];assert.equal(deadline.ms,8000);
  deadline.fn();await hero.settle();
  assert.match(hero.status.textContent,/Refresh this page to retry/);assert.equal(hero.timers.size,0);
  release({});await hero.settle();assert.equal(hero.state.maps.length,0);
});

test('Data hero cancels a pending renderer deadline on navigation', async()=>{
  const hero=dataHero({loader:()=>new Promise(()=>{})});
  await hero.settle();hero.events.pagehide({persisted:false});await hero.settle();
  assert.equal(hero.timers.size,0);assert.equal(hero.state.maps.length,0);
});

test('Data hero bounds style initialization and cancels its deadline on navigation', async()=>{
  const hero=dataHero({styleLoaded:false});await hero.settle();
  assert.equal(hero.timers.size,1);assert.equal([...hero.timers.values()][0].ms,15000);
  hero.events.pagehide({persisted:false});await hero.settle();
  assert.equal(hero.timers.size,0);assert.equal(hero.state.removed,1);assert.equal(hero.frames.size,0);
});

test('information-page anchors and icons resolve to unique owners', () => {
  for (const [name, html] of Object.entries(informationPages)) {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    const owners = new Set(ids);
    assert.equal(owners.size, ids.length, `${name} has duplicate IDs`);
    for (const match of html.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(owners.has(match[1]), `${name} has a missing anchor or icon: ${match[1]}`);
    }
    const symbols = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/information-icons.svg'), 'utf8');
    const symbolIds = [...symbols.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(symbolIds).size, symbolIds.length, 'shared icon IDs are unique');
    for (const match of html.matchAll(/href="information-icons\.svg#([^"]+)"/g)) {
      assert.ok(symbolIds.includes(match[1]), `${name} has a missing shared icon: ${match[1]}`);
    }
  }
});

test('information pages retain bounded and accurate data contracts', () => {
  assert.match(informationPages.data, /I-25 · MM 208–271/);
  assert.match(informationPages.data, /I-70 · MM 206–274/);
  assert.match(informationPages.data, /combined-direction view/);
  assert.match(informationPages.api, /These reads do not trigger new TomTom or CDOT requests/);
  assert.match(informationPages.api, /GET \/system\/operational-status/);
});

test('API page describes verified public routes and deployment-controlled access', () => {
  assert.match(informationPages.api, /The dashboard, in JSON/);
  assert.match(informationPages.api, /Thirteen useful starting points/);
  assert.match(informationPages.api, /Deployment configured/);
  assert.doesNotMatch(informationPages.api, /300\/min|300 reads/);
  const root=path.join(testDirectory,'../../api-service/src/main/java/com/example/api_service');
  const controllers=require('node:fs').readdirSync(root).filter(file=>file.endsWith('Controller.java'));
  const count=controllers.filter(file=>!['IncidentModelParityController.java','DashboardPageController.java'].includes(file))
    .reduce((total,file)=>total+new Set((readFileSync(path.join(root,file),'utf8').match(/@GetMapping(?:\([^)]*\))?/g)||[])
      .map(mapping=>mapping.match(/@GetMapping\((?:value\s*=\s*)?"([^"]+)"/)?.[1]||mapping)).size,0);
  const advertised = Number(informationPages.api.match(/<dt>(\d+)<\/dt><dd>public GET routes/)[1]);
  assert.equal(count,31);
  assert.equal(advertised,count);
});

test('API explorer boot creates bounded paths without any startup read', () => {
  let fetches=0;
  const page=informationPage(async()=>{fetches++;}, '/dashboard-experimental/api.html',[],true);
  assert.equal(fetches,0);
  assert.equal(page.nodes.get('apiRequestPath').textContent,'/dashboard-experimental-api/traffic/latest?corridor=I25&preferUsable=true');
  page.nodes.get('apiPreset').value='history'; page.nodes.get('apiCorridor').value='I70';
  page.nodes.get('apiPreset').events.change();
  assert.equal(page.nodes.get('apiRequestPath').textContent,'/dashboard-experimental-api/traffic/history?corridor=I70&windowMinutes=120&limit=12&includeIncidents=false');
  page.nodes.get('apiPreset').value='status'; page.nodes.get('apiPreset').events.change();
  assert.equal(page.nodes.get('apiCorridor').disabled,true);
  assert.equal(page.run('apiExplorerPath()'),'/dashboard-experimental-api/system/operational-status');
  page.nodes.get('apiPreset').value='constructor'; page.nodes.get('apiCorridor').value='I70&limit=9000';
  assert.equal(page.run('apiExplorerPath()'),'/dashboard-experimental-api/traffic/latest?corridor=I25&preferUsable=true');
});

test('API integration recipe uses the real bounded history preset without sending a read until Run', () => {
  for(const prefix of ['/dashboard','/dashboard-experimental']) {
    let fetches=0;
    const page=informationPage(async()=>{fetches++;},prefix+'/api.html',[],true);
    const base=prefix==='/dashboard' ? '/dashboard-api' : '/dashboard-experimental-api';
    const request=base+'/traffic/history?corridor=I70&windowMinutes=120&limit=12&includeIncidents=false';
    assert.equal(page.nodes.get('apiRecipePath').textContent,request);
    page.nodes.get('apiPreset').value='status';page.nodes.get('apiPreset').events.change();
    page.nodes.get('apiHistoryRecipe').events.click();
    assert.equal(page.nodes.get('apiPreset').value,'history');
    assert.equal(page.nodes.get('apiCorridor').value,'I70');
    assert.equal(page.nodes.get('apiCorridor').disabled,false);
    assert.equal(page.nodes.get('apiRequestPath').textContent,request);
    assert.equal(fetches,0);
  }
  assert.doesNotMatch(informationPages.api,/api-route-composer|Build the route/);
  for(const field of ['samples[].polledAt','samples[].avgCurrentSpeed','returned']) {
    assert.ok(informationPages.api.includes('<code>'+field+'</code>'));
  }
  assert.match(informationPages.api,/Up to 12 samples—not necessarily the full window/);
});

test('API explorer limits responses and displays the real read ceiling including zero remaining', async () => {
  let options;
  const page=informationPage(async(p,o)=>{options=o; return {ok:true,status:200,headers:{get:n=>({'content-type':'application/json','x-ratelimit-remaining':'0','x-ratelimit-limit':'120'}[n]??null)},json:async()=>({text:'x'.repeat(19000)})};},'/dashboard/api.html');
  page.run("informationElements.apiResponseBody.closest=()=>informationElements.apiExplorerForm");
  await page.run('runApiExplorerRequest()');
  assert.ok(options.signal instanceof AbortSignal);
  assert.match(page.nodes.get('apiResponseMeta').textContent,/0 \/ 120 reads remain/);
  assert.equal(page.nodes.get('apiResponseState').textContent,'200 OK');
  assert.equal(page.nodes.get('apiRun').disabled,false);
  assert.match(page.nodes.get('apiResponseBody').textContent,/response shortened/);
  assert.ok(page.nodes.get('apiResponseBody').textContent.length<18100);
  assert.equal(page.run('apiResponseText(undefined)'),'');
  assert.equal(page.run('apiResponseText("<script>bad()</script>")'),'<script>bad()</script>');
});

test('API explorer blocks overlapping requests and recovers from timeout and HTTP429', async () => {
  let release,fetches=0;
  const page=informationPage(()=>{fetches++;return new Promise(resolve=>release=resolve);},'/dashboard/api.html');
  page.run("informationElements.apiResponseBody.closest=()=>informationElements.apiExplorerForm");
  const first=page.run('runApiExplorerRequest()');
  await page.run('runApiExplorerRequest()'); assert.equal(fetches,1);
  release({ok:false,status:429,headers:{get:n=>n==='content-type'?'application/json':n==='retry-after'?'60':null},json:async()=>({error:'rate_limited'})});
  await first;
  assert.equal(page.nodes.get('apiResponseState').textContent,'HTTP 429');
  assert.match(page.nodes.get('apiResponseMeta').textContent,/Retry-After: 60/);
  page.context.window.fetch=async()=>{throw Object.assign(new Error('Read timed out'),{name:'TimeoutError'});};
  await page.run('runApiExplorerRequest()');
  assert.equal(page.nodes.get('apiResponseState').textContent,'Timed out');
  assert.match(page.nodes.get('apiResponseMeta').textContent,/eight-second.*retry/);
  assert.equal(page.nodes.get('apiRun').disabled,false);
});

test('data decorative card headings do not become nested keyboard stops', () => {
  const html=informationPages.data;
  const cards=[...html.matchAll(/<([a-z]+) class="[^"]*modular-panel[^\"]*"[^>]*>/g)];
  assert.equal(cards.length,14);
  assert.ok(cards.every(match=>match[1]==='article'&&match[0].includes('tabindex="0"')));
  assert.doesNotMatch(html, /class="[^"]*modular-panel derived-card-title/);
});

test('zone travel estimates retain each page numeric input rules', () => {
  const d = dashboard();
  const page = informationPage(undefined, '/dashboard/data.html');
  for (const marker of [false, ' ']) {
    const zones = [{startMileMarker:marker,endMileMarker:1,avgCurrentSpeed:60}];
    d.context.zones = zones;
    page.context.zones = zones;
    assert.equal(d.run('estimateSpeedZoneTravelMinutes(zones,1)'), 1);
    assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes(zones,1)')));
  }
  const zones = [{startMileMarker:'0',endMileMarker:'1',avgCurrentSpeed:'60'}];
  d.context.zones = zones;
  page.context.zones = zones;
  assert.equal(d.run('estimateSpeedZoneTravelMinutes(zones,1)'), 1);
  assert.equal(page.run('estimateZoneTravelMinutes(zones,1)'), 1);
});

test('data loads shared estimates before initialization while other information pages remain independent', () => {
  const sharedScript = informationPages.data.indexOf('src="traffic-estimates.js?');
  assert.ok(sharedScript >= 0 && sharedScript < informationPages.data.indexOf('src="information-pages.js?'));
  for (const page of ['system', 'api']) {
    const fixture = informationPage(undefined, `/dashboard/${page}.html`, [], true);
    assert.equal(fixture.context.window.TrafficEstimates, undefined);
  }
});

test('data daily estimates require complete contiguous positive-speed zone coverage', () => {
  const page = informationPage(undefined, '/dashboard/data.html');
  page.context.points = [
    {startMileMarker:208,endMileMarker:230,avgCurrentSpeed:55},
    {startMileMarker:230,endMileMarker:271,avgCurrentSpeed:70}
  ];
  assert.equal(page.run('estimateZoneTravelMinutes(points,63)'), (22/55+41/70)*60);
  page.context.points[1].startMileMarker = 231;
  assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes(points,63)')));
  page.context.points[1].startMileMarker = 229;
  assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes(points,63)')));
  page.context.points[1].startMileMarker = 230;
  page.context.points[1].avgCurrentSpeed = 0;
  assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes(points,63)')));
  for (const invalid of [null, undefined, '', ' ', false]) {
    page.context.points = [{startMileMarker:invalid,endMileMarker:63,avgCurrentSpeed:60}];
    assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes(points,63)')));
  }
  assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes([],NaN)')));
});

test('data daily range excludes incomplete days, earlier Denver days and future buckets', () => {
  const page = informationPage(undefined, '/dashboard/data.html');
  page.context.points = [
    {bucketStart:'2026-10-07T05:45:00Z',startMileMarker:208,endMileMarker:271,avgCurrentSpeed:5},
    {bucketStart:'2026-10-07T06:00:00Z',startMileMarker:208,endMileMarker:271,avgCurrentSpeed:63},
    {bucketStart:'2026-10-07T08:00:00Z',startMileMarker:208,endMileMarker:271,avgCurrentSpeed:42},
    {bucketStart:'2026-10-07T09:00:00Z',startMileMarker:208,endMileMarker:230,avgCurrentSpeed:5},
    {bucketStart:'2026-10-07T11:00:00Z',startMileMarker:208,endMileMarker:271,avgCurrentSpeed:2}
  ];
  const range = page.run('retainedDailyTravelRange(points,63,"2026-10-07T10:00:00Z")');
  assert.equal(range.fastest,60);
  assert.equal(range.slowest,90);
  assert.ok(Number.isNaN(page.run('retainedDailyTravelRange(points,63,"invalid").fastest')));
});

test('data daily reads use the matching retained mount and label each corridor date', async () => {
  const calls=[];
  const page=informationPage(async (url,options)=>{
    calls.push({url,options});
    const i25=url.includes('corridor=I25');
    const date=i25?'2026-10-07T10:00:00Z':'2026-10-06T10:00:00Z';
    return {ok:true,json:async()=>url.includes('/summary?')?{latest:{polledAt:date}}:{points:[
      {bucketStart:date,startMileMarker:i25?208:206,endMileMarker:i25?271:274,avgCurrentSpeed:60}
    ]}};
  },'/dashboard-experimental/data.html');
  await page.run('initializeDataDailyRange()');
  assert.equal(calls.length,4);
  assert.ok(calls.every(({url,options})=>url.startsWith('/dashboard-experimental-api/traffic/')&&options.signal));
  for(const corridor of ['I25','I70']) {
    const reads=calls.filter(({url})=>url.includes(`corridor=${corridor}`));
    assert.equal(reads[0].options.signal,reads[1].options.signal);
  }
  assert.ok(calls.some(({url})=>url.includes('asOf=2026-10-06T10%3A00%3A00Z')));
  assert.equal(page.nodes.get('i25DailyFastest').textContent,'63 min');
  assert.equal(page.nodes.get('i70DailyFastest').textContent,'68 min');
  assert.match(page.nodes.get('dailyRangeStatus').textContent,/I-25 · Oct 7, 2026 \/ I-70 · Oct 6, 2026/);
});

test('a data daily partial failure preserves the other range and offers a retry', async () => {
  const page=informationPage(async url=>{
    if(url.includes('corridor=I70')) throw new Error('offline');
    return {ok:true,json:async()=>url.includes('/summary?')?{latest:{polledAt:'2026-10-07T10:00:00Z'}}:{points:[
      {bucketStart:'2026-10-07T10:00:00Z',startMileMarker:208,endMileMarker:271,avgCurrentSpeed:63}
    ]}};
  },'/dashboard/data.html');
  await page.run('initializeDataDailyRange()');
  assert.equal(page.nodes.get('i25DailyFastest').textContent,'60 min');
  assert.equal(page.nodes.get('i70DailyFastest').textContent,'Unavailable');
  assert.match(page.nodes.get('dailyRangeStatus').textContent,/I-70 · retained data could not be loaded/);
  assert.match(page.nodes.get('dailyRangeStatus').textContent,/Refresh this page to retry/);
  assert.doesNotMatch(page.nodes.get('dailyRangeStatus').textContent,/out of service/i);
});

test('data daily reads share an eight-second deadline per corridor and settle after timeout', async () => {
  const requests=[];
  const controllers=[];
  const page=informationPage((url,options)=>{
    requests.push({url,signal:options.signal});
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  },'/dashboard/data.html');
  page.context.AbortSignal={timeout(ms){assert.equal(ms,8000);const controller=new AbortController();controllers.push(controller);return controller.signal;}};
  const pending=page.run('initializeDataDailyRange()');
  const timeout=new Error('Deadline exceeded');timeout.name='TimeoutError';
  controllers.forEach(controller=>controller.abort(timeout));
  await pending;
  assert.equal(requests.length,2);
  assert.match(page.nodes.get('dailyRangeStatus').textContent,/I-25 · request timed out \/ I-70 · request timed out/);
  assert.match(page.nodes.get('dailyRangeStatus').textContent,/Refresh this page to retry/);
});

test('invalid data observation time avoids an unanchored trend read', async () => {
  const requests=[];
  const page=informationPage(async url=>{
    requests.push(url);return {ok:true,json:async()=>({latest:{polledAt:'invalid'}})};
  },'/dashboard/data.html');
  await page.run('initializeDataDailyRange()');
  assert.equal(requests.length,2);
  assert.ok(requests.every(url=>url.includes('/summary?')));
  assert.equal(page.nodes.get('i25DailyFastest').textContent,'Unavailable');
});

test('a complete data page boot initializes its retained ranges without System reads', async () => {
  const reads=[];
  const page=informationPage(async url=>{
    reads.push(url);const i25=url.includes('corridor=I25');
    return {ok:true,json:async()=>url.includes('/summary?')?{latest:{polledAt:'2026-10-07T10:00:00Z'}}:{points:[
      {bucketStart:'2026-10-07T10:00:00Z',startMileMarker:i25?208:206,endMileMarker:i25?271:274,avgCurrentSpeed:60}
    ]}};
  },'/dashboard/data.html',[],true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads.length,4);
  assert.ok(reads.every(url=>url.startsWith('/dashboard-api/traffic/')));
  assert.equal(page.nodes.get('i25DailyFastest').textContent,'63 min');
  assert.equal(page.nodes.get('i70DailyFastest').textContent,'68 min');
});

test('information styles remain structurally valid across declarations, comments and strings', () => {
  const stack=[];
  let quote='',comment=false,line=1;
  for(let i=0;i<informationStyles.length;i++){
    const character=informationStyles[i];
    if(character==='\n')line++;
    if(comment){if(character==='*'&&informationStyles[i+1]==='/'){comment=false;i++;}continue;}
    if(quote){if(character==='\\'){i++;continue;}if(character===quote)quote='';continue;}
    if(character==='/'&&informationStyles[i+1]==='*'){comment=true;i++;continue;}
    if(character==='"'||character==="'"){quote=character;continue;}
    if(character==='{')stack.push(line);
    if(character==='}'){
      assert.ok(stack.length,`Unmatched CSS closing block at line ${line}`);
      stack.pop();
    }
  }
  assert.equal(comment,false,'Unterminated CSS comment');
  assert.equal(quote,'','Unterminated CSS string');
  assert.deepEqual(stack,[],'Unterminated CSS blocks');
  assert.match(informationStyles,/\.ingest-node\s*\{[^}]*padding:[^}]*border-top:/s);
});

test('System retains its five technical documentation destinations after the architecture',()=>{
  const system=informationPages.system;
  const navigation=system.match(/<nav class="architecture-doc-links"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation);
  assert.ok(system.indexOf('architecture-doc-links')>system.indexOf('id="trafficDashboard"'));
  for(const filename of ['corridor-geometry-sources.md','corridor-traffic-map-plan.md',
    'incident-event-operations.md','data-history-coverage.md']){
    assert.ok(navigation.includes('/docs/'+filename));
    assert.ok(readFileSync(path.join(testDirectory,'../../docs',filename),'utf8').length>0);
  }
  assert.ok(navigation.includes('href="api.html"'));
  assert.equal((navigation.match(/<a /g)||[]).length,5);
});

test('Data and API fact typography and desktop spacing use the same design scale',()=>{
  const declaration=selector=>{
    const rule=[...informationStyles.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
      .find(([,selectors])=>selectors.split(',').some(value=>value.trim()==='.'+selector));
    assert.ok(rule,selector); return rule[2];
  };
  for(const property of ['font-family','font-size','font-weight','letter-spacing','line-height']){
    const value=body=>body.match(new RegExp(property+':\\s*([^;]+)'))?.[1];
    assert.equal(value(declaration('data-hero-facts dt')),value(declaration('api-hero-facts dt')),property);
  }
  assert.match(informationStyles,/\.api-shell\s*\{[^}]*calc\(100% - 32px\)[^}]*clamp\(24px, 4vw, 48px\)/s);
  assert.match(informationStyles,/\.api-section, \.api-explorer\s*\{[^}]*clamp\(52px, 7vw, 92px\)/s);
  const versions=Object.values(informationPages).map(page=>page.match(/information\.css\?v=([^"\s]+)/)[1]);
  assert.equal(new Set(versions).size,1);
});

test('external dashboard links open separately while internal navigation stays in the page',()=>{
  const sources=[['index.html',indexSource],...Object.entries(informationPages),
    ...['corridor-map.js','data-hero-map.js'].map(name=>[name,readFileSync(path.join(testDirectory,
      '../../api-service/src/main/resources/static/dashboard',name),'utf8')])];
  let outgoing=0,internal=0;
  for(const [name,source] of sources) for(const [anchor] of source.matchAll(/<a\b[^>]*>/g)){
    const attribute=key=>anchor.match(new RegExp('\\b'+key+'="([^"]*)"'))?.[1];
    const href=attribute('href');
    if(!href) continue;
    const url=new URL(href,'https://dashboard.test/dashboard-experimental/');
    if(url.origin!=='https://dashboard.test'){
      outgoing++;
      assert.equal(attribute('target'),'_blank',`${name}: ${href}`);
      assert.ok((attribute('rel')||'').split(/\s+/).includes('noopener'),`${name}: ${href}`);
    }else{
      internal++;
      assert.equal(attribute('target'),undefined,`${name}: internal navigation must stay in the current tab`);
    }
  }
  assert.ok(outgoing>0&&internal>0);
});

test('observation desk retains metric meanings and decorative receipts stay separate',()=>{
  const section=indexSource.slice(indexSource.indexOf('<div class="pipeline-summary"'),indexSource.indexOf('<section id="under-the-hood"'));
  assert.match(section,/across live and archive tables; not all database tables/);
  assert.doesNotMatch(section,/Samples · Window|Last Usable Sample/);
  assert.equal([...section.matchAll(/data-observation-number/g)].length,1);
  assert.match(section,/Samples in View/);assert.match(section,/History Preserved/);
  assert.match(section,/class="pipeline-mail-slot" aria-hidden="true"/);
  assert.equal([...section.matchAll(/class="pipeline-paper-stack" aria-hidden="true"/g)].length,2);
  const style=readFileSync(path.join(testDirectory,'../../api-service/src/main/resources/static/dashboard/health-panel.css'),'utf8');
  assert.match(style,/\.pipeline-counter-active \.pipeline-mail-slot i \{[^}]*animation: health-store-record/);
  assert.match(style,/\.pipeline-counter-active \.pipeline-paper-stack \{[^}]*animation: pipeline-drawer-sort/);
  assert.match(style,/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.pipeline-paper-stack i[\s\S]*animation: none !important/);
  assert.doesNotMatch(style,/infinite/);
});

test('visible sample count follows corridors, historical bounds and zones without requesting data',()=>{
  const d=dashboard();
  d.run(`state.selectedHours=2;const end=Date.parse('2026-06-18T02:00:00Z');
    chartEndTime=()=>end;
    const points=[{timestamp:end-3*3600000,speed:50},{timestamp:end-3600000,speed:60},
      {timestamp:end,speed:70},{timestamp:end,speed:70,isBoundary:true},{timestamp:end+1,speed:70},{timestamp:end,speed:NaN}];
    chartRouteData=()=>({continuousSamples:points,layoutGroups:[{samples:points},{samples:points.slice(1,2)}]});
    renderPipelineViewSamples()`);
  assert.equal(d.nodes.get('pipelineViewSamples').textContent,'4');
  d.run("state.focusedCorridor='I70';renderPipelineViewSamples()");
  assert.equal(d.nodes.get('pipelineViewSamples').textContent,'2');
  d.run("state.chartView='zones';renderPipelineViewSamples()");
  assert.equal(d.nodes.get('pipelineViewSamples').textContent,'3');
  d.run('chartRouteData=()=>null;renderPipelineViewSamples()');
  assert.equal(d.nodes.get('pipelineViewSamples').textContent,'—');
  d.run('chartRouteData=()=>({layoutGroups:[]});renderPipelineViewSamples()');
  assert.equal(d.nodes.get('pipelineViewSamples').textContent,'0');assert.equal(d.network.length,0);
});

test('moving graphs defer sample recounting until their final visible window',()=>{
  const d=dashboard();d.run("document.getElementById('pipelineViewSamples').textContent='12'");
  d.run('window.ContinuousHistory={moving:true};chartRouteData=()=>{throw new Error("No per-frame counting")};renderPipelineViewSamples()');
  assert.equal(d.nodes.get('pipelineViewSamples').textContent,'12');
  d.run('window.ContinuousHistory.moving=false;chartRouteData=()=>({chartUnavailable:true});renderPipelineViewSamples()');
  assert.equal(d.nodes.get('pipelineViewSamples').textContent,'—');
});

test('only database metadata feeds stored counters, including version hints but not chart windows',()=>{
  const d=dashboard();
  d.run('window.counterReads=[];window.StoredObservations={receive(section,previous){window.counterReads.push({section,previous})}}');
  d.run("acceptDashboardSections({'/traffic/database/observations?':{status:200,version:'db1',data:{total:10}}})");
  d.run("acceptDashboardSections({'/traffic/database/observations?':{status:200,version:'db1'}})");
  assert.equal(d.run('window.counterReads.length'),2);
  assert.equal(d.run('window.counterReads[1].previous.data.total'),10);
  d.run("acceptDashboardSections({'/traffic/database/observations?':{status:200,version:'db2',data:{total:20}}},true)");
  d.run('renderSystemHealth();renderSystemHealth()');
  assert.equal(d.run('window.counterReads.length'),2);
  d.run("acceptDashboardSections({'/traffic/database/observations?':{status:503}})");
  assert.equal(d.run('window.counterReads[2].section.status'),503);
});

test('cached rendering and historical reads never report a new live snapshot response',async()=>{
  const d=dashboard(async()=>({ok:true,json:async()=>({})}));
  d.run('window.activity=[];window.HealthMonitor={receive(){window.activity.push(true)},setRetained(){},windowCounts(){}};renderSystemHealth();renderSystemHealth()');
  assert.equal(d.run('window.activity.length'),0);
  await d.run('readDashboardBatch(dashboardApi("/traffic/dashboard/snapshot?ranges=24&selectedHours=24&historical=false"))');
  assert.equal(d.run('window.activity.length'),1);
  await d.run('readDashboardBatch(dashboardApi("/traffic/dashboard/history?hours=2&asOf=2026-10-14T21%3A00%3A00Z&corridors=I25"))');
  assert.equal(d.run('window.activity.length'),1);
});

test('all dashboard pages use fresh consistent release keys for existing application assets', () => {
  const expectedVersions = {
    'corridor-map-style.js': 'map-style-1',
    'corridor-map-data.js': 'map-data-1',
    'dashboard-chart-painter.js': 'chart-painter-1',
    'dashboard-chart-axis.js': 'chart-axis-1',
    'corridor-map.js': 'map-style-1',
    'dashboard-continuous.js': 'chart-painter-1',
    'dashboard-history.js': 'chart-axis-1',
    'dashboard-incident-model.js': 'incident-model-1',
    'dashboard-series.js': 'chart-series-1',
    'dashboard-snapshots.js': 'snapshot-assembly-1',
    'dashboard-transport.js': 'request-coordination-1',
    'dashboard-window-summary.js': 'historical-card-parallel-1',
    'dashboard.css': 'interaction-style-groups-1',
    'dashboard.js': 'chart-painter-1',
    'data-hero-map.js': 'dashboard-incident-scroll-preview-1',
    'flow-diagram.css': 'under-hood-responsive-1',
    'flow-diagram.js': 'under-hood-cross-bar-2',
    'health-panel.css': 'pipeline-variety-1',
    'health-panel.js': 'stored-observations-1',
    'incident-types.js': 'floyd-hill-glare-1',
    'information-pages.js': 'shared-information-icons-1',
    'information.css': 'system-style-groups-1',
    'stored-observations.js': 'pipeline-variety-1',
    'traffic-estimates.js': 'shared-zone-estimates-1',
    'variable-speed-signs.js': 'last-reported-signs-1',
  };
  const references = new Map();
  for (const page of [indexSource, ...Object.values(informationPages)]) {
    for (const [,filename,version] of page.matchAll(/(?:src|href)="([^"?]+\.(?:css|js))\?v=([^"\s]+)"/g)) {
      assert.ok(!filename.startsWith('vendor/'));
      assert.equal(version, expectedVersions[filename], filename);
      assert.equal(references.get(filename) || version, version, filename);
      references.set(filename, version);
      assert.ok(readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard', filename)).length > 0);
    }
  }
  assert.deepEqual([...references.keys()].sort(), Object.keys(expectedVersions).sort());
  assert.match(indexSource, /vendor\/maplibre-gl\/6\.10\.0\/maplibre-gl\.css"/);
});

test('System sections remain deep-linkable without the obsolete progress bar', () => {
  assert.doesNotMatch(informationPages.system, /System page sections|systemPageRoute|system-page-route/);
  assert.doesNotMatch(informationSource, /systemPageRoute|initializeSystemPageRoute|system-route-progress/);
  assert.doesNotMatch(informationStyles, /system-page-route|system-route-progress/);
  for (const id of ['systemIntro', 'systemDataPath', 'systemDecisions', 'systemOperations', 'systemChecks', 'systemHealth']) {
    assert.ok(informationPages.system.includes('id="' + id + '"'));
  }
});

test('system page describes the implemented architecture without overstating it', () => {
  const system = informationPages.system;
  assert.match(system, /131 mi<\/strong><span>of monitored highway/);
  assert.match(system, /0\.5 mi<\/strong><span>stable road sections/);
  assert.match(system, /Routes Service/);
  assert.match(system, /Traffic speeds/);
  assert.match(system, /Road incidents/);
  assert.match(system, /An incident keeps its history across updates/);
  assert.match(system, /A failed or incomplete update does not replace the last complete report/);
  assert.match(system, /PostgreSQL \/ TimescaleDB/);
  assert.match(system, /Short local trends/);
  assert.match(system, /Fast answers, backed by retained history/);
  assert.match(system, /The dashboard and public API share one service but use separate routes/);
  assert.match(system, /Four isolated containers with explicit health checks/);
  assert.match(system, /The dashboard is served by the API container/);
  assert.doesNotMatch(system, /machine.learning/i);
  assert.doesNotMatch(system, /Kafka/);
});

test('system detail rows use consistent sentence capitalization without pipeline emphasis', () => {
  const system = informationPages.system;
  for (const group of ['persistence-groups', 'api-capabilities']) {
    const content = system.match(new RegExp(`<div class="${group}">([\\s\\S]*?)<\\/div>`))[1];
    for (const paragraph of content.matchAll(/<p>(.*?)<\/p>/g)) {
      for (const row of paragraph[1].split('<br>')) assert.match(row, /^[A-Z]/);
    }
  }
  const control = system.match(/<aside class="provider-control"[\s\S]*?<ul>([\s\S]*?)<\/ul>/)[1];
  for (const item of control.matchAll(/<li>(.*?)<\/li>/g)) assert.match(item[1], /^[A-Z]/);
  const steps = system.match(/<section class="pipeline-card flow-pipeline"[\s\S]*?<\/section>/)[0];
  assert.equal([...steps.matchAll(/<li>/g)].length, 5);
  assert.doesNotMatch(steps, /pipeline-emphasis|<strong>/);
  assert.match(steps, /Project speeds onto the monitored roadway/);
  assert.doesNotMatch(steps, /direction/i);
  const checks = system.match(/<div class="operations-coverage">([\s\S]*?)<\/div>/)[1];
  assert.equal([...checks.matchAll(/<li>/g)].length, 8);
  for (const item of checks.matchAll(/<li>(.*?)<\/li>/g)) assert.match(item[1], /^[A-Z]/);
});

test('system hero underline replays when the heading returns to view', () => {
  const page = informationPage();
  page.run(`
    window.IntersectionObserver = class {
      constructor(callback, options) {
        window.heroObserverCallback = callback;
        window.heroObserverOptions = options;
      }
      observe(target) { window.heroObserved = target; }
    };
    initializeSystemHero();
  `);
  assert.equal(page.run('window.heroObserverOptions.threshold'), 0.18);
  assert.equal(page.run('window.heroObserved === informationElements.systemHero'), true);
  page.run('window.heroObserverCallback([{ target: informationElements.systemHero, isIntersecting: true }])');
  assert.equal(page.nodes.get('systemIntro').classList.contains('is-visible'), true);
  page.run('window.heroObserverCallback([{ target: informationElements.systemHero, isIntersecting: false }])');
  assert.equal(page.nodes.get('systemIntro').classList.contains('is-visible'), false);
});

test('hero resize and font changes share one pending geometry update', () => {
  const page = informationPage();
  page.run(`
    let geometryUpdates = 0;
    let fontReady;
    let fontChanged;
    const frames = [];
    const listeners = {};
    positionSystemHeroSignal = () => { geometryUpdates++; };
    window.requestAnimationFrame = callback => frames.push(callback);
    window.addEventListener = (name, callback) => { listeners[name] = callback; };
    document.fonts = {
      ready: { then(callback) { fontReady = callback; } },
      addEventListener(name, callback) { fontChanged = callback; }
    };
    initializeSystemHero();
    listeners.resize();
    listeners.resize();
    fontReady();
    fontChanged();
  `);
  assert.equal(page.run('frames.length'), 1);
  assert.equal(page.run('geometryUpdates'), 0);
  page.run('frames.shift()();');
  assert.equal(page.run('geometryUpdates'), 1);
  assert.equal(page.nodes.get('systemIntro').classList.contains('is-visible'), true);
  page.run('listeners.resize(); frames.shift()();');
  assert.equal(page.run('geometryUpdates'), 2);
});

test('hero underline follows wrapped words and reads geometry before mutating lines', () => {
  const page = informationPage();
  page.run(`
    let writes = 0;
    const lines = [];
    const lineNode = () => ({
      hidden: false,
      values: {},
      setAttribute() {},
      style: { setProperty(key, value) { this[key] = value; writes++; } }
    });
    document.createElement = lineNode;
    informationElements.systemHero.style = { setProperty() { writes++; } };
    informationElements.systemHeroTitle.getBoundingClientRect = () => ({ left: 100, top: 40 });
    informationElements.systemHeroTitle.querySelectorAll = () => lines;
    informationElements.systemHeroTitle.appendChild = line => { lines.push(line); writes++; };
    informationElements.systemHeroSource.getClientRects = () => [{left: 100,right: 300,bottom: 80}];
    informationElements.systemHeroTarget.getClientRects = () => [{left: 350,right: 500,bottom: 80}];
    let wordRects = [
      {left: 350,right: 440,top: 50,bottom: 80},
      {left: 450,right: 500,top: 50,bottom: 80},
      {left: 100,right: 220,top: 90,bottom: 120}
    ];
    informationElements.systemHeroTarget.querySelectorAll = () => wordRects.map(rect => ({getBoundingClientRect: () => rect}));
    informationElements.systemHeroSignal.getBoundingClientRect = () => {
      if (writes) throw new Error('Geometry read after layout mutation');
      return {width: 10};
    };
    positionSystemHeroSignal(informationElements.systemHero);
  `);
  assert.equal(page.run('lines.length'), 2);
  assert.equal(page.run('lines[0].style["--system-highlight-width"]'), '150px');
  assert.equal(page.run('lines[1].style["--system-highlight-width"]'), '120px');
  assert.equal(page.run('lines[1].style["--system-highlight-top"]'), '80px');
  page.run(`
    writes = 0;
    wordRects = [{left: 350,right: 600,top: 50,bottom: 80}];
    positionSystemHeroSignal(informationElements.systemHero);
  `);
  assert.equal(page.run('lines.length'), 2);
  assert.equal(page.run('lines[1].hidden'), true);
});

test('system architecture focus traces only the selected panel, not every shared flow', () => {
  function item(flow, focusable = false) {
    const classes = new Set();
    return { dataset: { architectureFlow: flow }, tabIndex: focusable ? 0 : undefined, events: {},
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        toggle(name, force) { force === false ? classes.delete(name) : classes.add(name); },
        contains(name) { return classes.has(name); }
      },
      addEventListener(name, handler) { this.events[name] = handler; },
      matches(selector) { return selector === '[tabindex]' && this.tabIndex !== undefined; } };
  }
  const trafficPipeline = item('flow storage delivery', true);
  const database = item('flow incident storage delivery', true);
  const incidentPipeline = item('incident storage delivery', true);
  const containingPanel = item('flow incident', true);
  containingPanel.contains = source => source === trafficPipeline;
  const page = informationPage(undefined, '/dashboard/system.html', [trafficPipeline, database, incidentPipeline, containingPanel]);
  page.run('initializeArchitectureHighlights()');

  trafficPipeline.events.focus();
  assert.equal(page.nodes.get('systemArchitecture').classList.contains('has-active-flow'), true);
  assert.equal(trafficPipeline.classList.contains('is-related'), true);
  assert.equal(containingPanel.classList.contains('is-related'), true);
  assert.equal(database.classList.contains('is-related'), false);
  assert.equal(incidentPipeline.classList.contains('is-related'), false);
  assert.equal(incidentPipeline.classList.contains('is-muted'), false);
  trafficPipeline.events.pointerleave({relatedTarget:{closest(){return containingPanel;}}});
  assert.equal(trafficPipeline.classList.contains('is-related'), false);
  assert.equal(containingPanel.classList.contains('is-related'), true);

  trafficPipeline.events.blur();
  assert.equal(page.nodes.get('systemArchitecture').classList.contains('has-active-flow'), false);
  assert.equal(database.classList.contains('is-related'), false);
});

test('system status uses the matching production or experimental API prefix', () => {
  const production = informationPage();
  const experimental = informationPage(undefined, '/dashboard-experimental/system.html');
  assert.equal(production.run("informationRuntime(window.location.pathname).apiBase"), '/dashboard-api');
  assert.equal(experimental.run("informationRuntime(window.location.pathname).apiBase"), '/dashboard-experimental-api');
});

test('system status presents degraded reasons and a concrete next action', () => {
  const page = informationPage();
  page.context.status = {
    status: 'DEGRADED',
    checkedAt: '2026-09-26T15:30:00Z',
    summary: 'One check needs attention.',
    checks: [{ component: 'flow:I25', status: 'DEGRADED', code: 'FLOW_SAMPLE_STALE',
      message: 'The latest usable I25 flow sample is 75 minutes old.', ageMinutes: 75,
      thresholdMinutes: 60, suggestedAction: 'Check the ingest scheduler.' }]
  };
  page.run('renderOperationalStatus(status)');
  assert.equal(page.nodes.get('systemOverview').dataset.status, 'DEGRADED');
  assert.equal(page.nodes.get('systemSummary').textContent, 'One check needs attention.');
  assert.equal(page.nodes.get('systemStatusTitle').textContent, 'Some traffic information may be delayed');
  assert.equal(page.nodes.get('statusCheckCount').textContent, '0 / 1 clear');
  assert.equal(page.nodes.get('statusDetailCount').textContent, '1 check needs attention');
  assert.equal(page.nodes.get('statusSignalGrid').children[0].children[0].textContent, 'I-25 flow');
  assert.equal(page.nodes.get('statusSignalGrid').children[0].children[1].textContent, '1 hr old');
  const card = page.nodes.get('operationalChecks').children[0];
  assert.equal(card.dataset.status, 'DEGRADED');
  assert.equal(card.children[1].textContent, 'The latest usable I25 flow sample is 75 minutes old.');
  assert.equal(card.children[2].textContent, 'flow sample stale · 75 min old · 60 min threshold');
  assert.equal(card.children[3].children[1].textContent, 'Check the ingest scheduler.');
});

test('a failed status request is not mislabeled as a traffic outage', () => {
  const page = informationPage();
  page.context.failure = new Error('HTTP 503');
  page.run('renderStatusUnavailable(failure)');
  assert.equal(page.nodes.get('systemOverview').dataset.status, 'UNAVAILABLE');
  assert.match(page.nodes.get('systemSummary').textContent, /does not by itself mean traffic ingestion is down/);
  assert.match(page.nodes.get('operationalChecks').children[0].textContent, /HTTP 503/);
});
