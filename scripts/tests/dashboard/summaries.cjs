const { test } = require('node:test');
const { assert, indexSource, dashboard, vm, windowSummarySource } = require('../fixtures/core.cjs');
const { summaryFixture, historyHoverClock, prepareChartHistory, clickHistoryRange, continuousFixture, progressiveSummaryFixture } = require('../fixtures/history.cjs');

test('historical cards wait for a settled graph, share one compact read and report uncapped totals',async()=>{
  const f=summaryFixture();f.d.run('window.HistoricalSummary.schedule()');
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'—');
  f.clock.advance(149);await f.settle();assert.equal(f.reads.length,0);
  f.clock.advance(1);await f.settle();assert.equal(f.reads.length,1);
  assert.match(f.reads[0].path,/window-summary\?corridors=I25,I70/);
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'55');
  assert.equal(f.d.nodes.get('i70ActiveIncidents').textContent,'1501');
  assert.equal(f.d.nodes.get('i25Summary').attributes['aria-busy'],'false');
  assert.equal(f.d.nodes.get('i25AverageSpeedLabel').textContent,'Window Avg Speed');
  assert.equal(f.d.nodes.get('i25WorstSegmentLabel').textContent,'Slowest Avg Zone');
});

test('both historical cards separate speed units and hide them while a replacement window loads',async()=>{
  const f=summaryFixture();f.d.run('window.HistoricalSummary.schedule()');
  f.clock.advance(150);await f.settle();
  for (const prefix of ['i25','i70']) {
    assert.equal(f.d.nodes.get(`${prefix}WorstSpeed`).textContent,'40');
    assert.equal(f.d.nodes.get(`${prefix}WorstSpeedUnit`).hidden,false);
    assert.match(indexSource,new RegExp(`<span id="${prefix}WorstSpeed"></span> <small id="${prefix}WorstSpeedUnit" hidden>mph</small>`));
  }
  f.move(Date.parse('2026-06-17T02:00:00Z'));
  for (const prefix of ['i25','i70']) {
    assert.equal(f.d.nodes.get(`${prefix}WorstSpeed`).textContent,'');
    assert.equal(f.d.nodes.get(`${prefix}WorstSpeedUnit`).hidden,true);
  }
});

test('continuous motion within one minute keeps the summary debounce alive without issuing reads',async()=>{
  const f=summaryFixture(),end=Date.parse('2026-06-18T02:00:00Z');f.move(end);
  for(let i=1;i<=12;i++){f.clock.advance(100);f.move(end-i*1000);await f.settle();}
  assert.equal(f.reads.length,0);f.clock.advance(300);await f.settle();assert.equal(f.reads.length,1);
});

test('retained corridor travel estimates describe their method and Current restores live meaning',async()=>{
  const f=summaryFixture(async path=>{
    const url=new URL(path,'http://fixture'),hours=Number(url.searchParams.get('hours')),end=Date.parse(url.searchParams.get('asOf'));
    return {ok:true,json:async()=>({I25:{corridor:'I25',hours,start:new Date(end-hours*3600000).toISOString(),end:new Date(end).toISOString(),
      averageTravelMinutes:54.9,fastestTravelMinutes:52.4,slowestTravelMinutes:76.2,travelMethod:'CORRIDOR_AVERAGES',
      speedAvailable:true,zonesAvailable:true,incidentsAvailable:true}})};
  });
  f.d.run("state.focusedCorridor='I25';chartHistory.dataKey=historyWindowKey()");
  f.d.run('window.HistoricalSummary.schedule()');f.clock.advance(150);await f.settle();
  assert.equal(f.d.nodes.get('i25TravelTime').textContent,'55');assert.equal(f.d.nodes.get('i25FastestTravelTime').textContent,'52');
  assert.equal(f.d.nodes.get('i25SlowestTravelTime').textContent,'76');
  assert.match(f.d.nodes.get('i25TravelTimeLabel').title,/each retained corridor-average speed/);
  assert.match(f.d.nodes.get('i25TravelTimeRange').title,/distance \/ speed.*not individual vehicle journeys/);
  assert.equal(f.d.nodes.get('i25WorstMileMarker').textContent,'—');
  f.d.run('chartHistory.endTime=null;window.HistoricalSummary.schedule()');
  assert.match(f.d.nodes.get('i25TravelTimeLabel').title,/current half-mile/);
});

