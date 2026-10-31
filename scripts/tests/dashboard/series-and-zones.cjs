const { test } = require('node:test');
const { dashboard, assert, indexSource, readFileSync, path, event } = require('../fixtures/core.cjs');
const { informationPage } = require('../fixtures/information.cjs');
const { testDirectory } = require('../fixtures/core.cjs');

test('chart time window remains anchored to now and gaps are not bridged', () => {
  const d = dashboard();
  d.context.buckets = [{ bucketStart: new Date(Date.now() - 48 * 3_600_000).toISOString(), avgCurrentSpeed: 55 }];
  assert.equal(d.run('selectDisplayBuckets(buckets, 24).length'), 0);
  assert.equal(d.run('chartSegments([{timestamp:0, verticalPosition:10}, {timestamp:3600000, verticalPosition:12}, {timestamp:18000000, verticalPosition:20}]).length'), 2);
});

test('historical mode anchors retained charts and rebuilds snapshot incidents', async () => {
  const requests = [];
  const snapshot = '2026-06-19T02:51:46Z';
  const incidentsJson = JSON.stringify({ incidents: [{
    properties: { iconCategory: 14, closestMileMarker: 225, locationLabel: 'I-25 near MM 225' },
    geometry: { type: 'Point', coordinates: [-105, 40] }
  }] });
  const d = dashboard(async url => {
    requests.push(url);
    const json = url.includes('/summary?')
      ? { latest: { corridor: url.includes('I70') ? 'I70' : 'I25', polledAt: snapshot, avgCurrentSpeed: 55, incidentsJson } }
      : url.includes('/trends?') ? { buckets: [{ bucketStart: '2026-06-19T02:00:00Z', avgCurrentSpeed: 54, sampleCount: 60 }] }
      : url.includes('zones/trends') ? { points: [] }
      : url.includes('/operational-status') ? { status: 'UNKNOWN', checks: [] }
      : url.includes('/actuator') ? { status: 'UP' }
      : url.includes('/map/corridors') ? { features: [{ properties: { corridor: 'I25' } }, { properties: { corridor: 'I70' } }] }
      : { features: [] };
    return { ok: true, json: async () => json };
  }, '?historical=1');
  const data = await d.run('loadLiveDashboardData(24)');
  assert.ok(requests.some(url => url.includes('/trends?') && url.includes('asOf=2026-06-19T02%3A51%3A46Z')));
  assert.ok(requests.some(url => url.includes('zones/trends') && url.includes('windowHours=24')
    && url.includes('asOf=2026-06-19T02%3A51%3A46Z')));
  assert.ok(requests.some(url => url.includes('/zones/baselines?')
    && url.includes('asOf=2026-06-19T02%3A51%3A46Z')));
  assert.ok(requests.some(url => url.includes('/history?') && url.includes('asOf=2026-06-19T02%3A51%3A46Z')));
  assert.ok(requests.some(url => url.includes('/incidents/timeline?') && url.includes('asOf=2026-06-19T02%3A51%3A46Z')));
  assert.ok(requests.some(url => url.includes('/analytics/baselines?') && url.includes('asOf=2026-06-19T02%3A51%3A46Z')));
  assert.ok(requests.some(url => url.includes('/map/flow-cells/hourly?') && url.includes('asOf=2026-06-19T02%3A51%3A46Z')));
  assert.equal(data.routeData.get('I25').incidentThreads[0].type, 'Disabled Vehicle');
  assert.equal(data.routeData.get('I25').incidentThreads[0].ongoing, true);
  d.context.buckets = data.routeData.get('I25').trend.buckets;
  assert.equal(d.run("selectDisplayBuckets(buckets, 24, Date.parse('2026-06-19T02:51:46Z')).length"), 1);
});

test('historical live replay loops a shared virtual clock without calling the live incident feed', async () => {
  const requests = [];
  const incidentsJson = JSON.stringify({ incidents: [{
    properties: { iconCategory: 1, closestMileMarker: 221, locationLabel: 'I-25 near MM 221' },
    geometry: { type: 'Point', coordinates: [-105, 40] }
  }] });
  const d = dashboard(async url => {
    requests.push(url);
    const json = url.includes('/history?') && url.includes('includeIncidents=true')
      ? { samples: [{ corridor: url.includes('I70') ? 'I70' : 'I25', polledAt: '2026-06-18T19:59:42Z', avgCurrentSpeed: 55, incidentsJson }] }
      : url.includes('/history?') ? { samples: [] }
      : url.includes('/trends?') ? { buckets: [] }
      : url.includes('zones/trends') ? { points: [] }
      : url.includes('/operational-status') ? { status: 'UNKNOWN', checks: [] }
      : url.includes('/actuator') ? { status: 'UP' }
      : url.includes('/map/corridors') ? { features: [{ properties: { corridor: 'I25' } }, { properties: { corridor: 'I70' } }] }
      : { features: [] };
    return { ok: true, json: async () => json };
  }, '?replay=1');

  assert.equal(d.run('REPLAY_CONFIG.rate'), 30);
  d.run('state.replayStartedAt = Date.now()');
  const data = await d.run('loadLiveDashboardData(24)');
  assert.ok(requests.some(url => url.includes('includeIncidents=true') && url.includes('asOf=2026-09-10T20%3A30')));
  assert.ok(requests.some(url => url.includes('/trends?') && url.includes('asOf=2026-09-10T20%3A30')));
  assert.ok(requests.some(url => url.includes('/incidents/timeline?') && url.includes('windowMinutes=1440')));
  assert.ok(requests.some(url => url.includes('/analytics/baselines?') && url.includes('asOf=2026-09-10T20%3A30')));
  assert.ok(requests.some(url => url.includes('/zones/baselines?') && url.includes('asOf=2026-09-10T20%3A30')));
  assert.ok(requests.some(url => url.includes('/map/flow-cells/hourly?') && url.includes('asOf=2026-09-10T20%3A30')));
  assert.equal(requests.some(url => url.includes('/incidents/recent')), false);
  assert.equal(data.routeData.get('I25').incidentThreads[0].type, 'Crash');
  assert.equal(data.routeData.get('I25').dataAnchor.startsWith('2026-09-10T20:30'), true);

  const start = d.run('state.replayStartedAt');
  assert.equal(d.run(`replayAsOf(${start} + 2000).toISOString()`), '2026-09-10T20:31:00.000Z');
  assert.equal(d.run(`replayAsOf(${start} + 602000).toISOString()`), '2026-09-10T20:31:00.000Z');
});

