const { test } = require('node:test');
const { dashboard, assert } = require('../fixtures/core.cjs');

test('speed-zone incident markers stay inside the plot and use the open side of the speed point', () => {
  const d = dashboard();
  d.context.bounds = { top: 20, bottom: 120 };
  assert.equal(d.run("chartPainter.incidentFlagPlacement(32, bounds, 0, 'below').y"), 50);
  assert.equal(d.run("chartPainter.incidentFlagPlacement(32, bounds, 0, 'below').side"), 'below');
  assert.equal(d.run("chartPainter.incidentFlagPlacement(108, bounds, 0, 'above').y"), 90);
  assert.equal(d.run("chartPainter.incidentFlagPlacement(108, bounds, 0, 'above').side"), 'above');
  assert.equal(d.run("chartPainter.incidentFlagPlacement(25, bounds, 1, 'above').y"), 58);
  assert.equal(d.run("chartPainter.incidentFlagPlacement(25, bounds, 1, 'above').side"), 'below');
});

test('speed-zone incident labels extend past nearby traffic lines', () => {
  const d = dashboard();
  d.context.bounds = { top: 20, bottom: 120 };
  d.context.blocked = [{ min: 48, max: 56 }];
  assert.equal(d.run("chartPainter.incidentFlagPlacement(32, bounds, 0, 'below', blocked).y"), 72);
  assert.equal(d.run("chartPainter.incidentFlagPlacement(32, bounds, 0, 'below', blocked).side"), 'below');

  d.context.series = [[
    { horizontalPosition: 40, verticalPosition: 30 },
    { horizontalPosition: 80, verticalPosition: 70 }
  ]];
  assert.equal(d.run("chartPainter.trafficLineRanges(series, 50, 70)[0].min"), 40);
  assert.equal(d.run("chartPainter.trafficLineRanges(series, 50, 70)[0].max"), 60);
});