test('summaries never request data ahead of an unloaded or gapped graph',async()=>{
  const f=summaryFixture();f.d.run('chartHistory.dataKey=null;window.HistoricalSummary.schedule()');
  f.clock.advance(300);await f.settle();assert.equal(f.reads.length,0);
  f.d.run('chartHistory.dataKey=historyWindowKey();window.HistoricalSummary.schedule()');
  f.clock.advance(300);await f.settle();assert.equal(f.reads.length,1);
  f.d.run("chartHistory.endTime-=3600000;window.ContinuousHistory={active:true,route:()=>({parts:[{start:0,end:1,value:{}}]})};window.HistoricalSummary.schedule()");
  f.clock.advance(300);await f.settle();assert.equal(f.reads.length,1);
});

test('slow summary reads do not hold the foreground graph request slot',async()=>{
  let release;const f=summaryFixture(path=>path.includes('/window-summary?')?new Promise(resolve=>release=resolve):Promise.resolve({ok:true,json:async()=>({})}));
  f.d.run('window.HistoricalSummary.schedule()');f.clock.advance(300);await f.settle();
  assert.equal(f.d.run('dashboardReadRunning'),false);
  f.d.run("void fetchDashboardBatch('/dashboard-api/traffic/analytics/coverage?corridor=I25',new AbortController().signal)");
  await f.settle();assert.equal(f.reads.length,2);assert.match(f.reads[1].path,/coverage/);
  f.d.run('chartHistory.endTime=null;window.HistoricalSummary.schedule()');release({ok:true,json:async()=>({})});await f.settle();
});

test('ready cards dispatch while an unrelated graph preload is still running',async()=>{
  let release;
  const f=summaryFixture();
  f.d.context.window.fetch=path=>{f.reads.push({path});return path.includes('preload=1')?new Promise(resolve=>release=resolve)
    : Promise.resolve({ok:true,json:async()=>({})});};
  const preload=f.d.run("fetchDashboardBatch('/dashboard-api/traffic/dashboard/history?hours=24&preload=1',null,{priority:2})");
  f.d.run('window.HistoricalSummary.schedule()');f.clock.advance(150);await f.settle();
  assert.equal(f.reads.length,2);assert.match(f.reads[1].path,/window-summary/);
  assert.equal(f.d.run('dashboardReadRunning'),true);
  release({ok:true,json:async()=>({})});await preload;await f.settle();
});

test('card reads have one slot and cannot stop visible graph reads or spend aborted queued capacity',async()=>{
  const d=dashboard(),reads=[],release=new Map();
  d.context.window.fetch=path=>{reads.push(path);return new Promise(resolve=>release.set(path,resolve));};
  const clock=historyHoverClock(d);
  const first=d.run("fetchDashboardBatch('summary-one',null,{background:true})");
  const second=d.run("fetchDashboardBatch('summary-two',null,{background:true})");
  const aborted=d.run("queuedSummary=new AbortController();fetchDashboardBatch('summary-obsolete',queuedSummary.signal,{background:true}).catch(()=>{})");
  const graph=d.run("fetchDashboardBatch('visible-graph')");
  assert.deepEqual(reads,['summary-one','visible-graph']);
  d.run('queuedSummary.abort()');await aborted;
  assert.equal(d.run('dashboardRequestTimes.length'),2);
  release.get('summary-one')({ok:true,json:async()=>({})});await first;await new Promise(setImmediate);
  assert.deepEqual(reads,['summary-one','visible-graph','summary-two']);
  release.get('summary-two')({ok:true,json:async()=>({})});await second;
  release.get('visible-graph')({ok:true,json:async()=>({})});await graph;
  assert.equal(clock.timers.size,0);
});

