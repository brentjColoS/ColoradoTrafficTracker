const { test } = require('node:test');
const { dashboard, event, assert, floydHillClosure, vm, readFileSync, path, testDirectory, incidentTypesSource } = require('../fixtures/core.cjs');
const { corridorMap, fakeMapRenderer } = require('../fixtures/maps.cjs');

test('chain-law updates clear their active status and map popups use the same decoded wording', async () => {
  const d = dashboard();
  d.context.features = [event({providerEventId:'chains',incidentTypeLabel:'Chain Law Code 18',
    normalizedCategory:'weather',active:true,normalizedStatus:'active',lastSeenAt:'2026-10-26T12:00:00Z'}),
    event({providerEventId:'chains',incidentTypeLabel:'Chain Law Code 18 Lifted',
      normalizedCategory:'weather',active:false,normalizedStatus:'cleared',lastSeenAt:'2026-10-26T13:00:00Z'})];
  const thread = d.run("incidentModel.aggregateIncidentThreads(features)[0]");
  assert.equal(thread.displayType, 'Commercial vehicle chain restriction lifted');
  assert.equal(thread.ongoing, false);

  const instances=[], popups=[];
  const map = corridorMap(async()=>fakeMapRenderer(instances,popups));
  await map.context.window.CorridorMapPanel.render({corridor:'I70',
    corridorFeature:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-105.8,39.7],[-105,39.7]]}},
    incidentFeatures:[]});
  instances[0].listeners.get('click:corridor-incidents')({features:[{
    geometry:{type:'Point',coordinates:[-105.5,39.7]},
    properties:{incidentTypeLabel:'Chain Law Code 18 Lifted',normalizedCategory:'weather',
      active:false,normalizedStatus:'cleared',incidentNote:'The roadway is reopened to traffic.'}
  }]});
  assert.equal(popups[0].content.children[0].textContent, thread.displayType);
  assert.ok(popups[0].content.children.some(child=>child.textContent.includes('CDOT Code 18 — when in effect:')));
  assert.ok(popups[0].content.children.some(child=>child.textContent==='The roadway is reopened to traffic.'));
});

test('Floyd Hill safety closures match winter mornings in Denver time and the recorded preparatory hold', () => {
  const d = dashboard();
  const matches = [
    floydHillClosure(),
    floydHillClosure({sourceStartedAt:'2026-11-02T14:00:00Z',sourceEndedAt:'2026-11-02T15:30:00Z'}),
    floydHillClosure({sourceStartedAt:'2026-11-01T13:30:00Z',sourceEndedAt:'2026-11-01T14:00:00Z'}),
    floydHillClosure({sourceStartedAt:'2027-02-01T13:30:00Z',sourceEndedAt:null,lastSeenAt:'2027-02-01T15:00:00Z'}),
    floydHillClosure({sourceStartedAt:'2026-12-01T14:00:00Z',sourceEndedAt:'2026-12-01T15:00:00Z',closestMileMarker:248})
  ];
  for (const properties of matches) {
    d.context.properties = properties;
    assert.equal(d.run("incidentModel.normalizeIncidentType(properties)"), 'Sun Glare');
    assert.equal(d.run('window.IncidentTypes.label(properties)'), 'Sun glare · Safety Closure');
    assert.match(d.run('window.IncidentTypes.sunGlareInference(properties)'), /inferred.*CDOT reported a safety closure/);
  }
  const misses = [
    {sourceStartedAt:'2026-12-01T13:29:00Z',sourceEndedAt:'2026-12-01T14:00:00Z'},
    {sourceStartedAt:'2026-12-01T15:31:00Z',sourceEndedAt:'2026-12-01T15:40:00Z'},
    {sourceStartedAt:'2026-12-01T14:00:00Z',sourceEndedAt:'2026-12-01T15:31:00Z'},
    {sourceStartedAt:'2026-12-01T14:00:00Z',sourceEndedAt:null,lastSeenAt:'2026-12-01T16:00:00Z'},
    {sourceStartedAt:'2026-12-01T14:00:00Z',sourceEndedAt:'2026-12-02T14:00:00Z'},
    {sourceStartedAt:'2026-11-01T12:30:00Z',sourceEndedAt:'2026-11-01T13:00:00Z'},
    {sourceStartedAt:'2026-10-22T13:00:00Z',sourceEndedAt:'2026-10-22T14:00:00Z'},
    {sourceStartedAt:'2027-03-01T14:00:00Z',sourceEndedAt:'2027-03-01T15:00:00Z'},
    {sourceStartedAt:'2026-07-01T13:00:00Z',sourceEndedAt:'2026-07-01T14:00:00Z'},
    {sourceStartedAt:null},{sourceStartedAt:'invalid'}, {sourceEndedAt:'invalid'},
    {sourceStartedAt:'2026-10-21T14:00:00Z',sourceEndedAt:'2026-10-21T13:00:00Z'},
    {sourceEndedAt:null,lastSeenAt:null}, {incidentProvider:'tomtom'}, {corridor:'I25'},
    {travelDirection:'W'}, {travelDirection:null}, {closestMileMarker:243.9},
    {closestMileMarker:248.1}, {closestMileMarker:null}, {isOffCorridor:true},
    {incidentNote:'Not due to sun glare.'}, {incidentNote:'Police activity.'}
  ];
  for (const override of misses) {
    d.context.properties = floydHillClosure(override);
    assert.equal(d.run("incidentModel.normalizeIncidentType(properties)"), 'Closure', JSON.stringify(override));
    assert.equal(d.run('window.IncidentTypes.label(properties)'), 'Safety Closure');
    assert.equal(d.run('window.IncidentTypes.sunGlareInference(properties)'), '');
  }
  for (const [note, expected] of [['Closed due to snow.','Snow'],['Crash investigation.','Crash'],['Road construction.','Construction']]) {
    d.context.properties = floydHillClosure({incidentNote:note});
    assert.equal(d.run("incidentModel.normalizeIncidentType(properties)"), expected);
    assert.equal(d.run('window.IncidentTypes.sunGlareInference(properties)'), '');
  }
});

