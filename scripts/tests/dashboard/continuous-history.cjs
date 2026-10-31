const { test } = require('node:test');
const { dashboard, assert, liveEdgeFixture } = require('../fixtures/core.cjs');
const { continuousFixture, preparedFixture, setContinuousFetch, clickHistoryRange, prepareChartHistory, axisFixture, historyHoverClock } = require('../fixtures/history.cjs');

test('startup coverage cannot anchor retained chart buffers before the first snapshot arrives', async () => {
  const reads=[];
  const d = dashboard(async path=>{reads.push(path);return {ok:true,json:async()=>({firstObservedAt:'2026-04-12T02:00:00Z'})};},
    '?historical=1&continuous=1&prepared=1');
  d.run('initializeHistoryControls()');
  await new Promise(setImmediate);
  assert.equal(reads.length, 0, 'coverage waits for the first snapshot rather than starting a premature buffer');
  await d.run(`renderDashboard=()=>{};
    const retained={summary:{latest:{polledAt:'2026-06-19T02:00:00Z'}},trend:{buckets:[]},history:{samples:[]},zones:[],incidentThreads:[]};
    loadLiveDashboardSnapshots=async()=>new Map([[24,{routeData:new Map(CORRIDOR_IDS.map(corridor=>[corridor,retained]))}]]);
    refreshDashboard();`);
  await d.run('chartHistory.coveragePromise');
  assert.equal(reads.length, 2);
  assert.equal(d.run("window.ContinuousHistory.route('I25').parts[0].end"),Date.parse('2026-06-19T02:00:00Z'));
  assert.equal(d.run('chartHistory.enabled'), false);
});

test('cached retained charts initialize button navigation even when startup sync fails', async () => {
  const reads=[];
  const d=dashboard(async path=>{reads.push(path);return {ok:true,json:async()=>({firstObservedAt:'2026-04-12T02:00:00Z'})};},
    '?historical=1&continuous=1&prepared=1');
  d.run(`renderDashboard=()=>{};
    const retained={summary:{latest:{polledAt:'2026-06-19T02:00:00Z'}},trend:{buckets:[]},history:{samples:[]},zones:[],incidentThreads:[]};
    state.snapshots=new Map([[24,{routeData:new Map(CORRIDOR_IDS.map(corridor=>[corridor,retained]))}]]);
    loadLiveDashboardSnapshots=async()=>{throw new Error('Startup sync timed out');};`);
  await d.run('refreshDashboard()');
  await d.run('chartHistory.coveragePromise');
  assert.equal(reads.length,2);
  assert.equal(d.nodes.get('historyOlder').disabled,false);
  assert.equal(d.run("window.ContinuousHistory.route('I25').parts[0].end"),Date.parse('2026-06-19T02:00:00Z'));
  assert.equal(d.run('chartHistory.enabled'),false);
  assert.match(d.nodes.get('statusText').textContent,/Startup sync timed out/);
});

test('continuous button navigation works with wheel scrolling off in every range and chart view', async () => {
  for (const hours of [2,6,24,168,720]) for (const view of ['overall','zones']) {
    const f = continuousFixture();
    f.d.context.hours = hours;
    f.d.context.view = view;
    f.d.run("chartHistory.enabled=false;chartHistory.bounds.forEach(value=>value.firstZoneObservedAt=value.firstObservedAt);state.selectedHours=hours;state.chartView=view;state.focusedCorridor='I25';initializeHistoryControls();updateHistoryControls()");
    const latest = f.d.run('historyLatestTime()');
    f.d.nodes.get('historyOlder').events.click();
    for(let i=0;i<120;i++) f.frame();
    await f.settle();
    assert.equal(f.d.run('chartHistory.endTime'), latest-hours*1800000);
    assert.equal(f.d.run('chartHistory.enabled'), false);
    assert.equal(f.d.nodes.get('chartHistoryDetails').hidden, false);
    assert.equal(f.d.nodes.get('historyNewer').disabled, false);
    f.d.nodes.get('historyNewer').events.click();
    for(let i=0;i<120;i++) f.frame();
    assert.equal(f.d.run('chartHistory.endTime'), null);
    f.d.nodes.get('historyFirst').events.click();
    f.d.run('updateHistoryControls()');
    assert.equal(f.d.nodes.get('historyFirst').disabled, true);
    assert.equal(f.d.nodes.get('historyOlder').disabled, true);
    assert.equal(f.d.nodes.get('historyCurrent').disabled, false);
    f.d.nodes.get('historyCurrent').events.click();
    assert.equal(f.d.run('chartHistory.endTime'), null);
    assert.equal(f.d.run('chartHistory.enabled'), false);
    f.d.context.window.events.pagehide();
  }
});

test('continuous marker limits use the inline notice without adding a help line', async () => {
  const f = continuousFixture();
  f.d.run(`const loadUncappedRoute=loadChartHistoryRoute;
    loadChartHistoryRoute=async(...args)=>({...await loadUncappedRoute(...args),
      chartNote: args[0]==='I25' ? 'I-25 incident markers are limited to the latest 1,000 reports. Choose a shorter range for more detail.' : ''});
    window.ContinuousHistory.toggle();`);
  await f.settle();
  f.d.run("setHistoryEnd(Date.parse('2026-06-19T01:00:00Z'));updateHistoryControls()");
  await f.settle();
  f.d.run('updateHistoryControls()');
  const notice = f.d.nodes.get('chartHistoryMarkerNotice');
  assert.equal(notice.hidden, false);
  assert.match(notice.title, /I-25.*latest 1,000/);
  assert.doesNotMatch(f.d.nodes.get('chartHistoryHelp').textContent, /markers are limited/);
  f.d.run('chartHistory.enabled=false;updateHistoryControls()');
  assert.equal(notice.hidden, false);
  assert.equal(f.d.nodes.get('chartHistoryDetails').hidden, false);
  f.d.run('chartHistory.endTime=null;updateHistoryControls()');
  assert.equal(notice.hidden, true);
});

test('prepared history loads all views and a longer short-range strip before scrolling is enabled', async () => {
  const f = preparedFixture();
  f.d.run('window.ContinuousHistory.prepare()'); await f.settle();
  assert.equal(f.reads.length, 14);
  assert.equal(new Set(f.reads.map(path=>{
    const url=new URL(path,'http://fixture');
    assert.equal(url.searchParams.get('corridors'),'I25,I70');
    return url.searchParams.get('hours')+'|'+url.searchParams.get('zones');
  })).size,10);
  assert.equal(f.d.run('chartHistory.enabled'),false);
  assert.equal(f.d.run('chartHistory.endTime'),null);
  assert.equal(f.d.run('window.ContinuousHistory.preparationStatus().ready'),14);
  assert.match(f.d.nodes.get('historyScrollToggle').title,/14 \/ 14/);
  f.d.run('chartHistory.enabled=true;updateHistoryControls()');
  assert.match(f.d.nodes.get('historyScrollToggle').title,/↑ Forward: scroll up toward Current/);
  assert.match(f.d.nodes.get('historyScrollToggle').title,/↓ Backward: scroll down into older history/);
  assert.match(f.d.nodes.get('historyScrollToggle').title,/14 \/ 14/);
  f.d.run('chartHistory.enabled=false;updateHistoryControls();window.ContinuousHistory.help()');
  assert.match(f.d.nodes.get('historyScrollToggle').title,/Enable Historical Scroll.*14 \/ 14/);
  const reads=f.reads.length;
  for(let i=0;i<20;i++){f.d.run('window.ContinuousHistory.prepare()');f.advance(4001);await f.settle();}
  assert.equal(f.reads.length,reads,'preparation terminates and live sync does not restart the sweep');
});

test('prepared seeds share chart records without retaining map or summary payloads',async()=>{
  const f=preparedFixture();
  f.d.run(`state.routeData.get('I25').trend={buckets:[{bucketStart:'2026-06-19T01:00:00Z',avgCurrentSpeed:61}]};
    state.routeData.get('I25').flowCells={features:[{geometry:{coordinates:[]}}]};
    state.routeData.get('I25').dailyZones=[{avgCurrentSpeed:61}];
    window.ContinuousHistory.prepare();`);await f.settle();
  assert.equal(f.d.run("window.ContinuousHistory.route('I25').parts.find(part=>part.seed).value.trend===state.routeData.get('I25').trend"),true);
  for(const field of ['summary','flowCells','dailyZones']){
    f.d.context.field=field;
    assert.equal(f.d.run("field in window.ContinuousHistory.route('I25').parts.find(part=>part.seed).value"),false);
  }
});

test('prepared corridor and resolution switches use retained windows without visible reads',async()=>{
  const f=preparedFixture();f.d.run('window.ContinuousHistory.prepare()');await f.settle();
  f.d.run('dashboardRequestTimes.push(...Array(46).fill(Date.now()))');
  const reads=f.reads.length;
  for(const corridor of ['I25','I70','ALL'])for(const hours of [2,6,24,168,720]){
    f.d.context.corridor=corridor;f.d.context.hours=hours;
    f.d.run("applyCorridorFocus(corridor,false);state.selectedHours=hours;chartHistory.enabled=true;setHistoryEnd(Date.parse('2026-06-18T20:00:00Z'))");
    for(const view of corridor==='ALL'?['overall']:['overall','zones']){
      f.d.context.view=view;f.d.run('setChartView(view)');await f.settle();
      assert.equal(f.reads.length,reads);
      assert.equal(f.d.run("chartRouteData(corridor==='ALL'?'I70':corridor).parts.length>0"),true);
      assert.equal(f.d.run('dashboardReadQueue.every(request=>request.priority===2)'),true,
        'the selected window never waits on a budget-blocked visible request');
    }
  }
});