test('incident label backgrounds stay inside the chart edge', () => {
  const d = dashboard();
  const boxes = [];
  d.context.boxes = boxes;
  d.context.ctx = new Proxy({
    roundRect(left, top, width, height) { boxes.push({ left, top, width, height }); }
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  d.run("chartPainter.drawIncidentLabelBackground(ctx, 390, 60, 80, true, '#700', '#fff', 50, 400)");
  assert.equal(d.context.boxes[0].left, 293);
  assert.equal(d.context.boxes[0].width, 86);
  assert.ok(d.context.boxes[0].left >= 50);
  assert.ok(d.context.boxes[0].left + d.context.boxes[0].width <= 400);
});

test('dense incident callouts avoid overlap and never point into a large speed-data gap', () => {
  const d = dashboard();
  const labels = [];
  d.context.ctx = new Proxy({ canvas: {clientWidth: 400}, measureText: text => ({width:text.length * 5}),
    fillText: text => { if (text.startsWith('Crash') || text.includes('incidents')) labels.push(text); } }, {
      get(target, key) { return key in target ? target[key] : () => {}; }
    });
  d.context.incidents = [0,1,2].map(i => ({type:'Crash',locationLabel:`MP ${220+i}`,
    firstSeenAt: new Date(10_000 + i),lastSeenAt:new Date(10_000+i)}));
  d.context.points = [{timestamp:10_000,verticalPosition:100,horizontalPosition:50}];
  d.run("chartPainter.drawIncidentFlags(ctx, 'I25', incidents, points, 0, 20000, {left:43,right:18}, {panel:'#fff','--rose':'red'})");
  assert.equal(labels.length, 1);
  assert.equal(labels[0], '3 incidents');
  labels.length = 0;
  d.context.points = [{timestamp:10_000_000,verticalPosition:100,horizontalPosition:50}];
  d.run("chartPainter.drawIncidentFlags(ctx, 'I25', incidents, points, 0, 20000, {left:43,right:18}, {panel:'#fff','--rose':'red'})");
  assert.equal(labels.length, 0);
  assert.equal(d.run("incidentModel.normalizeIncidentType('weather')"), 'Weather');
});

test('incident callout text remains inside narrow plots, not only its background', () => {
  for (const clientWidth of [180,130]) {
    const d = dashboard();
    const labels = [];
    d.run('state.selectedHours=168');
    d.context.ctx = new Proxy({canvas:{clientWidth}, measureText:text=>({width:text.length*5}),
      fillText(text,x){if(Number.isNaN(Number(text)))labels.push({text,x,align:this.textAlign});}},
      {get(target,key){return key in target ? target[key] : ()=>{};}});
    d.context.incidents=[{type:'Crash',firstSeenAt:new Date(10000)}];
    d.context.points=[{timestamp:10000,verticalPosition:100,horizontalPosition:70}];
    d.run("chartPainter.drawIncidentFlags(ctx,'I25',incidents,points,0,20000,{left:43,right:18},{panel:'#fff','--rose':'red'})");
    assert.equal(labels.length,1);
    const label=labels[0],width=label.text.length*5;
    const left=label.align==='right'?label.x-width:label.x;
    assert.ok(left>=43,`Text starts at ${left} outside plot`);
    assert.ok(left+width<=clientWidth-18,'Text extends past right plot edge');
  }
});

test('cold bootstrap prioritizes the visible view and subsequent sync uses one network request',async()=>{
  const d=dashboard(async path=>({ok:true,json:async()=>path.includes('/summary?')
    ? {latest:{polledAt:new Date().toISOString(),avgCurrentSpeed:60}}
    : {features:[],buckets:[],samples:[],points:[],profiles:[],zones:[],status:'UP',checks:[]}}));
  await d.run('loadLiveDashboardSnapshots().then(value=>state.snapshots=value)');
  assert.equal(d.network.length,2);
  assert.match(d.network[0],/ranges=24&/);
  assert.match(d.network[1],/ranges=2,6,168,720&/);
  assert.equal(d.run('state.snapshots.size'),5);
  const original=d.run('state.readSections.size');
  await d.run('loadLiveDashboardSnapshots()');
  assert.equal(d.network.length,3);
  assert.equal(d.run('state.readSections.size'),original);
  assert.ok(new URL(d.network[2],'http://fixture').searchParams.get('known').length>0);
});

test('simultaneous corridor history reads share one batch without changing graph resolution',async()=>{
  const d=dashboard(async()=>({ok:true,json:async()=>({features:[],buckets:[],samples:[],profiles:[]})}));
  await d.run("Promise.all(['I25','I70'].map(c=>loadChartHistoryRoute(c,6,Date.parse('2026-09-15T12:00:00Z'),'overall'))) ");
  assert.equal(d.network.length,1);
  const url=new URL(d.network[0],'http://fixture');
  assert.equal(url.searchParams.get('corridors'),'I25,I70');
  assert.equal(url.searchParams.get('hours'),'6');
});

test('shared incidents reproduce event and corridor eligibility without false truncation',async()=>{
  const now=Date.now(), old=new Date(now-10*3600000).toISOString(), recent=new Date(now-3600000).toISOString();
  const feature=(id,eventActive,corridorActive,lastSeenAt,lastMatchedAt)=>({id,
    properties:{eventActive,corridorActive,lastSeenAt,lastMatchedAt,active:eventActive&&corridorActive,providerEventId:id}});
  const features=[feature('old-active',true,true,old,old),feature('old-match',true,false,recent,old),
    feature('recent-ended',false,false,recent,recent),feature('old-ended',false,false,old,old)];
  const d=dashboard(async path=>({ok:true,json:async()=>path.includes('/incidents/shared?')
    ? {features,truncated:false} : path.includes('/summary?') ? {latest:{polledAt:new Date().toISOString()}}
      : {features:[],buckets:[],samples:[],points:[],profiles:[],zones:[],checks:[]}}));
  const snapshots=await d.run('dashboardSnapshotBatch([2,6,24])');
  assert.deepEqual(Array.from(snapshots.get(2).routeData.get('I25').incidentFeatures,f=>f.id),['old-active','recent-ended']);
  assert.equal(snapshots.get(24).routeData.get('I25').incidentFeatures.length,4);
  assert.equal(snapshots.get(2).routeData.get('I25').incidentsTruncated,false);
});

test('unchanged weekly sections can reuse a version across different historical anchors',()=>{
  const d=dashboard();
  d.context.body={profiles:[{meanSpeed:60}]};
  d.run("acceptDashboardSections({'baseline-one':{status:200,version:'week-one',data:body}})");
  const reader=d.run("acceptDashboardSections({'/traffic/analytics/baselines?asOf=1&corridor=I25':{status:200,version:'week-one'}})");
  assert.equal(d.run("state.readSections.get('/traffic/analytics/baselines?asOf=1&corridor=I25').data"),d.context.body);
});

test('historical observation payloads remain owned by the graph buffer',async()=>{
  const d=dashboard(async()=>({ok:true,json:async()=>({features:[],buckets:[],samples:[],profiles:[]})}));
  await d.run("loadChartHistoryRoute('I25',6,Date.parse('2026-09-15T12:00:00Z'),'overall')");
  assert.ok(d.run("[...state.readSections.keys()].every(key=>key.includes('/baselines?'))"));
  assert.equal(d.run('chartHistory.baselines.size'),1);
});

test('fixture batches normalize unknown scenario names and preserve explicit section statuses',async t=>{
  const server=require('node:http').createServer(require("../dashboard-preview.cjs").handleRequest);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const fixture of ['constructor','__proto__']) {
    const response=await fetch(`${base}/dashboard-api/traffic/dashboard/snapshot?ranges=24&fixture=${fixture}`);
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.health.status,200);
    assert.equal(data.health.data.status,'UP');
    assert.ok(data['/traffic/map/incidents/shared?corridor=I25'].data.features.length>0);
  }
  const response=await fetch(`${base}/dashboard-api/traffic/dashboard/snapshot?ranges=24&fixture=partial`);
  const data=await response.json();
  assert.equal(data['/traffic/map/incidents/shared?corridor=I70'].status,503);
  assert.equal(data['/traffic/map/incidents/shared?corridor=I25'].status,200);
});