test('the independent card lane preserves shared live reserves and server cooldowns',async()=>{
  const d=dashboard(),reads=[];
  d.context.window.fetch=async path=>{reads.push(path);return {ok:true,json:async()=>({})};};
  const clock=historyHoverClock(d);
  d.run('dashboardRequestTimes.push(...Array(46).fill(Date.now()))');
  const card=d.run("fetchDashboardBatch('summary',null,{background:true})");
  const live=d.run("fetchDashboardBatch('/dashboard-api/traffic/dashboard/snapshot?ranges=24')");
  await live;await new Promise(setImmediate);
  assert.equal(reads.length,1);assert.match(reads[0],/snapshot/);
  assert.equal(d.run('dashboardRequestTimes.length'),47);
  d.run('dashboardRequestTimes.length=0;dashboardRetryUntil=Date.now()+60000;window.clearTimeout(dashboardReadTimer);dashboardReadTimer=null;drainDashboardReads()');
  assert.equal(reads.length,1);
  d.run('dashboardRetryUntil=0;window.clearTimeout(dashboardReadTimer);dashboardReadTimer=null;drainDashboardReads()');
  await card;assert.equal(reads.length,2);assert.equal(clock.timers.size,0);
});

test('a budget-paused card cannot strand an already queued live snapshot behind its timer',async()=>{
  const d=dashboard(),reads=[];let release;
  d.context.window.fetch=path=>{reads.push(path);return path==='graph-preload'?new Promise(resolve=>release=resolve)
    : Promise.resolve({ok:true,json:async()=>({})});};
  historyHoverClock(d);d.run('dashboardRequestTimes.push(...Array(45).fill(Date.now()))');
  const graph=d.run("fetchDashboardBatch('graph-preload',null,{priority:2})");
  const live=d.run("fetchDashboardBatch('/dashboard-api/traffic/dashboard/snapshot?ranges=24')");
  const cards=d.run("fetchDashboardBatch('cards',null,{background:true})");
  assert.equal(reads.length,1);assert.notEqual(d.run('dashboardReadTimer'),null);
  release({ok:true,json:async()=>({})});await graph;await new Promise(setImmediate);
  assert.equal(reads.length,2);assert.match(reads[1],/snapshot/);await live;
  assert.equal(d.run('dashboardRequestTimes.length'),47);
  d.run('dashboardRequestTimes.length=0;window.clearTimeout(dashboardReadTimer);dashboardReadTimer=null;drainDashboardReads()');
  await cards;assert.equal(reads.length,3);
});

test('discrete navigation settles cards in 50ms while wheel input remains coalesced for 150ms',async()=>{
  const f=summaryFixture(),end=Date.parse('2026-06-18T02:00:00Z');
  f.d.run("window.HistoricalSummary.navigation('discrete');window.HistoricalSummary.schedule()");
  f.clock.advance(49);await f.settle();assert.equal(f.reads.length,0);
  f.clock.advance(1);await f.settle();assert.equal(f.reads.length,1);
  f.d.run("window.HistoricalSummary.navigation('wheel')");f.move(end-3600000);
  for(let i=1;i<=6;i++){f.clock.advance(100);f.move(end-3600000-i*1000);await f.settle();}
  assert.equal(f.reads.length,1);f.clock.advance(149);await f.settle();assert.equal(f.reads.length,1);
  f.clock.advance(1);await f.settle();assert.equal(f.reads.length,2);
});

test('short settling never sends card reads during continuous graph motion',async()=>{
  const f=summaryFixture(),end=Date.parse('2026-06-18T02:00:00Z');
  f.d.run("window.ContinuousHistory={active:true,moving:true,route:()=>({parts:[{start:0,end:Date.parse('2027-01-01T00:00:00Z'),value:{}}]})};window.HistoricalSummary.navigation('discrete')");
  for(let i=0;i<8;i++){f.move(end-i*60000);f.clock.advance(120);await f.settle();}
  assert.equal(f.reads.length,0);
  f.d.run('window.ContinuousHistory.moving=false;window.HistoricalSummary.schedule()');
  f.clock.advance(50);await f.settle();assert.equal(f.reads.length,1);
});