test('prepared reads obey the shared budget, reserve live slots and cancel on page hide',async()=>{
  const f=preparedFixture();
  f.d.run('dashboardRequestTimes.push(...Array(46).fill(Date.now()));window.ContinuousHistory.prepare()');await f.settle();
  assert.equal(f.reads.length,0);
  assert.equal(f.d.run('dashboardReadQueue.length'),1);
  assert.equal(f.d.run('dashboardReadQueue[0].priority'),2);
  const signal=f.d.run('dashboardReadQueue[0].signal');
  f.d.run('window.ContinuousHistory.pause()');await f.settle();
  assert.equal(signal.aborted,true);
  f.advance(60051);await f.settle();assert.equal(f.reads.length,0);
  f.d.run('window.ContinuousHistory.resume()');await f.settle();
  assert.equal(f.reads.length,14);
});

test('prepared history excludes absent older coverage and never invents observations',async()=>{
  const f=preparedFixture();
  f.d.run("chartHistory.bounds.forEach(value=>value.firstZoneObservedAt=null);window.ContinuousHistory.prepare()");await f.settle();
  assert.equal(f.reads.length,7);
  assert.ok(f.reads.every(path=>new URL(path,'http://fixture').searchParams.get('zones')==='false'));
  assert.equal(f.d.run('window.ContinuousHistory.preparationStatus().total'),7);
});

test('prepared slow reads back off automatically instead of flooding the server',async()=>{
  const f=preparedFixture();let release;
  f.d.context.window.fetch=async()=>{
    await new Promise(resolve=>release=resolve);
    return {ok:true,json:async()=>({})};
  };
  f.d.run('window.ContinuousHistory.prepare()');await f.settle();
  assert.equal(f.d.run('dashboardRequestTimes.length'),1);
  f.advance(3000);release();await f.settle();
  f.advance(5999);await f.settle();assert.equal(f.d.run('dashboardRequestTimes.length'),1);
  f.advance(2);await f.settle();assert.equal(f.d.run('dashboardRequestTimes.length'),2);
  f.d.run('window.ContinuousHistory.pause()');release();await f.settle();
});

test('prepared failure keeps successful views and cannot become an automatic retry loop',async()=>{
  const f=preparedFixture();
  setContinuousFetch(f,async path=>({ok:!path.includes('/zones/trends'),status:503,
    json:async()=>({buckets:[],samples:[],points:[],profiles:[],features:[]})}));
  f.d.run('window.ContinuousHistory.prepare()');await f.settle();
  assert.equal(f.reads.length,14);
  assert.equal(f.d.run('window.ContinuousHistory.preparationStatus().ready'),7);
  for(let i=0;i<10;i++){f.advance(60001);f.d.run('window.ContinuousHistory.prepare()');await f.settle();}
  assert.equal(f.reads.length,14);
  f.d.run("applyCorridorFocus('I25',false);chartHistory.enabled=true;setChartView('zones');setHistoryEnd(Date.parse('2026-06-19T01:00:00Z'));updateHistoryControls()");
  assert.equal(f.d.nodes.get('historyRetry').hidden,false);
});

test('prepared oversized responses are bounded and never continually downloaded after eviction',async()=>{
  const f=preparedFixture();
  setContinuousFetch(f,async path=>{
    const end=Date.parse(new URL(path,'http://fixture').searchParams.get('asOf'));
    const points=Array.from({length:35000},()=>({bucketStart:new Date(end-60000).toISOString(),avgCurrentSpeed:55}));
    return {ok:true,json:async()=>({samples:path.includes('/history?')?points:[],
      points:path.includes('/zones/trends')?points:[],buckets:[],profiles:[],features:[]})};
  });
  f.d.run('window.ContinuousHistory.prepare()');await f.settle();
  const reads=f.reads.length;assert.ok(reads<=14);
  for(let i=0;i<20;i++){f.advance(60001);f.d.run('window.ContinuousHistory.prepare()');await f.settle();}
  assert.equal(f.reads.length,reads);
  assert.ok(f.d.run('window.ContinuousHistory.preparationStatus().ready')<14);
  assert.equal(f.d.run('chartHistory.endTime'),null);
});

test('prepared mode cannot add background reads to an ordinary or discrete dashboard',async()=>{
  for(const search of ['?historical=1&prepared=1','?historical=1&continuous=1']){
    const f=continuousFixture(search);f.d.run('chartHistory.enabled=false;window.ContinuousHistory.prepare()');await f.settle();
    assert.equal(f.d.run('window.ContinuousHistory.prepared'),false);
    assert.equal(f.reads.length,0);
  }
});

test('an explicit historical timeframe loads while wheel scrolling remains disabled', async () => {
  const f = preparedFixture();
  f.d.run('window.ContinuousHistory.prepare()'); await f.settle();
  f.d.run(`state.selectedHours=168;chartHistory.enabled=true;
    setHistoryEnd(Date.parse('2026-06-17T08:00:00Z'));
    chartHistory.enabled=false;window.ContinuousHistory.toggle();
    state.selectedHours=6;refreshHistorySelection();`);
  f.advance(4001); await f.settle();
  assert.ok(f.reads.some(path => {
    const url = new URL(path, 'http://fixture');
    return url.searchParams.get('hours') === '6'
      && url.searchParams.get('asOf') === '2026-06-17T08:00:00.000Z';
  }));
  assert.equal(f.d.run('chartHistory.enabled'), false);
  assert.equal(f.d.run('chartHistory.endTime'), Date.parse('2026-06-17T08:00:00Z'));
  assert.equal(f.d.run("window.ContinuousHistory.route('I25').parts.some(part => part.end === chartHistory.endTime)"), true);
});

test('elapsed live time cannot leave an inactive historical frame behind its selected head', async () => {
  const f = continuousFixture('?continuous=1&prepared=1');
  f.d.run(`chartHistory.enabled=false;state.snapshots=new Map(DASHBOARD_RANGE_HOURS.map(hours=>
    [hours,{routeData:new Map(CORRIDOR_IDS.map(c=>[c,{...state.routeData.get('I25')}]))}]));
    window.ContinuousHistory.prepare();`); await f.settle();
  f.advance(3600000); await f.settle();
  f.d.run(`chartHistory.enabled=true;setHistoryEnd(Date.parse('2026-06-19T02:50:00Z'));
    state.selectedHours=6;refreshHistorySelection();updateHistoryControls();`);
  await f.settle();
  assert.equal(f.d.run("Math.max(...window.ContinuousHistory.route('I25').parts.map(part=>part.end)) >= chartHistory.endTime"), true);
  assert.doesNotMatch(f.d.nodes.get('chartHistoryHelp').textContent, /Loading adjacent history/);
  assert.ok(f.reads.every(path => Date.parse(new URL(path,'http://fixture').searchParams.get('asOf')) <= f.d.run('Date.now()')));
});

test('prepared cache pressure evicts distant chunks rather than an entire useful timeframe', async () => {
  const f = preparedFixture();
  f.d.run('window.ContinuousHistory.prepare()'); await f.settle();
  f.d.run(`state.snapshots.forEach(snapshot=>snapshot.routeData.forEach(route=>{
    route.summary={latest:{polledAt:'2026-06-19T02:01:00Z'}};
  }));`);
  for (const view of ['overall','zones']) for (const hours of [2,6,24,168,720]) {
    f.d.context.view=view; f.d.context.hours=hours;
    f.d.run(`state.chartView=view;state.selectedHours=hours;
      state.routeData=state.snapshots.get(hours).routeData;window.ContinuousHistory.refresh();`);
    await f.settle();
  }
  f.d.run('dashboardRequestTimes.push(...Array(46).fill(Date.now()));chartHistory.enabled=true');
  const before = f.reads.length;
  for (const view of ['overall','zones']) for (const hours of [24,6,168,720]) {
    f.d.context.view=view; f.d.context.hours=hours;
    f.d.run(`state.chartView=view;state.selectedHours=hours;state.routeData=state.snapshots.get(hours).routeData;
      setHistoryEnd(Date.parse('2026-06-19T01:00:00Z'));refreshHistorySelection();`);
    await f.settle();
    f.d.run('updateHistoryControls()');
    assert.match(f.d.nodes.get('historyScrollToggle').title, /Selected window retained/, `${view} ${hours}`);
    assert.equal(f.d.run('dashboardReadQueue.some(request=>request.priority===1)'), false);
  }
  assert.equal(f.reads.length, before);
});

test('the experimental dashboard enables the improved loader without URL flags', () => {
  for (const pathname of ['/dashboard-experimental/', '/dashboard-experimental/index.html']) {
    const d = dashboard(undefined, '', pathname, false, true);
    assert.equal(d.run('window.ContinuousHistory.active'), true);
    assert.equal(d.run('window.ContinuousHistory.prepared'), true);
    assert.equal(d.run('chartHistory.enabled'), false, 'preloading must not capture page scrolling');
  }
});