test('default replay uses the latest window shared by both corridors', async () => {
  const d=dashboard(undefined,'?replay=1');
  const requests=[];
  d.context.request=async path=>{
    requests.push(path);
    return {polledAt:path.includes('I25')?'2026-10-07T12:00:00Z':'2026-10-07T11:55:00Z'};
  };
  await d.run('resolveDefaultReplayWindow(request)');
  assert.equal(d.run('REPLAY_CONFIG.end'),Date.parse('2026-10-07T11:55:00Z'));
  assert.equal(d.run('REPLAY_CONFIG.end-REPLAY_CONFIG.start'),5*3600000);
  assert.deepEqual(requests.sort(),[
    '/dashboard-api/traffic/latest?corridor=I25&preferUsable=true',
    '/dashboard-api/traffic/latest?corridor=I70&preferUsable=true']);
});

test('default replay keeps safe bounds when either latest observation is missing or invalid', async () => {
  for(const bad of [null,{}, {polledAt:'invalid'}, {polledAt:'1970-01-01T00:00:00Z'},new Error('Unavailable')]) {
    const d=dashboard(undefined,'?replay=1');
    const original=d.run('JSON.stringify(REPLAY_CONFIG)');
    d.context.request=async path=>{
      if(path.includes('I25'))return {polledAt:'2026-10-07T12:00:00Z'};
      if(bad instanceof Error)throw bad;
      return bad;
    };
    await d.run('resolveDefaultReplayWindow(request)');
    assert.equal(d.run('JSON.stringify(REPLAY_CONFIG)'),original);
  }
});

test('explicit replay bounds and non-replay modes never perform default-window reads', async () => {
  for(const [search,path] of [
    ['?replay=1&replayStart=2026-10-01T00:00:00Z','/dashboard/'],
    ['?replay=1&replayEnd=2026-10-01T00:00:00Z','/dashboard/'],
    ['', '/dashboard/'], ['?replay=1','/dashboard-experimental/']]) {
    const d=dashboard(undefined,search,path);
    const original=d.run('JSON.stringify(REPLAY_CONFIG)');
    d.context.request=()=>{throw new Error('Unexpected latest read');};
    await d.run('resolveDefaultReplayWindow(request)');
    assert.equal(d.run('JSON.stringify(REPLAY_CONFIG)'),original);
  }
});

test('legacy replay snapshots exclude congestion fragments from discrete incident counts', () => {
  const d = dashboard();
  d.context.latest = {
    corridor: 'I25', polledAt: '2026-05-29T22:03:00Z', incidentProvider: 'tomtom',
    incidentsJson: JSON.stringify({ incidents: [
      { properties: { iconCategory: 6, description: 'Slow traffic', closestMileMarker: 265.1 } },
      { properties: { iconCategory: 13, description: 'Cluster', closestMileMarker: 264.8 } },
      { properties: { iconCategory: 9, description: 'Roadworks', travelDirection: 'S', closestMileMarker: 250 } },
      { properties: { iconCategory: 7, description: 'Lane closed', travelDirection: 'S', closestMileMarker: 250.2 } }
    ] })
  };
  const features = d.run('legacySnapshotIncidentFeatures(latest)');
  assert.equal(features.length, 2);
  assert.deepEqual(Array.from(features, feature => feature.properties.incidentTypeLabel), ['Roadworks', 'Lane closed']);
});

test('historical incident lifecycle markers retain their actual timeline positions', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-09-15T20:00:00Z');
  d.context.end = Date.parse('2026-09-15T22:00:00Z');
  d.context.incidents = [
    { type: 'Construction', locationLabel: 'MP 243.4', firstSeenAt: new Date('2026-09-15T20:10:00Z'), lastSeenAt: new Date('2026-09-15T21:55:00Z') },
    { type: 'Closure', locationLabel: 'MP 235.5', firstSeenAt: new Date('2026-09-15T21:10:00Z'), lastSeenAt: new Date('2026-09-15T21:24:00Z') },
    { type: 'Construction', locationLabel: 'MP 210.4', firstSeenAt: new Date('2026-09-01T12:00:00Z'), lastSeenAt: new Date('2026-09-15T22:00:00Z'), ongoing: true }
  ];
  const groups = d.run('buildIncidentChartGroups(incidents, start, end, 50, 1050)');
  assert.deepEqual(Array.from(groups, group => group.timestamp), [
    Date.parse('2026-09-15T20:10:00Z'), Date.parse('2026-09-15T21:10:00Z')
  ]);
});