test('a corridor arriving after history dispatch receives its own complete batch',async()=>{
  const pending=[];
  const d=dashboard(async()=>new Promise(resolve=>pending.push(resolve)));
  const first=d.run("loadChartHistoryRoute('I25',6,Date.parse('2026-09-15T12:00:00Z'),'overall')");
  await new Promise(setImmediate);
  const second=d.run("loadChartHistoryRoute('I70',6,Date.parse('2026-09-15T12:00:00Z'),'overall')");
  const release=()=>pending.splice(0).forEach(resolve=>resolve({ok:true,json:async()=>({features:[],buckets:[],samples:[],profiles:[]})}));
  release();
  const firstRoute=await first;
  await new Promise(setImmediate);
  release();
  const secondRoute=await second;
  assert.equal(firstRoute.chartPartial,false);
  assert.equal(secondRoute.chartPartial,false);
  assert.deepEqual(d.network.map(path=>new URL(path,'http://fixture').searchParams.get('corridors')),['I25','I70']);
});

test('budget-paused reads cancel immediately without leaving the graph waiting',async()=>{
  const d=dashboard();
  d.context.controller=new AbortController();
  d.run('dashboardRequestTimes.push(...Array(48).fill(Date.now()))');
  const pending=d.run("fetchDashboardBatch(dashboardApi('/traffic/dashboard/history?hours=6'),controller.signal)");
  assert.equal(d.run('dashboardReadQueue.length'),1);
  d.context.controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(d.run('dashboardReadQueue.length'),0);
  assert.equal(d.run('dashboardReadTimer'),null);
  assert.equal(d.network.length,0);
});

test('history cannot consume the request slots reserved for a current snapshot',async()=>{
  const d=dashboard(async()=>({ok:true,json:async()=>({features:[],points:[],buckets:[],profiles:[],samples:[]})}));
  d.context.controller=new AbortController();
  d.run('dashboardRequestTimes.push(...Array(46).fill(Date.now()))');
  const history=d.run("fetchDashboardBatch(dashboardApi('/traffic/dashboard/history?hours=6'),controller.signal)");
  await d.run("fetchDashboardBatch(dashboardApi('/traffic/dashboard/snapshot?ranges=24&selectedHours=24'))");
  assert.equal(d.network.length,1);
  assert.match(d.network[0],/dashboard\/snapshot/);
  d.context.controller.abort();
  await assert.rejects(history,{name:'AbortError'});
});

