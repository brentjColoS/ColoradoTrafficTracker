const { test } = require('node:test');
const { assert, indexSource, mapSource, readFileSync, path, dashboard, event } = require('../fixtures/core.cjs');
const { corridorMap, fakeMapRenderer, zoneMotionFixture, zoneMapFixture } = require('../fixtures/maps.cjs');
const { testDirectory } = require('../fixtures/core.cjs');

test('uses relative dashboard assets under both public paths', () => {
  assert.doesNotMatch(indexSource, /(?:href|src)="\/dashboard\//);
  assert.match(mapSource, /import\("\.\/vendor\/maplibre-gl\/6\.10\.0\/maplibre-gl\.mjs"\)/);
});

test('inactive traffic map legend items remain hidden despite flex styling', () => {
  const css = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard.css'), 'utf8');
  assert.match(css, /\.corridor-map-key\s+\[hidden\]\s*\{\s*display:\s*none/);
});

test('routes reads through the matching production or experimental prefix', () => {
  const production = dashboard();
  assert.equal(production.run('DASHBOARD_RUNTIME.experimental'), false);
  assert.equal(production.run('DASHBOARD_RUNTIME.healthPath'), '/actuator/health');
  assert.equal(production.run("dashboardApi('/traffic/corridors')"), '/dashboard-api/traffic/corridors');
  for (const pathname of ['/dashboard-experimental', '/dashboard-experimental/', '/dashboard-experimental/index.html']) {
    const experimental = dashboard(undefined, '', pathname);
    assert.equal(experimental.run('DASHBOARD_RUNTIME.experimental'), true);
    assert.equal(experimental.run('DASHBOARD_RUNTIME.healthPath'), '/dashboard-experimental-health');
    assert.equal(experimental.run("dashboardApi('traffic/corridors')"), '/dashboard-experimental-api/traffic/corridors');
  }
  assert.equal(dashboard(undefined, '', '/dashboard-experimental-other/').run('DASHBOARD_RUNTIME.experimental'), false);
  assert.equal(dashboard(undefined, '?replay=1').run('REPLAY_MODE'), true);
  assert.equal(dashboard(undefined, '?replay=1', '/dashboard-experimental/').run('REPLAY_MODE'), false);
});

test('experimental refresh cannot read production API routes', async () => {
  const requests = [];
  const d = dashboard(async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ status: 'UP', features: [] }) };
  }, '', '/dashboard-experimental/');
  await d.run('loadLiveDashboardData(24)');
  assert.equal(requests.length, 20);
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/map/flow-cells/current?corridor=I25'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/map/flow-cells/current?corridor=I70'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/analytics/baselines?corridor=I25'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/analytics/baselines?corridor=I70'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/zones/baselines?corridor=I25'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/zones/baselines?corridor=I70'));
  assert.ok(requests.includes('/dashboard-experimental-health'));
  assert.ok(requests.every(url => url === '/dashboard-experimental-health' || url.startsWith('/dashboard-experimental-api/')));
});

test('renders the combined corridor map without loading directional geometry', async () => {
  const requests = [];
  const instances = [];
  const d = corridorMap(async () => fakeMapRenderer(instances));
  d.context.window.fetch = async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) };
  };
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I70',
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-106, 39.6], [-105, 39.8]] } },
    incidentFeatures: []
  });
  assert.deepEqual(requests, ['/dashboard-api/map/config']);
  assert.equal(instances[0].sources.has('corridor-directional-traffic'), false);
});

test('zone references keep configured numbering when observations omit earlier zones', () => {
  const d = dashboard();
  d.context.rows = [0, 2, 7].map(order => ({zoneKey:`zone-${order}`,zoneOrder:order,
    startMileMarker:206+order,endMileMarker:207+order,avgCurrentSpeed:50,bucketStart:'2026-06-19T01:00:00Z'}));
  assert.deepEqual(Array.from(d.run("chartSeries.groupZoneSeries(rows,24,Date.parse('2026-06-19T02:00:00Z')).map(group=>group.referenceLabel)")), ['Z1','Z3','Z8']);
  assert.equal(d.network.length,0);
});

test('different definitions sharing an order receive distinct deterministic references', () => {
  const d = dashboard();
  d.context.groups = [{key:'old|206|213',order:0},{key:'new|206|214',order:0},{key:'other',order:2}];
  const labels = Array.from(d.run("chartSeries.labelSpeedZoneGroups(groups).map(group=>[group.key,group.referenceLabel])"), row=>Array.from(row));
  const reversed = Array.from(d.run("chartSeries.labelSpeedZoneGroups([...groups].reverse()).map(group=>[group.key,group.referenceLabel])"), row=>Array.from(row));
  assert.deepEqual(labels,[['old|206|213','Z1b'],['new|206|214','Z1a'],['other','Z3']]);
  assert.deepEqual(new Map(labels),new Map(reversed));
});

test('zone identity colors follow configured order rather than visible row position', () => {
  const d=dashboard();
  d.context.groups=[{key:'west',order:0},{key:'middle',order:2},{key:'east',order:7}];
  const full=Array.from(d.run("chartSeries.labelSpeedZoneGroups(groups).map(group=>group.referenceColor)"));
  const omitted=Array.from(d.run("chartSeries.labelSpeedZoneGroups(groups.slice(1)).map(group=>group.referenceColor)"));
  assert.deepEqual(omitted,full.slice(1));
  assert.equal(new Set(full).size,3);
});

test('zone selection identity survives current-to-continuous key changes but not changed geometry',()=>{
  const d=dashboard();
  d.context.groups=[{key:'live',order:1,startMileMarker:213.1,endMileMarker:216,postedSpeedMph:50},
    {key:'live|213.1|216|50',order:1,startMileMarker:213.1,endMileMarker:216,postedSpeedMph:50},
    {key:'different',order:1,startMileMarker:213.1,endMileMarker:217,postedSpeedMph:50}];
  const references=Array.from(d.run("chartSeries.labelSpeedZoneGroups(groups).map(group=>group.referenceKey)"));
  assert.equal(references[0],references[1]);
  assert.notEqual(references[0],references[2]);
});