test('replay accepts safe custom bounds and clamps its playback rate', () => {
  const d = dashboard(undefined, '?replay=1&replayStart=2026-06-18T21%3A00%3A00Z&replayEnd=2026-06-18T22%3A00%3A00Z&replayRate=9999');
  assert.deepEqual({ ...d.run('REPLAY_CONFIG') }, {
    start: Date.parse('2026-06-18T21:00:00Z'),
    end: Date.parse('2026-06-18T22:00:00Z'),
    rate: 3600
  });

  const startOnly = dashboard(undefined, '?replay=1&replayStart=2026-07-01T00%3A00%3A00Z');
  assert.equal(startOnly.run('REPLAY_CONFIG.end - REPLAY_CONFIG.start'), 5 * 60 * 60_000);
});

test('incident transitions stay at their historical timestamps without piling up at the replay cursor', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-09-15T20:00:00Z');
  d.context.end = Date.parse('2026-09-15T22:00:00Z');
  assert.equal(d.run("incidentChartTimestamp({firstSeenAt:'2026-09-15T20:10:00Z',lastSeenAt:'2026-09-15T21:55:00Z'},start,end)"), Date.parse('2026-09-15T20:10:00Z'));
  assert.equal(d.run("incidentChartTimestamp({firstSeenAt:'2026-09-01T12:00:00Z',lastSeenAt:'2026-09-15T21:24:00Z',ongoing:false},start,end)"), Date.parse('2026-09-15T21:24:00Z'));
  assert.equal(d.run("incidentChartTimestamp({firstSeenAt:'2026-09-01T12:00:00Z',lastSeenAt:'2026-09-15T22:00:00Z',ongoing:true},start,end)"), 0);
});

test('travel time and worst segment use the current combined snapshot', () => {
  const d = dashboard();
  const current = new Date().toISOString();
  d.context.current = current;
  d.context.flowCells = { observedAt: current, totalCellCount: 3, supportedCellCount: 3,
    cells: [
      { cellId: 'fast', startMileMarker: 220, endMileMarker: 220.5, direction: 'COMBINED', speedMph: 60 },
      { cellId: 'slow', startMileMarker: 220.5, endMileMarker: 221, direction: 'COMBINED', speedMph: 30 },
      { cellId: 'directional', startMileMarker: 220.5, endMileMarker: 221, direction: 'SOUTHBOUND', speedMph: 5 }
    ] };
  assert.equal(d.run('estimateCorridorTravelMinutes(flowCells, 1, 42)'), 1.5);
  assert.equal(d.run('slowestCurrentCell(flowCells).cellId'), 'slow');
  assert.equal(d.run('estimateCorridorTravelMinutes(flowCells, 63, 42)'), 90);
  d.context.zones = [
    { bucketStart: current, avgCurrentSpeed: 40, zoneLabel: 'latest' },
    { bucketStart: new Date(Date.now() - 60_000).toISOString(), avgCurrentSpeed: 10, zoneLabel: 'older' }
  ];
  assert.equal(d.run('slowestCurrentZone(zones, current).zoneLabel'), 'latest');
  d.run(`renderCorridorSummary('I25', {
    summary: {latest: {avgCurrentSpeed: 42, polledAt: current}}, currentFlowCells: flowCells,
    zones: [], incidentThreads: [], incidentsAvailable: true })`);
  assert.equal(d.nodes.get('i25TravelTime').textContent, '90');
  assert.equal(d.nodes.get('i25FastestTravelTime').textContent, '90');
  assert.equal(d.nodes.get('i25SlowestTravelTime').textContent, '90');
  assert.equal(d.nodes.get('i25WorstMileMarker').textContent, 'MM 220.5–221');
  assert.equal(d.nodes.get('i25WorstSpeed').textContent, '30');
  assert.equal(d.nodes.get('i25WorstSpeedUnit').hidden, false);
  assert.match(indexSource, /Estimated Travel Time/);
  assert.doesNotMatch(indexSource, /Estimated Average Delay/);
});

test('both live cards clear speed units when segment observations become unavailable', () => {
  const d=dashboard();
  for (const corridor of ['I25','I70']) {
    const prefix=corridor.toLowerCase();
    d.run(`renderSummaryWorstSpeed('${prefix}', 49.6)`);
    assert.equal(d.nodes.get(`${prefix}WorstSpeed`).textContent,'50');
    assert.equal(d.nodes.get(`${prefix}WorstSpeedUnit`).hidden,false);
    d.run(`renderCorridorSummary('${corridor}', {summary:{latest:{}},zones:[],incidentThreads:[]})`);
    assert.equal(d.nodes.get(`${prefix}WorstSpeed`).textContent,'');
    assert.equal(d.nodes.get(`${prefix}WorstSpeedUnit`).hidden,true);
  }
});