test('inferred sun glare shares its label and explanation across the table, chart and map without changing status', async () => {
  const d = dashboard();
  d.context.properties = floydHillClosure();
  const thread = d.run("incidentModel.aggregateIncidentThreads([{properties}])[0]");
  assert.equal(thread.type, 'Sun Glare');
  assert.equal(thread.ongoing, false);
  d.context.thread = thread;
  assert.equal(d.run('incidentStatusLabel(thread)'), 'Cleared');
  assert.equal(d.run('buildIncidentNameCell(thread).children[0].children[1].textContent'), 'Sun glare · Safety Closure');
  assert.match(d.run("chartPainter.chartIncidentLabel(thread)"), /^Sun glare · Safety Closure/);
  assert.match(d.run('incidentDetailLines(thread)[0]'), /inferred.*October 21, 2026/);

  const instances=[], popups=[];
  const map=corridorMap(async()=>fakeMapRenderer(instances,popups));
  await map.context.window.CorridorMapPanel.render({corridor:'I70',
    corridorFeature:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-105.8,39.7],[-105,39.7]]}},
    incidentFeatures:[]});
  instances[0].listeners.get('click:corridor-incidents')({features:[{
    geometry:{type:'Point',coordinates:[-105.4,39.7]},properties:floydHillClosure()
  }]});
  assert.equal(popups[0].content.children[0].textContent, thread.displayType);
  assert.ok(popups[0].content.children.some(child=>child.textContent===thread.inferenceDetail));
});

test('incident causes refine broad categories while explicit event types retain priority', () => {
  const d = dashboard();
  const cases = [
    [{ normalizedCategory:'closure', incidentTypeLabel:'Road closed', incidentNote:'Closed due to sun glare.' }, 'Sun Glare'],
    [{ normalizedCategory:'weather', incidentTypeLabel:'Weather', incidentNote:'Heavy snow on the roadway.' }, 'Snow'],
    [{ normalizedCategory:'weather', sourceType:'Freezing rain' }, 'Ice'],
    [{ normalizedCategory:'traffic', sourceType:'Maintenance Operations', incidentNote:'Snow removal.' }, 'Maintenance'],
    [{ normalizedCategory:'crash', incidentNote:'Snow and ice on the roadway.' }, 'Crash'],
    [{ normalizedCategory:'weather', incidentTypeLabel:'Two-vehicle crash', incidentNote:'High wind.' }, 'Crash'],
    [{ iconCategory:14, incidentNote:'Heavy rain.' }, 'Disabled Vehicle'],
    [{ incidentTypeLabel:'Weather', incidentNote:'No snow reported. Sun glare across the roadway.' }, 'Sun Glare'],
    [{ incidentTypeLabel:'Road closure', incidentNote:'Snow has been cleared. Watch for falling rocks.' }, 'Closure'],
    [{ incidentTypeLabel:'Weather', incidentNote:'Chance of snow. Possible ice.' }, 'Weather'],
    [{ incidentTypeLabel:'Police activity' }, 'Other'],
    [{ incidentTypeLabel:'Emergency vehicle activity' }, 'Other'],
    [{ incidentTypeLabel:'Other', incidentNote:'Drain inspection.' }, 'Other'],
    [{ iconCategory:999 }, 'Other'],
    [{}, 'Other']
  ];
  for (const [properties, expected] of cases) {
    d.context.properties = properties;
    assert.equal(d.run("incidentModel.normalizeIncidentType(properties)"), expected, JSON.stringify(properties));
  }
});