test('active zone finder pin keeps its original outline around a rose fill and transparent center', () => {
  const cssSource = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard.css'), 'utf8');
  assert.match(cssSource, /\.zone-finder-icon\s*\{[^}]*fill:\s*none;/);
  assert.match(cssSource, /\.zone-finder-icon\s*\{[^}]*stroke:\s*currentColor;[^}]*stroke-width:\s*2;/);
  const activeIcon = cssSource.match(/#zoneFinderToggle\[aria-pressed="true"\] \.zone-finder-icon\s*\{([^}]+)\}/)[1];
  assert.match(activeIcon, /fill:\s*var\(--rose\);/);
  assert.doesNotMatch(activeIcon, /(?:^|[;\s])(?:color|stroke|stroke-width):/);
  const toggle = indexSource.match(/<button id="zoneFinderToggle"[\s\S]*?<\/button>/)[0];
  assert.match(toggle, /class="zone-finder-icon" viewBox="0 0 24 24"/);
  assert.match(toggle, /<mask id="zoneFinderPinCenter" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">/);
  assert.match(toggle, /<rect width="24" height="24" fill="#fff" stroke="none"><\/rect>/);
  assert.match(toggle, /<circle cx="12" cy="10" r="2" fill="#000" stroke="none"><\/circle>/);
  assert.match(toggle, /<use href="#icon-pin"><\/use>/);
  assert.match(cssSource, /#zoneFinderToggle\[aria-pressed="true"\] \.zone-finder-icon use\s*\{\s*mask:\s*url\(#zoneFinderPinCenter\);/);
  assert.doesNotMatch(cssSource + indexSource, /--pin-center-fill/);
});

test('speed-zone mode retains the original layout until the zone finder is enabled', () => {
  const d = dashboard();
  const panel = d.nodes.get('corridorMapPanel') || d.run("document.getElementById('corridorMapPanel')");
  const comparison = d.run("document.getElementById('comparisonPanel')");
  const incidents = d.run("document.getElementById('incidentRouteGrid')");
  for (const destination of [comparison, incidents]) destination.appendChild = child => {child.parentElement=destination;};
  d.run("state.focusedCorridor='I70';setChartView('zones')");
  assert.equal(panel.parentElement,incidents);
  assert.equal(d.run('zoneFinderActive()'),false);
  d.run('setZoneFinder(true)');
  assert.equal(panel.parentElement,comparison);
  d.run('setZoneFinder(false)');
  assert.equal(panel.parentElement,incidents);
  d.run('setZoneFinder(true)');
  d.run("setChartView('overall')");
  assert.equal(panel.parentElement,incidents);
  assert.equal(d.run('state.zoneFinder'),false);
  assert.equal(d.network.length,0);
});

test('zone finder reveal is inert outside speed zones and resets on corridor changes',()=>{
  const d=dashboard();
  const toggle=d.nodes.get('zoneFinderToggle'),reveal=d.nodes.get('zoneFinderReveal');
  d.run("applyCorridorFocus('I70',false);setChartView('overall');setZoneFinder(true)");
  assert.equal(toggle.disabled,true);
  assert.equal(reveal.inert,true);
  assert.equal(d.run('state.zoneFinder'),false);
  d.run("setChartView('zones');setZoneFinder(true)");
  assert.equal(toggle.disabled,false);
  assert.equal(reveal.inert,false);
  assert.equal(reveal.attributes['aria-hidden'],'false');
  assert.equal(toggle.attributes['aria-pressed'],'true');
  d.run("applyCorridorFocus('I25',false)");
  assert.equal(d.run('state.zoneFinder'),false);
  assert.equal(toggle.attributes['aria-pressed'],'false');
  d.run("setZoneFinder(true);applyCorridorFocus('ALL',false)");
  assert.equal(toggle.disabled,true);
  assert.equal(reveal.inert,true);
  assert.equal(toggle.attributes['aria-pressed'],'false');
});

test('zone finder moves existing graph and map layers in both directions with bounded transform-only motion', () => {
  const {d,motions,frames} = zoneMotionFixture();
  d.run('setZoneFinder(true)'); frames.shift()();
  assert.equal(motions.length,2);
  assert.equal(motions[0].keyframes[0].transform,'translate(0px, 0px) scaleX(1.5)');
  assert.equal(motions[1].keyframes[0].transform,'translate(-200px, 1100px) scaleX(1.5)');
  assert.equal(motions[1].options.duration,380);
  assert.ok(motions.every(motion=>motion.keyframes.every(frame=>Object.keys(frame).every(key=>['transform','transformOrigin','opacity'].includes(key)))));
  d.run('setZoneFinder(false)'); frames.shift()();
  assert.ok(motions.slice(0,2).every(motion=>motion.cancelled));
  assert.match(motions.at(-1).keyframes[0].transform,/translate\(200px, -1100px\)/);
  for (const motion of motions.slice(2)) motion.onfinish();
  assert.equal(d.run('zoneLayoutAnimations.length'),0);
  assert.equal(d.network.length,0);
});

test('shield slides out as the graph fills its space and slides back with the inverse graph motion', () => {
  const {d,motions,frames}=zoneMotionFixture(false,true);
  d.run('setZoneFinder(true)');frames.shift()();
  assert.equal(motions.length,3);
  assert.equal(motions[0].keyframes[0].transform,'translate(72px, 0px) scaleX(1.41)');
  assert.equal(motions[0].keyframes[1].transform,'translate(0px, 0) scaleX(1)');
  assert.equal(motions[1].keyframes[0].transform,'translate(0px, 0px) scaleX(1)');
  assert.equal(motions[1].keyframes[1].transform,'translate(-72px, 0) scaleX(1)');
  assert.equal(motions[1].keyframes[1].opacity,0);
  assert.ok(motions.every(motion=>motion.options.duration===380));
  d.run('setZoneFinder(false)');frames.shift()();
  assert.ok(motions.slice(0,3).every(motion=>motion.cancelled));
  assert.match(motions[3].keyframes[0].transform,/translate\(-72px, 0px\)/);
  assert.equal(motions[4].keyframes[0].transform,'translate(-72px, 0px) scaleX(1)');
  assert.equal(motions[4].keyframes[0].opacity,0);
  assert.equal(motions[4].keyframes[1].opacity,1);
  for(const motion of motions.slice(3))motion.onfinish();
  assert.equal(d.run('zoneLayoutAnimations.length'),0);
  assert.equal(d.network.length,0);
  const reduced=zoneMotionFixture(true,true);
  reduced.d.run('setZoneFinder(true)');reduced.frames.shift()();
  assert.equal(reduced.motions.length,0);
});

test('finder graph height expansion and contraction animate even when its width is unchanged', () => {
  const {d,motions,frames}=zoneMotionFixture();
  const graph=d.nodes.get('i70Chart').closest('.chart-canvas-wrap');
  graph.getBoundingClientRect=()=>({left:0,top:400,width:800,height:d.run('state.zoneFinder') ? 600 : 408});
  d.run('setZoneFinder(true)');frames.shift()();
  assert.equal(motions[0].node,graph);
  assert.equal(motions[0].keyframes[0].transform,'translate(0px, 0px) scaleX(1) scaleY(0.68)');
  assert.equal(motions[0].keyframes[1].transform,'translate(0px, 0) scaleX(1)');
  assert.equal(motions[0].options.duration,380);
  d.run('setZoneFinder(false)');frames.shift()();
  assert.equal(motions[2].node,graph);
  assert.equal(motions[2].keyframes[0].transform,'translate(0px, 0px) scaleX(1) scaleY(1.4705882352941178)');
  assert.equal(d.network.length,0);
});

test('reduced motion and superseded zone finder frames cannot leave stale transitions', () => {
  const reduced = zoneMotionFixture(true);
  reduced.d.run('setZoneFinder(true)'); reduced.frames.shift()();
  assert.equal(reduced.motions.length,0);
  const {d,motions,frames} = zoneMotionFixture();
  d.run('setZoneFinder(true);setZoneFinder(false)');
  for (const frame of frames) frame();
  assert.equal(motions.length,0);
  d.run('setZoneFinder(true)'); frames.at(-1)();
  d.run("setChartView('overall')");
  assert.ok(motions.every(motion=>motion.cancelled));
  assert.equal(d.run('zoneLayoutAnimations.length'),0);
});

test('offscreen map placement uses a short visible rise and reverse exit instead of a long cross-page flight', () => {
  const {d,motions,frames}=zoneMotionFixture();
  d.context.window.innerHeight=827;
  d.nodes.get('corridorMapPanel').id='corridorMapPanel';
  d.run('setZoneFinder(true)');frames.shift()();
  assert.equal(motions[1].keyframes[0].transform,'translate(0, 150px) scaleX(1)');
  assert.equal(motions[1].keyframes[0].opacity,0);
  d.run('setZoneFinder(false)');frames.shift()();
  assert.equal(motions.at(-1).keyframes[1].opacity,0);
  assert.equal(motions.at(-1).keyframes[1].transform,'translate(200px, -950px) scaleX(0.6666666666666666)');
});

test('chart pixel resolution uses layout dimensions rather than animated visual scaling', () => {
  const d=dashboard();
  d.context.canvas={clientWidth:800,clientHeight:280,width:0,height:0,
    getBoundingClientRect:()=>({width:1200,height:420}),getContext:()=>({setTransform(){}})};
  const size=d.run('sizeCanvas(canvas)');
  assert.equal(size.width,800); assert.equal(size.height,280);
  assert.equal(d.context.canvas.width,800); assert.equal(d.context.canvas.height,280);
});

test('zone finder toggles preserve historical timing, frame and wheel state without history reads',()=>{
  const d=dashboard(),renders=[];
  d.context.window.CorridorMapPanel={render:payload=>renders.push(payload)};
  d.run(`state.focusedCorridor='I70';state.chartView='zones';state.selectedHours=168;
    chartHistory.endTime=Date.parse('2026-06-19T02:00:00Z');chartHistory.enabled=true;initializeControls();`);
  const end=d.run('chartHistory.endTime');
  d.nodes.get('zoneFinderToggle').events.click();
  assert.equal(d.run('state.zoneFinder'),true);
  assert.equal(renders.at(-1).zoneMode,true);
  d.run("selectSpeedZone('test')");
  d.nodes.get('zoneFinderToggle').events.click();
  assert.equal(d.run('state.selectedZoneKey'),null);
  assert.equal(renders.at(-1).zoneMode,false);
  assert.equal(d.run('chartHistory.endTime'),end);
  assert.equal(d.run('chartHistory.enabled'),true);
  assert.equal(d.run('state.selectedHours'),168);
  assert.equal(d.network.length,0);
});

test('graph zone badge selection leaves historical timing and request state untouched', () => {
  const d=dashboard();
  const selected=[];
  d.context.window.CorridorMapPanel={render(){},selectZone:(key,locate)=>selected.push({key,locate})};
  d.run(`state.focusedCorridor='I70';state.chartView='zones';state.zoneFinder=true;initializeControls();
    visibleSpeedZoneGroups=()=>[{key:'west'},{key:'tunnel'}];`);
  const canvas=d.nodes.get('i70Chart');
  const event={currentTarget:{getBoundingClientRect:()=>({left:100,top:200,height:284})},clientX:116,clientY:400};
  canvas.events.click(event);
  assert.deepEqual(selected,[{key:'tunnel',locate:true}]);
  assert.equal(d.run('chartHistory.endTime'),null);
  assert.equal(d.network.length,0);
  canvas.events.click({...event,clientX:500});
  assert.equal(selected.length,1,'ordinary chart-area clicks do not change zone selection');
  d.run('setZoneFinder(false)');
  canvas.events.click(event);
  assert.equal(selected.length,1,'graph clicks do not locate zones while the finder is off');
});

test('descending I25 geometry keeps its missing high-mile endpoint and yellow Z3 section at the north end in both themes',async()=>{
  const instances=[],markers=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  const feature={type:'Feature',properties:{startMileMarker:271,endMileMarker:208,primaryDirection:'S',
    mileMarkerAnchorsJson:JSON.stringify([{mileMarker:270,longitude:-105,latitude:40.6},
      {mileMarker:220,longitude:-105,latitude:39.9},{mileMarker:208,longitude:-105,latitude:39.7}])},
    geometry:{type:'LineString',coordinates:[[-105,40.6],[-105,39.9],[-105,39.7]]}};
  await d.context.window.CorridorMapPanel.render({corridor:'I25',zoneMode:true,corridorFeature:feature});
  d.context.window.CorridorMapPanel.setZones([{key:'north',referenceLabel:'Z3',referenceColor:'#f3bd67',
    startMileMarker:225.552,endMileMarker:271,postedSpeedMph:75}],null,()=>{});
  const colored=instances[0].sources.get('corridor-zones').data.features[0];
  assert.equal(colored.properties.color,'#f3bd67');
  assert.equal(colored.geometry.coordinates.at(-1)[1],40.6,'Z3 must reach the north endpoint, not double back south');
  assert.ok(colored.geometry.coordinates.every(point=>point[1]>39.9));
  d.context.window.CorridorMapPanel.selectZone('north',false);
  const selected=instances[0].sources.get('corridor-zone-highlight').data.features[0];
  assert.deepEqual(selected.geometry.coordinates,colored.geometry.coordinates);
  for(const theme of ['light','dark']) {
    d.context.window.CorridorMapPanel.setTheme(theme);
    assert.equal(instances[0].sources.get('corridor-zones').data.features[0].properties.color,'#f3bd67');
  }
});

test('mobile corridor headers remain visible during finder transitions rather than sliding off to the left',()=>{
  const {d,motions,frames}=zoneMotionFixture(false,true);
  d.context.window.matchMedia=query=>({matches:query==='(max-width: 48rem)'});
  d.run('setZoneFinder(true)');frames.shift()();
  assert.equal(motions[1].keyframes[1].transform,'translate(0px, 0) scaleX(1)');
  assert.equal(motions[1].keyframes[0].opacity,1);
  assert.equal(motions[1].keyframes[1].opacity,1);
});

test('fixture basemap defaults stay offline while configured previews reuse one bounded read',async()=>{
  const {createPreviewBasemapLoader}=require("../dashboard-preview.cjs");
  let reads=0;
  const config={provider:'TRACESTRACK_TOPO',tileUrl:'https://tile.tracestrack.com/topo_en/{z}/{x}/{y}@1x.webp?key=restricted',
    overviewTileUrl:'https://tile.tracestrack.com/en/{z}/{x}/{y}@1x.webp?key=restricted',detailMinZoom:10};
  const fetchConfig=async(url,options)=>{
    reads++;
    assert.equal(url,'https://coloradotraffictracker.net/dashboard-experimental-api/map/config');
    assert.equal(options.redirect,'error');
    assert.ok(options.signal);
    return {ok:true,json:async()=>config};
  };
  const offline=createPreviewBasemapLoader(false,fetchConfig);
  assert.equal((await offline()).provider,'USGS_IMAGERY');
  assert.equal(reads,0);
  const configured=createPreviewBasemapLoader(true,fetchConfig);
  const results=await Promise.all([configured(),configured(),configured()]);
  assert.ok(results.every(result=>result===config));
  assert.equal(reads,1);
});

test('configured fixture basemap failures retain the imagery fallback without repeated reads',async()=>{
  const {createPreviewBasemapLoader}=require("../dashboard-preview.cjs");
  for(const fetchConfig of [async()=>{throw new Error('Unavailable');},async()=>({ok:false}),
    async()=>({ok:true,json:async()=>({provider:'UNKNOWN'})})]) {
    let reads=0;
    const load=createPreviewBasemapLoader(true,async(...args)=>{reads++;return fetchConfig(...args);});
    assert.equal((await load()).provider,'USGS_IMAGERY');
    await load();
    assert.equal(reads,1);
  }
});

test('zone buttons and map badges locate anchored road geometry without changing traffic colors', async()=>{
  const {d,instances,markers,groups,selections}=await zoneMapFixture();
  const map=instances[0];
  const buttons=d.nodes.get('corridorZoneButtons').children;
  assert.equal(buttons.length,2);
  assert.match(buttons[1].title,/Z2.*Tunnel.*MM 213.1–216/);
  assert.equal(markers.filter(marker=>marker.element.className==='corridor-zone-marker').length,2);
  const full=JSON.stringify(map.bounds);
  buttons[1].events.click();
  assert.deepEqual(selections,['tunnel']);
  const highlight=map.sources.get('corridor-zone-highlight').data.features[0];
  assert.equal(highlight.properties.zoneKey,'tunnel');
  assert.ok(highlight.geometry.coordinates[0][0]>-105.4);
  assert.equal(highlight.geometry.coordinates.at(-1)[0],-105);
  assert.notEqual(JSON.stringify(map.bounds),full);
  assert.equal(buttons[1].attributes['aria-pressed'],'true');
  assert.equal(map.sources.get('corridor-traffic').data.features.length,0);
  d.nodes.get('corridorZoneReset').events.click();
  assert.deepEqual(selections,['tunnel',null]);
  assert.equal(map.sources.get('corridor-zone-highlight').data.features.length,0);
  assert.equal(JSON.stringify(map.bounds),full);
});

test('stationary zone references reuse markers and avoid map source updates during graph redraws',async()=>{
  const {d,instances,markers,groups}=await zoneMapFixture();
  const count=markers.length, source=instances[0].sources.get('corridor-zone-highlight');
  let updates=0;const original=source.setData;source.setData=data=>{updates++;original.call(source,data);};
  let zoneUpdates=0;const zoneSource=instances[0].sources.get('corridor-zones');
  const originalZones=zoneSource.setData;zoneSource.setData=data=>{zoneUpdates++;originalZones.call(zoneSource,data);};
  for(let i=0;i<100;i++) d.context.window.CorridorMapPanel.setZones(groups,null,()=>{});
  assert.equal(markers.length,count);
  assert.equal(updates,0);
  assert.equal(zoneUpdates,0);
  d.context.window.CorridorMapPanel.hide();
  assert.equal(d.nodes.get('corridorZoneReference').hidden,true);
  assert.ok(markers.filter(marker=>marker.element.className==='corridor-zone-marker').every(marker=>marker.removed));
});

test('zone route sections and wider posted-limit bubbles share identity colors without inventing limits', async () => {
  const {d,instances,markers,groups}=await zoneMapFixture();
  const source=instances[0].sources.get('corridor-zones');
  assert.equal(source.data.features.length,2);
  const bubbles=markers.filter(marker=>marker.element.className==='corridor-zone-marker');
  assert.deepEqual(bubbles.map(marker=>marker.element.textContent),['Z1 | 60','Z2 | 50']);
  assert.match(bubbles[1].element.attributes['aria-label'],/Posted limit 50 mph/);
  assert.equal(bubbles[1].element.style['--zone-color'],source.data.features[1].properties.color);
  assert.equal(source.data.features[0].geometry.coordinates.at(-1)[0],source.data.features[1].geometry.coordinates[0][0]);
  d.context.window.CorridorMapPanel.setZones([{...groups[0],postedSpeedMph:null}],null,()=>{});
  const unknown=markers.filter(marker=>marker.element.className==='corridor-zone-marker'&&!marker.removed);
  assert.equal(unknown[0].element.textContent,'Z1 | —');
  assert.match(unknown[0].element.attributes['aria-label'],/Posted limit unavailable/);
  d.context.window.CorridorMapPanel.setZones([{...groups[0],postedSpeedMph:55}],null,()=>{});
  assert.equal(markers.filter(marker=>marker.element.className==='corridor-zone-marker'&&!marker.removed)[0].element.textContent,'Z1 | 55');
});

test('finder identity mode hides traffic layers without changing their styling and restores them on disable', async () => {
  const {d,instances}=await zoneMapFixture();
  const map=instances[0],traffic=map.options.style.layers.find(layer=>layer.id==='corridor-traffic');
  const paint=JSON.stringify(traffic.paint);
  assert.ok(map.layoutChanges.every(change=>change.value==='none'));
  assert.match(d.nodes.get('corridorMapLegendNote').textContent,/not traffic speed/);
  assert.equal(d.nodes.get('currentLegend').hidden,true);
  await d.context.window.CorridorMapPanel.render({corridor:'I70',zoneMode:false,selectedHours:168,
    corridorFeature:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}}});
  assert.ok(map.layoutChanges.slice(-3).every(change=>change.value==='visible'));
  assert.equal(map.sources.get('corridor-zones').data.features.length,0);
  assert.equal(d.nodes.get('frequencyLegend').hidden,false);
  assert.match(d.nodes.get('corridorMapLegendNote').textContent,/Slow hours/);
  assert.equal(JSON.stringify(traffic.paint),paint);
});