test('long-range summaries use period averages and observed incidents', () => {
  const d = dashboard(undefined, '?historical=1');
  d.run('state.selectedHours = 168');
  d.context.route = {
    dataAnchor: '2026-09-28T18:00:00Z',
    summary: { latest: { avgCurrentSpeed: 70, polledAt: '2026-09-28T18:00:00Z' } },
    trend: { buckets: [
      { bucketStart: '2026-09-28T17:00:00Z', avgCurrentSpeed: 60, sampleCount: 3 },
      { bucketStart: '2026-09-28T18:00:00Z', avgCurrentSpeed: 30, sampleCount: 1 }
    ] },
    zones: [
      { zoneKey: 'a', bucketStart: '2026-09-28T17:00:00Z', startMileMarker: 0, endMileMarker: 10, avgCurrentSpeed: 60, observationCount: 3 },
      { zoneKey: 'b', bucketStart: '2026-09-28T17:00:00Z', startMileMarker: 10, endMileMarker: 63, avgCurrentSpeed: 60, observationCount: 3 },
      { zoneKey: 'a', bucketStart: '2026-09-28T18:00:00Z', startMileMarker: 0, endMileMarker: 10, avgCurrentSpeed: 30, observationCount: 1 },
      { zoneKey: 'b', bucketStart: '2026-09-28T18:00:00Z', startMileMarker: 10, endMileMarker: 63, avgCurrentSpeed: 60, observationCount: 1 }
    ],
    currentFlowCells: {
      observedAt: '2026-09-28T18:00:00Z', totalCellCount: 1, supportedCellCount: 1,
      cells: [{ cellId: 'current', startMileMarker: 0, endMileMarker: 60, direction: 'COMBINED', speedMph: 20 }]
    },
    incidentThreads: [{ ongoing: true }, { ongoing: false }, { ongoing: false }],
    incidentsAvailable: true
  };

  d.run("renderCorridorSummary('I25', route)");

  assert.equal(d.nodes.get('i25AverageSpeedLabel').textContent, '7-Day Average Speed');
  assert.equal(d.nodes.get('i25AverageSpeed').textContent, '53');
  assert.equal(d.nodes.get('i25TravelTimeLabel').textContent, 'Average Travel Time');
  assert.equal(d.nodes.get('i25TravelTime').textContent, '68');
  assert.equal(d.nodes.get('i25FastestTravelTimeLabel').textContent, 'Fastest hour');
  assert.equal(d.nodes.get('i25FastestTravelTime').textContent, '63');
  assert.equal(d.nodes.get('i25SlowestTravelTimeLabel').textContent, 'Slowest hour');
  assert.equal(d.nodes.get('i25SlowestTravelTime').textContent, '73');
  assert.equal(d.nodes.get('i25IncidentsLabel').textContent, 'Observed Incidents');
  assert.equal(d.nodes.get('i25ActiveIncidents').textContent, '3');
  assert.equal(d.nodes.get('i25WorstSegmentLabel').textContent, 'Slowest Avg Segment');
  assert.equal(d.nodes.get('i25WorstMileMarker').textContent, 'MM 0–10');
  assert.equal(d.nodes.get('i25WorstSpeed').textContent, '53');
  assert.equal(d.nodes.get('i25WorstSpeedUnit').hidden, false);
});

test('switching back to a short range restores current summary labels', () => {
  const d = dashboard();
  d.run(`state.selectedHours = 720;
    renderCorridorSummaryLabels('i25', true);
    state.selectedHours = 24;
    renderCorridorSummaryLabels('i25', false);`);
  assert.equal(d.nodes.get('i25AverageSpeedLabel').textContent, 'Average Speed');
  assert.equal(d.nodes.get('i25TravelTimeLabel').textContent, 'Estimated Travel Time');
  assert.equal(d.nodes.get('i25FastestTravelTimeLabel').textContent, 'Fastest today');
  assert.equal(d.nodes.get('i25SlowestTravelTimeLabel').textContent, 'Slowest today');
  assert.equal(d.nodes.get('i25IncidentsLabel').textContent, 'Active Incidents');
  assert.equal(d.nodes.get('i25WorstSegmentLabel').textContent, 'Worst Segment');
});

test('thirty-day travel labels describe actual three-hour zone buckets', () => {
  const d = dashboard();
  d.run("state.selectedHours=720; renderCorridorSummaryLabels('i70',true)");
  assert.equal(d.nodes.get('i70FastestTravelTimeLabel').textContent,'Fastest 3-hour');
  assert.equal(d.nodes.get('i70SlowestTravelTimeLabel').textContent,'Slowest 3-hour');
  assert.match(d.nodes.get('i70TravelTimeRange').title,/complete 3-hour/);
  assert.equal(d.nodes.get('i70AverageSpeedLabel').textContent,'30-Day Average Speed');
});

test('missing complete period coverage does not substitute current travel into period metrics', () => {
  const d = dashboard();
  d.run("state.selectedHours=720; renderCorridorSummary('I70',{summary:{latest:{avgCurrentSpeed:60}},trend:{buckets:[]},zones:[],incidentThreads:[],incidentsAvailable:false})");
  assert.equal(d.nodes.get('i70TravelTime').textContent,'—');
  assert.equal(d.nodes.get('i70FastestTravelTime').textContent,'—');
  assert.equal(d.nodes.get('i70ActiveIncidents').textContent,'—');
});