test('destination cards load alongside easing without following its intermediate timestamps',async()=>{
  const f=summaryFixture(),destination=Date.parse('2026-06-17T02:00:00Z');
  f.d.context.destination=destination;
  f.d.run(`window.ContinuousHistory={active:true,moving:true,requestedEnd:destination,
    route:()=>({parts:[{start:0,end:Date.parse('2027-01-01T00:00:00Z'),value:{}}]})};
    window.HistoricalSummary.navigation('discrete');window.HistoricalSummary.schedule()`);
  f.clock.advance(49);await f.settle();assert.equal(f.reads.length,0);
  f.clock.advance(1);await f.settle();assert.equal(f.reads.length,1);
  assert.equal(Date.parse(new URL(f.reads[0].path,'http://fixture').searchParams.get('asOf')),destination);
  assert.equal(f.d.run('window.ContinuousHistory.moving'),true);
  for(let i=0;i<12;i++) {
    f.d.run(`chartHistory.endTime=destination+${12000-i*1000};window.HistoricalSummary.schedule()`);
    f.clock.advance(16);await f.settle();
  }
  assert.equal(f.reads.length,1);
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'55');
  f.d.run('chartHistory.endTime=destination;window.ContinuousHistory.moving=false;window.HistoricalSummary.schedule()');
  f.clock.advance(200);await f.settle();assert.equal(f.reads.length,1);
});

test('moving destinations still coalesce wheel input and wait for target graph coverage',async()=>{
  const f=summaryFixture(),end=Date.parse('2026-06-18T02:00:00Z');
  f.d.context.covered=false;
  f.d.run(`window.ContinuousHistory={active:true,moving:true,requestedEnd:${end},
    route:()=>({parts:[{start:covered ? 0 : Date.parse('2026-06-19T00:00:00Z'),end:Date.parse('2027-01-01T00:00:00Z'),value:{}}]})};
    window.HistoricalSummary.navigation('wheel')`);
  for(let i=1;i<=6;i++) {
    f.d.run(`window.ContinuousHistory.requestedEnd=${end-i*60000};window.HistoricalSummary.schedule()`);
    f.clock.advance(100);await f.settle();
  }
  f.clock.advance(200);await f.settle();assert.equal(f.reads.length,0);
  f.d.run('covered=true;window.HistoricalSummary.schedule()');
  f.clock.advance(149);await f.settle();assert.equal(f.reads.length,0);
  f.clock.advance(1);await f.settle();assert.equal(f.reads.length,1);
  assert.equal(Date.parse(new URL(f.reads[0].path,'http://fixture').searchParams.get('asOf')),end-6*60000);
});

test('Current destination cancels historical cards before the graph animation finishes',async()=>{
  let release;const f=summaryFixture(()=>new Promise(resolve=>{release=resolve;}));
  f.d.run(`window.ContinuousHistory={active:true,moving:true,requestedEnd:chartHistory.endTime,
    route:()=>({parts:[{start:0,end:Date.parse('2027-01-01T00:00:00Z'),value:{}}]})};
    window.HistoricalSummary.navigation('discrete');window.HistoricalSummary.schedule()`);
  f.clock.advance(50);await f.settle();assert.equal(f.reads.length,1);
  f.d.run(`state.routeData.get('I25').summary.latest.avgCurrentSpeed=66;
    window.ContinuousHistory.requestedEnd=null;window.HistoricalSummary.schedule()`);
  assert.equal(f.reads[0].options.signal.aborted,true);
  assert.notEqual(f.d.run('chartHistory.endTime'),null);
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'66');
  assert.equal(f.d.nodes.get('i25IncidentsLabel').textContent,'Active Incidents');
  release({ok:true,json:async()=>({I25:{averageSpeed:1}})});await f.settle();
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'66');assert.equal(f.reads.length,1);
});