test('zone bubbles stagger across the north-south route and above/below the east-west route', async () => {
  const {d,markers,groups}=await zoneMapFixture();
  const eastWest=markers.filter(marker=>marker.element.className==='corridor-zone-marker'&&!marker.removed);
  assert.deepEqual(Array.from(eastWest[0].options.offset),[0,-32]);
  assert.deepEqual(Array.from(eastWest[1].options.offset),[0,32]);
  await d.context.window.CorridorMapPanel.render({corridor:'I25',zoneMode:true,
    corridorFeature:{type:'Feature',properties:{startMileMarker:206,endMileMarker:216},
      geometry:{type:'LineString',coordinates:[[-105,39],[-105,40]]}}});
  d.context.window.CorridorMapPanel.setZones(groups,null,()=>{});
  const northSouth=markers.filter(marker=>marker.element.className==='corridor-zone-marker'&&!marker.removed);
  assert.deepEqual(Array.from(northSouth[0].options.offset),[-44,0]);
  assert.deepEqual(Array.from(northSouth[1].options.offset),[44,0]);
});

test('crowded zone bubbles choose nonoverlapping in-map positions on move and resize without rebuilding markers', async () => {
  const {d,instances,markers}=await zoneMapFixture();
  const map=instances[0],canvas=d.nodes.get('corridorMap');
  canvas.clientWidth=342; canvas.clientHeight=320;
  map.project=()=>({x:171,y:160});
  d.context.window.CorridorMapPanel.setZones(Array.from({length:8},(_,index)=>({
    key:`zone-${index}`,referenceLabel:`Z${index+1}`,startMileMarker:206+index,endMileMarker:207+index,postedSpeedMph:65
  })),null,()=>{});
  const active=markers.filter(marker=>marker.element.className==='corridor-zone-marker'&&!marker.removed);
  const before=markers.length;
  map.listeners.get('moveend')();
  const offsets=active.map(marker=>Array.from(marker.options.offset));
  assert.notDeepEqual(offsets[0],offsets[1]);
  assert.ok(Math.abs(offsets[0][1]-offsets[1][1])>=32);
  for (const [index,a] of offsets.entries()) for (const b of offsets.slice(index+1)) {
    assert.ok(Math.abs(a[0]-b[0])>=74 || Math.abs(a[1]-b[1])>=32,'even eight colocated bubbles retain a readable gap');
  }
  map.listeners.get('resize')();
  assert.equal(markers.length,before);
  assert.deepEqual(active.map(marker=>Array.from(marker.options.offset)),offsets);
});