test('prepared deep history warms midpoint-aligned windows before 7D to 24H to 6H switching', async () => {
  const f=preparedFixture();f.d.run('window.ContinuousHistory.prepare()');await f.settle();
  const initial=f.reads.length;
  f.d.run(`state.selectedHours=168;chartHistory.enabled=true;
    setHistoryEnd(Date.parse('2026-06-17T07:43:12.123Z'));`);
  await f.settle();
  assert.equal(f.reads.length,initial,'alternate preparation waits for settled navigation');
  f.advance(351);await f.settle();
  const alternate=f.reads.slice(initial).map(path=>new URL(path,'http://fixture'));
  for(const hours of [24,6]) assert.ok(alternate.some(url=>
    Number(url.searchParams.get('hours'))===hours
    && Date.parse(url.searchParams.get('asOf'))===Date.parse('2026-06-17T07:43:12.123Z')+(hours-168)*1800000));
  assert.ok(alternate.length<=3,'at most three alternate batches per settled intent');
  f.d.run('dashboardRequestTimes.push(...Array(46).fill(Date.now()))');
  const ready=f.reads.length;
  f.d.run('initializeControls();applyDashboardSnapshot=()=>{}');
  const midpoint=Date.parse('2026-06-17T07:43:12.123Z')-168*1800000;
  for(const hours of [24,6,24,6]) {
    clickHistoryRange(f.d,hours);f.d.run('updateHistoryControls()');await f.settle();
    assert.equal(f.d.run('chartHistory.endTime')-hours*1800000,midpoint);
    assert.match(f.d.nodes.get('historyScrollToggle').title,/Selected window retained/);
    assert.equal(f.d.run('dashboardReadQueue.some(request=>request.priority===1)'),false);
  }
  assert.equal(f.reads.length,ready);
});

test('cursor preparation preserves each zone resolution and terminates after failed reads', async () => {
  const f=preparedFixture();f.d.run('window.ContinuousHistory.prepare()');await f.settle();
  setContinuousFetch(f,async()=>({ok:false,status:503,json:async()=>({})}));
  const initial=f.reads.length;
  f.d.run(`state.focusedCorridor='I70';state.chartView='zones';state.selectedHours=168;
    chartHistory.enabled=true;setHistoryEnd(Date.parse('2026-06-17T07:43:00Z'));`);
  f.advance(351);await f.settle();
  const reads=f.reads.slice(initial).map(path=>new URL(path,'http://fixture'));
  assert.ok(reads.some(url=>url.searchParams.get('hours')==='24' && url.searchParams.get('zones')==='true'));
  assert.ok(reads.some(url=>url.searchParams.get('hours')==='6' && url.searchParams.get('zones')==='true'));
  assert.ok(reads.length<=3);
  const before=f.reads.length;
  for(let i=0;i<8;i++){f.advance(60001);f.d.run('window.ContinuousHistory.prepare()');await f.settle();}
  assert.ok(f.reads.slice(before).every(path=>new URL(path,'http://fixture').searchParams.get('hours')==='168'),
    'failed alternate requests do not repeat; active adjacent preparation remains separately bounded');
  f.d.run('chartHistory.enabled=false;window.ContinuousHistory.toggle()');
  const disabled=f.reads.length;f.advance(60001);await f.settle();
  assert.equal(f.reads.length,disabled);
});

test('cursor preparation coalesces moving positions and ignores unavailable alternate coverage', async () => {
  const f=preparedFixture();f.d.run('window.ContinuousHistory.prepare()');await f.settle();
  const before=f.reads.length;
  f.d.run(`state.selectedHours=168;chartHistory.enabled=true;setHistoryEnd(Date.parse('2026-06-17T07:43:00Z'));`);
  f.advance(100);
  f.d.run("setHistoryEnd(Date.parse('2026-06-17T06:43:00Z'))");
  f.advance(251);await f.settle();
  assert.equal(f.reads.length,before);
  f.advance(100);await f.settle();
  assert.ok(f.reads.slice(before).every(path=>{
    const url=new URL(path,'http://fixture');
    return Date.parse(url.searchParams.get('asOf'))===Date.parse('2026-06-17T06:43:00Z')+(Number(url.searchParams.get('hours'))-168)*1800000;
  }));
  f.d.run(`chartHistory.bounds.forEach(value=>value.firstZoneObservedAt=null);
    state.focusedCorridor='I25';state.selectedHours=168;
    setHistoryEnd(Date.parse('2026-06-17T05:43:00Z'));`);
  f.advance(351);await f.settle();
  assert.ok(f.reads.slice(before).every(path=>new URL(path,'http://fixture').searchParams.get('zones')==='false'));
  f.d.run('window.ContinuousHistory.pause()');
});

test('visible historical misses bypass speculative pacing but still reserve live request capacity', async () => {
  const f=preparedFixture();f.d.run('window.ContinuousHistory.prepare()');await f.settle();
  f.d.run(`chartHistory.enabled=false;state.selectedHours=6;
    setHistoryEnd(Date.parse('2026-06-17T08:00:00Z'));`);
  await f.settle();
  const loaded=f.reads.length;
  assert.equal(loaded,15,'missing selection dispatches immediately after startup reads');
  f.d.run('dashboardRequestTimes.push(...Array(46).fill(Date.now()));state.selectedHours=2;refreshHistorySelection()');
  await f.settle();
  assert.equal(f.reads.length,loaded);
  assert.equal(f.d.run('dashboardReadQueue[0].priority'),1);
  assert.equal(f.d.run('chartHistory.enabled'),false);
  f.advance(60051);await f.settle();
  assert.equal(f.reads.length,loaded+1,'visible selection resumes when shared capacity returns');
});

test('timeframe changes retain compatible dispatched reads without reopening the old graph', async () => {
  const f=preparedFixture();f.d.run('window.ContinuousHistory.prepare()');await f.settle();
  const releases=[];
  setContinuousFetch(f,async path=>{
    if(path.includes('/analytics/trends')) await new Promise(resolve=>releases.push(resolve));
    return {ok:true,json:async()=>({buckets:[],samples:[],points:[],profiles:[],features:[]})};
  });
  f.d.run(`chartHistory.enabled=false;state.selectedHours=6;setHistoryEnd(Date.parse('2026-06-17T08:00:00Z'));`);
  await f.settle();
  const first=f.reads.length;assert.equal(releases.length,2);
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  assert.equal(f.reads.length,first,'locking wheel navigation does not restart the visible read');
  f.d.run('state.selectedHours=24;refreshHistorySelection()');
  releases.splice(0).forEach(release=>release());await f.settle();
  assert.equal(f.d.run('state.selectedHours'),24);
  assert.equal(f.d.run('chartHistory.endTime'),Date.parse('2026-06-17T08:00:00Z'));
  assert.equal(f.reads.length,first+1);
  releases.splice(0).forEach(release=>release());await f.settle();
  const ready=f.reads.length;
  f.d.run('state.selectedHours=6;refreshHistorySelection();updateHistoryControls()');await f.settle();
  assert.equal(f.reads.length,ready,'returning reuses the completed six-hour response');
  assert.match(f.d.nodes.get('historyScrollToggle').title,/Selected window retained/);
});

test('experimental loader comparisons respect explicit opt-outs and leave other pages unchanged', () => {
  for (const [search, active, prepared] of [
    ['?continuous=0', false, false], ['?continuous=0&prepared=1', false, false],
    ['?continuous=1&prepared=0', true, false], ['?prepared=0', true, false],
    ['?continuous=1&prepared=1', true, true]
  ]) {
    const d = dashboard(undefined, search, '/dashboard-experimental/');
    assert.equal(d.run('window.ContinuousHistory.active'), active);
    assert.equal(d.run('window.ContinuousHistory.prepared'), prepared);
  }
  for (const pathname of ['/dashboard/', '/dashboard/index.html', '/dashboard-experimental-copy/']) {
    const d = dashboard(undefined, '', pathname);
    assert.equal(d.run('window.ContinuousHistory.active'), false);
    assert.equal(d.run('window.ContinuousHistory.prepared'), false);
    const comparison = dashboard(undefined, '?continuous=1&prepared=1', pathname);
    assert.equal(comparison.run('window.ContinuousHistory.prepared'), true);
  }
});

test('corridor changes return to Current and disable scrolling without changing the timeframe', () => {
  for (const continuous of [false, true]) {
    for (const from of ['ALL', 'I25', 'I70']) {
      for (const to of ['ALL', 'I25', 'I70'].filter(value => value !== from)) {
        const d = dashboard(undefined, continuous ? '?historical=1&continuous=1' : '?historical=1');
        prepareChartHistory(d);
        d.context.from = from; d.context.to = to;
        d.run(`state.focusedCorridor=from;state.selectedHours=168;
          chartHistory.endTime=Date.parse('2026-06-12T02:00:00Z');
          chartHistory.controller=new AbortController();
          chartHistory.dataKey='old';chartHistory.error='old failure';
          beginHistoryWheelHover(elements.i25Chart);`);
        const pending = d.run('chartHistory.controller');
        d.run('applyCorridorFocus(to, false)');
        assert.equal(d.run('chartHistory.endTime'), null);
        assert.equal(d.run('chartHistory.enabled'), false);
        assert.equal(d.run('state.selectedHours'), 168);
        assert.equal(d.run('chartHistory.hoverCanvas'), null);
        assert.equal(d.run('chartHistory.dataKey'), null);
        assert.equal(pending.signal.aborted, true);
        assert.equal(d.nodes.get('chartHistoryDetails').hidden, true);
        assert.equal(d.nodes.get('historyScrollToggle').attributes['aria-pressed'], 'false');
        assert.match(d.nodes.get('chartHistoryWindow').textContent, /Current window/);
        assert.equal(d.network.length, 0);
      }
    }
  }
});

