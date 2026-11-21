const { test } = require('node:test');
const { dashboard, assert, readFileSync, path, indexSource, vm } = require('../fixtures/core.cjs');
const { healthActivityFixture, informationPage, heartbeatLifecycleFixture } = require('../fixtures/information.cjs');
const { testDirectory } = require('../fixtures/core.cjs');

test('health monitor signals follow the existing check results, not retained traffic or partial success',()=>{
  const d=dashboard();
  const ids=['routesServiceStatus','ingestServiceStatus','apiServiceStatus','databaseStatus'];
  d.run('state.health={apiUp:true,routesUp:true,databaseUp:true,operational:{status:"HEALTHY"}};renderSystemHealth()');
  for(const id of ids)assert.equal(d.nodes.get(id).dataset.healthState,'healthy');
  assert.equal(d.nodes.get('systemHeadline').dataset.healthState,'healthy');
  d.run('state.health.operational.status="DEGRADED";renderSystemHealth()');
  assert.equal(d.nodes.get('ingestServiceStatus').dataset.healthState,'attention');
  assert.equal(d.nodes.get('systemHeadline').dataset.healthState,'attention');
  assert.equal(d.nodes.get('apiServiceStatus').dataset.healthState,'healthy');
  d.run('state.health={};renderSystemHealth()');
  for(const id of ids)assert.equal(d.nodes.get(id).dataset.healthState,'attention');
  const retained=dashboard(undefined,'?historical=1','/dashboard/',true);
  retained.run('state.health={apiUp:true,routesUp:true,databaseUp:true,operational:{status:"HEALTHY"}};renderSystemHealth()');
  assert.equal(retained.nodes.get('ingestServiceStatus').dataset.healthState,'attention');
  assert.equal(retained.nodes.get('ingestServiceStatus').textContent,'Off for replay');
});