test('zone bubbles avoid road segments crossing their preferred position, not just route vertices',async()=>{
  const {d,instances,markers}=await zoneMapFixture();
  const map=instances[0],canvas=d.nodes.get('corridorMap');
  canvas.clientWidth=342; canvas.clientHeight=320;
  map.project=coordinate=> coordinate[1]===39.6 ? {x:20,y:128}
    : coordinate[1]===39.8 ? {x:322,y:128} : {x:171,y:160};
  d.context.window.CorridorMapPanel.setZones([{key:'center',referenceLabel:'Z3',
    startMileMarker:206,endMileMarker:216,postedSpeedMph:65}],null,()=>{});
  const marker=markers.findLast(marker=>marker.element.className==='corridor-zone-marker'&&!marker.removed);
  assert.deepEqual(Array.from(marker.options.offset),[0,32],
    'the line crosses the above-road candidate even though both route vertices are outside its bubble');
  map.project=coordinate=> coordinate[1]===39.6 ? {x:20,y:192}
    : coordinate[1]===39.8 ? {x:322,y:192} : {x:171,y:160};
  map.listeners.get('moveend')();
  assert.deepEqual(Array.from(marker.options.offset),[0,-32],'moving the map recalculates road clearance');
});

test('refreshed geometry repositions existing zone identities instead of retaining stale map badges',async()=>{
  const {d,instances,markers}=await zoneMapFixture();
  const old=markers.filter(marker=>marker.element.className==='corridor-zone-marker');
  await d.context.window.CorridorMapPanel.render({corridor:'I70',zoneMode:true,
    corridorFeature:{type:'Feature',properties:{startMileMarker:206,endMileMarker:216,direction:'EASTBOUND'},
      geometry:{type:'LineString',coordinates:[[-106,40],[-105,40.2]]}}});
  const current=markers.filter(marker=>marker.element.className==='corridor-zone-marker'&&!marker.removed);
  assert.ok(old.every(marker=>marker.removed));
  assert.equal(current.length,2);
  assert.ok(current.every(marker=>marker.coordinates[1]>=40));
  assert.equal(instances.length,1,'geometry refresh must not create a second renderer');
});

test('zone ranges outside known geometry are disabled rather than clamped onto the road',async()=>{
  const {d,instances,markers}=await zoneMapFixture();
  d.context.window.CorridorMapPanel.setZones([{key:'outside',referenceLabel:'Z9',startMileMarker:250,endMileMarker:260}],null,()=>{});
  assert.equal(d.nodes.get('corridorZoneButtons').children[0].disabled,true);
  assert.equal(instances[0].sources.get('corridor-zone-highlight').data.features.length,0);
  assert.equal(markers.filter(marker=>marker.element.className==='corridor-zone-marker'&&!marker.removed).length,0);
});

test('pending zone references survive initial map startup without waiting for raster tiles',async()=>{
  const instances=[],markers=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  const ready=d.context.window.CorridorMapPanel.render({corridor:'I70',zoneMode:true,
    corridorFeature:{type:'Feature',properties:{startMileMarker:206,endMileMarker:216},
      geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}}});
  d.context.window.CorridorMapPanel.setZones([{key:'tunnel',referenceLabel:'Z2',startMileMarker:213.1,endMileMarker:216}],null,()=>{});
  await ready;
  assert.equal(d.nodes.get('corridorZoneReference').hidden,false);
  assert.equal(d.nodes.get('corridorZoneButtons').children.length,1);
  instances[0].isStyleLoaded=()=>false;
  d.context.window.CorridorMapPanel.setZones([{key:'west',referenceLabel:'Z1',startMileMarker:206,endMileMarker:213.1}],null,()=>{});
  assert.equal(d.nodes.get('corridorZoneButtons').children[0].dataset.zoneKey,'west');
});

test('focused corridor map receives only the selected route geometry', () => {
  const d = dashboard();
  const calls = [];
  d.context.window.CorridorMapPanel = {
    render: payload => calls.push({ type: 'render', payload }),
    hide: () => calls.push({ type: 'hide' }),
    setTheme() {}
  };
  d.context.feature = { type: 'Feature', properties: { corridor: 'I25' },
    geometry: { type: 'LineString', coordinates: [[-105, 39], [-104, 40]] } };
  d.run("state.corridorFeatures.set('I25', feature); applyCorridorFocus('I25', false)");
  assert.equal(calls.at(-1).type, 'render');
  assert.equal(calls.at(-1).payload.corridor, 'I25');
  assert.equal(calls.at(-1).payload.corridorFeature.properties.corridor, 'I25');
  d.run("applyCorridorFocus('ALL', false)");
  assert.equal(calls.at(-1).type, 'hide');
});

test('map preloading warms one module without hidden WebGL or basemap reads', async () => {
  const instances=[];
  let loads=0,reads=0;
  const d=corridorMap(async()=>{loads++;return fakeMapRenderer(instances);});
  d.context.window.fetch=async()=>{reads++;return {ok:false};};
  await Promise.all([d.context.window.CorridorMapPanel.preload(),d.context.window.CorridorMapPanel.preload()]);
  assert.equal(loads,1);
  assert.equal(instances.length,0);
  assert.equal(reads,0);
  assert.equal(d.nodes.get('corridorMapPanel').hidden,true);
  await d.context.window.CorridorMapPanel.render({corridor:'I25',corridorFeature:{type:'Feature',properties:{},
    geometry:{type:'LineString',coordinates:[[-105,39.7],[-104.9,40.1]]}},incidentFeatures:[]});
  assert.equal(loads,1);
  assert.equal(instances.length,1);
});