test('reapplying the same corridor and switching chart views preserve the displayed historical time', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run("state.focusedCorridor='I25';panHistoryWindow(3600000)");
  const end = d.run('chartHistory.endTime');
  d.run("applyCorridorFocus('I25',false);setChartView('zones')");
  assert.equal(d.run('chartHistory.endTime'), end);
  assert.equal(d.run('chartHistory.enabled'), true);
});

test('switching older Overall history to Speed Zones immediately selects the first available zone window',async()=>{
  for (const corridor of ['I25','I70']) for (const hours of [2,6,24,168,720]) {
    const f=continuousFixture();f.d.context.corridor=corridor;f.d.context.hours=hours;
    setContinuousFetch(f,async path=>{
      const end=Date.parse(new URL(path,'http://fixture').searchParams.get('asOf'));
      return {ok:true,json:async()=>({buckets:[],profiles:[],samples:[],features:[],points:[{zoneKey:'test',zoneOrder:0,
        startMileMarker:208,endMileMarker:271,postedSpeedMph:65,bucketStart:new Date(end).toISOString(),
        avgCurrentSpeed:50,observationCount:1}]})};
    });
    f.d.run(`state.focusedCorridor=corridor;state.selectedHours=hours;
      setHistoryEnd(Date.parse('2026-04-20T02:00:00Z'));setChartView('zones')`);
    assert.equal(f.d.run('chartHistory.endTime'),f.d.run('historyLimits().firstEnd'),`${corridor}/${hours}`);
    assert.equal(f.d.run('state.selectedHours'),hours);
    await f.settle();await f.settle();
    assert.ok(f.reads.some(path=>new URL(path,'http://fixture').searchParams.get('zones')==='true'));
    assert.ok(f.d.run('chartRouteData(corridor).layoutGroups.length')>0);
    f.d.run('window.ContinuousHistory.pause()');
  }
});

test('view switches preserve Current and valid history with wheel scrolling disabled',()=>{
  const f=continuousFixture();
  f.d.run(`state.focusedCorridor='I70';chartHistory.enabled=false;setChartView('zones')`);
  assert.equal(f.d.run('chartHistory.endTime'),null);
  f.d.run("setChartView('overall');setHistoryEnd(Date.parse('2026-06-18T01:00:00Z'));setChartView('zones')");
  assert.equal(f.d.run('chartHistory.endTime'),Date.parse('2026-06-18T01:00:00Z'));
  assert.equal(f.d.run('chartHistory.enabled'),false);
  f.d.run('window.ContinuousHistory.pause()');
});

test('continuous history warms the matching alternate view without a visible read on switching', async () => {
  const f = continuousFixture();
  f.d.run("state.focusedCorridor='I25';window.ContinuousHistory.toggle()");
  await f.settle();
  f.d.run("setHistoryEnd(Date.parse('2026-06-19T01:00:00Z'))");
  f.advance(4001); await f.settle();
  const warm = f.reads.map(path => new URL(path, 'http://fixture'))
    .find(url => url.searchParams.get('zones') === 'true');
  assert.ok(warm);
  assert.equal(warm.searchParams.get('asOf'), '2026-06-19T01:00:00.000Z');
  assert.equal(warm.searchParams.get('hours'), '24');
  const reads = f.reads.length;
  f.d.run("setChartView('zones')"); await f.settle();
  assert.equal(f.reads.length, reads);
  assert.equal(f.d.run('chartHistory.endTime'), Date.parse('2026-06-19T01:00:00Z'));
  assert.equal(f.d.run("chartRouteData('I25').parts.some(part=>part.end===chartHistory.endTime)"), true);
  assert.equal(f.d.run('chartHistory.enabled'), true);
});

test('continuous history warms a recently used timeframe around the historical midpoint', async () => {
  const f = continuousFixture();
  f.d.run('window.ContinuousHistory.toggle()'); await f.settle();
  f.d.run("state.selectedHours=6;setHistoryEnd(Date.parse('2026-06-15T02:00:00Z'))");
  for (let i=0;i<8;i++) {f.advance(4001);await f.settle();}
  assert.ok(f.reads.some(path => {
    const url = new URL(path, 'http://fixture');
    return url.searchParams.get('hours') === '24' && url.searchParams.get('asOf') === '2026-06-15T02:00:00.000Z';
  }));
  const reads = f.reads.length;
  f.d.run('initializeControls();applyDashboardSnapshot=()=>{};dashboardRequestTimes.push(...Array(46).fill(Date.now()))');
  clickHistoryRange(f.d,24);await f.settle();
  assert.equal(f.reads.length, reads);
  assert.equal(f.d.run('chartHistory.endTime'), Date.parse('2026-06-15T11:00:00Z'));
  assert.ok(f.d.run("Math.max(...chartRouteData('I25').parts.map(part=>part.end))>=chartHistory.endTime"));
  assert.equal(f.d.run('dashboardReadQueue[0].priority'), 2);
});

test('failed alternate warming does not disturb the selected graph or repeat background retries', async () => {
  const f=continuousFixture();
  setContinuousFetch(f, async path => ({ok:!path.includes('/zones/trends'),status:503,
    json:async()=>({buckets:[],samples:[],points:[],profiles:[],features:[]})}));
  f.d.run("state.focusedCorridor='I25';window.ContinuousHistory.toggle()");await f.settle();
  f.d.run("setHistoryEnd(Date.parse('2026-06-19T01:00:00Z'))");
  for(let i=0;i<8;i++) {f.advance(4001);await f.settle();}
  assert.equal(f.reads.filter(path=>path.includes('zones=true')).length, 1);
  assert.equal(f.d.run("chartRouteData('I25').chartPartial"), false);
  assert.equal(f.d.nodes.get('historyRetry').hidden, true);
  f.d.run("setChartView('zones');updateHistoryControls()");
  assert.equal(f.d.nodes.get('historyRetry').hidden, false);
  assert.match(f.d.nodes.get('chartHistoryHelp').textContent, /Retry/);
});

test('oversized alternate warming is evicted without an endless redownload loop', async () => {
  const f=continuousFixture();
  setContinuousFetch(f, async path => {
    const end=Date.parse(new URL(path,'http://fixture').searchParams.get('asOf'));
    const points=Array.from({length:35000},()=>({bucketStart:new Date(end-60000).toISOString(),avgCurrentSpeed:55}));
    return {ok:true,json:async()=>({samples:path.includes('/history?')?points:[],
      points:path.includes('/zones/trends')?points:[],buckets:[],profiles:[],features:[]})};
  });
  f.d.run("state.focusedCorridor='I25';window.ContinuousHistory.toggle()");await f.settle();
  f.d.run("setHistoryEnd(Date.parse('2026-06-19T01:00:00Z'))");
  for(let i=0;i<8;i++) {f.advance(4001);await f.settle();}
  assert.equal(f.reads.filter(path=>path.includes('zones=true')).length, 1);
  assert.ok(f.d.run("chartRouteData('I25').parts.reduce((n,part)=>n+(part.value.history?.samples?.length||0),0)") <=60000);
});

test('corridor changes cancel budget-queued alternate view warming and never resume it while disabled', async () => {
  const f = continuousFixture();
  f.d.run("state.focusedCorridor='I25';window.ContinuousHistory.toggle()"); await f.settle();
  f.d.run("setHistoryEnd(Date.parse('2026-06-19T01:00:00Z'));dashboardRequestTimes.push(...Array(46).fill(Date.now()))");
  f.advance(4001); await f.settle();
  const pending = f.d.run('dashboardReadQueue[0].signal');
  assert.equal(f.d.run('dashboardReadQueue[0].priority'), 2);
  assert.match(f.d.run('dashboardReadQueue[0].path'), /zones=true/);
  const reads = f.reads.length;
  f.d.run("applyCorridorFocus('I70',false)"); await f.settle();
  assert.equal(pending.aborted, true);
  assert.equal(f.d.run('dashboardReadQueue.length'), 0);
  f.advance(60051); await f.settle();
  assert.equal(f.reads.length, reads);
  assert.equal(f.d.run('chartHistory.endTime'), null);
  assert.equal(f.d.run('chartHistory.enabled'), false);
});

test('a late dispatched history response cannot restore history after a corridor reset', async () => {
  const f=continuousFixture();let release;
  setContinuousFetch(f, async path => {
    if(path.includes('/analytics/trends')) await new Promise(resolve=>{release=resolve;});
    return {ok:true,json:async()=>({buckets:[],samples:[],profiles:[],features:[]})};
  });
  f.d.run("state.focusedCorridor='I25';window.ContinuousHistory.toggle()");await f.settle();
  assert.equal(typeof release,'function');
  f.d.run("applyCorridorFocus('I70',false)");
  release();await f.settle();f.advance(60001);await f.settle();
  assert.equal(f.d.run('chartHistory.endTime'),null);
  assert.equal(f.d.run('chartHistory.enabled'),false);
  assert.equal(f.d.run('state.focusedCorridor'),'I70');
  assert.equal(f.reads.length,1);
});