test('the illustrated health scopes stay readable without motion and never add background requests',()=>{
  const style=readFileSync(path.join(testDirectory,'../../api-service/src/main/resources/static/dashboard/health-panel.css'),'utf8');
  const source=readFileSync(path.join(testDirectory,'../../api-service/src/main/resources/static/dashboard/health-panel.js'),'utf8');
  const section=indexSource.slice(indexSource.indexOf('<section id="system-health"'),indexSource.indexOf('<section id="under-the-hood"'));
  assert.match(section,/Live reactions · Existing reads/);
  assert.equal([...section.matchAll(/class="health-trace"/g)].length,4);
  assert.equal([...section.matchAll(/data-health-state="checking"/g)].length,5);
  assert.match(style,/\.health-event-active \.health-packet \{[^}]*animation: health-packet-arrive 1\.8s/);
  assert.doesNotMatch(style,/infinite|health-heartbeat|health-trace-sweep/,'no constantly repeating health motion');
  assert.match(style,/@container health-panel \(max-width: 28rem\)/);
  assert.match(style,/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
  assert.doesNotMatch(source,/fetch\(|setInterval\(|setTimeout\(|requestAnimationFrame\(/);
  const classes=new Set(),root={querySelectorAll:()=>[],classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}}};
  let observer;
  const document={hidden:false,events:{},querySelectorAll:()=>[root],addEventListener(name,callback){this.events[name]=callback;}};
  const window={events:{},addEventListener(name,callback){this.events[name]=callback;},IntersectionObserver:class{
    constructor(callback){observer=this;this.callback=callback;}observe(){}disconnect(){this.disconnected=true;}
  }};
  vm.runInNewContext(source,{window,document});
  assert.ok(classes.has('health-motion-paused'));
  observer.callback([{target:root,isIntersecting:true}]);assert.equal(classes.has('health-motion-paused'),false);
  document.hidden=true;document.events.visibilitychange();assert.ok(classes.has('health-motion-paused'));
  document.hidden=false;document.events.visibilitychange();assert.equal(classes.has('health-motion-paused'),false);
  window.events.pagehide({persisted:true});assert.ok(classes.has('health-motion-paused'));assert.ok(!observer.disconnected);
  window.events.pageshow();assert.equal(classes.has('health-motion-paused'),false);
  observer.callback([{target:root,isIntersecting:false}]);assert.ok(classes.has('health-motion-paused'));
  window.events.pagehide({persisted:false});assert.ok(observer.disconnected);
});

test('health activity deduplicates cached reads and reacts to timestamps, not changing speeds',()=>{
  const f=healthActivityFixture();f.visible();
  const summary='/traffic/summary?corridor=I25',route='/traffic/map/corridors?';
  const first={status:200,version:'v1',fetchedAt:'2026-10-14T21:58:00Z',data:{latest:{polledAt:'2026-10-14T21:57:00Z',avgCurrentSpeed:60}}};
  f.monitor.receive({[summary]:first,[route]:first});
  for(const card of f.cards.values())assert.ok(card.classes.has('health-event-active'));
  assert.equal(f.panel.classes.size,0,'flow reads do not animate stored-row counts');
  f.clear();f.advance();f.monitor.receive({[summary]:{...first,data:undefined},[route]:first},new Map([[summary,first]]));
  assert.ok(f.cards.get('api').classes.has('health-event-active'),'a new browser response is observable even with cached contents');
  for(const key of ['routes','database','ingest'])assert.equal(f.cards.get(key).classes.size,0);
  assert.equal(f.panel.classes.size,0);
  f.clear();f.advance();f.monitor.receive({[summary]:{...first,data:{latest:{...first.data.latest,avgCurrentSpeed:65}}}});
  assert.equal(f.cards.get('ingest').classes.size,0,'speed changes alone are not observations');
  f.clear();f.advance();f.monitor.receive({[summary]:{...first,data:{latest:{...first.data.latest,polledAt:'2026-10-14T21:59:00Z'}}}});
  assert.ok(f.cards.get('ingest').classes.has('health-event-active'),'unchanged speeds with a later poll are new observations');
  f.cards.get('ingest').events.animationend({animationName:'health-packet-arrive'});
  assert.equal(f.cards.get('ingest').classes.size,0);
  f.clear();f.advance();f.monitor.receive({'/traffic/summary?corridor=I70':{...first,data:{latest:{polledAt:'2026-10-14T21:59:30Z'}}}});
  f.clear();f.advance();f.monitor.receive({[summary]:{...first,data:{latest:{polledAt:'2026-10-14T21:59:15Z'}}}});
  assert.ok(f.cards.get('ingest').classes.has('health-event-active'),'each corridor advances independently even when the other has a later sample');
  f.clear();f.advance();f.monitor.receive({[summary]:{status:503,fetchedAt:'2026-10-14T22:00:00Z'},[route]:{status:503}});
  for(const key of ['routes','database','ingest'])assert.equal(f.cards.get(key).classes.size,0);
});

test('unseen health reactions are not replayed and do not drive database counters',()=>{
  const f=healthActivityFixture();f.visible();
  const sample={status:200,version:'x',fetchedAt:'2026-10-14T21:59:00Z',data:{latest:{polledAt:'2026-10-14T21:58:00Z'}}};
  f.visible(false);f.monitor.receive({'/traffic/summary?corridor=I25':sample});
  assert.match(f.cards.get('ingest').label.textContent,/Sample seen/);
  assert.equal(f.cards.get('ingest').classes.size,0);assert.equal(f.panel.classes.size,0);
  f.visible();assert.equal(f.cards.get('ingest').classes.size,0);
  f.advance();f.monitor.receive({'/traffic/summary?corridor=I25':{...sample,data:{latest:{polledAt:'2026-10-14T21:59:00Z'}}}});
  assert.ok(f.cards.get('ingest').classes.has('health-event-active'));
  f.document.hidden=true;f.document.events.visibilitychange();assert.equal(f.cards.get('ingest').classes.size,0);
  f.document.hidden=false;f.document.events.visibilitychange();assert.equal(f.cards.get('ingest').classes.size,0);
  f.advance();f.monitor.receive({'/traffic/summary?corridor=I70':{...sample,data:{latest:{polledAt:'2026-10-14T21:59:30Z'}}}});
  assert.ok(f.cards.get('ingest').classes.has('health-event-active'));
  f.motion.matches=true;f.motion.events.change();assert.equal(f.cards.get('ingest').classes.size,0);
  f.motion.matches=false;f.motion.events.change();assert.equal(f.cards.get('ingest').classes.size,0,'preference changes do not replay an old receipt');
  f.monitor.setRetained(true);f.advance();f.monitor.receive({'/traffic/summary?corridor=I25':sample});
  assert.equal(f.cards.get('api').classes.size,0);assert.equal(f.cards.get('ingest').label.textContent,'Live reactions off');
  const staticMode=healthActivityFixture(true);staticMode.visible();staticMode.monitor.receive({'/traffic/summary?corridor=I25':sample});
  assert.equal(staticMode.panel.classes.size,0);assert.match(staticMode.cards.get('ingest').label.textContent,/Sample seen/);
});

test('information health loads only the matching retained-data endpoint and releases refresh', async () => {
  const reads = [];
  const page = informationPage(async (url, options) => {
    reads.push({ url, options });
    return { ok: true, json: async () => ({ status: 'HEALTHY', summary: 'Recent observations.', checks: [] }) };
  }, '/dashboard-experimental/system.html');
  await page.run('loadOperationalStatus()');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].url, '/dashboard-experimental-api/system/operational-status');
  assert.equal(reads[0].options.method, undefined);
  assert.equal(reads[0].options.headers.Accept, 'application/json');
  assert.equal(reads[0].options.signal.aborted, false);
  assert.equal(page.nodes.get('systemOverview').dataset.status, 'HEALTHY');
  assert.equal(page.nodes.get('systemSummary').textContent, 'Recent observations.');
  assert.equal(page.nodes.get('statusRefresh').disabled, false);
});

test('health refresh rejects overlapping requests and releases the busy state', async () => {
  let resolveResponse;
  let reads = 0;
  const page = informationPage(() => {
    reads++;
    return new Promise(resolve => { resolveResponse = resolve; });
  });
  const first = page.run('loadOperationalStatus()');
  assert.equal(page.nodes.get('systemOverview').attributes['aria-busy'], 'true');
  await page.run('loadOperationalStatus("automatic")');
  assert.equal(reads, 1);
  resolveResponse({ ok: true, json: async () => ({ status: 'HEALTHY', checks: [] }) });
  await first;
  assert.equal(page.nodes.get('systemOverview').attributes['aria-busy'], 'false');
  assert.equal(page.nodes.get('statusRefresh').disabled, false);
});

test('health request timeout is bounded and remains retryable without claiming an outage', async () => {
  let timeout;
  const page = informationPage((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Status request timed out')), { once: true });
  }));
  const controller = new AbortController();
  page.context.AbortSignal = { timeout(milliseconds) { timeout = milliseconds; return controller.signal; } };
  const request = page.run('loadOperationalStatus()');
  assert.equal(timeout, 8000);
  controller.abort();
  await request;
  assert.equal(page.nodes.get('systemOverview').dataset.status, 'UNAVAILABLE');
  assert.equal(page.nodes.get('statusRefresh').disabled, false);
  assert.equal(page.nodes.get('statusCheckCount').textContent, 'Connection failed');
  assert.match(page.nodes.get('systemSummary').textContent, /does not by itself mean traffic ingestion is down/);
});