test('daily travel range uses Denver midnight and starts fresh each day', () => {
  const d = dashboard(undefined, '?historical=1');
  d.context.route = {
    dataAnchor: '2026-09-27T12:00:00Z',
    summary: { latest: { polledAt: '2026-09-27T12:00:00Z' } },
    dailyZones: [
      { zoneKey: 'a', bucketStart: '2026-09-27T05:59:00Z', startMileMarker: 0, endMileMarker: 10, avgCurrentSpeed: 5 },
      { zoneKey: 'b', bucketStart: '2026-09-27T05:59:00Z', startMileMarker: 10, endMileMarker: 60, avgCurrentSpeed: 5 },
      { zoneKey: 'a', bucketStart: '2026-09-27T06:00:00Z', startMileMarker: 0, endMileMarker: 10, avgCurrentSpeed: 20 },
      { zoneKey: 'b', bucketStart: '2026-09-27T06:00:00Z', startMileMarker: 10, endMileMarker: 60, avgCurrentSpeed: 100 },
      { zoneKey: 'a', bucketStart: '2026-09-27T09:00:00Z', startMileMarker: 0, endMileMarker: 10, avgCurrentSpeed: 10 },
      { zoneKey: 'b', bucketStart: '2026-09-27T09:00:00Z', startMileMarker: 10, endMileMarker: 60, avgCurrentSpeed: 50 },
      { zoneKey: 'partial', bucketStart: '2026-09-27T10:00:00Z', startMileMarker: 0, endMileMarker: 10, avgCurrentSpeed: 200 }
    ]
  };
  assert.deepEqual(
    { ...d.run('dailyTravelTimeRange(route, 60, 90)') },
    { fastest: 60, slowest: 120 }
  );

  d.context.route.dataAnchor = '2026-09-28T06:00:01Z';
  d.context.route.summary.latest.polledAt = '2026-09-28T06:00:01Z';
  assert.deepEqual(
    { ...d.run('dailyTravelTimeRange(route, 60, 75)') },
    { fastest: 75, slowest: 75 }
  );
  d.context.gappedZones = [
    { zoneKey: 'a', startMileMarker: 0, endMileMarker: 30, avgCurrentSpeed: 60 },
    { zoneKey: 'b', startMileMarker: 31, endMileMarker: 61, avgCurrentSpeed: 60 }
  ];
  assert.equal(d.run('Number.isNaN(estimateSpeedZoneTravelMinutes(gappedZones, 60))'), true);
});

test('Denver day ranges reject incomplete stopped and overlapping intervals', () => {
  const d = dashboard(undefined, '?historical=1');
  d.context.zones = [
    {zoneKey:'a',startMileMarker:0,endMileMarker:30,avgCurrentSpeed:60},
    {zoneKey:'b',startMileMarker:30,endMileMarker:60,avgCurrentSpeed:30}
  ];
  assert.equal(d.run('estimateSpeedZoneTravelMinutes(zones,60)'), 90);
  d.context.zones[1].avgCurrentSpeed = 0;
  assert.equal(d.run('Number.isNaN(estimateSpeedZoneTravelMinutes(zones,60))'), true);
  d.context.zones[1].avgCurrentSpeed = 30;
  d.context.zones[1].startMileMarker = 29;
  assert.equal(d.run('Number.isNaN(estimateSpeedZoneTravelMinutes(zones,60))'), true);
  assert.equal(d.run("denverCalendarDay('2026-11-01T07:30:00Z')"), '2026-11-01');
  assert.equal(d.run("denverCalendarDay('2026-11-01T08:30:00Z')"), '2026-11-01');
  const range = d.run('dailyTravelTimeRange({},60,NaN)');
  assert.equal(Number.isNaN(range.fastest), true);
  assert.equal(Number.isNaN(range.slowest), true);
});

test('daily zone requests share the selected24h read and retain the historical anchor', async () => {
  const requests = [];
  const anchor = '2026-09-28T12:00:00Z';
  const d = dashboard(async url => {
    requests.push(url);
    return {ok:true,json:async()=>({status:'UP',latest:{polledAt:anchor},points:[],features:[],buckets:[]})};
  }, '?historical=1');
  await d.run('loadLiveDashboardData(24)');
  assert.equal(requests.filter(url=>url.includes('/zones/trends?')).length,2);
  assert.ok(requests.filter(url=>url.includes('/zones/trends?'))
    .every(url=>url.includes('windowHours=24')&&url.includes(encodeURIComponent(anchor))));
  requests.length = 0;
  await d.run('loadLiveDashboardData(2)');
  assert.equal(requests.filter(url=>url.includes('/zones/trends?')&&url.includes('windowHours=24')).length,2);
  assert.equal(requests.filter(url=>url.includes('/zones/trends?')&&new URL(url,'http://fixture').searchParams.get('windowHours')==='2').length,2);
});

test('complete combined geometry is not rejected by directional companion counters', () => {
  const d = dashboard();
  d.context.snapshot = { observedAt: new Date().toISOString(), totalCellCount: 149, supportedCellCount: 149,
    cells: Array.from({length:136}, (_, i) => ({cellId:`combined-${i}`, direction:'COMBINED',
      startMileMarker:206 + i/2, endMileMarker:206 + (i+1)/2, speedMph:60})) };
  d.context.snapshot.cells.push(...Array.from({length:13}, (_, i) => ({cellId:`east-${i}`,
    direction:'EASTBOUND',startMileMarker:206+i/2,endMileMarker:206+(i+1)/2,speedMph:2})));
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 68, 30)'), 68);
  d.context.snapshot.cells.splice(20,1);
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 68, 30)'), 136);
});