test('the expanded incident vocabulary recognizes specific reports and legacy weather codes', () => {
  const d = dashboard();
  const cases = { 'Sun-glare closure':'Sun Glare', 'Snow storm':'Snow', 'Icy road':'Ice',
    'Fog':'Fog', 'High winds':'Wind', 'Heavy rain':'Weather', 'Flooded roadway':'Flooding',
    'Rock slide':'Debris', 'Avalanche control':'Avalanche', 'Wildfire':'Fire',
    'Debris on roadway':'Debris', 'Animals on road':'Animal', 'Passenger vehicle traction law':'Other',
    'Road damage':'Road Hazard', 'Heavy traffic':'Traffic', 'Snow removal operations':'Maintenance',
    'Broken down vehicle':'Disabled Vehicle', 'Roadworks':'Construction', 'Lane closed':'Closure' };
  for (const [source, expected] of Object.entries(cases)) {
    d.context.source = source;
    assert.equal(d.run("incidentModel.normalizeIncidentType(source)"), expected, source);
  }
  for (const [code, expected] of [[2,'Fog'],[3,'Weather'],[4,'Weather'],[5,'Ice'],[10,'Wind'],[11,'Flooding']]) {
    d.context.latest = {corridor:'I70',polledAt:'2026-10-20T12:00:00Z',
      incidentsJson:JSON.stringify({incidents:[{properties:{iconCategory:code}}]})};
    assert.equal(d.run("incidentModel.aggregateIncidentThreads(incidentModel.legacySnapshotIncidentFeatures(latest))[0].type"), expected);
  }
});

test('incident rows, chart labels and legend share the cause icon without discarding closure details', () => {
  const d = dashboard();
  d.context.features = [event({normalizedCategory:'closure',incidentTypeLabel:'Road closed',
    incidentNote:'Sun glare across the roadway.',incidentImpactLabel:'Eastbound: all lanes closed'})];
  const incident = d.run("incidentModel.aggregateIncidentThreads(features)[0]");
  const cell = d.run("buildIncidentNameCell(incidentModel.aggregateIncidentThreads(features)[0])");
  assert.equal(incident.type, 'Sun Glare');
  assert.equal(cell.children[0].children[1].textContent, 'Sun glare · Road closed');
  assert.equal(cell.children[0].children[0].children[0].attributes.d,
    d.context.window.IncidentTypes.icon('Sun Glare').path);
  assert.match(d.run("chartPainter.chartIncidentLabel(incidentModel.aggregateIncidentThreads(features)[0])"), /^Sun glare · Road closed/);
  assert.equal(incident.impactLabel, 'Eastbound: all lanes closed');
  d.run('renderIncidentLegend()');
  const legend = d.nodes.get('incidentLegendItems').children;
  assert.equal(legend.filter(item => !item.hidden).length, 8);
  d.run('setIncidentLegendExpanded(true)');
  assert.equal(legend.filter(item => !item.hidden).length, 18);
  assert.equal(d.nodes.get('incidentLegendToggle').attributes['aria-expanded'], 'true');
  assert.equal(d.nodes.get('incidentLegendToggle').textContent, 'Fewer types');
  d.run('setIncidentLegendExpanded(false)');
  assert.equal(legend.filter(item => !item.hidden).length, 8);
  assert.equal(d.nodes.get('incidentLegendToggle').attributes['aria-expanded'], 'false');
  const strokes = [];
  d.context.ctx = new Proxy({stroke(path){strokes.push(path.path);}},
    {get(target,key){return key in target?target[key]:()=>{};}});
  d.run("chartPainter.drawIncidentGlyph(ctx, 0, 0, 'Sun Glare', '#000')");
  assert.deepEqual(strokes, [d.context.window.IncidentTypes.icon('Sun Glare').path]);
});

