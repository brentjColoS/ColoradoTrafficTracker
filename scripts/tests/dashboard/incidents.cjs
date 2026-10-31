const { test } = require('node:test');
const { dashboard, assert, event, indexSource } = require('../fixtures/core.cjs');
const { historyHoverClock } = require('../fixtures/history.cjs');
const { corridorMap, fakeMapRenderer } = require('../fixtures/maps.cjs');

test('unscrollable and invalid incident panels leave native wheel handling intact', () => {
  const d = dashboard();
  d.context.scroller = { scrollTop: 0, scrollHeight: 100, clientHeight: 100 };
  assert.equal(d.run('nestedScrollRemainder(scroller, 20)'), 0);
  assert.equal(d.context.scroller.scrollTop, 0);
  assert.equal(d.run('nestedScrollRemainder(null, NaN)'), 0);
  assert.equal(d.run('nestedScrollRemainder(scroller, 0)'), 0);
});

test('changing corridor focus rerenders compact and complete incident rows', () => {
  const d = dashboard();
  d.context.features = Array.from({ length: 5 }, (_, i) => event({ providerEventId: String(i) }));
  d.run("state.routeData.set('I25', buildRouteData('I25', {}, {}, {features})); applyCorridorFocus('I25', false)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 5);
  d.run("applyCorridorFocus('ALL', false)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 3);
});

test('short-range combined incident tables keep ongoing reports ahead of cleared reports', () => {
  const d = dashboard();
  d.context.features = [
    event({ providerEventId: 'ongoing', active: true, locationLabel: 'Ongoing report' }),
    event({ providerEventId: 'ended-one', active: false, locationLabel: 'Recent report one' }),
    event({ providerEventId: 'ended-two', active: false, locationLabel: 'Recent report two' })
  ];
  d.run("state.selectedHours = 2; state.routeData.set('I25', buildRouteData('I25', {}, {}, {features})); renderIncidentTable('I25', state.routeData.get('I25').incidentThreads)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 3);
  assert.equal(d.nodes.get('i25IncidentCount').textContent, '1 active · 3 total');
  assert.equal(d.nodes.get('i25IncidentRows').children[0].children[1].children[0].textContent, 'MP 225 · Ongoing report');

  d.run("state.expandedIncidents.add('I25'); renderIncidentTable('I25', state.routeData.get('I25').incidentThreads)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 3);
});

test('short incident views show ended reports without implying an empty feed', () => {
  const d = dashboard();
  d.context.features = [event({active:false, providerEventId:'ended'})];
  d.run("state.selectedHours = 6; state.routeData.set('I25', buildRouteData('I25', {}, {}, {features})); renderIncidentTable('I25', state.routeData.get('I25').incidentThreads)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 1);
  assert.equal(d.nodes.get('i25IncidentRows').children[0].children.length, 4);
  assert.equal(d.nodes.get('i25IncidentCount').textContent, '0 active · 1 total');
  d.run("state.expandedIncidents.add('I25'); renderIncidentTable('I25', state.routeData.get('I25').incidentThreads)");
  assert.equal(d.nodes.get('i25IncidentRows').children[0].children.length, 4);
});

test('incident rows use specific CDOT details and distinguish a reported duration', () => {
  const d = dashboard();
  d.context.features = [event({
    normalizedCategory: 'CRASH',
    incidentTypeLabel: 'Two-vehicle crash',
    incidentImpactLabel: 'Southbound: right lane closed · Slower speeds advised',
    incidentNote: 'Expect delays.',
    sourceSeverity: 'major',
    sourceStartedAt: '2026-09-15T08:30:00Z',
    sourceEndedAt: '2026-09-15T10:00:00Z',
    active: false,
    normalizedStatus: 'cleared'
  })];
  const incident = d.run("incidentModel.aggregateIncidentThreads(features)[0]");
  const nameCell = d.run("buildIncidentNameCell(incidentModel.aggregateIncidentThreads(features)[0])");
  const locationCell = d.run("buildIncidentLocationCell(incidentModel.aggregateIncidentThreads(features)[0])");
  const lastSeenCell = d.run("buildLastSeenCell(incidentModel.aggregateIncidentThreads(features)[0])");
  assert.equal(incident.type, 'Crash');
  assert.equal(nameCell.children[0].children[1].textContent, 'Two-vehicle crash');
  assert.equal(locationCell.children[1].children[0].textContent, 'Incident details');
  assert.equal(locationCell.children[1].children.length, 1, 'closed details do not build report text or format times');
  locationCell.children[1].open = true; locationCell.children[1].events.toggle();
  assert.equal(locationCell.children[1].children[1].textContent,
    'Southbound: right lane closed · Slower speeds advised · Major severity');
  assert.equal(locationCell.children[1].children[2].textContent, 'Reported: 09/15/26 2:30 AM → 4:00 AM MDT');
  assert.equal(locationCell.children[1].children[3].textContent, 'Expect delays.');
  assert.equal(locationCell.children[1].children[4].children[0].textContent, 'Full CDOT report');
  assert.equal(nameCell.children[1].textContent, 'Cleared');
  assert.equal(lastSeenCell.children[1].textContent, 'Reported 1 hr 30 min');
});

test('expanded reports preserve landmarks, schedules, punctuation and literal unsafe text without fetching',()=>{
  const d=dashboard(undefined,'', '/dashboard/',undefined,undefined,'America/New_York');
  d.context.features=[event({normalizedStatus:'planned',incidentTypeLabel:'Road work',
    incidentDescription:'Between Exit 263 and Chief Hosa on I-70. Work begins tomorrow. Full schedule: • 10/20 overnight • 10/21 overnight <img src=x onerror=alert(1)>',
    sourceStartMarker:262,sourceEndMarker:253,sourceStartedAt:'2026-10-21T13:00:00Z',sourceEndedAt:'2026-10-22T00:00:00Z',sourceUpdatedAt:'2026-10-14T18:00:00Z'})];
  const cell=d.run("buildIncidentLocationCell(incidentModel.aggregateIncidentThreads(features)[0])"),details=cell.children[1];
  details.open=true;details.events.toggle();const lines=details.children.slice(1).map(node=>node.textContent);
  assert.equal(lines[0],'MM 253–262');
  assert.equal(lines[1],'Scheduled: 10/21/26 9:00 AM → 8:00 PM EDT');
  assert.doesNotMatch(lines.join(' '),/Full schedule|overnight|tomorrow/);
  const source=details.children.at(-1);assert.equal(source.children.length,1,'full reports remain lazy and collapsed');
  source.open=true;source.events.toggle();
  assert.match(source.children[1].textContent,/Updated:/);assert.match(source.children[2].textContent,/Between Exit 263.*I-70/);
  assert.match(source.children[2].textContent,/\n• 10\/20 overnight\n• 10\/21 overnight <img/);
  assert.equal(source.children[2].children.length,0,'provider markup is text, not HTML');
  const size=details.children.length;details.events.toggle();assert.equal(details.children.length,size);
  assert.equal(d.network.length,0,'opening and reopening details adds no API requests');
  assert.equal((indexSource.match(/>First Observed</g)||[]).length,2);
  assert.equal((indexSource.match(/>Last Observed</g)||[]).length,2);
  assert.equal(d.run("incidentObservedDuration(incidentModel.aggregateIncidentThreads(features)[0])"),'Scheduled 11 hr');
});

test('details omit missing metadata and survive table refresh with the latest full report',()=>{
  const d=dashboard();d.context.features=[event({incidentDescription:'First report.',sourceStartMarker:221.95,sourceEndMarker:220.66})];
  d.run("renderIncidentTable('I25',incidentModel.aggregateIncidentThreads(features))");
  const body=d.nodes.get('i25IncidentRows'),details=body.children[0].children[1].children[1];
  details.open=true;details.events.toggle();const source=details.children.at(-1);source.open=true;source.events.toggle();
  body.querySelectorAll=()=>[details,source];
  d.context.features=[event({incidentDescription:'Updated report. Crews remain on scene.',sourceSeverity:'unknown',sourceStartedAt:'invalid'})];
  d.run("renderIncidentTable('I25',incidentModel.aggregateIncidentThreads(features))");
  const next=body.children[0].children[1].children[1];assert.equal(next.open,true);
  assert.deepEqual(next.children.slice(1,-1).map(node=>node.textContent),['Updated report. Crews remain on scene.']);
  assert.equal(next.children.at(-1).open,true,'an explicitly opened full report stays open through refresh');
  assert.equal(next.children.at(-1).children.at(-1).textContent,'Updated report. Crews remain on scene.');
  d.context.features=[event({incidentProvider:'tomtom',incidentTypeLabel:'Crash',incidentDescription:'Crash',sourceSeverity:'unknown'})];
  assert.equal(d.run("buildIncidentLocationCell(incidentModel.aggregateIncidentThreads(features)[0]).children.length"),1);
  d.context.features=[event({sourceStartMarker:0,sourceEndMarker:null})];
  assert.deepEqual(Array.from(d.run("incidentDetailLines(incidentModel.aggregateIncidentThreads(features)[0])")),['MM 0']);
});

test('compact sign-work facts remove repeated location and schedule while keeping the reason',()=>{
  const d=dashboard();d.context.features=[event({incidentTypeLabel:'Sign Work',sourceStartMarker:220.66,sourceEndMarker:221.95,
    incidentImpactLabel:'Northbound: left lane and toll lanes closed',sourceStartedAt:'2026-10-15T03:00:00Z',sourceEndedAt:'2026-10-15T11:00:00Z',
    incidentDescription:'Between Exit 220: Thornton Parkway and CO 128/120th Avenue (Northglenn) from Mile Point 220.66 to Mile Point 221.95. Left lane closed due to sign repair. Starting tomorrow at 9:00PM MDT until Thursday, at about 5:00AM MDT. Full schedule below: • October 14, 9:00PM - October 15, 5:00AM'})];
  const lines=Array.from(d.run("incidentDetailLines(incidentModel.aggregateIncidentThreads(features)[0])"));
  assert.equal(lines.length,3);assert.equal(lines[0],'MM 220.66–221.95 · Northbound: left lane and toll lanes closed');
  assert.equal(lines[1],'Reported: 10/14/26 9:00 PM → 10/15/26 5:00 AM MDT');assert.equal(lines[2],'Sign repair.');
  d.context.features=[event({incidentImpactLabel:'Right lane closed',incidentDescription:'Ramp and right lane closed due to a crash. Emergency crews on scene. Use the alternate exit.'})];
  assert.match(d.run("compactIncidentMessage(incidentModel.aggregateIncidentThreads(features)[0])"),/^Ramp and right lane closed.*Emergency crews on scene/);
  assert.match(d.run("compactIncidentMessage(incidentModel.aggregateIncidentThreads(features)[0])"),/…$/,'shortened summaries signal that more source text is available');
  d.context.features=[event({incidentDescription:'Long advisory '.repeat(50)})];
  assert.ok(d.run("compactIncidentMessage(incidentModel.aggregateIncidentThreads(features)[0]).length")<=180);
});

test('compact time ranges retain both timezone abbreviations across a daylight-saving change',()=>{
  const d=dashboard();
  assert.equal(d.run(`incidentTimeRange({sourceStartedAt:new Date('2026-11-01T07:30:00Z'),sourceEndedAt:new Date('2026-11-01T08:30:00Z')})`),
    'Reported: 11/01/26 1:30 AM MDT → 1:30 AM MST');
  assert.match(d.run(`incidentTimeRange({sourceEndedAt:new Date('2026-11-01T08:30:00Z')})`),/^Reported end:/);
});

test('incident duration never mixes a provider boundary with an observed boundary', () => {
  const d = dashboard();
  d.context.incident = { firstSeenAt: new Date('2026-09-15T11:00:00Z'),
    lastSeenAt: new Date('2026-09-15T11:10:00Z'), sourceStartedAt: new Date('2026-09-15T10:00:00Z') };
  assert.equal(d.run('incidentObservedDuration(incident)'), 'Observed 10 min');
  d.context.incident.sourceEndedAt = new Date('2026-09-15T11:30:00Z');
  assert.equal(d.run('incidentObservedDuration(incident)'), 'Reported 1 hr 30 min');
  d.context.incident.sourceEndedAt = new Date('2026-09-15T09:30:00Z');
  assert.equal(d.run('incidentObservedDuration(incident)'), '');
});

test('planned CDOT work is not counted as an ongoing incident', () => {
  const d = dashboard();
  d.context.features = [event({ active: true, normalizedStatus: 'planned', incidentTypeLabel: 'Road construction' })];
  const incident = d.run("incidentModel.aggregateIncidentThreads(features)[0]");
  assert.equal(incident.ongoing, false);
  assert.equal(d.run("incidentStatusLabel(incidentModel.aggregateIncidentThreads(features)[0])"), 'Planned');
});

test('active spot incidents precede refreshed long-term reports without changing lifecycle or counts', () => {
  const d=dashboard();
  d.context.features=[
    event({providerEventId:'long-observed',firstSeenAt:'2026-09-12T10:00:00Z',lastSeenAt:'2026-09-15T10:00:00Z'}),
    event({providerEventId:'spot-older',firstSeenAt:'2026-09-15T08:00:00Z',lastSeenAt:'2026-09-15T09:40:00Z'}),
    event({providerEventId:'cleared',active:false,normalizedStatus:'cleared',lastSeenAt:'2026-09-15T10:05:00Z'}),
    event({providerEventId:'long-reported',firstSeenAt:'2026-09-15T09:00:00Z',lastSeenAt:'2026-09-15T09:50:00Z',
      sourceStartedAt:'2026-09-15T08:00:00Z',sourceEndedAt:'2026-09-29T08:00:00Z'}),
    event({providerEventId:'spot-newer',firstSeenAt:'2026-09-15T09:00:00Z',lastSeenAt:'2026-09-15T09:45:00Z'}),
    event({providerEventId:'planned',normalizedStatus:'planned',lastSeenAt:'2026-09-15T10:10:00Z'})
  ];
  const ordered=()=>JSON.parse(d.run("JSON.stringify(incidentModel.aggregateIncidentThreads(features,'2026-09-15T10:15:00Z').map(i=>i.key.split('|').at(-1)))"));
  assert.deepEqual(ordered(),['spot-newer','spot-older','long-observed','long-reported','planned','cleared']);
  assert.equal(d.run("incidentModel.aggregateIncidentThreads(features).filter(i=>i.ongoing).length"),4);
  assert.equal(d.run('features[0].properties.active'),true);
  d.run("features[3].properties.lastSeenAt='2026-09-15T10:12:00Z'");
  assert.deepEqual(ordered(),['spot-newer','spot-older','long-reported','long-observed','planned','cleared']);
});

test('multi-day active reports stay active while identifying their long-term span', () => {
  const d = dashboard();
  d.context.features = [event({incidentTypeLabel:'Road maintenance',
    firstSeenAt:'2026-09-03T10:00:00Z',lastSeenAt:'2026-09-15T10:00:00Z',
    sourceStartedAt:'2026-09-15T04:00:00Z',sourceEndedAt:'2026-09-15T12:00:00Z'})];
  const cell=d.run("buildIncidentNameCell(incidentModel.aggregateIncidentThreads(features)[0])");
  assert.equal(cell.children[1].textContent,'Active · Long-term');
  assert.equal(cell.children[1].className,'continuing-pill incident-row-state');
  assert.match(cell.children[1].title,/at least two days.*intermittent/);
  assert.equal(d.run("buildLastSeenCell(incidentModel.aggregateIncidentThreads(features)[0]).children[1].textContent"),'Observed 12 days');
  d.context.features=[event({firstSeenAt:'2026-09-15T09:30:00Z'})];
  assert.equal(d.run("incidentStatusLabel(incidentModel.aggregateIncidentThreads(features)[0])"),'Active');
  assert.equal(d.run("incidentObservedDuration(incidentModel.aggregateIncidentThreads(features)[0])"),'Observed 30 min');
});

test('known multi-day work periods remain active even when first observed recently', () => {
  const d=dashboard();
  d.context.features=[event({firstSeenAt:'2026-09-15T09:00:00Z',
    sourceStartedAt:'2026-09-15T08:00:00Z',sourceEndedAt:'2026-09-29T08:00:00Z'})];
  assert.equal(d.run("incidentStatusLabel(incidentModel.aggregateIncidentThreads(features)[0])"),'Active · Long-term');
  assert.equal(d.run("incidentObservedDuration(incidentModel.aggregateIncidentThreads(features)[0])"),'Reported 14 days');
  assert.equal(d.run("incidentModel.aggregateIncidentThreads(features)[0].ongoing"),true,'active counts keep provider lifecycle semantics');
});

test('long-lived planned and cleared records retain their lifecycle states',()=>{
  const d=dashboard();
  d.context.features=[event({normalizedStatus:'planned',sourceStartedAt:'2026-09-16T08:00:00Z',sourceEndedAt:'2026-09-16T16:00:00Z'})];
  assert.equal(d.run("incidentStatusLabel(incidentModel.aggregateIncidentThreads(features)[0])"),'Planned');
  assert.equal(d.run("incidentObservedDuration(incidentModel.aggregateIncidentThreads(features)[0])"),'Scheduled 8 hr');
  d.context.features=[event({normalizedStatus:'cleared',active:false})];
  assert.equal(d.run("incidentStatusLabel(incidentModel.aggregateIncidentThreads(features)[0])"),'Cleared');
  assert.equal(d.run("buildIncidentNameCell(incidentModel.aggregateIncidentThreads(features)[0]).children[1].className"),'incident-status-pill incident-row-state');
});

test('continuing threshold uses valid ordered evidence and does not age reports using wall time',()=>{
  const d=dashboard();
  d.context.incident={firstSeenAt:'2026-09-13T10:00:00Z',lastSeenAt:'2026-09-15T10:00:00Z'};
  assert.equal(d.run('window.IncidentTypes.longTermSpan(incident).basis'),'Observed');
  d.context.incident.lastSeenAt='2026-09-15T09:59:59Z';
  assert.equal(d.run('window.IncidentTypes.longTermSpan(incident)'),null);
  for (const incident of [
    {firstSeenAt:'invalid',lastSeenAt:'2026-09-15T10:00:00Z'},
    {firstSeenAt:'2026-09-16T10:00:00Z',lastSeenAt:'2026-09-15T10:00:00Z'},
    {firstSeenAt:null,lastSeenAt:'2026-09-15T10:00:00Z'},
    {firstSeenAt:'2026-09-01T10:00:00Z',lastSeenAt:'2026-09-15T10:00:00Z',sourceStartedAt:'2026-09-16T10:00:00Z'},
    {lastSeenAt:'2026-09-15T10:00:00Z',sourceStartedAt:'2026-09-15T08:00:00Z',sourceEndedAt:'2026-09-14T08:00:00Z'}
  ]) {d.context.incident=incident;assert.equal(d.run('window.IncidentTypes.longTermSpan(incident)'),null);}
});

test('recurring work shows its next reported start and is excluded from active counts',()=>{
  const d=dashboard();
  d.context.features=[event({normalizedStatus:'planned',incidentDescription:'Recurring overnight maintenance.',
    firstSeenAt:'2026-09-10T16:00:00Z',lastSeenAt:'2026-09-15T16:00:00Z',
    sourceStartedAt:'2026-09-16T01:00:00Z',sourceEndedAt:'2026-09-16T09:00:00Z'})];
  d.run("state.routeData.set('I25',{incidentThreads:incidentModel.aggregateIncidentThreads(features,'2026-09-15T16:00:00Z')});renderIncidentTable('I25',state.routeData.get('I25').incidentThreads)");
  const incident=d.run("state.routeData.get('I25').incidentThreads[0]");
  assert.equal(incident.ongoing,false);
  const badge=d.nodes.get('i25IncidentRows').children[0].children[0].children[1];
  assert.equal(badge.textContent,'Continuing at 7:00 PM');
  assert.match(badge.title,/Not active now.*Sep 15.*7:00 PM MDT/);
  assert.equal(d.nodes.get('i25IncidentCount').textContent,'0 active · 1 continuing later · 1 total');
});

test('continuation times include another local date and follow the selected display timezone',()=>{
  const d=dashboard();
  d.context.features=[event({normalizedStatus:'planned',incidentNote:'Nightly maintenance.',
    firstSeenAt:'2026-09-10T16:00:00Z',lastSeenAt:'2026-09-15T16:00:00Z',
    sourceStartedAt:'2026-09-17T01:00:00Z',sourceEndedAt:'2026-09-17T09:00:00Z'})];
  assert.equal(d.run("incidentStatusLabel(incidentModel.aggregateIncidentThreads(features,'2026-09-15T16:00:00Z')[0])"),'Continuing Sep 16 at 7:00 PM');
  const east=dashboard(undefined,'','/dashboard/',undefined,undefined,'America/New_York');
  east.context.features=d.context.features;
  assert.equal(east.run("incidentStatusLabel(incidentModel.aggregateIncidentThreads(features,'2026-09-15T16:00:00Z')[0])"),'Continuing Sep 16 at 9:00 PM');
});

test('continuation times require a valid future provider start and explicit recurrence',()=>{
  const d=dashboard();
  const recurring={...event().properties,incidentDescription:'Recurring overnight work.',normalizedStatus:'planned',
    sourceStartedAt:'2026-09-16T01:00:00Z',sourceEndedAt:'2026-09-16T09:00:00Z'};
  d.context.incident=recurring;
  assert.equal(d.run("window.IncidentTypes.nextContinuationStart(incident,'2026-09-15T16:00:00Z')"),Date.parse(recurring.sourceStartedAt));
  assert.equal(d.run("window.IncidentTypes.nextContinuationStart(incident,'2026-09-16T01:00:00Z')"),null,'a start that has arrived is not an upcoming continuation');
  for(const change of [
    {sourceStartedAt:null},{sourceStartedAt:'invalid'},
    {sourceEndedAt:'2026-09-15T01:00:00Z'},{sourceEndedAt:'invalid'},
    {incidentDescription:'A one-off repair.'},{incidentDescription:'No recurring overnight work.'},
    {archived:true},{normalizedStatus:'cleared'},{normalizedStatus:'cancelled'},
    {firstSeenAt:'2026-09-15T15:00:00Z',lastSeenAt:'2026-09-15T16:00:00Z'}
  ]) {
    d.context.incident={...recurring,...change};
    assert.equal(d.run("window.IncidentTypes.nextContinuationStart(incident,'2026-09-15T16:00:00Z')"),null,JSON.stringify(change));
  }
});

test('a future work period is not active even when the provider record remains active',()=>{
  const d=dashboard();
  d.context.features=[event({active:true,normalizedStatus:'active',sourceStartedAt:'2026-09-16T01:00:00Z',sourceEndedAt:'2026-09-16T09:00:00Z'})];
  assert.equal(d.run("incidentModel.aggregateIncidentThreads(features,'2026-09-15T16:00:00Z')[0].ongoing"),false);
  assert.equal(d.run("incidentStatusLabel(incidentModel.aggregateIncidentThreads(features,'2026-09-15T16:00:00Z')[0])"),'Planned');
  d.context.features[0].properties.normalizedStatus='cleared';
  assert.equal(d.run("incidentStatusLabel(incidentModel.aggregateIncidentThreads(features,'2026-09-15T16:00:00Z')[0])"),'Cleared');
  d.context.features[0].properties.normalizedStatus='cancelled';
  d.context.features[0].properties.sourceStartedAt='2026-09-15T01:00:00Z';
  assert.equal(d.run("incidentModel.aggregateIncidentThreads(features,'2026-09-15T16:00:00Z')[0].ongoing"),false);
});

test('map popups distinguish continuing reports and honor cleared state over an active flag',async()=>{
  const instances=[],popups=[],d=corridorMap(async()=>fakeMapRenderer(instances,popups));
  await d.context.window.CorridorMapPanel.render({corridor:'I25',
    corridorFeature:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-105,39.7],[-104.9,40.1]]}},incidentFeatures:[]});
  const feature={geometry:{type:'Point',coordinates:[-105,40]},properties:{...event().properties,incidentTypeLabel:'Maintenance'}};
  instances[0].listeners.get('click:corridor-incidents')({features:[feature]});
  assert.match(popups[0].content.children.at(-1).textContent,/CDOT report · Active · Long-term/);
  feature.properties.normalizedStatus='cleared';
  instances[0].listeners.get('click:corridor-incidents')({features:[feature]});
  assert.match(popups[1].content.children.at(-1).textContent,/CDOT report · Cleared/);
});

test('health never infers successful checks from existing route data', () => {
  const d = dashboard();
  d.run("state.routeData = buildDemoDashboardData().routeData; state.health = {apiUp:false}; renderSystemHealth()");
  assert.equal(d.nodes.get('apiServiceStatus').textContent, 'Unavailable');
  assert.equal(d.nodes.get('pipelineStatus').textContent, 'Unconfirmed');
});

test('failed refresh clears previous successful metrics and exposes unavailable incidents', async () => {
  const d = dashboard();
  d.run("state.routeData = buildDemoDashboardData().routeData; renderDashboard()");
  assert.equal(d.nodes.get('i25AverageSpeed').textContent, '61');
  await d.run('refreshDashboard()');
  assert.equal(d.nodes.get('i25AverageSpeed').textContent, '—');
  assert.equal(d.nodes.get('i25ActiveIncidents').textContent, '—');
  assert.match(d.nodes.get('i25IncidentRows').children[0].children[0].textContent, /unavailable/);
  assert.equal(d.nodes.get('apiServiceStatus').textContent, 'Unavailable');
});

test('optional endpoint failure does not discard other route metrics and ranges fetch baseline lookback', async () => {
  const requests = [];
  const d = dashboard(async url => {
    requests.push(url);
    if (url.includes('zones/trends')) throw new Error('Zone failure');
    const json = url.includes('/summary?') ? { latest: { avgCurrentSpeed: 42 } }
      : url.includes('/trends?') ? { buckets: [] }
      : url.includes('/operational-status') ? {status: 'HEALTHY', checks: []}
      : url.includes('/actuator') ? {status: 'UP'} : {features: []};
    return { ok: true, json: async () => json };
  });
  const data = await d.run('loadLiveDashboardData(720)');
  assert.equal(data.routeData.get('I25').summary.latest.avgCurrentSpeed, 42);
  assert.equal(data.health.partial, true);
  assert.ok(requests.some(url => url.includes('windowHours=889')));
  assert.equal(requests.filter(url => url.includes('/zones/baselines?')).length, 2);
  assert.ok(requests.some(url => url.includes('/incidents/recent?') && url.includes('windowMinutes=43200')));
  assert.equal(requests.filter(url => url.includes('/map/flow-cells/current?')).length, 2);
  assert.equal(requests.filter(url => url.includes('/map/flow-cells/frequency?') && url.includes('windowHours=720')).length, 2);
});

test('unavailable optional flow keeps corridor charts and incident data usable', async () => {
  const d = dashboard(async url => {
    if (url.includes('/map/flow-cells/')) throw new Error('Flow unavailable');
    return { ok: true, json: async () => ({ status:'UP', latest:{avgCurrentSpeed:61},
      buckets:[], features:[], points:[], zones:[], profiles:[] }) };
  });
  const data = await d.run('loadLiveDashboardData(24)');
  assert.equal(data.routeData.get('I25').summary.latest.avgCurrentSpeed, 61);
  assert.equal(data.routeData.get('I25').flowCells, null);
  assert.equal(data.routeData.get('I25').incidentsAvailable, true);
  assert.equal(data.health.failures.some(reason => reason.includes('undefined')), false);
});

test('missing zone baselines preserve current zone points and report partial data', async () => {
  const requests = [];
  const d = dashboard(async url => {
    requests.push(url);
    if (url.includes('/zones/baselines?')) throw new Error('Baseline unavailable');
    return { ok: true, json: async () => url.includes('/zones/trends?')
      ? { points: [{zoneKey:'south', bucketStart:'2026-09-26T00:00:00Z', avgCurrentSpeed:52}] }
      : { status:'UP', latest:{avgCurrentSpeed:61}, buckets:[], features:[] } };
  });
  const data = await d.run('loadLiveDashboardData(24)');
  assert.equal(data.routeData.get('I25').zones.length, 1);
  assert.equal(data.routeData.get('I25').zoneBaseline.zones.length, 0);
  assert.equal(data.routeData.get('I25').summary.latest.avgCurrentSpeed, 61);
  assert.equal(data.health.partial, true);
  assert.equal(requests.filter(url => url.includes('/zones/baselines?')).length, 2);
});

test('24-hour charts request enough compact observations to cover a one-minute cadence', async () => {
  const requests = [];
  const d = dashboard(async url => {
    requests.push(url);
    const json = url.includes('/summary?') ? { latest: { avgCurrentSpeed: 42 } }
      : url.includes('/trends?') ? { buckets: [] }
      : url.includes('/operational-status') ? {status: 'HEALTHY', checks: []}
      : url.includes('/actuator') ? {status: 'UP'}
      : url.includes('/history?') ? {samples: []} : {features: [], samples: []};
    return { ok: true, json: async () => json };
  });
  await d.run('loadLiveDashboardData(24)');
  const detailRequests = requests.filter(url => url.includes('/history?') && url.includes('includeIncidents=false'));
  assert.equal(detailRequests.length, 2);
  assert.ok(detailRequests.every(url => url.includes('windowMinutes=1440') && url.includes('limit=1500')));
  assert.equal(requests.filter(url => url.includes('/map/flow-cells/current?')).length, 2);
  assert.equal(requests.some(url => url.includes('/map/flow-cells/frequency?')), false);
  assert.equal(d.run('detailedSpeedSampleLimit(120)'), 180);
  assert.equal(d.run('detailedSpeedSampleLimit(10080)'), 2000);
});

test('incident reads follow the selected short range exactly', async () => {
  const requests = [];
  const d = dashboard(async url => {
    requests.push(url);
    const json = url.includes('/summary?') ? { latest: { avgCurrentSpeed: 42 } }
      : url.includes('/zones/trends?') ? { points: [] }
      : url.includes('/analytics/trends?') ? { buckets: [] }
      : url.includes('/operational-status') ? {status: 'HEALTHY', checks: []}
      : url.includes('/actuator') ? {status: 'UP'}
      : url.includes('/history?') ? {samples: []} : {features: []};
    return { ok: true, json: async () => json };
  });
  await d.run('loadLiveDashboardData(2)');
  assert.equal(
    requests.filter(url => url.includes('/incidents/recent?') && url.includes('windowMinutes=120')).length,
    2
  );
  requests.length = 0;
  await d.run('loadLiveDashboardData(6)');
  assert.equal(
    requests.filter(url => url.includes('/incidents/recent?') && url.includes('windowMinutes=360')).length,
    2
  );
});

test('one sync preloads every range while deduplicating shared endpoint requests', async () => {
  const requests = [];
  const d = dashboard(async url => {
    requests.push(url);
    const json = url.includes('/summary?') ? { latest: { avgCurrentSpeed: 42, polledAt: '2026-09-28T18:00:00Z' } }
      : url.includes('/zones/trends?') ? { points: [] }
      : url.includes('/analytics/trends?') ? { buckets: [] }
      : url.includes('/operational-status') ? { status: 'HEALTHY', checks: [] }
      : url.includes('/actuator') ? { status: 'UP' }
      : url.includes('/map/corridors') ? { features: [] }
      : url.includes('/history?') ? { samples: [] }
      : url.includes('/incidents/') ? { features: [] }
      : url.includes('/flow-cells/') ? { cells: [] }
      : url.includes('/baselines?') ? { profiles: [], zones: [] }
      : {};
    return { ok: true, json: async () => json };
  });
  const snapshots = await d.run('loadLiveDashboardSnapshots()');
  assert.deepEqual([...snapshots.keys()], [2, 6, 24, 168, 720]);
  assert.equal(requests.filter(url => url.includes('/traffic/summary?')).length, 2);
  assert.equal(requests.filter(url => url.includes('/analytics/trends?')).length, 2);
  assert.ok(requests.filter(url => url.includes('/analytics/trends?'))
    .every(url => url.includes('windowHours=889') && url.includes('limit=890')));
  assert.equal(requests.filter(url => url.includes('/history?') && url.includes('includeIncidents=false')).length, 2);
  assert.ok(requests.filter(url => url.includes('/history?') && url.includes('includeIncidents=false'))
    .every(url => url.includes('windowMinutes=1440') && url.includes('limit=1500')));
  assert.equal(requests.filter(url => url.includes('/zones/trends?')).length, 10);
  assert.equal(requests.filter(url => url.includes('/incidents/shared?')).length, 2);
  assert.equal(requests.filter(url => url.includes('/flow-cells/frequency?')).length, 4);
  assert.equal(requests.filter(url => url.includes('/actuator/health')).length, 1);
  assert.equal(requests.filter(url => url.includes('/system/operational-status')).length, 1);
});

test('switching a preloaded range renders locally without fetching', () => {
  let requestCount = 0;
  const d = dashboard(async () => { requestCount += 1; throw new Error('Unexpected request'); });
  d.run('state.snapshots = buildDemoDashboardSnapshots(); state.lastSyncedAt = new Date();');
  assert.equal(d.run('applyDashboardSnapshot(2)'), true);
  assert.equal(d.run("state.routeData.get('I25').trend.windowHours"), 171);
  assert.equal(d.run('applyDashboardSnapshot(720)'), true);
  assert.equal(d.run("state.routeData.get('I25').trend.windowHours"), 889);
  assert.equal(requestCount, 0);
});

test('every preloaded chart range is reachable from the dashboard controls', () => {
  const d = dashboard();
  const html = indexSource;
  const buttons = [...html.matchAll(/<button\b[^>]*data-hours="(\d+)"[^>]*>([^<]+)<\/button>/g)];
  assert.deepEqual(buttons.map(match => Number(match[1])), Array.from(d.run('DASHBOARD_RANGE_HOURS')));
  assert.deepEqual(buttons.map(match => match[2]), ['2H', '6H', '24H', '7D', '30D']);
  assert.match(buttons[0][0], /aria-pressed="false"/);
  assert.equal(buttons.filter(match => /aria-pressed="true"/.test(match[0])).length, 1);
  assert.match(html, /id="refreshButton"[^>]*title="Sync is limited to once every 15 seconds\."/);
});

test('a partial background sync retains the last good endpoint values', () => {
  const d = dashboard();
  d.run(`previousSnapshots = buildDemoDashboardSnapshots();
    nextSnapshots = buildDemoDashboardSnapshots();
    nextRoute = nextSnapshots.get(24).routeData.get('I25');
    nextRoute.summary = {};
    nextRoute.syncAvailability = { summary: false };
    mergedSnapshots = mergeDashboardSnapshots(previousSnapshots, nextSnapshots);`);
  assert.equal(d.run("mergedSnapshots.get(24).routeData.get('I25').summary.latest.avgCurrentSpeed"), 61);
});

test('a failed background sync keeps the preloaded dashboard visible', async () => {
  const d = dashboard();
  d.run(`state.snapshots = buildDemoDashboardSnapshots();
    state.lastSyncedAt = new Date('2026-09-28T13:00:00Z');
    applyDashboardSnapshot(24);
    loadLiveDashboardSnapshots = async () => { throw new Error('Temporary sync failure'); };`);
  await d.run('refreshDashboard()');
  assert.equal(d.nodes.get('i25AverageSpeed').textContent, '61');
  assert.match(d.nodes.get('statusText').textContent, /Temporary sync failure/);
  assert.match(d.nodes.get('statusText').textContent, /Showing data synced at/);
});

test('overlapping sync requests coalesce without depending on the selected range', async () => {
  const d = dashboard();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let syncCount = 0;
  d.context.loader = async () => {
    syncCount += 1;
    if (syncCount === 1) await pending;
    return d.run('buildDemoDashboardSnapshots()');
  };
  d.run('loadLiveDashboardSnapshots = loader');
  const first = d.run('refreshDashboard()');
  d.run('state.selectedHours = 720');
  await d.run('refreshDashboard()');
  release();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(syncCount, 1);
  assert.equal(d.run('state.routeData.get("I25").trend.windowHours'), 889);
  assert.equal(d.run('state.refreshing'), false);
});

test('an explicit queued view change gets one follow-up sync', async () => {
  const d=dashboard();
  let release,count=0;
  const pending=new Promise(resolve=>{release=resolve;});
  d.context.loader=async()=>{if(++count===1)await pending;return d.run('buildDemoDashboardSnapshots()');};
  d.run('loadLiveDashboardSnapshots=loader');
  const first=d.run('refreshDashboard()');
  await d.run('refreshDashboard({queueIfBusy:true})');
  await d.run('refreshDashboard({queueIfBusy:true})');
  release();await first;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(count,2);
  assert.equal(d.run('state.refreshing'),false);
});

test('manual sync ignores click spam until its cooldown expires', async () => {
  const d=dashboard();
  let release,count=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const clock=historyHoverClock(d);
  d.context.loader=async()=>{count++;await pending;return d.run('buildDemoDashboardSnapshots()');};
  d.run('loadLiveDashboardSnapshots=loader;requestManualRefresh()');
  for(let i=0;i<20;i++)d.run('requestManualRefresh()');
  assert.equal(count,1);
  assert.equal(d.nodes.get('refreshButton').disabled,true);
  assert.equal(d.nodes.get('refreshButton').attributes['data-history-pressed'],'true');
  clock.advance(450);
  assert.equal(d.nodes.get('refreshButton').attributes['data-history-pressed'],undefined);
  assert.equal(d.nodes.get('refreshButton').disabled,true);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(d.nodes.get('refreshButton').disabled,true);
  clock.advance(14550);assert.equal(d.nodes.get('refreshButton').disabled,false);
});

test('offline preload placeholders cannot make a failed sync appear successful', async () => {
  const d=dashboard();
  await assert.rejects(d.run('loadLiveDashboardSnapshots()'),/Select Sync now to retry/);
  await d.run('refreshDashboard()');
  assert.doesNotMatch(d.nodes.get('statusText').textContent,/previously synced|Showing data synced/);
});

test('partial sync retains failed slices, missing corridors and missing geometry', () => {
  const d=dashboard();
  d.run(`previous=buildDemoDashboardSnapshots();next=buildDemoDashboardSnapshots();
    previous.get(24).corridorFeatures.set('I70',{geometry:{type:'LineString',coordinates:[[1,2],[3,4]]}});
    next.get(24).routeData.delete('I70');
    next.get(24).routeData.get('I25').zones=[];
    next.get(24).routeData.get('I25').syncAvailability={zones:false};
    merged=mergeDashboardSnapshots(previous,next);`);
  assert.equal(d.run('merged.get(24).routeData.has("I70")'),true);
  assert.equal(d.run('merged.get(24).corridorFeatures.has("I70")'),true);
  assert.ok(d.run('merged.get(24).routeData.get("I25").zones.length')>0);
});