test('superseded moving destinations cannot publish a late summary',async()=>{
  const releases=[];
  const f=summaryFixture(path=>new Promise(resolve=>releases.push(speed=>{
    const url=new URL(path,'http://fixture'),hours=Number(url.searchParams.get('hours')),end=Date.parse(url.searchParams.get('asOf'));
    resolve({ok:true,json:async()=>Object.fromEntries(['I25','I70'].map(corridor=>[corridor,{corridor,hours,
      start:new Date(end-hours*3600000).toISOString(),end:new Date(end).toISOString(),averageSpeed:speed,
      speedAvailable:true,zonesAvailable:true,incidentsAvailable:true}]))});
  })));
  f.d.run(`window.ContinuousHistory={active:true,moving:true,requestedEnd:chartHistory.endTime,
    route:()=>({parts:[{start:0,end:Date.parse('2027-01-01T00:00:00Z'),value:{}}]})};
    window.HistoricalSummary.navigation('discrete');window.HistoricalSummary.schedule()`);
  f.clock.advance(50);await f.settle();assert.equal(f.reads.length,1);
  f.d.run('window.ContinuousHistory.requestedEnd-=3600000;window.HistoricalSummary.schedule()');
  assert.equal(f.reads[0].options.signal.aborted,true);
  releases[0](1);await f.settle();
  f.clock.advance(50);await f.settle();assert.equal(f.reads.length,2);
  releases[1](66);await f.settle();
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'66');
  assert.equal(f.d.run('window.ContinuousHistory.moving'),true);
});

test('unchanged animation frames do not repeat live chart announcements',()=>{
  const d=dashboard();let text='',writes=0;
  Object.defineProperty(d.nodes.get('chartSummary'),'textContent',{get:()=>text,set:value=>{text=value;writes++;}});
  d.run(`state.focusedCorridor='I25';drawCorridorChart=()=>{};
    chartRouteData=()=>({summary:{latest:{avgCurrentSpeed:60}},incidentThreads:[]});
    drawAllCharts();drawAllCharts()`);
  assert.equal(writes,1);
  d.run(`chartRouteData=()=>({summary:{latest:{avgCurrentSpeed:40}},incidentThreads:[]});drawAllCharts()`);
  assert.equal(writes,2);assert.match(text,/40 miles per hour/);
});

test('navigation controls distinguish wheel input from buttons and timeframe changes',()=>{
  const d=dashboard(undefined,'?historical=1'),inputs=[];
  prepareChartHistory(d);d.context.summaryInputs=inputs;
  d.run('window.HistoricalSummary={navigation:input=>summaryInputs.push(input)};initializeControls();applyDashboardSnapshot=()=>{}');
  d.nodes.get('historyOlder').events.click();assert.equal(inputs.at(-1),'discrete');
  clickHistoryRange(d,6);assert.equal(inputs.at(-1),'discrete');
  const canvas=d.nodes.get('i25Chart');canvas.clientWidth=1000;
  d.run("chartHistory.hoverCanvas=document.getElementById('i25Chart');chartHistory.hoverReady=true");
  canvas.events.wheel({deltaY:10,deltaMode:0,preventDefault(){}});
  assert.equal(inputs.at(-1),'wheel');
});

test('continuous motion reports settled only after the selected graph reaches its target',()=>{
  const f=continuousFixture();f.d.run('panHistoryWindow(3600000)');
  assert.equal(f.d.run('window.ContinuousHistory.moving'),true);
  for(let i=0;i<120;i++)f.frame();
  assert.equal(f.d.run('window.ContinuousHistory.moving'),false);
  f.d.run('setHistoryEnd(null)');f.frame();
  assert.equal(f.d.run('window.ContinuousHistory.moving'),false);
});

test('continuous destinations remain exact through easing, reversals and boundary clamping',()=>{
  const f=continuousFixture(),latest=f.d.run('historyLatestTime()');
  f.d.run('panHistoryWindow(3600000)');
  assert.equal(f.d.run('window.ContinuousHistory.requestedEnd'),latest-3600000);
  for(let i=0;i<5;i++)f.frame();
  assert.notEqual(f.d.run('chartHistory.endTime'),latest-3600000);
  assert.equal(f.d.run('window.ContinuousHistory.requestedEnd'),latest-3600000);
  f.d.run('panHistoryWindow(-7200000)');
  assert.equal(f.d.run('window.ContinuousHistory.requestedEnd'),null);
  for(let i=0;i<120;i++)f.frame();
  assert.equal(f.d.run('chartHistory.endTime'),null);
  f.d.run('panHistoryWindow(1e12)');
  assert.equal(f.d.run('window.ContinuousHistory.requestedEnd'),f.d.run('historyLimits().firstEnd'));
  f.d.run('setHistoryEnd(null)');
  assert.equal(f.d.run('window.ContinuousHistory.requestedEnd'),null);
});