test('the latest incident revision updates both its display label and icon', () => {
  const d = dashboard();
  d.context.features = [
    event({providerEventId:'evolving',incidentTypeLabel:'Road closure', normalizedCategory:'closure',
      firstSeenAt:'2026-10-20T12:00:00Z',lastSeenAt:'2026-10-20T12:00:00Z'}),
    event({providerEventId:'evolving',incidentTypeLabel:'Snow',normalizedCategory:'weather',
      firstSeenAt:'2026-10-20T12:00:00Z',lastSeenAt:'2026-10-20T12:10:00Z'})
  ];
  const thread = d.run("incidentModel.aggregateIncidentThreads(features)[0]");
  assert.equal(thread.type, 'Snow');
  assert.equal(thread.displayType, 'Snow');
  assert.equal(thread.firstSeenAt.toISOString(), '2026-10-20T12:00:00.000Z');
  assert.equal(thread.lastSeenAt.toISOString(), '2026-10-20T12:10:00.000Z');
});

test('map popups describe a weather closure with the same cause as the incident table', async () => {
  const instances=[], popups=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,popups));
  await d.context.window.CorridorMapPanel.render({corridor:'I70',
    corridorFeature:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-105.8,39.7],[-105,39.7]]}},
    incidentFeatures:[]});
  instances[0].listeners.get('click:corridor-incidents')({features:[{
    geometry:{type:'Point',coordinates:[-105.5,39.7]},
    properties:{incidentTypeLabel:'Road closed',normalizedCategory:'closure',
      incidentNote:'Sun glare across the roadway.',incidentImpactLabel:'Eastbound: all lanes closed'}
  }]});
  assert.equal(popups[0].content.children[0].textContent, 'Sun glare · Road closed');
  assert.ok(popups[0].content.children.some(child=>child.textContent==='Impact: Eastbound: all lanes closed'));
});

test('the narrowed incident set uses Lucide for every icon and preserves specific debris labels', () => {
  const d = dashboard();
  const types = d.context.window.IncidentTypes.types;
  assert.equal(Object.keys(types).length, 19);
  assert.ok(Object.values(types).every(icon => icon.lucide && icon.path));
  assert.equal(types.Flooding.lucide, 'waves-arrow-up');
  assert.equal(types.Debris.lucide, 'stone');
  assert.equal(types.Other.label, 'Other');
  assert.equal(types.Rain, undefined);
  assert.equal(types.Restrictions, undefined);
  assert.equal(types.Rockfall, undefined);
  for (const label of ['Rockfall', 'Falling rocks', 'Debris on roadway']) {
    d.context.properties = {incidentTypeLabel:label,normalizedCategory:'traffic'};
    assert.equal(d.run("incidentModel.normalizeIncidentType(properties)"), 'Debris');
    assert.equal(d.run('window.IncidentTypes.label(properties)'), label);
  }
  d.context.features = [event({incidentTypeLabel:'Rain',normalizedCategory:'weather'}),
    event({providerEventId:'chains',incidentTypeLabel:'Traction law',normalizedCategory:'other'})];
  const threads = d.run("incidentModel.aggregateIncidentThreads(features)");
  assert.equal(threads.length, 2);
  assert.deepEqual(Array.from(threads, thread => thread.type), ['Weather','Other']);
  assert.deepEqual(Array.from(threads, thread => thread.displayType), ['Rain','Traction law']);
});

test('incident legend stacks unique types by latest observation with first-seen tie breaks', () => {
  const d = dashboard();
  d.context.incidents = [
    {type:'Crash',firstSeenAt:'2026-10-20T09:00:00Z',lastSeenAt:'2026-10-20T10:00:00Z'},
    {type:'Snow',firstSeenAt:'2026-10-20T08:00:00Z',lastSeenAt:'2026-10-20T12:00:00Z'},
    {type:'Debris',firstSeenAt:'2026-10-20T10:00:00Z',lastSeenAt:'2026-10-20T11:00:00Z'},
    {type:'Snow',firstSeenAt:'2026-10-20T07:00:00Z',lastSeenAt:'2026-10-20T09:00:00Z'},
    {type:'Wind',firstSeenAt:'2026-10-20T11:00:00Z',lastSeenAt:'2026-10-20T12:00:00Z'},
    {type:'Closure',firstSeenAt:'2026-10-20T13:00:00Z',lastSeenAt:'invalid'},
    {type:'Weather',lastSeenAt:'2026-10-20T14:00:00Z'},
    {type:'Other'}, {type:'Unrecognized'}
  ];
  d.run("state.focusedCorridor='I70';state.routeData.set('I70',{incidentThreads:incidents});renderIncidentLegend()");
  const items = d.nodes.get('incidentLegendItems').children;
  assert.deepEqual(items.slice(0,8).map(item=>item.dataset.incidentType),
    ['Weather','Closure','Wind','Snow','Debris','Crash','Other','Construction']);
  assert.equal(items.filter(item=>item.dataset.incidentType==='Snow').length,1);
  assert.equal(items.length,19);
  assert.equal(items.filter(item=>!item.hidden).length,8);
});