test('travel estimates deduplicate geometry, reject gaps and retain zero-speed evidence', () => {
  const d = dashboard();
  d.context.snapshot = { observedAt:new Date().toISOString(), cells:[
    {cellId:'a',startMileMarker:0,endMileMarker:0.5,speedMph:60},
    {cellId:'duplicate',startMileMarker:0,endMileMarker:0.5,speedMph:60},
    {cellId:'b',startMileMarker:0.5,endMileMarker:1,speedMph:30}] };
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 1, 10)'), 1.5);
  d.context.snapshot.cells[2].startMileMarker = 0.6;
  d.context.snapshot.cells[2].endMileMarker = 1.1;
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 1, 10)'), 6);
  d.context.snapshot.cells[2].speedMph = 0;
  assert.equal(d.run('Number.isNaN(estimateCorridorTravelMinutes(snapshot, 1, 10))'), true);
  assert.equal(d.run('slowestCurrentCell(snapshot).speedMph'), 0);
});

test('hourly travel estimates use hourly speed and actual observation time', () => {
  const d = dashboard(undefined, '?historical=1');
  d.context.snapshot = { resolution:'HOURLY',hourEnd:'2026-01-01T11:00:00Z', cells:[
    {startMileMarker:0,endMileMarker:0.5,avgSpeedMph:60,lastObservedAt:'2026-01-01T10:45:00Z'},
    {startMileMarker:0.5,endMileMarker:1,avgSpeedMph:30,lastObservedAt:'2026-01-01T10:46:00Z'}] };
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 1, 10)'), 1.5);
  assert.equal(d.run('slowestCurrentCell(snapshot).speedMph'), 30);
  assert.equal(d.run('window.TrafficEstimates.currentFlowCells(snapshot).length'), 0);
  d.context.snapshot.cells.forEach(cell => delete cell.lastObservedAt);
  assert.equal(d.run('currentFlowCells(snapshot).length'), 0);
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 1, 10)'), 6);
  assert.equal(d.run('currentFlowCells({resolution:"HOURLY",cells:{}}).length'), 0);
  assert.equal(d.run('currentFlowCells({resolution:"SLOWDOWN_FREQUENCY",cells:[]}).length'), 0);
});

test('speed-zone charts use complete bucketed points for long ranges', () => {
  const d = dashboard();
  d.context.zoneRows = [
    { zoneKey: 'I70-west', zoneOrder: 0, startMileMarker: 206, endMileMarker: 213,
      bucketStart: '2026-09-01T00:00:00Z', avgCurrentSpeed: 52 },
    { zoneKey: 'I70-west', zoneOrder: 0, startMileMarker: 206, endMileMarker: 213,
      bucketStart: '2026-09-15T00:00:00Z', avgCurrentSpeed: 47 },
    { zoneKey: 'I70-west', zoneOrder: 0, startMileMarker: 206, endMileMarker: 213,
      bucketStart: '2026-09-26T00:00:00Z', avgCurrentSpeed: 55 }
  ];
  const groups = d.run("groupZoneSeries(zoneRows, 720, Date.parse('2026-09-26T00:00:00Z'))");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].samples.length, 3);
  assert.equal(groups[0].samples[0].timestamp, Date.parse('2026-09-01T00:00:00Z'));
});

test('speed-zone charts retain posted limits and include them in the chart domain', () => {
  const d = dashboard();
  d.context.zoneRows = [
    { zoneKey: 'south', zoneOrder: 0, startMileMarker: 208, endMileMarker: 221.5,
      bucketStart: '2026-09-26T00:00:00Z', avgCurrentSpeed: 42 }
  ];
  d.context.zoneBaselines = [{ zoneKey: 'south', postedSpeedMph: 55, profiles: [] }];
  d.run("groups = groupZoneSeries(zoneRows, 24, Date.parse('2026-09-26T00:00:00Z'), zoneBaselines)");
  assert.equal(d.run('groups[0].postedSpeedMph'), 55);
  assert.ok(d.run('calculateZoneSpeedDomain(groups[0], []).max >= groups[0].postedSpeedMph'));
});

test('speed-zone lines reach the window edges without inventing observation markers', () => {
  const d = dashboard();
  d.context.end = Date.parse('2026-09-26T00:00:00Z');
  d.context.start = d.context.end - 2 * 3_600_000;
  d.context.zoneRows = [
    { zoneKey: 'south', zoneOrder: 0, startMileMarker: 208, endMileMarker: 221.5,
      bucketStart: '2026-09-25T22:30:00Z', avgCurrentSpeed: 42 },
    { zoneKey: 'south', zoneOrder: 0, startMileMarker: 208, endMileMarker: 221.5,
      bucketStart: '2026-09-25T23:30:00Z', avgCurrentSpeed: 48 }
  ];
  d.run('groups = groupZoneSeries(zoneRows, 2, end)');
  assert.equal(d.run('groups[0].samples[0].timestamp'), d.context.start);
  assert.equal(d.run('groups[0].samples[0].isBoundary'), true);
  assert.equal(d.run('groups[0].samples.at(-1).timestamp'), d.context.end);
  assert.equal(d.run('groups[0].samples.at(-1).isBoundary'), true);
});