test('automatic health sync pauses hidden-tab reads and resumes the sixty-second cadence', async () => {
  let reads = 0;
  const page = informationPage(async () => {
    reads++;
    return { ok: true, json: async () => ({ status: 'HEALTHY', checks: [] }) };
  });
  page.run('window.setInterval = (callback, delay) => { window.statusInterval = callback; window.statusDelay = delay; }; initializeInformationPage();');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  assert.equal(page.run('window.statusDelay'), 60000);
  page.run('document.hidden = true; window.statusInterval();');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  page.run('document.hidden = false; window.statusInterval();');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 2);
});

test('health snapshot uses all actual components and does not turn a single degraded source into outage', () => {
  const page = informationPage();
  page.context.status = { status: 'DEGRADED', checks: [
    { component: 'flow:I25', status: 'HEALTHY', ageMinutes: 1 },
    { component: 'flow:I70', status: 'HEALTHY', ageMinutes: 2 },
    { component: 'incidents:cdot', status: 'HEALTHY', ageMinutes: 9 },
    { component: 'provider:tomtom', status: 'DEGRADED', message: 'One source needs attention.', suggestedAction: 'Check provider capacity.' }
  ] };
  page.run('renderOperationalStatus(status)');
  assert.equal(page.nodes.get('systemOverview').dataset.status, 'DEGRADED');
  assert.equal(page.nodes.get('statusCheckCount').textContent, '3 / 4 clear');
  assert.deepEqual(page.nodes.get('statusSignalGrid').children.map(child => child.children[0].textContent),
    ['I-25 flow', 'I-70 flow', 'CDOT reports', 'TomTom source']);
  page.context.status = { status: 'OUT_OF_SERVICE', checks: [] };
  page.run('renderOperationalStatus(status)');
  assert.equal(page.nodes.get('systemStatusTitle').textContent, 'Current traffic updates are unavailable');
  assert.equal(page.nodes.get('statusCheckCount').textContent, 'No checks');
});