test('missing alternate-view coverage never causes speculative zone reads', async () => {
  const f=continuousFixture();
  f.d.run("state.focusedCorridor='I25';chartHistory.bounds.get('I25').firstZoneObservedAt=null;window.ContinuousHistory.toggle()");await f.settle();
  f.d.run("setHistoryEnd(Date.parse('2026-06-19T01:00:00Z'))");
  for(let i=0;i<8;i++) {f.advance(4001);await f.settle();}
  assert.equal(f.reads.filter(path=>path.includes('zones=true')).length,0);
});

test('continuous history is opt-in and moves in fractional display frames without minute snapping', async () => {
  assert.equal(dashboard().run('window.ContinuousHistory.active'), false);
  const f = continuousFixture();
  assert.equal(f.d.run('window.ContinuousHistory.active'), true);
  f.d.run('panHistoryWindow(123456)');
  const initial = f.d.run('chartHistory.endTime');
  assert.equal(f.frames.size, 1);
  f.frame();
  const intermediate = f.d.run('chartEndTime(null)');
  assert.ok(intermediate < initial && intermediate > initial - 123456);
  assert.notEqual(intermediate % 60000, 0);
  for (let i=0;i<100;i++) f.frame();
  assert.equal(f.d.run('chartHistory.endTime'), initial - 123456);
  assert.equal(f.frames.size, 0);
  await f.settle();
});

test('continuous movement reuses bounded adjacent chunks instead of issuing a request per wheel event', async () => {
  const f = continuousFixture();
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  const initialReads = f.reads.length;
  assert.equal(initialReads, 1);
  for(let i=0;i<30;i++){f.d.run('panHistoryWindow(60000)');f.frame();}
  await f.settle();
  assert.equal(f.reads.length, initialReads);
  assert.ok(f.d.run("chartRouteData('I25').trend.buckets.length") > 0);
  f.d.run('setHistoryEnd(null)');
  assert.equal(f.d.run('chartHistory.endTime'), null);
  await f.settle();
});

test('continuous prefetch reserves live request headroom and resumes when the budget returns', async () => {
  const f = continuousFixture();
  f.d.run('dashboardRequestTimes.push(...Array(46).fill(Date.now()));window.ContinuousHistory.toggle()');
  await f.settle();assert.equal(f.reads.length, 0);
  assert.match(f.d.nodes.get('chartHistoryHelp').textContent, /shared request capacity/);
  assert.match(f.d.nodes.get('chartHistoryHelp').textContent, /automatically/);
  assert.equal(f.d.nodes.get('historyRetry').hidden, true);
  f.advance(59999);await f.settle();assert.equal(f.reads.length, 0);
  f.advance(52);await f.settle();
  assert.equal(f.reads.length, 1);
});

test('sparse detailed samples in an adjacent interval cannot suppress the next interval hourly observations', async () => {
  const f=continuousFixture();
  f.d.run(`state.selectedHours=2;
    state.routeData.get('I25').trend={buckets:[0,1,2].map(i=>({bucketStart:new Date(Date.parse('2026-06-19T02:00:00Z')-i*3600000).toISOString(),avgCurrentSpeed:60}))};
    state.routeData.get('I25').history={samples:[{polledAt:'2026-06-19T01:59:00Z',avgCurrentSpeed:61}]};`);
  setContinuousFetch(f, async path=>{
    const end=Date.parse(new URL(path,'http://fixture').searchParams.get('asOf'));
    return {ok:true,json:async()=>({buckets:[0,1,2].map(i=>({bucketStart:new Date(end-i*3600000).toISOString(),avgCurrentSpeed:55})),
      samples:[{polledAt:new Date(end-60000).toISOString(),avgCurrentSpeed:56}],profiles:[],features:[]})};
  });
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  assert.equal(f.d.run("window.ContinuousHistory.route('I25').continuousSamples.some(point=>point.timestamp===Date.parse('2026-06-19T01:00:00Z'))"),true);
});

test('continuous cache retains up to twelve adjacent intervals during long browsing', async () => {
  const f=continuousFixture();
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  for(let i=2;i<=20;i++) {
    f.advance(60001);
    f.d.run(`setHistoryEnd(Date.parse('2026-06-19T02:00:00Z')-${i}*86400000)`);
    await f.settle();
    assert.ok(f.d.run("window.ContinuousHistory.route('I25').parts.length") <= 12);
  }
  assert.ok(f.d.run("window.ContinuousHistory.route('I25').parts.length") > 4);
});

test('continuous prefetch prepares three older intervals and revisits them without reads', async () => {
  const f=continuousFixture();
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  f.advance(4001);await f.settle();f.advance(4001);await f.settle();
  assert.equal(f.d.run("window.ContinuousHistory.route('I25').parts.length"),4);
  const reads=f.reads.length;
  for(const hours of [6,12,18,12,6]) {
    f.d.run(`setHistoryEnd(Date.parse('2026-06-19T02:00:00Z')-${hours}*3600000)`);await f.settle();
  }
  assert.equal(f.reads.length, reads);
});

test('slow historical reads delay speculation but do not delay a newly visible interval', async () => {
  const f=continuousFixture();let release;
  f.d.context.window.fetch=async()=> {
    await new Promise(resolve=>{release=resolve;});
    return {ok:true,json:async()=>({})};
  };
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  assert.equal(f.d.run('dashboardRequestTimes.length'),1);
  f.advance(3000);release();await f.settle();
  f.advance(4001);await f.settle();
  assert.equal(f.d.run('dashboardRequestTimes.length'),1,'slow read leaves six seconds of speculative cooldown');
  f.d.run("setHistoryEnd(Date.parse('2026-06-19T02:00:00Z')-4*86400000)");await f.settle();
  assert.equal(f.d.run('dashboardRequestTimes.length'),2,'visible navigation bypasses only speculative cooldown');
  assert.equal(f.d.run('dashboardReadRunning'),true);
  release();await f.settle();
});

test('slow-read speculative cooldown is bounded and resumes without user retry', async () => {
  const f=continuousFixture();let release, reads=0;
  f.d.context.window.fetch=async()=> {
    reads++;
    if(reads===1) await new Promise(resolve=>{release=resolve;});
    return {ok:true,json:async()=>({})};
  };
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  f.advance(20000);release();await f.settle();
  f.advance(29999);await f.settle();assert.equal(reads,1);
  f.advance(2);await f.settle();assert.equal(reads,2);
});

test('continuous buffers survive timeframe switches and Current without refetching loaded windows', async () => {
  const f=continuousFixture();
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  f.advance(4001);await f.settle();f.advance(4001);await f.settle();
  const loaded=f.d.run("window.ContinuousHistory.route('I25').parts.length");
  f.d.run('state.selectedHours=168;refreshHistorySelection()');
  await f.settle();f.advance(4001);await f.settle();
  const reads=f.reads.length;
  f.d.run('state.selectedHours=24;refreshHistorySelection()');await f.settle();
  assert.equal(f.d.run("window.ContinuousHistory.route('I25').parts.length"), loaded);
  f.d.run("setHistoryEnd(Date.parse('2026-06-19T02:00:00Z')-3600000);setHistoryEnd(null)");await f.settle();
  assert.equal(f.reads.length, reads);
});

test('record-limited prefetch does not repeatedly download an evicted oversized interval', async () => {
  const f=continuousFixture();
  setContinuousFetch(f, async path=>{
    const end=Date.parse(new URL(path,'http://fixture').searchParams.get('asOf'));
    return {ok:true,json:async()=>({samples:Array.from({length:35000},()=>({polledAt:new Date(end-60000).toISOString(),avgCurrentSpeed:55})),
      buckets:[],profiles:[],features:[]})};
  });
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  assert.equal(f.d.run("window.ContinuousHistory.route('I25').parts.length"),1);
  f.advance(4001);await f.settle();f.advance(4001);await f.settle();
  const reads=f.reads.length;
  f.advance(60001);await f.settle();
  assert.equal(f.reads.length, reads);
});

test('hidden pages cancel a budget-resume timer without making background history reads', async () => {
  const f=continuousFixture();
  f.d.run('initializeHistoryControls();dashboardRequestTimes.push(...Array(46).fill(Date.now()));window.ContinuousHistory.toggle()');
  await f.settle();
  f.d.context.document.hidden=true;f.d.context.document.events.visibilitychange();
  f.advance(60051);await f.settle();
  assert.equal(f.reads.length,0);
  f.d.context.document.hidden=false;f.d.context.document.events.visibilitychange();await f.settle();
  assert.equal(f.reads.length,1);
});

test('returning to a complete cached range clears a budget pause and cancels unnecessary resumption', async () => {
  const f=continuousFixture();
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  f.advance(4001);await f.settle();f.advance(4001);await f.settle();
  const reads=f.reads.length;
  f.d.run("dashboardRequestTimes.push(...Array(46).fill(Date.now()));setHistoryEnd(Date.parse('2026-06-19T02:00:00Z')-4*86400000)");
  f.advance(4001);await f.settle();
  assert.match(f.d.nodes.get('chartHistoryHelp').textContent,/shared request capacity/);
  f.d.run('setHistoryEnd(null)');f.frame();
  assert.doesNotMatch(f.d.nodes.get('chartHistoryHelp').textContent,/shared request capacity/);
  f.advance(60051);await f.settle();assert.equal(f.reads.length,reads);
});