test('primary and experimental dashboards prepare history by default without enabling scrolling', () => {
  for (const pathname of ['/dashboard/', '/dashboard/index.html', '/dashboard-experimental/']) {
    const d = dashboard(undefined, '', pathname, false, true);
    assert.equal(d.run('window.ContinuousHistory.active'), true);
    assert.equal(d.run('window.ContinuousHistory.prepared'), true);
    assert.equal(d.run('chartHistory.enabled'), false);
    assert.equal(dashboard(undefined, '?continuous=0', pathname, false, true).run('window.ContinuousHistory.active'), false);
    assert.equal(dashboard(undefined, '?prepared=0', pathname, false, true).run('window.ContinuousHistory.prepared'), false);
  }
});

test('server replay policy keeps the public primary live while retaining explicit local replay', () => {
  const publicPage = dashboard(undefined, '?replay=1', '/dashboard/', false);
  assert.equal(publicPage.run('REPLAY_MODE'), false);
  assert.equal(publicPage.run('DASHBOARD_RUNTIME.apiBase'), '/dashboard-api');
  assert.equal(dashboard(undefined, '?replay=1', '/dashboard/', true).run('REPLAY_MODE'), true);
  assert.equal(dashboard(undefined, '?replay=1', '/dashboard-experimental/', true).run('REPLAY_MODE'), false);
});

test('CDOT chain-law labels explain vehicle scope and preserve lifted restrictions', () => {
  const d = dashboard();
  const cases = [
    ['Traction Law Code 15', 'Passenger vehicles: winter equipment required'],
    ['Traction Law Code 15 Lifted', 'Passenger vehicle traction restriction lifted'],
    ['Chain Law Code 18', 'Commercial vehicles: chains required'],
    ['Chain Law Code 18 Lifted', 'Commercial vehicle chain restriction lifted']
  ];
  for (const [source, expected] of cases) {
    d.context.properties = { incidentTypeLabel:source, normalizedCategory:'weather', incidentNote:source, incidentDescription:source };
    const thread = d.run("incidentModel.aggregateIncidentThreads([{properties}])[0]");
    assert.equal(thread.displayType, expected);
    d.context.thread = thread;
    assert.equal(d.run('buildIncidentNameCell(thread).children[0].children[1].textContent'), expected);
    assert.match(d.run("chartPainter.chartIncidentLabel(thread)"), new RegExp(`^${expected}`));
    const details = Array.from(d.run('incidentDetailLines(thread)'));
    const location = d.run('buildIncidentLocationCell(thread, true, true)');
    const report = location.children[1].children.find(child => child.className === 'incident-source');
    assert.ok(report.children.some(child => child.textContent === source), 'The full provider report retains its original text');
    assert.match(details[0], /when in effect:/);
    assert.match(details[0], source.includes('15')
      ? /AWD\/4WD.*3\/16-inch.*Two-wheel-drive vehicles need chains/
      : /Commercial vehicles must use chains or approved alternative traction devices/);
    assert.equal(d.run('buildIncidentLocationCell({...thread,description:"",note:""},true).children.length'), 2,
      'The explanation stays accessible when the report supplies only a coded type');
  }
  d.context.properties = {sourceType:'Chain Law Code 18'};
  assert.equal(d.run('window.IncidentTypes.label(properties)'), 'Commercial vehicles: chains required');
  for (const source of ['Chain Law Code 99', 'Incident type 15', 'Crash at mile 18', 'Traction Law Code 150']) {
    d.context.properties = {incidentTypeLabel:source};
    assert.equal(d.run('window.IncidentTypes.chainLaw(properties)'), null);
    assert.equal(d.run('window.IncidentTypes.label(properties)'), source === 'Incident type 15' ? 'Other' : source);
  }
});

test('Retry-After deadlines preserve seconds, dates and the fallback for invalid or elapsed values', () => {
  const d = dashboard();
  const now = Date.parse('2026-10-30T12:00:00Z');
  d.run(`Date.now = () => ${now}`);
  for (const [value, delay] of [['12',12000], ['Fri, 30 Oct 2026 12:00:25 GMT',25000],
    ['Fri, 30 Oct 2026 11:59:59 GMT',60000], ['invalid',60000], [null,60000], ['',60000]]) {
    assert.equal(d.run(`dashboardRetryDeadline(${JSON.stringify(value)})`), now + delay);
  }
});