test('health sync preserves the handoff and avoids forced layout when refreshing again', () => {
  const page = informationPage();
  Object.defineProperty(page.nodes.get('systemOverview'), 'offsetWidth', {
    get() { throw new Error('Unexpected forced layout'); }
  });
  page.run('startStatusSyncPulse("automatic")');
  assert.equal(page.nodes.get('systemOverview').classList.contains('is-heartbeat'), true);
  assert.equal(page.nodes.get('statusSyncCalloutText').textContent, 'Dashboard sync · checking health…');
  page.run('finishStatusSyncPulse(true); startStatusSyncPulse("manual");');
  assert.equal(page.nodes.get('systemOverview').classList.contains('is-sync-complete'), false);
  assert.equal(page.nodes.get('statusSyncCalloutText').textContent, 'Refreshing dashboard health…');
});

test('rapid health refreshes rewind only the heartbeat and ignore superseded cleanup', () => {
  const f = heartbeatLifecycleFixture(); f.view(true);
  f.page.run('startStatusSyncPulse("manual"); finishStatusSyncPulse(true)');
  const oldCleanup = [...f.timers.values()][0].fn;
  f.animations.forEach(animation => { animation.currentTime = 2500; });
  f.page.run('startStatusSyncPulse("manual"); finishStatusSyncPulse(false)');
  assert.deepEqual(f.animations.slice(0, 4).map(animation => animation.currentTime), [0, 0, 0, 0]);
  assert.deepEqual(f.animations.slice(4).map(animation => animation.currentTime), [2500, 2500]);
  assert.equal(f.panel.classList.contains('is-sync-complete'), false);
  assert.equal(f.panel.classList.contains('is-sync-failed'), true);
  oldCleanup();
  assert.equal(f.timers.size, 1);
  assert.equal(f.panel.classList.contains('is-heartbeat'), true);
  f.fire();
  assert.equal(f.panel.classList.contains('is-heartbeat'), false);
  assert.equal(f.panel.classList.contains('is-sync-failed'), false);
});