test('failed module warm-up can retry on a focused map render', async () => {
  const instances=[],attempts=[];
  const d=corridorMap(async attempt=>{
    attempts.push(attempt);
    if(attempt===0)throw new Error('Transient module failure');
    return fakeMapRenderer(instances);
  });
  await d.context.window.CorridorMapPanel.preload();
  assert.equal(instances.length,0);
  await d.context.window.CorridorMapPanel.render({corridor:'I25',corridorFeature:{type:'Feature',properties:{},
    geometry:{type:'LineString',coordinates:[[-105,39.7],[-104.9,40.1]]}},incidentFeatures:[]});
  assert.deepEqual(attempts,[0,1]);
  assert.equal(instances.length,1);
});

test('corridor map fits verified route geometry and preserves a clear no-flow fallback', async () => {
  const instances = [];
  const popups = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, popups));
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I25',
    theme: 'light',
    corridorFeature: { type: 'Feature', properties: { mileMarkerRange: 'MM 208 to 271' },
      geometry: { type: 'LineString', coordinates: [[-105.2, 39.6], [-104.8, 40.7]] } },
    incidentFeatures: [
      { type: 'Feature', properties: { corridor: 'I25', normalizedCategory: 'CRASH' },
        geometry: { type: 'Point', coordinates: [-105, 40] } },
      { type: 'Feature', properties: { corridor: 'I70' }, geometry: { type: 'Point', coordinates: [-105, 40] } },
      { type: 'Feature', properties: { corridor: 'I25', isOffCorridor: true },
        geometry: { type: 'Point', coordinates: [-105, 40] } }
    ]
  });
  assert.equal(d.nodes.get('corridorMapPanel').hidden, false);
  assert.equal(JSON.stringify(instances[0].bounds), JSON.stringify([[-105.2, 39.6], [-104.8, 40.7]]));
  assert.equal(instances[0].sources.get('corridor-route').data.features.length, 1);
  assert.equal(instances[0].sources.get('corridor-incidents').data.features.length, 1);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /1 mapped CDOT report/);
  assert.equal(instances[0].sources.get('corridor-traffic').data.features.length, 0);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Local flow is unavailable/);
  instances[0].listeners.get('click:corridor-incidents')({ features: [{
    geometry: { type: 'Point', coordinates: [-105, 40] },
    properties: { incidentTypeLabel: 'Crash', locationLabel: 'I-25 near MM 220', active: true,
      travelDirectionLabel: 'Southbound', closestMileMarker: 220 }
  }] });
  assert.equal(popups.length, 1);
  assert.equal(popups[0].content.children[0].textContent, 'Crash');
  assert.match(popups[0].content.children[2].textContent, /CDOT report · Active · Southbound · MM 220/);
});

test('incident map popups use specific details without repeating the location', async () => {
  const instances = [];
  const popups = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, popups));
  const incident = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-105, 40] },
    properties: {
      corridor: 'I25',
      incidentTypeLabel: 'Two-vehicle crash',
      incidentDisplayLabel: 'Two-vehicle crash at I-25 southbound near MM 220',
      incidentImpactLabel: 'Southbound: right lane closed',
      incidentNote: 'Expect delays.',
      locationLabel: 'I-25 southbound near MM 220',
      active: true,
      normalizedStatus: 'active'
    }
  };
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I25',
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-105.1, 39.9], [-104.9, 40.1]] } },
    incidentFeatures: [incident]
  });
  instances[0].listeners.get('click:corridor-incidents')({ features: [incident] });
  assert.equal(popups[0].content.children[0].textContent, 'Two-vehicle crash');
  assert.equal(popups[0].content.children[1].textContent, 'I-25 southbound near MM 220');
  assert.equal(popups[0].content.children[2].textContent, 'Impact: Southbound: right lane closed');
  assert.equal(popups[0].content.children[3].textContent, 'Expect delays.');
  assert.match(popups[0].content.children[4].textContent, /CDOT report · Active/);
});

test('integer mile markers appear only after a close map zoom', async () => {
  const instances = [];
  const markers = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, [], markers));
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I25',
    corridorFeature: {
      type: 'Feature',
      properties: {
        startMileMarker: 220,
        endMileMarker: 222,
        mileMarkerAnchorsJson: JSON.stringify([
          { mileMarker: 220, latitude: 39.99, longitude: -105 },
          { mileMarker: 222, latitude: 40.01, longitude: -105 }
        ])
      },
      geometry: { type: 'LineString', coordinates: [[-105, 39.99], [-105, 40.01]] }
    },
    incidentFeatures: []
  });
  assert.equal(markers.length, 3);
  assert.deepEqual(Array.from(markers, marker => marker.element.textContent), ['MM 220', 'MM 221', 'MM 222']);
  assert.ok(markers.every(marker => marker.element.hidden));
  instances[0].zoom = 12;
  instances[0].listeners.get('zoom')();
  assert.ok(markers.every(marker => !marker.element.hidden));
  assert.equal(markers[1].element.attributes['aria-label'], 'I-25 mile marker 221');
  assert.ok(Math.abs(markers[1].coordinates[1] - 40) < 1e-9);
});

test('posted-speed transitions are marked at their precise corridor boundary', async () => {
  const instances = [];
  const markers = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, [], markers));
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I25',
    corridorFeature: {
      type: 'Feature',
      properties: {
        startMileMarker: 220,
        endMileMarker: 223,
        mileMarkerAnchorsJson: JSON.stringify([
          { mileMarker: 220, latitude: 39.99, longitude: -105 },
          { mileMarker: 223, latitude: 40.02, longitude: -105 }
        ]),
        speedLimitSegments: [
          { startMileMarker: 220, endMileMarker: 221.5, speedLimitMph: 55 },
          { startMileMarker: 221.5, endMileMarker: 222, speedLimitMph: 65 },
          { startMileMarker: 222, endMileMarker: 223, speedLimitMph: 65 }
        ]
      },
      geometry: { type: 'LineString', coordinates: [[-105, 39.99], [-105, 40.02]] }
    },
    incidentFeatures: []
  });
  const boundaries = markers.filter(marker => marker.element.className === 'corridor-speed-boundary');
  assert.equal(boundaries.length, 1);
  assert.equal(boundaries[0].element.textContent, '');
  assert.equal(boundaries[0].element.title, 'Reference limit changes near MM 221.5: 55–65 mph');
  assert.ok(Math.abs(boundaries[0].coordinates[1] - 40.005) < 1e-9);
  assert.match(boundaries[0].element.attributes['aria-label'], /mile marker 221\.5: 55 and 65/);
  const references = markers.filter(marker => marker.element.className.includes('corridor-speed-reference'));
  assert.deepEqual(references.map(marker => marker.element.children.map(child => child.textContent)),
    [['55','ref'],['65','ref']]);
  assert.match(references[1].element.title,/MM 221.5–223; not a live sign reading/);
  assert.ok(Math.abs(references[1].coordinates[1] - 40.0125) < 1e-9);
  assert.ok(references.every(marker=>marker.options.offset[0]>0&&marker.options.offset[1]===0),
    'I-25 reference signs sit beside the north-south road');
});

test('uses configured Tracestrack Topo tiles and otherwise keeps the USGS fallback', async () => {
  const instances = [];
  const d = corridorMap(async () => fakeMapRenderer(instances));
  d.context.window.fetch = async url => ({
    ok: true,
    json: async () => ({
      provider: 'TRACESTRACK_TOPO',
      tileUrl: 'https://tile.tracestrack.com/topo_en/{z}/{x}/{y}@1x.webp?key=restricted',
      overviewTileUrl: 'https://tile.tracestrack.com/en/{z}/{x}/{y}@1x.webp?key=restricted',
      attribution: 'Data: © OpenStreetMap contributors; Maps © Tracestrack',
      maxZoom: 19,
      detailMinZoom: 10
    })
  });
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I70',
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-106, 39.6], [-105, 39.8]] } },
    incidentFeatures: []
  });
  assert.equal(instances[0].options.style.sources['base-map'].tiles[0],
    'https://tile.tracestrack.com/topo_en/{z}/{x}/{y}@1x.webp?key=restricted');
  assert.equal(instances[0].options.style.sources['base-map-overview'].tiles[0],
    'https://tile.tracestrack.com/en/{z}/{x}/{y}@1x.webp?key=restricted');
  assert.equal(instances[0].options.style.sources['base-map'].maxzoom, 19);
  assert.equal(instances[0].options.style.layers.find(layer => layer.id === 'base-map-overview').maxzoom, 10);
  assert.equal(instances[0].options.style.layers.find(layer => layer.id === 'base-map').minzoom, 10);
  assert.equal(instances[0].options.refreshExpiredTiles, false);
  assert.doesNotMatch(d.nodes.get('corridorMapStatus').textContent, /Tracestrack overview/);
  assert.equal(d.attributionDetails.open, false);
  assert.equal(d.attributionDetails.compactShow, false);
  assert.equal(d.attributionDetails.initiallyCollapsed, true);

  const fallbackInstances = [];
  const fallback = corridorMap(async () => fakeMapRenderer(fallbackInstances));
  await fallback.context.window.CorridorMapPanel.render({
    corridor: 'I70',
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-106, 39.6], [-105, 39.8]] } },
    incidentFeatures: []
  });
  assert.match(fallbackInstances[0].options.style.sources['base-map'].tiles[0], /basemap\.nationalmap\.gov/);
  assert.equal(fallbackInstances[0].options.style.sources['base-map-overview'], undefined);
});