test('incident legend follows corridor selection and combines recency across both corridors', () => {
  const d=dashboard();
  d.run(`state.routeData=buildDemoDashboardData().routeData;
    state.routeData.get('I25').incidentThreads=[{type:'Fire',lastSeenAt:new Date('2026-10-20T15:00:00Z')}];
    state.routeData.get('I70').incidentThreads=[{type:'Snow',lastSeenAt:new Date('2026-10-20T14:00:00Z')}];
    applyCorridorFocus('I70',false)`);
  const types=()=>d.nodes.get('incidentLegendItems').children.map(item=>item.dataset.incidentType);
  assert.equal(types()[0],'Snow');
  assert.equal(types()[1],'Crash');
  d.run("applyCorridorFocus('I25',false)");
  assert.equal(types()[0],'Fire');
  d.run("applyCorridorFocus('ALL',false)");
  assert.deepEqual(types().slice(0,2),['Fire','Snow']);
});

test('incident legend refreshes its order without resetting expansion and falls back stably when empty', () => {
  const d=dashboard();
  d.run(`state.focusedCorridor='I70';state.routeData=buildDemoDashboardData().routeData;
    state.routeData.get('I70').incidentThreads=[{type:'Snow',lastSeenAt:new Date('2026-10-20T10:00:00Z')}];
    renderDashboard();setIncidentLegendExpanded(true)`);
  d.run(`state.routeData.get('I70').incidentThreads.push({type:'Debris',lastSeenAt:new Date('2026-10-20T11:00:00Z')});renderDashboard()`);
  let items=d.nodes.get('incidentLegendItems').children;
  assert.deepEqual(items.slice(0,2).map(item=>item.dataset.incidentType),['Debris','Snow']);
  assert.ok(items.every(item=>!item.hidden));
  assert.equal(d.nodes.get('incidentLegendToggle').attributes['aria-expanded'],'true');
  d.run("state.routeData.get('I70').incidentThreads=[];renderDashboard()");
  items=d.nodes.get('incidentLegendItems').children;
  assert.deepEqual(items.slice(0,4).map(item=>item.dataset.incidentType),['Crash','Construction','Closure','Disabled Vehicle']);
  assert.equal(items.length,18);
  assert.equal(d.nodes.get('incidentLegendToggle').attributes['aria-expanded'],'true');
});


test('incident lifecycle aggregation accepts out-of-order reports without a dashboard or DOM', () => {
  const context = vm.createContext({window: {}});
  vm.runInContext(incidentTypesSource, context);
  vm.runInContext(readFileSync(path.join(testDirectory,
    '../../api-service/src/main/resources/static/dashboard/dashboard-incident-model.js'), 'utf8'), context);
  const parseDate = value => value ? new Date(value) : null;
  const model = context.window.DashboardIncidentModel.create({
    parseDate,
    dateMillis: value => parseDate(value)?.getTime() || 0,
    finiteNumber: value => value == null || value === '' ? NaN : Number(value),
    formatMileMarker: String,
    types: context.window.IncidentTypes
  });
  const feature = (firstSeenAt, lastSeenAt, active, description) => ({properties: {
    incidentProvider: 'cdot', corridor: 'I25', providerEventId: 'observed-case',
    firstSeenAt, lastSeenAt, active, incidentDescription: description,
    normalizedStatus: active ? 'active' : 'cleared', closestMileMarker: 218
  }});
  const reports = [
    feature('2026-10-30T12:00:00Z', '2026-10-30T12:05:00Z', true, 'Current report'),
    feature('2026-10-30T11:45:00Z', '2026-10-30T11:55:00Z', false, 'Older report'),
    feature('2026-10-30T12:00:00Z', '2026-10-30T12:10:00Z', false, 'Cleared report')
  ];
  const [incident] = model.aggregateIncidentThreads(reports, '2026-10-30T12:15:00Z');
  assert.equal(incident.firstSeenAt.toISOString(), '2026-10-30T11:45:00.000Z');
  assert.equal(incident.lastSeenAt.toISOString(), '2026-10-30T12:10:00.000Z');
  assert.equal(incident.description, 'Cleared report');
  assert.equal(incident.locationLabel, 'MP 218');
  assert.equal(incident.ongoing, false);
});