test('speed-zone descriptors spell out the range and distinguish current from expected speed', () => {
  const d = dashboard();
  d.context.group = { marker: 'MM 208–221.5', latestSpeed: 42, postedSpeedMph: 55 };
  d.context.baselineSeries = [{ speed: 53 }];
  assert.equal(d.run('speedZoneDescriptor(group, baselineSeries).mileMarkerRange'), '208–221.5');
  assert.equal(d.run('speedZoneDescriptor(group, baselineSeries).liveSpeed'), '42 mph');
  assert.equal(d.run('speedZoneDescriptor(group, baselineSeries).expectedSpeed'), '53 mph');

  const labels = [];
  d.context.labels = labels;
  d.context.ctx = new Proxy({
    fillText(text) { labels.push(text); }
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  d.run('drawSpeedLimitSign(ctx, group.postedSpeedMph, 8, 34)');
  assert.deepEqual([...d.context.labels], ['SPEED', 'LIMIT', '55']);
  assert.equal(d.run('speedZoneDescriptorTop(8, 108)'), 8);
  assert.equal(d.run('speedZoneDescriptorTop(20, 128)'), 30);
});

test('speed-zone descriptors label retained and long-range speeds as observed', () => {
  const labels = [];
  const d = dashboard(undefined, '?historical=1');
  d.context.labels = labels;
  d.context.ctx = new Proxy({fillText(text){labels.push(text);}}, {get(target,key){return key in target ? target[key] : ()=>{};}});
  d.run("drawSpeedZoneDescriptor(ctx,{marker:'MM208–221',latestSpeed:42,postedSpeedMph:55},[{speed:53}],8,108,{ink:'#111',muted:'#333'},92)");
  assert.ok(labels.includes('Observed:'));
  assert.equal(labels.includes('Live:'),false);
});

test('speed-zone charts attach zone-specific baselines and incidents by mile-marker range', () => {
  const d = dashboard();
  d.context.zoneRows = [
    { zoneKey: 'south', zoneOrder: 0, startMileMarker: 208, endMileMarker: 221.5,
      bucketStart: '2026-09-26T00:00:00Z', avgCurrentSpeed: 52 },
    { zoneKey: 'middle', zoneOrder: 1, startMileMarker: 221.5, endMileMarker: 225.6,
      bucketStart: '2026-09-26T00:00:00Z', avgCurrentSpeed: 62 },
    { zoneKey: 'north', zoneOrder: 2, startMileMarker: 225.6, endMileMarker: 271,
      bucketStart: '2026-09-26T00:00:00Z', avgCurrentSpeed: 68 }
  ];
  d.context.zoneBaselines = [{ zoneKey: 'middle', profiles: [{ dayOfWeek: 1, hourOfDay: 8, meanSpeed: 65 }] }];
  d.context.incidents = [
    { locationLabel: 'Crash near MM 221.5' },
    { locationLabel: 'Closure at MP 271' },
    { locationLabel: 'Location unavailable' }
  ];
  d.run("groups = groupZoneSeries(zoneRows, 24, Date.parse('2026-09-26T00:00:00Z'), zoneBaselines)");
  assert.equal(d.run("groups.find(group => group.key === 'middle').baselineProfiles.length"), 1);
  d.run('assignments = assignIncidentsToZoneGroups(groups, incidents)');
  assert.equal(d.run("assignments.get('south').length"), 0);
  assert.equal(d.run("assignments.get('middle')[0].locationLabel"), 'Crash near MM 221.5');
  assert.equal(d.run("assignments.get('north')[0].locationLabel"), 'Closure at MP 271');
  assert.equal(d.run("[...assignments.values()].flat().length"), 2);
});

test('speed-zone view reports coverage from zone profiles instead of the corridor baseline', () => {
  const d = dashboard();
  d.context.end = Date.now();
  d.run(`profiles = Array.from({length:168}, (_, index) => ({
    dayOfWeek: Math.floor(index / 24) + 1,
    hourOfDay: index % 24,
    meanSpeed: 60,
    standardDeviation: 3,
    effectiveSampleSize: 8,
    coverageTwoSigma: 87.5
  }))`);
  d.run(`state.focusedCorridor = 'I25'; state.chartView = 'zones'; state.selectedHours = 24;
    state.routeData.set('I25', {
      summary: {latest: {polledAt: new Date(end).toISOString()}},
      zones: [{zoneKey:'south', zoneOrder:0, startMileMarker:208, endMileMarker:221.5,
        bucketStart:new Date(end).toISOString(), avgCurrentSpeed:55}],
      zoneBaseline: {zones:[{zoneKey:'south', profiles}]},
      trend: {buckets:[]}, baseline: {profiles:[{coverageTwoSigma:12.5}]}
    })`);
  assert.equal(d.run('referenceCoveragePercentage()'), 87.5);
});

test('demo mode gives every speed zone a matching baseline profile', () => {
  const d = dashboard();
  d.context.now = new Date();
  d.run("demoRoute = buildDemoRouteData('I70', now)");
  assert.equal(d.run("new Set(demoRoute.zones.map(zone => zone.zoneKey)).size"), 8);
  assert.equal(d.run('demoRoute.zoneBaseline.zones.length'), 8);
  assert.ok(d.run('demoRoute.zoneBaseline.zones.every(zone => zone.profiles.length === 168)'));
});

test('I-70 demo and preview zones cover the monitored corridor with the actual posted limits', () => {
  const expected=[[206,213.1,60],[213.1,216,50],[216,236.918,65],[236.918,241.907,60],
    [241.907,244.857,55],[244.857,259,65],[259,270.274,65],[270.274,274,55]];
  const d=dashboard();
  assert.equal(d.run('CORRIDOR_CONFIG.I70.distanceMiles'),68);
  d.run("demoRoute=buildDemoRouteData('I70',new Date('2026-10-07T15:00:00Z'))");
  const demo=JSON.parse(d.run('JSON.stringify(demoRoute.zoneBaseline.zones.map(z=>[z.startMileMarker,z.endMileMarker,z.postedSpeedMph]))'));
  assert.deepEqual(demo,expected);
  const preview=require("../dashboard-preview.cjs");
  const zones=preview.speedZones('I70');
  assert.deepEqual(zones.map(z=>[z.startMileMarker,z.endMileMarker,z.postedSpeedMph]),expected);
  const anchors=preview.corridorAnchors.I70;
  assert.equal(anchors.length,9);assert.equal(anchors.at(-1)[0],274);
  assert.equal(anchors.at(-1)[1],-104.990514722445);
  const geometry=JSON.parse(readFileSync(path.join(testDirectory,'../../routes-service/src/main/resources/routes/i70.geojson'),'utf8'));
  assert.equal(geometry.type,'LineString');
  assert.ok(geometry.coordinates.some(([lon,lat])=>Math.abs(lon-anchors.at(-1)[1])<0.001
    &&Math.abs(lat-anchors.at(-1)[2])<0.001));
  d.context.Date = class extends Date {static now(){return Date.parse('2026-10-07T15:00:00Z');}};
  assert.ok(Number.isFinite(d.run('dailyTravelTimeRange(demoRoute,68,NaN).fastest')));
  const page=informationPage(undefined,'/dashboard/data.html');
  page.context.points=zones.map(z=>({...z,avgCurrentSpeed:60}));
  assert.equal(page.run('estimateZoneTravelMinutes(points,68)'),68);
  assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes(points.slice(0,6),68)')));
});

test('combined incident tables expand beyond three, and provider text stays text', () => {
  const d = dashboard();
  d.context.features = Array.from({ length: 5 }, (_, i) => event({ providerEventId: String(i), locationLabel: '<img onerror=alert(1)>' }));
  d.run("state.routeData.set('I25', buildRouteData('I25', {}, {}, {features})); renderDashboard()");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 3);
  d.run("state.expandedIncidents.add('I25'); renderDashboard()");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 5);
  assert.equal(d.nodes.get('i25IncidentCount').textContent, '5 active · 5 total');
  assert.match(d.nodes.get('i25IncidentRows').children[0].children[1].children[0].textContent, /<img onerror/);
});