test('optional basemap configuration has a bounded timeout and uses the matching API prefix', async () => {
  for (const pathname of ['/dashboard/', '/dashboard-experimental/']) {
    const instances = [];
    const d = corridorMap(async () => fakeMapRenderer(instances));
    d.context.window.location.pathname = pathname;
    const signals = [];
    d.context.AbortSignal = { timeout(milliseconds) {
      assert.equal(milliseconds, 3000);
      const signal = { configuredTimeout: milliseconds };
      signals.push(signal);
      return signal;
    } };
    const requests = [];
    d.context.window.fetch = async (url, options) => {
      requests.push(url);
      assert.equal(options.signal, signals[0]);
      assert.equal(options.cache, 'no-store');
      throw new DOMException('Configuration timed out', 'TimeoutError');
    };
    await d.context.window.CorridorMapPanel.render({
      corridor: 'I25', corridorFeature: { type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: [[-105, 39], [-105, 40]] } },
      incidentFeatures: []
    });
    assert.deepEqual(requests, [pathname.includes('experimental')
      ? '/dashboard-experimental-api/map/config' : '/dashboard-api/map/config']);
    assert.equal(instances.length, 1);
    assert.match(instances[0].options.style.sources['base-map'].tiles[0], /nationalmap/);
    assert.match(d.nodes.get('corridorMapStatus').textContent, /Local flow is unavailable/);
  }
});

test('corridor map combines half-mile cells into one-mile display intervals', async () => {
  const instances = [];
  const popups = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, popups));
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I25',
    corridorFeature: {
      type: 'Feature',
      properties: {
        startMileMarker: 221,
        endMileMarker: 220,
        mileMarkerRange: 'MM 220 to 221',
        mileMarkerAnchorsJson: JSON.stringify([
          { mileMarker: 221, latitude: 40, longitude: -105 },
          { mileMarker: 220, latitude: 39.99, longitude: -105 }
        ]),
        speedLimitSegments: [{ startMileMarker: 220, endMileMarker: 221, speedLimitMph: 60 }]
      },
      geometry: { type: 'LineString', coordinates: [[-105, 40], [-105, 39.995], [-105, 39.99]] }
    },
    flowCells: {
      corridor: 'I25', observedAt: '2026-09-23T19:41:00Z',
      cells: [
        { cellId: 'I25:220.000-220.500', startMileMarker: 220, endMileMarker: 220.5,
          direction: 'COMBINED', speedMph: 25, quality: 'FULL_CELL', closureEvidence: 'NONE',
          lengthWeightedSourceSpanMiles: 1.2 },
        { cellId: 'I25:220.500-221.000', startMileMarker: 220.5, endMileMarker: 221,
          direction: 'COMBINED', speedMph: 55, quality: 'PARTIAL_CELL', closureEvidence: 'ONE_SIDE_REPORTED',
          lengthWeightedSourceSpanMiles: 0.4 }
      ]
    },
    incidentFeatures: []
  });
  const traffic = instances[0].sources.get('corridor-traffic').data.features;
  assert.equal(traffic.length, 1);
  assert.equal(traffic[0].properties.cellId, 'I25:220.000-221.000');
  assert.equal(traffic[0].properties.speedMph, 40);
  assert.ok(Math.abs(traffic[0].properties.speedRatio - (2 / 3)) < 1e-9);
  assert.equal(traffic[0].properties.condition, 'SLOWING');
  assert.equal(traffic[0].properties.quality, 'PARTIAL_CELL');
  assert.equal(traffic[0].properties.closureEvidence, 'ONE_SIDE_REPORTED');
  assert.ok(Math.abs(traffic[0].properties.sourceSpanMiles - 0.8) < 1e-9);
  assert.ok(traffic[0].geometry.coordinates.length >= 2);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /^Current traffic as of/);
  assert.doesNotMatch(d.nodes.get('corridorMapStatus').textContent, /one-mile|Combined directions|posted speeds/);

  instances[0].listeners.get('click:corridor-traffic')({
    lngLat: { lng: -105, lat: 39.995 },
    features: [traffic[0]]
  });
  assert.equal(popups.length, 1);
  assert.equal(popups[0].content.children[0].textContent, 'Slowing traffic · MM 220–221');
  assert.match(popups[0].content.children[1].textContent, /Combined directions · 40 mph observed/);
  assert.match(popups[0].content.children[2].textContent, /60 mph posted speed/);
  assert.match(popups[0].content.children[3].textContent, /closure on one side/);
});

test('corridor map colors long ranges by recurring slowdown frequency', async () => {
  const instances = [];
  const popups = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, popups));
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I25',
    selectedHours: 168,
    corridorFeature: {
      type: 'Feature',
      properties: {
        startMileMarker: 220, endMileMarker: 221, mileMarkerRange: 'MM 220 to 221',
        mileMarkerAnchorsJson: JSON.stringify([
          { mileMarker: 220, latitude: 39.99, longitude: -105 },
          { mileMarker: 221, latitude: 40, longitude: -105 }
        ]),
        speedLimitSegments: [{ startMileMarker: 220, endMileMarker: 221, speedLimitMph: 60 }]
      },
      geometry: { type: 'LineString', coordinates: [[-105, 39.99], [-105, 40]] }
    },
    incidentFeatures: [],
    flowCells: {
      corridor: 'I25', resolution: 'SLOWDOWN_FREQUENCY', requestedHourCount: 168,
      availableHourCount: 24, windowStart: '2026-09-18T21:00:00Z', windowEnd: '2026-09-25T21:00:00Z',
      cells: [
        { cellId: 'I25:220.000-220.500', startMileMarker: 220, endMileMarker: 220.5,
          direction: 'COMBINED', avgSpeedMph: 45, sampledHourCount: 24, slowdownHourCount: 6,
          heavySlowdownHourCount: 2, severeSlowdownHourCount: 0, stoppedHourCount: 0,
          firstObservedAt: '2026-09-24T21:01:00Z', lastObservedAt: '2026-09-25T20:58:00Z' },
        { cellId: 'I25:220.500-221.000', startMileMarker: 220.5, endMileMarker: 221,
          direction: 'COMBINED', avgSpeedMph: 35, sampledHourCount: 24, slowdownHourCount: 18,
          heavySlowdownHourCount: 8, severeSlowdownHourCount: 2, stoppedHourCount: 0,
          firstObservedAt: '2026-09-24T21:01:00Z', lastObservedAt: '2026-09-25T20:58:00Z' }
      ]
    }
  });

  const traffic = instances[0].sources.get('corridor-traffic').data.features;
  assert.equal(traffic.length, 1);
  assert.equal(traffic[0].properties.resolution, 'SLOWDOWN_FREQUENCY');
  assert.equal(traffic[0].properties.condition, 'FREQUENT_SLOWDOWN');
  assert.equal(traffic[0].properties.slowdownFrequency, 0.5);
  assert.equal(traffic[0].properties.quality, 'FULL_CELL');
  assert.match(d.nodes.get('corridorMapStatus').textContent, /^Slowdown history through/);
  assert.match(d.nodes.get('corridorMapSubtitle').textContent, /Recurring slowdowns over 7 days/);
  assert.equal(d.nodes.get('currentLegend').hidden, true);
  assert.equal(d.nodes.get('frequencyLegend').hidden, false);
  const colorExpression = JSON.stringify(
    instances[0].options.style.layers.find(layer => layer.id === 'corridor-traffic').paint['line-color']
  );
  assert.match(colorExpression, /slowdownFrequency/);
  assert.match(colorExpression, /stoppedFrequency/);
  assert.match(indexSource, /Frequent near-stops/);
  assert.match(indexSource, /Low slowdown rate/);
  assert.match(indexSource, /Very high slowdown rate/);

  instances[0].listeners.get('click:corridor-traffic')({
    lngLat: { lng: -105, lat: 39.995 }, features: [traffic[0]]
  });
  assert.match(popups[0].content.children[0].textContent, /High slowdown rate/);
  assert.match(popups[0].content.children[1].textContent, /12 of 24 sampled hours/);
  assert.match(popups[0].content.children[3].textContent, /24 of 168 requested hours available/);
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I25', selectedHours: 24,
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-105,39.99],[-105,40]] } },
    incidentFeatures: [], flowCells: null
  });
  assert.equal(d.nodes.get('currentLegend').hidden, false);
  assert.equal(d.nodes.get('frequencyLegend').hidden, true);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Local flow is unavailable for this time/);
});