test('offscreen health completion survives until three uninterrupted visible seconds', async () => {
  const f = heartbeatLifecycleFixture();
  await f.page.run('loadOperationalStatus("initial")');
  assert.equal(f.timers.size, 0);
  assert.equal(f.panel.classList.contains('is-heartbeat'), true);
  f.view(true);
  assert.equal([...f.timers.values()][0].ms, 3000);
  const interrupted = [...f.timers.values()][0].fn;
  f.view(false); assert.equal(f.timers.size, 0);
  f.view(true); interrupted();
  assert.equal(f.panel.classList.contains('is-heartbeat'), true);
  assert.equal(f.timers.size, 1);
  assert.equal(f.reads(), 1);
  f.fire(); assert.equal(f.panel.classList.contains('is-heartbeat'), false);
});

test('hidden-tab and page-cache resume preserve the pulse without another health read', async () => {
  const f = heartbeatLifecycleFixture(); f.view(true);
  await f.page.run('loadOperationalStatus()');
  f.page.context.document.hidden = true; f.emit('document', 'visibilitychange');
  assert.equal(f.timers.size, 0);
  assert.equal(f.page.context.document.documentElement.classList.contains('motion-suspended'), true);
  f.page.context.document.hidden = false; f.emit('document', 'visibilitychange');
  assert.equal(f.timers.size, 1);
  f.emit('window', 'pagehide', {persisted: true});
  assert.equal(f.timers.size, 0);
  assert.equal(f.page.context.document.documentElement.classList.contains('motion-suspended'), true);
  f.emit('window', 'pageshow', {persisted: true});
  assert.equal(f.page.context.document.documentElement.classList.contains('motion-suspended'), false);
  assert.equal(f.timers.size, 1);
  assert.equal(f.reads(), 1);
  f.fire(); assert.equal(f.panel.classList.contains('is-heartbeat'), false);
});

test('reduced-motion health presentation cleans up without needing animation events', () => {
  const f = heartbeatLifecycleFixture(); f.view(true);
  f.panel.getAnimations = () => [];
  f.page.run('startStatusSyncPulse("manual"); finishStatusSyncPulse(true)');
  assert.equal(f.timers.size, 1);
  f.fire(); assert.equal(f.panel.classList.contains('is-heartbeat'), false);
});

test('a decorative animation API failure cannot block or mislabel a successful health read', async () => {
  const f = heartbeatLifecycleFixture(); f.view(true);
  f.panel.getAnimations = () => { throw new Error('Animation inspection unavailable'); };
  await f.page.run('loadOperationalStatus()');
  assert.equal(f.reads(), 1);
  assert.equal(f.panel.dataset.status, 'HEALTHY');
  assert.equal(f.page.nodes.get('statusRefresh').disabled, false);
  f.fire(); assert.equal(f.panel.classList.contains('is-heartbeat'), false);
});

test('slow health reads keep the sync state until settled and remain overlap-protected', async () => {
  const f = heartbeatLifecycleFixture(); f.view(true);
  let resolve;
  f.page.context.window.fetch = () => new Promise(done => { resolve = done; });
  const request = f.page.run('loadOperationalStatus()');
  assert.equal(f.timers.size, 0);
  assert.equal(f.page.nodes.get('statusRefresh').disabled, true);
  f.animations.slice(0, 4).forEach(animation => { animation.currentTime = 2600; });
  resolve({ok: true, json: async () => ({status: 'HEALTHY', checks: []})});
  await request;
  assert.equal(f.page.nodes.get('statusRefresh').disabled, false);
  assert.equal(f.timers.size, 1);
  f.fire(); assert.equal(f.panel.classList.contains('is-heartbeat'), false);
});

test('failed information health requests remain retryable without reporting a traffic outage', async () => {
  const page = informationPage(async () => ({ ok: false, status: 503 }));
  await page.run('loadOperationalStatus()');
  assert.equal(page.nodes.get('systemOverview').dataset.status, 'UNAVAILABLE');
  assert.match(page.nodes.get('systemSummary').textContent, /does not by itself mean traffic ingestion is down/);
  assert.equal(page.nodes.get('statusRefresh').disabled, false);
});