test('real continuous pan dispatches one destination summary before its animation settles',async()=>{
  const f=continuousFixture(),summaryReads=[],originalFetch=f.d.context.window.fetch;
  f.d.context.window.fetch=async(path,options)=>{
    if (!path.includes('/window-summary?')) return originalFetch(path,options);
    summaryReads.push(path);
    const url=new URL(path,'http://fixture'),hours=Number(url.searchParams.get('hours')),end=Date.parse(url.searchParams.get('asOf'));
    return {ok:true,json:async()=>Object.fromEntries(['I25','I70'].map(corridor=>[corridor,{corridor,hours,
      start:new Date(end-hours*3600000).toISOString(),end:new Date(end).toISOString(),averageSpeed:55,
      speedAvailable:true,zonesAvailable:true,incidentsAvailable:true}]))};
  };
  vm.runInContext(windowSummarySource,f.d.context);
  f.d.run(`chartRouteData=()=>({parts:[{start:0,end:Date.parse('2027-01-01T00:00:00Z'),value:{}}]});
    panHistoryWindow(3600000)`);
  const destination=f.d.run('window.ContinuousHistory.requestedEnd');
  f.advance(49);await f.settle();assert.equal(summaryReads.length,0);
  f.advance(1);await f.settle();assert.equal(summaryReads.length,1);
  assert.equal(Date.parse(new URL(summaryReads[0],'http://fixture').searchParams.get('asOf')),destination);
  assert.equal(f.d.run('window.ContinuousHistory.moving'),true);
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'55');
  for(let i=0;i<120;i++)f.frame();
  f.advance(200);await f.settle();
  assert.equal(f.d.run('chartHistory.endTime'),destination);
  assert.equal(summaryReads.length,1);
  f.d.context.window.events.pagehide();
});

test('direct Current cancels a queued destination summary before the next animation frame',async()=>{
  const f=continuousFixture(),summarySignals=[],originalFetch=f.d.context.window.fetch;
  f.d.context.window.fetch=(path,options)=>{
    if(!path.includes('/window-summary?'))return originalFetch(path,options);
    summarySignals.push(options.signal);
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  };
  vm.runInContext(windowSummarySource,f.d.context);
  f.d.run(`chartRouteData=()=>({parts:[{start:0,end:Date.parse('2027-01-01T00:00:00Z'),value:{}}]});
    panHistoryWindow(3600000)`);
  f.advance(50);await f.settle();assert.equal(summarySignals.length,1);
  f.d.run('setHistoryEnd(null)');
  assert.equal(summarySignals[0].aborted,true);
  assert.equal(f.d.nodes.get('i25IncidentsLabel').textContent,'Active Incidents');
  await f.settle();f.d.context.window.events.pagehide();
});

test('Current and corridor changes abort stale summaries and restore live cards',async()=>{
  let release;const f=summaryFixture(()=>new Promise(resolve=>release=resolve));
  f.d.run('window.HistoricalSummary.schedule()');f.clock.advance(300);await f.settle();
  f.d.run("state.routeData.get('I25').summary.latest.avgCurrentSpeed=66;chartHistory.endTime=null;window.HistoricalSummary.schedule()");
  assert.equal(f.reads[0].options.signal.aborted,true);assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'66');
  release({ok:true,json:async()=>({I25:{averageSpeed:1}})});await f.settle();
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'66');assert.equal(f.d.nodes.get('i25AverageSpeedLabel').textContent,'Average Speed');
});

test('matching windows reuse summaries across graph views and a bounded cache evicts old positions',async()=>{
  const f=summaryFixture(),end=Date.parse('2026-06-18T02:00:00Z');f.move(end);f.clock.advance(300);await f.settle();
  f.d.run("state.chartView='zones';window.HistoricalSummary.schedule()");f.clock.advance(300);await f.settle();assert.equal(f.reads.length,1);
  for(let i=1;i<=33;i++){f.move(end-i*3600000);f.clock.advance(300);await f.settle();}
  assert.equal(f.reads.length,34);f.move(end);f.clock.advance(300);await f.settle();assert.equal(f.reads.length,35);
});