test('focused corridor incident tables show every report by default', () => {
  const d = dashboard();
  d.context.features = Array.from({ length: 5 }, (_, i) => event({ providerEventId: String(i) }));
  d.run("state.focusedCorridor = 'I25'; state.routeData.set('I25', buildRouteData('I25', {}, {}, {features})); renderIncidentTable('I25', state.routeData.get('I25').incidentThreads)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 5);
});

test('incident scrolling hands unused wheel distance to the page immediately', () => {
  const d = dashboard();
  d.context.scroller = { scrollTop: 90, scrollHeight: 200, clientHeight: 100 };
  assert.equal(d.run('nestedScrollRemainder(scroller, 30)'), 20);
  assert.equal(d.context.scroller.scrollTop, 100);

  d.context.scroller.scrollTop = 100;
  assert.equal(d.run('nestedScrollRemainder(scroller, 12)'), 12);
  d.context.scroller.scrollTop = 10;
  assert.equal(d.run('nestedScrollRemainder(scroller, -30)'), -20);
  assert.equal(d.context.scroller.scrollTop, 0);

  d.context.scroller.scrollTop = 40;
  assert.equal(d.run('nestedScrollRemainder(scroller, 20)'), 0);
  assert.equal(d.context.scroller.scrollTop, 40);
});

test('incident page scrolling bypasses smooth animation in both directions and batches each frame', () => {
  const d = dashboard();
  const frames = [];
  const pageScrolls = [];
  d.context.window.requestAnimationFrame = callback => frames.push(callback);
  d.context.window.scrollBy = options => pageScrolls.push({ ...options });

  d.run('queueIncidentPageScroll(8); queueIncidentPageScroll(14)');
  assert.equal(frames.length, 1);
  assert.deepEqual(pageScrolls, []);
  frames.shift()();
  assert.deepEqual(pageScrolls, [{ top: 22, left: 0, behavior: 'instant' }]);

  d.run('queueIncidentPageScroll(-6)');
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(pageScrolls, [
    { top: 22, left: 0, behavior: 'instant' },
    { top: -6, left: 0, behavior: 'instant' }
  ]);
});