+test('long-range maps replace event clouds with the five busiest one-mile hotspots', async () => {
  const instances = [];
  const popups = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, popups));
  const corridorFeature = {
    type: 'Feature',
    properties: {
      startMileMarker: 220, endMileMarker: 228,
      mileMarkerAnchorsJson: JSON.stringify([
        { mileMarker: 220, latitude: 39.99, longitude: -105 },
        { mileMarker: 228, latitude: 40.07, longitude: -105 }
      ])
    },
    geometry: { type: 'LineString', coordinates: [[-105, 39.99], [-105, 40.07]] }
  };
  const incident = (id, marker, active = false, type = 'Crash') => ({
    type: 'Feature', id,
    geometry: { type: 'Point', coordinates: [-105, 39.99 + (marker - 220) / 100] },
    properties: { corridor: 'I25', incidentProvider: 'cdot', providerEventId: id,
      closestMileMarker: marker, active, incidentTypeLabel: type,
      firstSeenAt: '2026-09-20T00:00:00Z', lastSeenAt: '2026-09-25T00:00:00Z' }
  });
  const incidents = [
    incident('a', 220.2, true), incident('b', 220.4), incident('c', 220.8, false, 'Construction'),
    incident('a', 220.2, true), incident('d', 221.2), incident('e', 221.7),
    incident('f', 222.2), incident('g', 223.2), incident('h', 224.2),
    incident('i', 225.2), incident('j', 226.2)
  ];
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I25', selectedHours: 168, corridorFeature, incidentFeatures: incidents,
    flowCells: { corridor: 'I25', resolution: 'SLOWDOWN_FREQUENCY', requestedHourCount: 168,
      availableHourCount: 1, cells: [] }
  });

  const hotspots = instances[0].sources.get('corridor-incidents').data.features;
  assert.equal(hotspots.length, 5);
  assert.equal(hotspots[0].properties.locationLabel, 'MM 220–221');
  assert.equal(hotspots[0].properties.incidentCount, 3);
  assert.equal(hotspots[0].properties.activeIncidentCount, 1);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /5 incident hotspots/);

  instances[0].listeners.get('click:corridor-incidents')({ features: [hotspots[0]] });
  assert.match(popups[0].content.children[0].textContent, /3 incidents · MM 220–221/);
  assert.match(popups[0].content.children[1].textContent, /selected 7 days/);
  instances[0].renderedFeatures = [hotspots[0]];
  instances[0].listeners.get('click:corridor-traffic')({
    point: { x: 10, y: 10 }, lngLat: { lng: -105, lat: 40 },
    features: [{ geometry: { type: 'LineString', coordinates: [[-105, 39.99], [-105, 40]] },
      properties: { resolution: 'SLOWDOWN_FREQUENCY' } }]
  });
  assert.equal(popups.length, 1);
  instances[0].listeners.get('click:corridor-incidents')({ features: [hotspots[2]] });
  assert.match(popups[1].content.children[0].textContent, /^1 incident ·/);
  assert.equal(popups[0].removed, true);
  d.context.window.CorridorMapPanel.hide();
  assert.equal(popups[1].removed, true);
});

test('unavailable long-range flow shows a neutral route and no fabricated slowdown data', async () => {
  const instances = [];
  const d = corridorMap(async () => fakeMapRenderer(instances));
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I70', selectedHours: 720,
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-106,39.6],[-105,39.8]] } },
    incidentFeatures: [], flowCells: null
  });
  assert.equal(instances[0].sources.get('corridor-traffic').data.features.length, 0);
  assert.equal(instances[0].sources.get('corridor-route').data.features.length, 1);
  assert.match(d.nodes.get('corridorMapSubtitle').textContent, /30 days/);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Slowdown history is unavailable for this range/);
});

test('corridor map uses a continuous traffic scale and ignores directional companion rows', async () => {
  const instances = [];
  const popups = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, popups));
  const corridorFeature = {
    type: 'Feature',
    properties: {
      startMileMarker: 220,
      endMileMarker: 227,
      mileMarkerAnchorsJson: JSON.stringify([
        { mileMarker: 220, latitude: 39.99, longitude: -105 },
        { mileMarker: 227, latitude: 40.06, longitude: -105 }
      ]),
      speedLimitSegments: [{ startMileMarker: 220, endMileMarker: 227, speedLimitMph: 60 }]
    },
    geometry: { type: 'LineString', coordinates: [[-105, 39.99], [-105, 40.06]] }
  };
  const speeds = [66, 60, 42, 30, 12, 2, 60];
  const cells = speeds.map((speedMph, index) => ({
    cellId: `I25:${220 + index}.000-${221 + index}.000`,
    startMileMarker: 220 + index,
    endMileMarker: 221 + index,
    direction: 'COMBINED',
    speedMph,
    quality: 'FULL_CELL',
    closureEvidence: index === 6 ? 'FULL_REPORTED' : 'NONE'
  }));
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I25', corridorFeature, incidentFeatures: [],
    flowCells: {
      corridor: 'I25',
      observedAt: '2026-09-24T06:00:00Z',
      cells: [
        ...cells,
        { ...cells[0], direction: 'NORTHBOUND', speedMph: 10, closureEvidence: 'ONE_SIDE_REPORTED' }
      ]
    }
  });

  const combined = instances[0].sources.get('corridor-traffic').data.features;
  assert.equal(combined.length, 7);
  assert.equal(
    combined.map(feature => feature.properties.condition).join(','),
    'ABOVE_EXPECTED,EXPECTED,SLOWING,HEAVY,SEVERE,STOPPED,STOPPED'
  );
  assert.ok(combined.every(feature => feature.properties.direction === 'COMBINED'));
  const layers = instances[0].options.style.layers;
  assert.equal(layers.some(layer => layer.id.includes('directional')), false);
  const colorExpression = JSON.stringify(layers.find(layer => layer.id === 'corridor-traffic').paint['line-color']);
  for (const color of ['#2675b8', '#2f7a55', '#d8aa24', '#bd3334', '#681c2a', '#0b0d0c']) {
    assert.match(colorExpression, new RegExp(color));
  }
  const incidentRadius = layers.find(layer => layer.id === 'corridor-incidents').paint['circle-radius'];
  assert.equal(incidentRadius[0], 'interpolate');
  assert.equal(incidentRadius[2][0], 'zoom');
});

test('corridor map explains missing geometry and renderer failures', async () => {
  let loadCount = 0;
  const missing = corridorMap(async () => { loadCount += 1; return fakeMapRenderer([]); });
  await missing.context.window.CorridorMapPanel.render({ corridor: 'I70' });
  assert.equal(loadCount, 0);
  assert.match(missing.nodes.get('corridorMapStatus').textContent, /Route geometry is unavailable/);

  const failed = corridorMap(async () => { throw new Error('WebGL unavailable'); });
  await failed.context.window.CorridorMapPanel.render({
    corridor: 'I70',
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-106, 39.6], [-105, 39.8]] } }
  });
  assert.match(failed.nodes.get('corridorMapStatus').textContent, /Select Sync now to retry/);
});

test('corridor map retries after a transient renderer startup failure', async () => {
  const instances = [];
  let attempts = 0;
  const d = corridorMap(async attempt => {
    assert.equal(attempt, attempts);
    if (++attempts === 1) throw new Error('Renderer temporarily unavailable');
    return fakeMapRenderer(instances);
  });
  const payload = { corridor: 'I70', corridorFeature: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[-106, 39.6], [-105, 39.8]] } },
    incidentFeatures: [] };
  await d.context.window.CorridorMapPanel.render(payload);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Select Sync now to retry/);
  await d.context.window.CorridorMapPanel.render(payload);
  assert.equal(attempts, 2);
  assert.equal(instances.length, 1);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Local flow is unavailable/);
});