test('all frames and individual corridors use the selected bounds with no summaries while hidden',async()=>{
  const f=summaryFixture(),end=Date.parse('2026-06-18T02:00:00Z');
  f.d.run("state.focusedCorridor='I70'");
  for(const hours of [2,6,24,168,720]){f.move(end,hours);f.clock.advance(300);await f.settle();
    const url=new URL(f.reads.at(-1).path,'http://fixture');assert.equal(url.searchParams.get('corridors'),'I70');assert.equal(Number(url.searchParams.get('hours')),hours);}
  f.d.run('document.hidden=true;window.HistoricalSummary.pause();chartHistory.endTime-=3600000;window.HistoricalSummary.schedule()');
  f.clock.advance(300);await f.settle();assert.equal(f.reads.length,5);
  f.d.run('document.hidden=false;chartHistory.dataKey=historyWindowKey();window.HistoricalSummary.resume()');f.clock.advance(300);await f.settle();assert.equal(f.reads.length,6);
});

test('a ready corridor is published while the other corridor waits for its single busy retry',async()=>{
  const f=summaryFixture(async path=>{
    const url=new URL(path,'http://fixture'),hours=Number(url.searchParams.get('hours')),end=Date.parse(url.searchParams.get('asOf'));
    const window={hours,start:new Date(end-hours*3600000).toISOString(),end:new Date(end).toISOString()};
    return {ok:true,json:async()=>({I25:{...window,corridor:'I25',averageSpeed:55,speedAvailable:true,zonesAvailable:true,incidentsAvailable:true},
      I70:{...window,corridor:'I70',busy:true}})};
  });
  f.d.run('window.HistoricalSummary.schedule()');f.clock.advance(300);await f.settle();
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'55');assert.equal(f.d.nodes.get('i70AverageSpeed').textContent,'—');
  assert.equal(f.reads.length,1);
});

test('busy summary capacity retries once without an open-ended polling loop',async()=>{
  const f=summaryFixture(async path=>{
    const url=new URL(path,'http://fixture'),hours=Number(url.searchParams.get('hours')),end=Date.parse(url.searchParams.get('asOf'));
    return {ok:true,json:async()=>Object.fromEntries(['I25','I70'].map(corridor=>[corridor,{corridor,hours,start:new Date(end-hours*3600000).toISOString(),end:new Date(end).toISOString(),busy:true}]))};
  });
  f.d.run('window.HistoricalSummary.schedule()');f.clock.advance(300);await f.settle();assert.equal(f.reads.length,1);
  f.clock.advance(1000);await f.settle();assert.equal(f.reads.length,2);
  for(let i=0;i<8;i++){f.d.run('window.HistoricalSummary.schedule()');f.clock.advance(1000);await f.settle();}
  assert.equal(f.reads.length,2);assert.match(f.d.nodes.get('i25Summary').attributes.title,/capacity is busy/);
});

test('mismatched or failed summaries stay unavailable and cannot create a retry loop',async()=>{
  const f=summaryFixture(async()=>({ok:true,json:async()=>({I25:{corridor:'I25',hours:2,end:'2026-01-01T00:00:00Z'}})}));
  f.d.run('window.HistoricalSummary.schedule()');f.clock.advance(300);await f.settle();
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'—');
  for(let i=0;i<10;i++){f.d.run('window.HistoricalSummary.schedule()');f.clock.advance(300);await f.settle();}
  assert.equal(f.reads.length,1);f.d.run('window.HistoricalSummary.schedule(true)');f.clock.advance(300);await f.settle();assert.equal(f.reads.length,2);
});