test('Current overlays fresh observations without discarding historical intervals or trapping navigation at an old anchor', async () => {
  const f=continuousFixture();
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  const historicalStart=f.d.run("window.ContinuousHistory.route('I25').parts[0].start");
  f.d.run(`state.routeData.set('I25',{summary:{latest:{polledAt:'2026-06-19T03:00:00Z'}},
    history:{samples:[{polledAt:'2026-06-19T02:59:00Z',avgCurrentSpeed:63}]},trend:{buckets:[]},incidentThreads:[]});
    refreshHistorySelection();panHistoryWindow(60000);`);
  assert.equal(f.d.run('chartHistory.endTime'),Date.parse('2026-06-19T03:00:00Z'));
  assert.ok(f.d.run("window.ContinuousHistory.route('I25').parts.some(part=>part.start==="+historicalStart+")"));
  assert.ok(f.d.run("window.ContinuousHistory.route('I25').continuousSamples.some(point=>point.timestamp===Date.parse('2026-06-19T02:59:00Z'))"));
  for(let i=0;i<100;i++) f.frame();
  f.d.run('panHistoryWindow(-60000)');for(let i=0;i<100;i++) f.frame();
  assert.equal(f.d.run('chartHistory.endTime'),null);
});

test('a long-running short-range session loads elapsed intervals, not future dates or a stale live seed', async () => {
  const f=continuousFixture();
  f.d.run('state.selectedHours=2;window.ContinuousHistory.toggle()');await f.settle();
  f.d.run(`state.routeData.set('I25',{summary:{latest:{polledAt:'2026-06-19T07:00:00Z'}},
    history:{samples:[]},trend:{buckets:[]},incidentThreads:[]});refreshHistorySelection();
    setHistoryEnd(Date.parse('2026-06-19T07:00:00Z')-3600000);`);
  f.advance(4001);await f.settle();
  assert.ok(f.reads.some(path=>path.includes(encodeURIComponent('2026-06-19T06:00:00.000Z'))));
  assert.ok(f.reads.every(path=>Date.parse(new URL(path,'http://fixture').searchParams.get('asOf')) <= Date.parse('2026-06-19T07:00:00Z')));
  assert.ok(f.d.run("window.ContinuousHistory.route('I25').parts.some(part=>!part.seed && part.end===Date.parse('2026-06-19T06:00:00Z'))"));
});

test('continuous history cancels pending reads and animation when hidden and never replaces live metrics', async () => {
  const signals=[];
  const d=dashboard(async(path,options)=>{signals.push(options.signal);
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  },'?historical=1&continuous=1');
  prepareChartHistory(d);d.run('initializeHistoryControls();panHistoryWindow(10000)');
  await new Promise(setImmediate);
  assert.equal(d.network.length,1);
  assert.equal(signals.length,8);
  d.context.document.hidden=true;d.context.document.events.visibilitychange();
  assert.ok(signals.every(signal=>signal.aborted));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(d.run('state.routeData.size'),1);
  assert.equal(d.run('chartHistory.endTime'), Date.parse('2026-06-19T02:00:00Z'));
});