test('renderer network retries are bounded before requiring a page reload', async () => {
  const attempts = [];
  const d = corridorMap(async attempt => { attempts.push(attempt); throw new Error('Offline'); });
  const payload = { corridor: 'I25', corridorFeature: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[-105, 39], [-105, 40]] } }, incidentFeatures: [] };
  for (let index = 0; index < 5; index++) await d.context.window.CorridorMapPanel.render(payload);
  assert.deepEqual(attempts, [0,1,2,2,2]);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /reload if startup still fails/);
});

test('failed partial map startup is removed before a fresh attempt', async () => {
  const instances = [];
  const module = fakeMapRenderer(instances);
  const OriginalMap = module.default.Map;
  module.default.Map = class extends OriginalMap {
    addControl() { if (instances.length === 1) throw new Error('Control initialization failed'); }
  };
  let moduleLoads = 0;
  const d = corridorMap(async () => { moduleLoads += 1; return module; });
  const payload = { corridor: 'I25', corridorFeature: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[-105, 39], [-105, 40]] } }, incidentFeatures: [] };
  await d.context.window.CorridorMapPanel.render(payload);
  assert.equal(instances[0].removed, true);
  await d.context.window.CorridorMapPanel.render(payload);
  assert.equal(instances.length, 2);
  assert.equal(moduleLoads, 1);
  assert.equal(instances[1].sources.get('corridor-route').data.features.length, 1);
});

test('style-ready route context does not wait for raster load and retains imagery failures across refresh', async () => {
  const instances = [];
  const module = fakeMapRenderer(instances);
  const OriginalMap = module.default.Map;
  module.default.Map = class extends OriginalMap {
    isStyleLoaded() { return this.styleReady || false; }
    once(event, callback) {
      assert.equal(event, 'style.load');
      this.listeners.get('error')({ sourceId: 'base-map' });
      this.styleReady = true;
      callback();
    }
  };
  const d = corridorMap(async () => module);
  const payload = { corridor: 'I70', corridorFeature: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[-106, 39.6], [-105, 39.8]] } }, incidentFeatures: [] };
  await d.context.window.CorridorMapPanel.render(payload);
  assert.equal(instances[0].loaded(), false);
  assert.equal(instances[0].sources.get('corridor-route').data.features.length, 1);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /tiles could not load.*Reload to retry/);
  await d.context.window.CorridorMapPanel.render(payload);
  assert.equal(instances.length, 1);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /tiles could not load.*Local flow is unavailable/);
  d.context.window.CorridorMapPanel.setTheme('dark');
  assert.ok(instances[0].paintChanges.some(change =>
    change.layer === 'map-background' && change.value === '#17221c'));
});

test('changing corridor or timeframe removes a popup from the previous map context', async () => {
  const instances = [];
  const popups = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, popups));
  const payload = { corridor: 'I25', selectedHours: 24, corridorFeature: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[-105, 39], [-105, 40]] } }, incidentFeatures: [] };
  const incident = { features: [{ geometry: { type: 'Point', coordinates: [-105, 40] },
    properties: { incidentTypeLabel: 'Crash', locationLabel: 'MM 220', active: true } }] };
  await d.context.window.CorridorMapPanel.render(payload);
  instances[0].listeners.get('click:corridor-incidents')(incident);
  await d.context.window.CorridorMapPanel.render({...payload, corridor: 'I70'});
  assert.equal(popups[0].removed, true);
  instances[0].listeners.get('click:corridor-incidents')(incident);
  await d.context.window.CorridorMapPanel.render({...payload, corridor: 'I70', selectedHours: 168});
  assert.equal(popups[1].removed, true);
});

test('attribution stays initially collapsed without observers and opens on its button', async () => {
  const d = corridorMap(async () => fakeMapRenderer([]));
  d.context.window.MutationObserver = class {
    constructor() { throw new Error('No attribution DOM observer should be installed'); }
  };
  await d.context.window.CorridorMapPanel.render({ corridor: 'I25',
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-105, 39], [-105, 40]] } },
    incidentFeatures: [] });
  assert.equal(d.attributionDetails.initiallyCollapsed, true);
  assert.equal(d.attributionDetails.open, false);
  let prevented = false;
  d.attributionButton.listeners.click({ preventDefault() { prevented = true; } });
  assert.equal(d.attributionDetails.initiallyCollapsed, false);
  assert.equal(d.attributionDetails.open, true);
  assert.equal(d.attributionDetails.compactShow, true);
  assert.equal(prevented, true);
});

test('hourly map reports the observation time rather than a later bucket boundary', async () => {
  const d = corridorMap(async () => fakeMapRenderer([]));
  await d.context.window.CorridorMapPanel.render({
    corridor:'I25',
    corridorFeature:{type:'Feature',properties:{startMileMarker:220,endMileMarker:221,
      speedLimitSegments:[{startMileMarker:220,endMileMarker:221,speedLimitMph:60}]},
      geometry:{type:'LineString',coordinates:[[-105,39.99],[-105,40]]}},
    flowCells:{corridor:'I25',resolution:'HOURLY',hourEnd:'2026-09-23T20:00:00Z',
      cells:[{cellId:'I25:220.000-221.000',startMileMarker:220,endMileMarker:221,
        direction:'COMBINED',avgSpeedMph:50,fullCellObservationCount:60,
        lastObservedAt:'2026-09-23T19:41:00Z'}]},
    incidentFeatures:[]
  });
  assert.match(d.nodes.get('corridorMapStatus').textContent, /^Hourly traffic observed/);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /1:41 PM MDT/);
  assert.doesNotMatch(d.nodes.get('corridorMapStatus').textContent, /2:00 PM MDT/);
});

test('imagery failure retains route context and provider popup content stays text', async () => {
  const instances = [];
  const popups = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, popups));
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I70',
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-106, 39.6], [-105, 39.8]] } },
    incidentFeatures: []
  });
  instances[0].listeners.get('error')({ sourceId: 'base-map' });
  assert.match(d.nodes.get('corridorMapStatus').textContent, /imagery tiles could not load.*Reload to retry/);
  assert.equal(instances[0].sources.get('corridor-route').data.features.length, 1);
  const malicious = '<img src=x onerror=alert(1)>';
  instances[0].listeners.get('click:corridor-incidents')({ features: [{
    geometry: { type: 'Point', coordinates: [-105, 39.8] },
    properties: { incidentTypeLabel: malicious, locationLabel: malicious }
  }] });
  assert.equal(popups[0].content.children[0].textContent, malicious);
  assert.equal(popups[0].content.children[1].textContent, malicious);
  assert.equal(popups[0].content.children[0].tagName, 'strong');
  await d.context.window.CorridorMapPanel.render({ corridor: 'I70' });
  assert.equal(instances[0].sources.get('corridor-route').data.features.length, 0);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Route geometry is unavailable/);
  assert.doesNotMatch(d.nodes.get('corridorMapStatus').textContent, /route and traffic remain available/);
});

test('uses durable first/last sightings and provider active flag, including old active events', () => {
  const d = dashboard();
  d.context.features = [event(), event({ providerEventId: 'ended', active: false })];
  const rows = d.run("incidentModel.aggregateIncidentThreads(features)");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'Disabled Vehicle');
  assert.equal(rows[0].firstSeenAt.toISOString(), '2026-09-13T10:00:00.000Z');
  assert.equal(rows[0].lastSeenAt.toISOString(), '2026-09-15T10:00:00.000Z');
  assert.equal(rows[0].locationLabel, 'MP 225 · Thornton');
  assert.equal(rows[0].ongoing, true);
  assert.equal(rows[1].ongoing, false);
});

test('event identity includes provider and corridor and latest state wins when deduplicating', () => {
  const d = dashboard();
  d.context.features = [event({ active: false }), event({ lastSeenAt: '2026-09-14T10:00:00Z' }),
    event({ incidentProvider: 'tomtom' }), event({ corridor: 'I70' })];
  const rows = d.run("incidentModel.aggregateIncidentThreads(features)");
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.key === 'cdot|I25|one').ongoing, false);
});

test('incident locations do not repeat an existing MP or MM reference', () => {
  const d = dashboard();
  assert.equal(d.run("incidentModel.buildIncidentLocation({closestMileMarker:260.3, locationLabel:'I-25 southbound near MM 260.3'})"), 'I-25 southbound near MM 260.3');
  assert.equal(d.run("incidentModel.buildIncidentLocation({closestMileMarker:225, locationLabel:'Thornton'})"), 'MP 225 · Thornton');
});

test('worst-segment context formats usable mile-marker ranges', () => {
  const d = dashboard();
  assert.equal(d.run('formatZoneMileMarkerRange({startMileMarker:244, endMileMarker:232.5})'), 'MM 232.5–244');
  assert.equal(d.run('formatZoneMileMarkerRange({startMileMarker:225, endMileMarker:225})'), 'MM 225');
  assert.equal(d.run('formatZoneMileMarkerRange({})'), '');
});