test('one progressive request paints speed and travel while incident work is still pending',async()=>{
  const f=progressiveSummaryFixture();await f.start();
  assert.match(f.reads[0].path,/progressive=true/);
  f.push({I25:f.summary('I25'),I70:f.summary('I70')});await f.settle();
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'55');assert.equal(f.d.nodes.get('i70AverageSpeed').textContent,'55');
  assert.equal(f.d.nodes.get('i25WorstSegmentLabel').textContent,'Lowest Observed Speed');
  assert.equal(f.d.nodes.get('i25WorstSpeed').textContent,'41');
  assert.equal(f.d.nodes.get('i25WorstSpeedUnit').hidden,false);
  assert.equal(f.d.nodes.get('i25TravelTime').textContent,'—');assert.equal(f.reads.length,1);
  const travel={zonesAvailable:true,averageTravelMinutes:54,fastestTravelMinutes:51,slowestTravelMinutes:70};
  f.push({I25:f.summary('I25',travel),I70:f.summary('I70',travel)});await f.settle();
  assert.equal(f.d.nodes.get('i25TravelTime').textContent,'54');assert.equal(f.d.nodes.get('i25ActiveIncidents').textContent,'—');
  f.push({I25:f.summary('I25',{...travel,observedIncidents:1121,incidentsAvailable:true,incidentMethod:'RECONSTRUCTED_EPISODES'}),
    I70:f.summary('I70',{...travel,observedIncidents:331,incidentsAvailable:true,incidentMethod:'RECONSTRUCTED_EPISODES'})},true);f.end();await f.settle();
  assert.equal(f.d.nodes.get('i25ActiveIncidents').textContent,'1121');assert.equal(f.d.nodes.get('i25IncidentsLabel').textContent,'Est. Incidents');
  assert.match(f.d.nodes.get('i25IncidentsLabel').title,/Missing identifiers and polling gaps/);
  assert.equal(f.d.nodes.get('i25Summary').attributes['aria-busy'],'false');assert.equal(f.reads.length,1);
  assert.equal(f.d.nodes.get('i25FastestTravelTimeLabel').textContent,'Fastest');
});

test('incomplete streams preserve already received values without inventing missing counts',async()=>{
  const f=progressiveSummaryFixture();await f.start();
  f.push({I25:f.summary('I25',{averageTravelMinutes:54}),I70:f.summary('I70')});await f.settle();f.end();await f.settle();
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'55');assert.equal(f.d.nodes.get('i25TravelTime').textContent,'54');
  assert.equal(f.d.nodes.get('i25ActiveIncidents').textContent,'—');
  assert.match(f.d.nodes.get('i25Summary').attributes.title,/unavailable.*retry/);
  for(let i=0;i<3;i++){f.d.run('window.HistoricalSummary.schedule()');f.clock.advance(1000);await f.settle();}
  assert.equal(f.reads.length,1);
});

test('obsolete progressive updates cannot overwrite Current or consume more reads',async()=>{
  const f=progressiveSummaryFixture();await f.start();
  f.push({I25:f.summary('I25'),I70:f.summary('I70')});await f.settle();
  f.d.run("state.routeData.get('I25').summary.latest.avgCurrentSpeed=66;chartHistory.endTime=null;window.HistoricalSummary.schedule()");
  f.push({I25:f.summary('I25',{averageSpeed:1}),I70:f.summary('I70')});await f.settle();
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'66');assert.equal(f.reads.length,1);
  assert.equal(f.d.nodes.get('i25IncidentsLabel').textContent,'Active Incidents');
});

test('stream chunks can split records and an oversized update is rejected',async()=>{
  const f=progressiveSummaryFixture();await f.start();
  const line=JSON.stringify({summaries:{I25:f.summary('I25'),I70:f.summary('I70')},complete:false})+'\n';
  f.raw(line.slice(0,10));await f.settle();assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'—');
  f.raw(line.slice(10));await f.settle();assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'55');
  f.raw(' '.repeat(65537));await f.settle();assert.match(f.d.nodes.get('i25Summary').attributes.title,/unavailable/);
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'55');
});

test('mismatched progressive bounds never replace valid selected values',async()=>{
  const f=progressiveSummaryFixture();await f.start();
  f.push({I25:f.summary('I25'),I70:f.summary('I70')});await f.settle();
  f.push({I25:f.summary('I25',{end:'2026-01-01T00:00:00Z',averageSpeed:1}),I70:f.summary('I70')});await f.settle();
  assert.equal(f.d.nodes.get('i25AverageSpeed').textContent,'55');assert.match(f.d.nodes.get('i25Summary').attributes.title,/unavailable/);
});