test('continuous raster reuse keeps the speed axis stationary while the plot moves', async () => {
  const f = continuousFixture();
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  let bakes=0;const images=[],domains=[];
  f.d.context.capture = frame => {
    bakes++;domains.push(frame.domain);
    assert.ok(frame.trendSamples.every(point => point.timestamp >= frame.end - frame.hours * 3600000
      && point.timestamp <= frame.end), 'smoothing halo must not paint into the stationary axis');
  };
  const context={setTransform(){},clearRect(){},drawImage(...args){images.push(args);},
    save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
  f.d.context.canvas={width:0,height:0,getBoundingClientRect:()=>({width:1000,height:158}),getContext:()=>context,
    closest:()=>({style:{removeProperty(){}}})};
  f.d.run("drawCorridorChart=(canvas,corridor,route,frame)=>capture(frame);chartColors=()=>({muted:'gray'});panHistoryWindow(60000)");f.frame();
  f.d.run("window.ContinuousHistory.paint(canvas,'I25')");
  const firstOffset=images[0][1];
  f.d.run('panHistoryWindow(60000)');f.frame();
  f.d.run("window.ContinuousHistory.paint(canvas,'I25')");
  assert.equal(bakes,1);
  assert.notEqual(images[2][1],firstOffset);
  assert.equal(images[1][1],0);assert.equal(images[3][1],0);
  assert.ok(domains[0].min <= Math.min(...f.d.run("window.ContinuousHistory.route('I25').continuousSamples.filter(point=>point.timestamp>=chartHistory.endTime-state.selectedHours*3600000&&point.timestamp<=chartHistory.endTime).map(point=>point.speed)")));
  assert.equal(f.d.run("state.routeData.get('I25').summary.latest.polledAt"),'2026-06-19T02:00:00Z');
});

test('Current and continuous history share the tighter Overall plot gutter',async()=>{
  const current=liveEdgeFixture();
  current.d.run(`canvas={getContext:()=>ctx,getBoundingClientRect:()=>dimensions,
    closest:()=>({style:{removeProperty(){}}})};chartColors=()=>({});drawCorridorChart(canvas,'I25',route)`);
  assert.ok(current.moves.some(([x])=>x===34));
  const history=axisFixture();history.d.run('window.ContinuousHistory.toggle()');
  await history.settle();history.paint();
  assert.ok(history.images.some(args=>args[5]===34&&args[7]===948), 'retained raster uses the same origin and full available plot width');
});

test('unchanged reference-band descriptions and tooltips avoid repeated DOM writes',async()=>{
  const f=axisFixture();let descriptions=0,titles=0,title='';
  const canvas=f.d.context.canvas;
  canvas.getAttribute=key=>f.attributes[key];
  canvas.setAttribute=(key,value)=>{f.attributes[key]=value;descriptions++;};
  Object.defineProperty(canvas,'title',{get:()=>title,set:value=>{title=value;titles++;}});
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  f.paint();const firstDescription=f.attributes['aria-description'];
  f.paint();assert.equal(descriptions,1);assert.equal(titles,1);
  f.d.run('state.referenceSigma=0');f.paint();
  assert.notEqual(f.attributes['aria-description'],firstDescription);
  assert.equal(descriptions,2);assert.equal(titles,2);
});

test('continuous axes fit visible values instead of off-screen speeds or full uncertainty bands', async () => {
  const f = axisFixture();
  f.d.run("state.routeData.get('I25').history.samples[0].polledAt='2026-06-19T00:40:00Z'");
  setContinuousFetch(f, async path => {
    const end=Date.parse(new URL(path,'http://fixture').searchParams.get('asOf'));
    return {ok:true,json:async()=>({samples:[
      {polledAt:new Date(end-3600000).toISOString(),avgCurrentSpeed:15},
      {polledAt:new Date(end-600000).toISOString(),avgCurrentSpeed:60}],
      buckets:[],profiles:f.d.context.profiles,features:[]})};
  });
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();f.paint();
  const frame=f.bakes[0];
  assert.ok(frame.samples.some(point=>point.speed===15), 'the off-screen slowdown remains in the cached strip');
  assert.ok(frame.domain.min>=50 && frame.domain.max<=70, JSON.stringify({domain:frame.domain,
    samples:frame.samples.map(point=>[new Date(point.timestamp).toISOString(),point.speed]),
    trend:frame.trendSamples.map(point=>[new Date(point.timestamp).toISOString(),point.speed])}));
  assert.ok(f.arrows.length>=2);
  assert.match(f.attributes['aria-description'],/reference band continuing beyond/);
  assert.match(f.d.context.canvas.title,/continues beyond/);
});

test('a visible slowdown expands the axis immediately and settled scrolling contracts it in bounded steps',async()=>{
  const f=axisFixture();
  f.d.run("state.routeData.get('I25').history.samples[1].avgCurrentSpeed=15;window.ContinuousHistory.toggle()");
  await f.settle();f.paint();assert.ok(f.bakes.at(-1).domain.min<=15);
  f.d.run('panHistoryWindow(3600000)');for(let i=0;i<100;i++)f.frame();await f.settle();f.paint();
  const before=f.bakes.length;
  for(let step=0;step<6;step++){f.advance(step?60:180);f.frame();f.paint();}
  const fitted=f.bakes.at(-1).domain;
  assert.ok(fitted.min>=50 && fitted.max<=70);
  assert.ok(f.bakes.length-before<=6, 'contraction must not create an unbounded raster animation');
  assert.ok(f.bakes.slice(before).every(frame=>frame.domain.min<=58 && frame.domain.max>=60));
  const bakes=f.bakes.length;
  f.advance(1000);f.frame();f.paint();assert.equal(f.bakes.length,bakes);
});

test('small pans keep the cached raster and hiding cancels pending axis contraction',async()=>{
  const f=axisFixture();f.d.run('window.ContinuousHistory.toggle()');await f.settle();f.paint();
  const first=f.bakes.length;
  for(let i=0;i<5;i++){f.d.run('panHistoryWindow(1000)');f.frame();f.paint();}
  assert.equal(f.bakes.length,first);
  f.d.context.document.hidden=true;f.d.run('window.ContinuousHistory.pause()');
  f.advance(2000);f.frame();assert.equal(f.bakes.length,first);
});

test('continuous zone axes retain posted limits and changed road definitions',async()=>{
  const f=axisFixture();f.d.run(`state.chartView='zones';state.focusedCorridor='I25';
    state.routeData.get('I25').zones=[{zoneKey:'test',zoneOrder:0,startMileMarker:208,endMileMarker:221,
      postedSpeedMph:75,bucketStart:'2026-06-19T01:00:00Z',avgCurrentSpeed:59}];
    state.routeData.get('I25').zoneBaseline={zones:[{zoneKey:'test',startMileMarker:208,endMileMarker:221,
      postedSpeedMph:75,profiles}]};
    drawZoneChart=(canvas,corridor,data,frame)=>capture(frame);drawSpeedZoneDescriptor=()=>{};
    window.ContinuousHistory.toggle();`);
  await f.settle();f.paint();
  const domain=f.bakes[0].domains.get('test|208|221|75');
  assert.ok(domain.min<=59 && domain.max>=75);
  assert.ok(domain.max-domain.min<60);
});

test('reference-band widths change uncertainty without changing the continuous speed range',async()=>{
  const f=axisFixture();f.d.run('window.ContinuousHistory.toggle()');await f.settle();f.paint();
  const first=f.bakes.at(-1).domain;
  for(const sigma of [1,3]){
    f.d.context.sigma=sigma;f.d.run('state.referenceSigma=sigma');f.paint();
    assert.deepEqual({...f.bakes.at(-1).domain},{...first});
    assert.match(f.attributes['aria-description'],/reference band/);
  }
});

test('large continuous charts keep full-resolution direct rendering and uncertainty markers',async()=>{
  const f=axisFixture();f.d.context.window.devicePixelRatio=2;
  f.d.context.canvas.getBoundingClientRect=()=>({width:3000,height:900});
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();f.paint();
  assert.equal(f.d.context.canvas.width,6000);assert.equal(f.d.context.canvas.height,1800);
  assert.equal(f.bakes.at(-1).hours,2,'raster cap uses the visible window without lowering resolution');
  assert.match(f.attributes['aria-description'],/reference band continuing beyond/);
});

test('continuous speed zones keep different road definitions separate and cache stationary descriptors', async () => {
  const f=continuousFixture();
  f.d.context.profiles=Array.from({length:168},(_,i)=>({dayOfWeek:Math.floor(i/24)+1,hourOfDay:i%24,meanSpeed:60,standardDeviation:2,
    effectiveSampleSize:9,coverageTwoSigma:94}));
  f.d.run(`state.chartView='zones';state.focusedCorridor='I70';state.routeData.set('I70',{zones:[{
    zoneKey:'same',zoneOrder:0,startMileMarker:206,endMileMarker:213,postedSpeedMph:60,
    bucketStart:'2026-06-19T01:00:00Z',avgCurrentSpeed:55}],zoneBaseline:{zones:[{
      zoneKey:'same',startMileMarker:206,endMileMarker:213,postedSpeedMph:60,profiles}]}});`);
  setContinuousFetch(f, async path=>{
    const end=Date.parse(new URL(path,'http://fixture').searchParams.get('asOf'));
    return {ok:true,json:async()=>({points:[{zoneKey:'same',zoneOrder:0,startMileMarker:206,endMileMarker:214,
      postedSpeedMph:55,bucketStart:new Date(end-3600000).toISOString(),avgCurrentSpeed:51}],zones:[{
        zoneKey:'same',startMileMarker:206,endMileMarker:214,postedSpeedMph:55,profiles:f.d.context.profiles}],features:[]})};
  });
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  assert.equal(f.d.run("window.ContinuousHistory.route('I70').layoutGroups.length"),2);
  const context={setTransform(){},clearRect(){},drawImage(){},save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
  f.d.context.document.createElement=()=>({getContext:()=>context});
  let descriptors=0,bakes=0;f.d.context.descriptor=()=>descriptors++;f.d.context.bake=frame=>{
    bakes++;
    const boundary=Date.parse('2026-06-18T02:00:00Z');
    const old=frame.baselines.get('same|206|214|55'),current=frame.baselines.get('same|206|213|60');
    assert.ok(old.length>0&&current.length>0);
    assert.ok(old.every(point=>point.timestamp<=boundary));
    assert.ok(current.every(point=>point.timestamp>=boundary));
  };
  f.d.context.canvas={width:0,height:0,getBoundingClientRect:()=>({width:1000,height:1026}),getContext:()=>context,
    closest:()=>({style:{setProperty(){}}})};
  f.d.run("drawZoneChart=(canvas,corridor,data,frame)=>bake(frame);drawSpeedZoneDescriptor=()=>descriptor();chartColors=()=>({});panHistoryWindow(10000)");f.frame();
  f.d.run("window.ContinuousHistory.paint(canvas,'I70')");
  f.d.run('panHistoryWindow(10000)');f.frame();
  f.d.run("window.ContinuousHistory.paint(canvas,'I70')");
  assert.equal(bakes,1);assert.equal(descriptors,2);
  assert.equal(f.d.run('referenceCoveragePercentage()'),94);
  const reads=f.reads.length, end=f.d.run('chartHistory.endTime');
  f.d.run("state.zoneFinder=true;window.ContinuousHistory.paint(canvas,'I70')");
  assert.equal(bakes,2,'finder activation rebuilds the stationary axis even at the same canvas width');
  f.d.run("window.ContinuousHistory.paint(canvas,'I70')");
  assert.equal(bakes,2,'steady finder redraws reuse the new raster');
  f.d.run("state.zoneFinder=false;window.ContinuousHistory.paint(canvas,'I70')");
  assert.equal(bakes,3,'finder deactivation restores the original gutter');
  assert.equal(f.reads.length,reads);
  assert.equal(f.d.run('chartHistory.endTime'),end);
});

test('continuous history failures keep the healthy corridor and require explicit retry', async () => {
  const f=continuousFixture();let failed=true;
  setContinuousFetch(f, async path=> failed && path.includes('I70')
    ? {ok:false,status:503} : {ok:true,json:async()=>({buckets:[{bucketStart:'2026-06-17T02:00:00Z',avgCurrentSpeed:50}],profiles:[],features:[]})});
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  assert.ok(f.d.run("window.ContinuousHistory.route('I25')"));
  assert.equal(f.d.run("window.ContinuousHistory.route('I70')"),null);
  assert.equal(f.d.nodes.get('historyRetry').hidden,false);
  f.d.run('chartHistory.endTime=Date.parse("2026-06-18T02:00:00Z")');
  assert.match(f.d.run("chartHistoryEmptyMessage('No retained observations','I70')"),/could not load.*Retry/);
  const before=f.reads.length;
  f.advance(4001);await f.settle();
  assert.equal(f.reads.length,before+1,'other adjacent intervals may preload but the failed interval must not retry');
  assert.equal(f.d.nodes.get('historyRetry').hidden,false);
  failed=false;f.d.run('window.ContinuousHistory.retry()');f.advance(4001);await f.settle();
  assert.ok(f.d.run("window.ContinuousHistory.route('I70')"));
});

test('missing zone profiles cannot borrow the corridor legacy baseline', () => {
  const f=continuousFixture();
  f.d.run(`state.chartView='zones';state.focusedCorridor='I25';
    const seed=state.routeData.get('I25');
    seed.trend={buckets:Array.from({length:200},(_,i)=>({bucketStart:new Date(Date.parse('2026-06-19T02:00:00Z')-i*3600000).toISOString(),avgCurrentSpeed:50}))};
    seed.zones=[{zoneKey:'zone',zoneOrder:0,startMileMarker:208,endMileMarker:221.5,postedSpeedMph:55,bucketStart:'2026-06-19T01:00:00Z',avgCurrentSpeed:40}];
    seed.zoneBaseline={zones:[]};
    chartHistory.endTime=Date.parse('2026-06-19T01:30:00Z');`);
  assert.equal(f.d.run("window.ContinuousHistory.reference('I25',Date.parse('2026-06-18T02:00:00Z'),Date.parse('2026-06-19T02:00:00Z')).length"),0);
});

for(const prepared of [false,true]) test(`continuous HTTP rate limits recover controls without automatic failed retries (prepared=${prepared})`, async () => {
  const f=continuousFixture(`?historical=1&continuous=1&prepared=${Number(prepared)}`);let reads=0,failed=true;
  const success=require("../dashboard-batch-fixture.cjs").batchFetch(async()=>({ok:true,
    json:async()=>({buckets:[],samples:[],profiles:[],features:[]})}));
  f.d.context.window.fetch=async (path,options)=>{
    reads++;
    return failed ? {ok:false,status:429,headers:{get:()=> '60'}}
      : success(path,options);
  };
  f.d.run('initializeHistoryControls();window.ContinuousHistory.toggle()');await f.settle();
  const before=reads;
  assert.equal(f.d.nodes.get('historyRetry').disabled,true);
  assert.match(f.d.nodes.get('chartHistoryHelp').textContent,/Retry available after/);
  f.d.run('window.ContinuousHistory.retry()');f.advance(4001);await f.settle();
  assert.equal(reads,before);
  assert.equal(f.d.run('dashboardRetryUntil'),f.d.run('chartHistory.rateUntil'));
  f.advance(60001);await f.settle();assert.equal(reads,before);
  assert.equal(f.d.nodes.get('historyRetry').disabled,false);
  assert.match(f.d.nodes.get('chartHistoryHelp').textContent,/Choose Retry/);
  failed=false;f.d.nodes.get('historyRetry').events.click();await f.settle();
  assert.ok(reads>before);
  if(!prepared) assert.equal(reads,before+1);
  assert.equal(f.d.run('chartHistory.rateUntil'),0);
  assert.equal(f.d.nodes.get('historyRetry').hidden,true);
  assert.doesNotMatch(f.d.nodes.get('chartHistoryHelp').textContent,/read limit|unavailable/);
  f.d.run('window.ContinuousHistory.pause()');
});

test('a renewed server wait refreshes Retry only at the latest deadline without reading history', () => {
  const f=continuousFixture();
  f.d.run('chartHistory.rateUntil=Date.now()+60000;updateHistoryControls()');
  f.advance(30000);
  f.d.run('chartHistory.rateUntil=Date.now()+60000;updateHistoryControls()');
  f.advance(30001);
  assert.equal(f.d.nodes.get('historyRetry').disabled,true);
  f.advance(30000);
  assert.equal(f.d.nodes.get('historyRetry').disabled,false);
  assert.equal(f.reads.length,0);
});

test('a failed manual retry clears the old rate warning but preserves unavailable history', async () => {
  const f=continuousFixture();
  setContinuousFetch(f,async()=>({ok:false,status:503}));
  f.d.run('window.ContinuousHistory.toggle()');await f.settle();
  f.d.run('chartHistory.rateUntil=Date.now()-1;window.ContinuousHistory.retry()');
  f.advance(4001);await f.settle();
  assert.equal(f.d.run('chartHistory.rateUntil'),0);
  assert.equal(f.d.nodes.get('historyRetry').hidden,false);
  assert.equal(f.d.nodes.get('historyRetry').disabled,false);
  assert.match(f.d.nodes.get('chartHistoryHelp').textContent,/unavailable.*Retry/);
  assert.doesNotMatch(f.d.nodes.get('chartHistoryHelp').textContent,/read limit/);
  const before=f.reads.length;
  const failedEnds=new Set(f.reads.map(path=>new URL(path,'http://fixture').searchParams.get('asOf')));
  f.advance(4001);await f.settle();
  f.advance(60001);await f.settle();
  const adjacentEnds=f.reads.slice(before).map(path=>new URL(path,'http://fixture').searchParams.get('asOf'));
  assert.ok(adjacentEnds.every(end=>!failedEnds.has(end)),'failed intervals never retry automatically');
  assert.equal(new Set(adjacentEnds).size,adjacentEnds.length);
  f.d.run('window.ContinuousHistory.pause()');
});

for(const lifecycle of ['visibility','page']) test(`Retry expiry is cancelled while ${lifecycle} is inactive and restored on return`, () => {
  const d=dashboard(undefined,'?historical=1');
  prepareChartHistory(d);const clock=historyHoverClock(d);
  let now=Date.parse('2026-06-19T02:00:00Z');
  d.context.Date=class extends Date{static now(){return now;}};
  d.run('initializeHistoryControls();chartHistory.rateUntil=Date.now()+60000;updateHistoryControls()');
  assert.ok(d.run('chartHistory.rateTimer')!==null);
  if(lifecycle==='visibility'){
    d.context.document.hidden=true;d.context.document.events.visibilitychange();
  }else d.context.window.events.pagehide({persisted:true});
  assert.equal(d.run('chartHistory.rateTimer'),null);
  now+=30000;clock.advance(30000);
  if(lifecycle==='visibility'){
    d.context.document.hidden=false;d.context.document.events.visibilitychange();
  }else d.context.window.events.pageshow({persisted:true});
  assert.equal(d.nodes.get('historyRetry').disabled,true);
  assert.ok(d.run('chartHistory.rateTimer')!==null,'returning before expiry rearms the UI timer');
  if(lifecycle==='visibility'){
    d.context.document.hidden=true;d.context.document.events.visibilitychange();
  }else d.context.window.events.pagehide({persisted:true});
  now+=60001;clock.advance(60001);
  assert.equal(d.nodes.get('historyRetry').disabled,true,'inactive pages do not refresh their controls');
  if(lifecycle==='visibility'){
    d.context.document.hidden=false;d.context.document.events.visibilitychange();
  }else d.context.window.events.pageshow({persisted:true});
  assert.equal(d.nodes.get('historyRetry').disabled,false);
  assert.equal(d.network.length,0);
});

test('shared scheduler dispatches snapshots before visible history before speculative prefetch', async () => {
  const d=dashboard(), requests=[], release=[];
  d.context.window.fetch=async path=>{
    requests.push(path);
    return new Promise(resolve=>release.push(()=>resolve({ok:true,json:async()=>({})})));
  };
  const first=d.run("fetchDashboardBatch('/dashboard-api/traffic/dashboard/history?hours=2&block=1')");
  const preload=d.run("fetchDashboardBatch('/dashboard-api/traffic/dashboard/history?hours=24&preload=1',null,{priority:2})");
  const visible=d.run("fetchDashboardBatch('/dashboard-api/traffic/dashboard/history?hours=6&visible=1')");
  const snapshot=d.run("fetchDashboardBatch('/dashboard-api/traffic/dashboard/snapshot?ranges=24')");
  assert.equal(requests.length,1);
  release.shift()();await first;await new Promise(setImmediate);
  assert.match(requests[1],/snapshot/);
  release.shift()();await snapshot;await new Promise(setImmediate);
  assert.match(requests[2],/visible=1/);
  release.shift()();await visible;await new Promise(setImmediate);
  assert.match(requests[3],/preload=1/);
  release.shift()();await preload;
});

test('budget-queued batches send only version hints still owned at actual dispatch', async () => {
  const d=dashboard(), requests=[];
  d.context.window.fetch=async path=>{requests.push(path);return {ok:true,json:async()=>({})};};
  d.run("state.readSections.set('old',{version:'old-version'});dashboardRequestTimes.push(...Array(46).fill(Date.now()))");
  const pending=d.run("readDashboardBatch('/dashboard-api/traffic/dashboard/history?hours=24')");
  assert.equal(requests.length,0);
  d.run("state.readSections.clear();state.readSections.set('new',{version:'new-version'});dashboardRequestTimes.length=0;window.clearTimeout(dashboardReadTimer);dashboardReadTimer=null;drainDashboardReads()");
  await pending;
  assert.equal(new URL(requests[0],'http://fixture').searchParams.get('known'),'new-version');
});

test('continuous navigation cancels obsolete queued prefetch without using another request slot', async () => {
  const f=continuousFixture();
  f.d.run('dashboardRequestTimes.push(...Array(46).fill(Date.now()));window.ContinuousHistory.toggle()');
  await f.settle();
  const obsolete=f.d.run('dashboardReadQueue[0].signal');
  assert.equal(f.d.run('dashboardReadQueue[0].priority'),2);
  f.d.run("setHistoryEnd(Date.parse('2026-06-19T02:00:00Z')-4*86400000)");await f.settle();
  assert.equal(obsolete.aborted,true);
  assert.equal(f.d.run('dashboardReadQueue.length'),1);
  assert.equal(f.d.run('dashboardReadQueue[0].priority'),1);
  assert.match(f.d.run('dashboardReadQueue[0].path'),/2026-06-15/);
  assert.equal(f.reads.length,0);
  assert.equal(f.d.run('dashboardRequestTimes.length'),46);
  f.advance(60051);await f.settle();
  assert.equal(f.reads.length,1);
  assert.match(f.reads[0],/2026-06-15/);
  assert.equal(f.d.run("[...state.readSections.keys()].every(key=>key.includes('/baselines?'))"),true);
});

test('queued speculative history becomes visible priority when its interval enters the viewport', async () => {
  const f=continuousFixture();
  f.d.run('dashboardRequestTimes.push(...Array(46).fill(Date.now()));window.ContinuousHistory.toggle()');await f.settle();
  const obsolete=f.d.run('dashboardReadQueue[0].signal');
  f.d.run("setHistoryEnd(Date.parse('2026-06-18T02:00:00Z'))");await f.settle();
  assert.equal(obsolete.aborted,true);
  assert.equal(f.d.run('dashboardReadQueue.length'),1);
  assert.equal(f.d.run('dashboardReadQueue[0].priority'),1);
  assert.equal(f.reads.length,0);
  f.advance(60051);await f.settle();assert.equal(f.reads.length,1);
});

test('continuous batch preview gives overlapping speed-zone timestamps identical observations', async t => {
  const server=require('node:http').createServer(require("../dashboard-preview.cjs").handleRequest);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const points=[];
  for(const anchor of ['2026-10-07T15:11:00Z','2026-10-07T15:49:00Z']) {
    const reply=await fetch(`${base}/dashboard-api/traffic/dashboard/history?corridors=I70&hours=2&zones=true&asOf=${anchor}&continuous=1`);
    assert.equal(reply.status,200);
    const sections=await reply.json();
    points.push(Object.values(sections).find(section=>section.data?.points)?.data.points);
  }
  const first=new Map(points[0].map(point=>[`${point.zoneKey}|${point.bucketStart}`,point.avgCurrentSpeed]));
  const overlap=points[1].filter(point=>first.has(`${point.zoneKey}|${point.bucketStart}`));
  assert.ok(overlap.length>0);
  for(const point of overlap) assert.equal(point.avgCurrentSpeed,first.get(`${point.zoneKey}|${point.bucketStart}`));
});
