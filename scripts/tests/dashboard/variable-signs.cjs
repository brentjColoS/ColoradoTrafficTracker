const { test } = require('node:test');
const { variableSpeedSigns, vslSnapshot, vslSign, vslNow, assert, dashboard, popupText, indexSource } = require('../fixtures/core.cjs');
const { corridorMap, fakeMapRenderer, variableLimitDemoHarness, speedAreaFixture } = require('../fixtures/maps.cjs');

test('variable limits distinguish source changes from successful read freshness',()=>{
  const summary=variableSpeedSigns.summary(vslSnapshot([vslSign()]),true,vslNow);
  assert.equal(summary.reduced.length,1);assert.equal(summary.available.length,1);
  assert.equal(variableSpeedSigns.summary(vslSnapshot([vslSign({fetchedAt:new Date(vslNow-3600001).toISOString()})]),true,vslNow).changed.length,0);
});

test('six-hour cached sign reports remain inspectable without confirming current restrictions',()=>{
  const old=vslSign({fetchedAt:new Date(vslNow-5*3600000).toISOString()});
  const summary=variableSpeedSigns.summary(vslSnapshot([old]),true,vslNow);
  assert.equal(summary.available.length,0);assert.equal(summary.changed.length,0);
  assert.equal(summary.lastReported.length,1);assert.equal(summary.lastReported[0].reportedLimitMph,45);
  for(const changes of [{status:'FETCH_FAILED'},{communicationStatus:'error'},{displayStatus:'off'},
    {reportedLimitMph:null},{reportedLimitMph:0},{fetchedAt:null}]) {
    assert.equal(variableSpeedSigns.summary(vslSnapshot([{...old,...changes}]),true,vslNow).lastReported.length,0);
  }
  assert.equal(variableSpeedSigns.summary(vslSnapshot([old]),false,vslNow).lastReported.length,0);
});

test('the map keeps old reports in a compact disclosure, never as live map badges',async()=>{
  const instances=[],markers=[],reads=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  d.context.window.fetch=async path=>{reads.push(path);return {ok:true,json:async()=>({})};};
  const feature={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}};
  const old=vslSign({fetchedAt:new Date(Date.now()-5*3600000).toISOString()});
  await d.context.window.CorridorMapPanel.render({corridor:'I70',corridorFeature:feature,variableSpeedSigns:vslSnapshot([old])});
  assert.equal(markers.filter(marker=>marker.element.className.includes('corridor-variable-speed-sign')).length,0);
  const note=d.nodes.get('corridorVariableLimitStatus'),details=note.children[0];
  assert.match(note.textContent,/six hours/);assert.match(details.children[0].textContent,/Last-reported.*unconfirmed/);
  assert.match(details.children[1].children[0].textContent,/Eastbound.*45 mph.*read.*unconfirmed/);
  details.open=true;note.querySelector=()=>details;
  await d.context.window.CorridorMapPanel.render({corridor:'I70',corridorFeature:feature,
    variableSpeedSigns:vslSnapshot([{...old,fetchedAt:new Date(Date.now()-4*3600000).toISOString()}])});
  assert.equal(note.children.length,1);assert.equal(note.children[0].open,true,'refresh must not close a report being read');
  assert.deepEqual(reads,['/dashboard-api/map/config']);
});

test('communication errors, missing values, failed reads and blank displays never confirm changes',()=>{
  for(const changes of [{status:'COMMUNICATION_ERROR',communicationStatus:'error'},{status:'FETCH_FAILED'},
    {reportedLimitMph:null},{reportedLimitMph:0},{displayStatus:'off'},{fetchedAt:null}]) {
    const summary=variableSpeedSigns.summary(vslSnapshot([vslSign(changes)]),true,vslNow);
    assert.equal(summary.changed.length,0);assert.equal(summary.unavailable.length,1);
  }
  assert.equal(variableSpeedSigns.summary(vslSnapshot([vslSign()]),false,vslNow).changed.length,0);
});

test('paired signs are grouped while disagreements and companion errors remain visible',()=>{
  const second=vslSign({id:'second',mileMarker:234.55,status:'COMMUNICATION_ERROR',communicationStatus:'error'});
  const summary=variableSpeedSigns.summary(vslSnapshot([vslSign(),second]),true,vslNow);
  assert.equal(summary.locations.length,1);assert.equal(summary.changed.length,1);
  assert.equal(summary.locations[0].error,true);assert.equal(summary.locations[0].label,'45E !');
  const conflict=variableSpeedSigns.summary(vslSnapshot([vslSign(),vslSign({id:'second',reportedLimitMph:50})]),true,vslNow);
  assert.equal(conflict.locations[0].speed,null);assert.equal(conflict.locations[0].label,'—E !');
});

test('the variable sign layer rejects other routes, out-of-range locations and invalid points',()=>{
  assert.equal(variableSpeedSigns.summary({corridor:'I25',signs:[vslSign()]},true,vslNow).records.length,0);
  const summary=variableSpeedSigns.summary(vslSnapshot([vslSign({mileMarker:205}),vslSign({mileMarker:275}),
    vslSign({direction:'NORTH'}),vslSign({latitude:100}),vslSign({longitude:null})]),true,vslNow);
  assert.equal(summary.records.length,0);
});

test('a reported limit above the configured reference is still identified as different',()=>{
  const summary=variableSpeedSigns.summary(vslSnapshot([vslSign({reportedLimitMph:70})]),true,vslNow);
  assert.equal(summary.changed.length,1);assert.equal(summary.reduced.length,0);
});

test('Both Corridors and focused I-70 show changes without implying an I-25 change',()=>{
  const d=dashboard();const payload=vslSnapshot([vslSign({fetchedAt:new Date().toISOString()})]);
  d.context.vslPayload=payload;
  d.run("state.routeData.set('I70',{variableSpeedSigns:vslPayload,syncAvailability:{variableSpeedSigns:true}});renderVariableSpeedNotice()");
  assert.equal(d.nodes.get('variableLimitNotice').hidden,false);
  assert.match(d.nodes.get('variableLimitNotice').textContent,/I-70.*different from the regular reference/);
  assert.equal(d.nodes.get('i70VariableLimitBadge').hidden,false);
  d.run("applyCorridorFocus('I70',false)");assert.equal(d.nodes.get('variableLimitNotice').hidden,false);
  d.run("applyCorridorFocus('I25',false)");assert.equal(d.nodes.get('variableLimitNotice').hidden,true);
});

test('historical chart windows cannot display current variable-limit reports',()=>{
  const d=dashboard();d.context.vslPayload=vslSnapshot([vslSign()]);
  d.run("state.routeData.set('I70',{variableSpeedSigns:vslPayload});chartHistory.endTime=Date.now()-3600000;renderVariableSpeedNotice()");
  assert.equal(d.run('currentVariableSpeedSigns()'),null);
  assert.equal(d.nodes.get('variableLimitNotice').hidden,true);
});

test('a known paired limit omits failed companion signs and retains its successful timestamps without provider reads',async()=>{
  const instances=[],markers=[],popups=[],reads=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,popups,markers));
  d.context.window.fetch=async path=>{reads.push(path);return {ok:true,json:async()=>({})};};
  const feature={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}};
  const sign=vslSign({fetchedAt:new Date().toISOString(),status:'COMMUNICATION_ERROR',communicationStatus:'error',sourceUpdatedAt:null});
  const available={...sign,id:'available-companion',status:'AVAILABLE',communicationStatus:'operational'};
  await d.context.window.CorridorMapPanel.render({corridor:'I70',corridorFeature:feature,variableSpeedSigns:vslSnapshot([available,sign])});
  const marker=markers.find(marker=>marker.element.className.includes('corridor-variable-speed-sign'));
  assert.doesNotMatch(marker.element.className,/is-error|is-unavailable/);
  assert.deepEqual(marker.element.children.map(child=>child.textContent),['45','E→']);
  marker.element.events.click({stopPropagation(){}});
  const text=popups.at(-1).content.children.map(child=>child.textContent).join(' ');
  assert.match(text,/eastbound/);assert.doesNotMatch(text,/Communication error|unconfirmed|Last reported/);
  assert.match(text,/Source update: unavailable/);assert.match(text,/Last successful read:/);assert.doesNotMatch(text,/1969|1970/);
  assert.deepEqual(reads,['/dashboard-api/map/config']);
  await d.context.window.CorridorMapPanel.render({corridor:'I25',corridorFeature:feature,variableSpeedSigns:vslSnapshot([sign])});
  assert.equal(marker.removed,true);assert.equal(d.nodes.get('variableLimitLegend').hidden,true);
});

test('unavailable limits remove map badges at every zoom and recovery restores the numeric label',async()=>{
  const instances=[],markers=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  const feature={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}};
  const instant=new Date().toISOString();
  const available=vslSign({fetchedAt:instant});
  const render=signs=>d.context.window.CorridorMapPanel.render({corridor:'I70',corridorFeature:feature,
    variableSpeedSigns:vslSnapshot(signs)});
  const active=()=>markers.filter(marker=>!marker.removed&&marker.element.className.includes('corridor-variable-speed-sign'));
  for(const changes of [{status:'UNAVAILABLE'},{status:'NOT_OBSERVED'},{status:'COMMUNICATION_ERROR',communicationStatus:'error'},
    {status:'FETCH_FAILED'},{status:'STALE'},{reportedLimitMph:null},{displayStatus:'off'},
    {fetchedAt:new Date(Date.now()-3_600_001).toISOString()}]) {
    await render([available]);assert.equal(active().length,1);
    await render([{...available,...changes}]);assert.equal(active().length,0);
    instances[0].zoom=12;instances[0].listeners.get('zoom')();assert.equal(active().length,0);
  }
  for (const speed of [50,65]) {
    await render([available,{...available,id:'disagreeing-companion',reportedLimitMph:speed}]);
    assert.equal(active().length,0,'a regular companion cannot be discarded to conceal conflicting reports');
  }
  await render([available]);assert.equal(active().length,1);
  assert.deepEqual(active()[0].element.children.map(child=>child.textContent),['45','E→']);
});

test('unchanged sign reports reuse their markers and missing route geometry clears them',async()=>{
  const instances=[],markers=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  const feature={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}};
  const payload={corridor:'I70',corridorFeature:feature,variableSpeedSigns:vslSnapshot([vslSign({fetchedAt:new Date().toISOString()})])};
  await d.context.window.CorridorMapPanel.render(payload);const count=markers.length;
  await d.context.window.CorridorMapPanel.render(payload);assert.equal(markers.length,count);
  await d.context.window.CorridorMapPanel.render({...payload,corridorFeature:null});
  assert.ok(markers.filter(marker=>marker.element.className.includes('corridor-variable-speed-sign')).every(marker=>marker.removed));
});

test('only changed directional limits are present even when nearby and distant regular signs exist',async()=>{
  const instances=[],markers=[],reads=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  d.context.window.fetch=async path=>{reads.push(path);return {ok:true,json:async()=>({})};};
  const feature={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}};
  const instant=new Date().toISOString();
  await d.context.window.CorridorMapPanel.render({corridor:'I70',corridorFeature:feature,
    variableSpeedSigns:vslSnapshot([vslSign({fetchedAt:instant}),
      vslSign({id:'west',direction:'WEST',mileMarker:235,reportedLimitMph:65,fetchedAt:instant}),
      vslSign({id:'distant-west',direction:'WEST',mileMarker:250,reportedLimitMph:65,fetchedAt:instant})])});
  const signs=markers.filter(marker=>marker.element.className.includes('corridor-variable-speed-sign'));
  assert.equal(signs.length,1);assert.equal(signs[0].element.hidden,false);
  assert.deepEqual(signs[0].element.children.map(child=>child.textContent),['45','E→']);
  assert.ok(signs[0].options.offset[1]<0);
  instances[0].zoom=11;instances[0].listeners.get('zoom')();
  assert.equal(signs.length,1);
  assert.deepEqual(reads,['/dashboard-api/map/config']);
});

test('equal or unconfirmed opposite reports do not establish a directional difference',async()=>{
  for(const opposite of [{reportedLimitMph:65},{reportedLimitMph:45,status:'FETCH_FAILED'}]) {
    const instances=[],markers=[];
    const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
    const feature={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}};
    const instant=new Date().toISOString();
    await d.context.window.CorridorMapPanel.render({corridor:'I70',corridorFeature:feature,
      variableSpeedSigns:vslSnapshot([vslSign({reportedLimitMph:65,fetchedAt:instant}),
        vslSign({id:'west',direction:'WEST',fetchedAt:instant,...opposite})])});
    const signs=markers.filter(marker=>marker.element.className.includes('corridor-variable-speed-sign'));
    assert.equal(signs.length,0);
  }
});

test('I-70 keeps a number for each configured segment with changed, unavailable or historical sign data',async()=>{
  const instances=[],markers=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  const feature={type:'Feature',properties:{startMileMarker:230,endMileMarker:240,speedLimitSegments:[
    {startMileMarker:230,endMileMarker:236,speedLimitMph:65},
    {startMileMarker:236,endMileMarker:238,speedLimitMph:60},
    {startMileMarker:238,endMileMarker:240,speedLimitMph:60}]},
    geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}};
  const payload={corridor:'I70',corridorFeature:feature,variableSpeedSigns:vslSnapshot([vslSign({fetchedAt:new Date().toISOString()})])};
  await d.context.window.CorridorMapPanel.render(payload);
  const references=markers.filter(marker=>marker.element.className.includes('corridor-speed-reference'));
  assert.equal(references.length,3);
  assert.deepEqual(references.map(marker=>marker.element.children[0].textContent),['65','60','60']);
  assert.ok(references.every(marker=>!marker.element.hidden));
  await d.context.window.CorridorMapPanel.render({...payload,
    variableSpeedSigns:vslSnapshot([vslSign({status:'FETCH_FAILED'})])});
  assert.ok(references.every(marker=>!marker.element.hidden));
  await d.context.window.CorridorMapPanel.render({...payload,variableSpeedSigns:null});
  assert.ok(references.every(marker=>!marker.element.hidden));
  d.context.window.CorridorMapPanel.hide();
  assert.ok(references.every(marker=>marker.removed));
});

test('speed labels stay within both map edges without moving their source locations',async()=>{
  const instances=[],markers=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  const feature={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}};
  const instant=new Date().toISOString();
  await d.context.window.CorridorMapPanel.render({corridor:'I70',corridorFeature:feature,
    variableSpeedSigns:vslSnapshot([vslSign({fetchedAt:instant}),
      vslSign({id:'west',direction:'WEST',reportedLimitMph:55,fetchedAt:instant})])});
  const canvas=d.nodes.get('corridorMap'),map=instances[0];
  canvas.clientWidth=320;canvas.clientHeight=200;map.zoom=12;
  const signs=markers.filter(marker=>marker.element.className.includes('corridor-variable-speed-sign'));
  const coordinates=signs.map(marker=>Array.from(marker.coordinates));
  map.project=location=>location===signs[0].coordinates?{x:2,y:80}:{x:318,y:120};
  map.listeners.get('resize')();
  assert.ok(2+signs[0].options.offset[0]-27>=8);
  assert.ok(318+signs[1].options.offset[0]+27<=312);
  assert.ok(signs[0].options.offset[1]<0&&signs[1].options.offset[1]>0);
  assert.deepEqual(signs.map(marker=>Array.from(marker.coordinates)),coordinates);
  assert.equal(parseFloat(markers.find(m=>m.element.className.includes('corridor-speed-connector')).element.style['--sign-cross-offset']),signs[0].options.offset[0]);
  map.project=()=>({x:-20,y:80});map.listeners.get('moveend')();
  assert.ok(signs.every(marker=>marker.element.style.visibility==='hidden'));
  map.project=()=>({x:160,y:80});map.listeners.get('moveend')();
  assert.ok(signs.every(marker=>marker.element.style.visibility===''));
});

test('entering and leaving historical navigation updates variable-limit context only at its boundary',()=>{
  const d=dashboard();let renders=0;d.context.countVslRender=()=>renders++;
  d.run('renderFocusedCorridorMap=()=>countVslRender();chartHistory.endTime=Date.now()-3600000;updateHistoryControls()');
  assert.equal(renders,1);
  d.run('chartHistory.endTime-=1000;updateHistoryControls();updateHistoryControls()');assert.equal(renders,1);
  d.run('chartHistory.endTime=null;updateHistoryControls()');assert.equal(renders,2);
});

test('full dashboard startup can initialize the variable-limit history hook before the first snapshot',async()=>{
  const d=dashboard(undefined,'?corridor=I70','/dashboard/',undefined,undefined,'America/Denver',true);
  await d.context.window.startupTest;
  assert.equal(d.run('state.focusedCorridor'),'I70');
  assert.equal(d.run('state.variableSpeedHistoricalView'),false);
  assert.equal(d.run('state.refreshTimer'),1);
});

test('saved-limit demo freezes only sign freshness and adds one sign section to the existing traffic batch',async()=>{
  const capture='2026-10-14T23:06:57Z';
  const saved={corridor:'I70',generatedAt:capture,signs:[{id:'saved',mileMarker:234.5,direction:'EAST',longitude:-105.61,latitude:39.75,
    reportedLimitMph:45,regularLimitMph:65,status:'AVAILABLE',displayStatus:'on',communicationStatus:'operational',fetchedAt:capture}]};
  const {window,calls}=variableLimitDemoHarness(capture,saved);
  const path='/dashboard-experimental-api/traffic/dashboard/snapshot?ranges=24&historical=false';
  const sections=await (await window.fetch(path)).json();
  assert.equal(sections.traffic.data.speed,54);
  assert.deepEqual(sections['/traffic/map/variable-speed-limits/current?corridor=I70'].data,saved);
  assert.equal(window.VariableSpeedSigns.summary(saved).available.length,1);
  assert.equal(window.VariableSpeedSigns.summary(saved).changed.length,1);
  await window.fetch(path);
  assert.equal(calls.filter(value=>value==='variable-limit-snapshot.json').length,1);
  assert.ok(calls.every(value=>!String(value).includes('cotrip')));
  const historical=await (await window.fetch(path.replace('false','true'))).json();
  assert.equal(Object.keys(historical).length,1);
});

test('missing saved-limit data degrades only that section and ordinary pages never activate the demo',async()=>{
  const capture='2026-10-14T23:06:57Z';
  const {window}=variableLimitDemoHarness(capture,null,404);
  const sections=await (await window.fetch('/dashboard-experimental-api/traffic/dashboard/snapshot?ranges=24')).json();
  assert.equal(sections.traffic.data.speed,54);
  assert.equal(sections['/traffic/map/variable-speed-limits/current?corridor=I70'].status,503);
  const ordinary=variableLimitDemoHarness(null,null);
  assert.equal(ordinary.window.fetch,ordinary.nativeFetch);
  assert.equal(ordinary.calls.length,0);
});

test('demo export excludes private fields, rejects untracked signs, and preserves existing previews',t=>{
  const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
  const {execFileSync}=require('node:child_process');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctt-sign-demo-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source'), staticDir=path.join(source,'api-service/src/main/resources/static/dashboard');
  fs.mkdirSync(staticDir,{recursive:true});
  const catalogDir=path.join(source,'common/src/main/resources');fs.mkdirSync(catalogDir,{recursive:true});
  const device={id:'OpenTMS-Sign1',mileMarker:230,direction:'EAST',longitude:-105.6,latitude:39.7,location:'Public sign location'};
  fs.writeFileSync(path.join(catalogDir,'i70-variable-speed-signs.json'),JSON.stringify([device]));
  fs.writeFileSync(path.join(staticDir,'index.html'),'<html lang="en"><head></head><body><main></main><script src="variable-speed-signs.js?v=regular-sign-references-1"></script></body></html>');
  fs.writeFileSync(path.join(staticDir,'dashboard.js'),'I-70 current posted limits:');
  fs.writeFileSync(path.join(staticDir,'corridor-map.js'),'Current CDOT limits; CDOT-reported posted limit');
  const input=path.join(root,'input.json'),output=path.join(root,'export');
  const snapshot={corridor:'I70',provider:'CDOT',generatedAt:'2026-10-14T23:06:57Z',apiKey:'private-sentinel',
    signs:[{...device,status:'AVAILABLE',reportedLimitMph:45,regularLimitMph:65,unexpected:'private-sentinel'}]};
  fs.writeFileSync(input,JSON.stringify(snapshot));
  const run=()=>execFileSync('python3',['-B','scripts/prepare-variable-limit-demo.py','--source',source,'--snapshot',input,'--output',output],{stdio:'pipe'});
  run();
  const exported=fs.readFileSync(path.join(output,'dashboard/variable-limit-snapshot.json'),'utf8');
  assert.ok(!exported.includes('private-sentinel'));
  const page=fs.readFileSync(path.join(output,'dashboard/index.html'),'utf8');
  assert.ok(page.includes('Sign readings are frozen, not live'));
  assert.ok(page.includes('data-replay-enabled="false"'));
  assert.ok(page.includes('variable-limit-demo.js'));
  assert.throws(run,/existing previews are preserved/);
  assert.equal(fs.readFileSync(path.join(output,'dashboard/variable-limit-snapshot.json'),'utf8'),exported);
  snapshot.signs[0].id='OpenTMS-Sign999';fs.writeFileSync(input,JSON.stringify(snapshot));
  assert.throws(()=>execFileSync('python3',['-B','scripts/prepare-variable-limit-demo.py','--source',source,'--snapshot',input,'--output',path.join(root,'invalid')],{stdio:'pipe'}),/outside the reviewed catalog/);
  assert.ok(!fs.existsSync(path.join(root,'invalid')));
  const liveOutput=path.join(root,'live-export');
  execFileSync('python3',['-B','scripts/prepare-variable-limit-demo.py','--source',source,'--live','--output',liveOutput],{stdio:'pipe'});
  const livePage=fs.readFileSync(path.join(liveOutput,'dashboard/index.html'),'utf8');
  assert.ok(livePage.includes('data-variable-limit-demo-live="true"'));
  assert.ok(livePage.includes('Live CDOT variable speed limits'));
  assert.ok(!livePage.includes('Sign readings are frozen'));
  assert.ok(!fs.existsSync(path.join(liveOutput,'dashboard/variable-limit-snapshot.json')));
});

test('live-limit demo shares one database read across batches and keeps real freshness checks',async()=>{
  const now=new Date().toISOString();
  const saved={corridor:'I70',generatedAt:now,signs:[{id:'live',mileMarker:234.5,direction:'EAST',longitude:-105.61,latitude:39.75,
    reportedLimitMph:45,regularLimitMph:65,status:'AVAILABLE',displayStatus:'on',communicationStatus:'operational',fetchedAt:now}]};
  const {window,calls}=variableLimitDemoHarness(null,saved,200,true);
  const path='/dashboard-experimental-api/traffic/dashboard/snapshot?ranges=24&historical=false';
  const sections=await (await window.fetch(path)).json();
  await window.fetch(path.replace('24','2,6,168,720'));
  assert.equal(sections.traffic.data.speed,54);
  assert.deepEqual(sections['/traffic/map/variable-speed-limits/current?corridor=I70'].data,saved);
  assert.equal(calls.filter(value=>String(value).includes('/traffic/map/variable-speed-limits/current')).length,1);
  assert.ok(!calls.includes('variable-limit-snapshot.json'));
  assert.ok(!calls.some(value=>String(value).includes('cotrip')));
  assert.equal(window.VariableSpeedSigns.summary(saved).available.length,1);
  saved.signs[0].fetchedAt=new Date(Date.now()-3_601_000).toISOString();
  assert.equal(window.VariableSpeedSigns.summary(saved).available.length,0);
});

test('overview combines nearby speed reductions into an area and keeps distant reports separate',async()=>{
  const f=speedAreaFixture(),instant=new Date().toISOString();
  await f.render([vslSign({fetchedAt:instant}),
    vslSign({id:'second',mileMarker:235,longitude:-105.59,reportedLimitMph:50,fetchedAt:instant}),
    vslSign({id:'far',mileMarker:260,longitude:-105.2,fetchedAt:instant}),
    vslSign({id:'failed',mileMarker:235.5,longitude:-105.6,status:'COMMUNICATION_ERROR',communicationStatus:'error',fetchedAt:instant})]);
  assert.equal(f.areas().length,2);
  assert.ok(f.signs().every(m=>m.element.hidden));
  assert.ok(f.areas().every(m=>m.element.textContent==='Speed Limit Reduced'));
  const area=f.areas()[0];assert.match(area.element.attributes['aria-label'],/2 sign locations/);
  area.element.events.click({stopPropagation(){}});
  const text=popupText(f.popups.at(-1).content);
  assert.match(text,/Speed Limit Reduced.*Eastbound: 45–50 mph/);
  assert.match(text,/MM 234.5.*MM 235/);
  assert.match(text,/Source update:.*Last successful read:/);
  assert.match(text,/not a verified continuous restriction/);
  assert.doesNotMatch(text,/Communication error|MM 235.5/);
  assert.deepEqual(f.reads,['/dashboard-api/map/config']);
});

test('zoom and resize split or regroup overlapping signs without new data requests',async()=>{
  const f=speedAreaFixture(),instant=new Date().toISOString();
  await f.render([vslSign({fetchedAt:instant}),
    vslSign({id:'second',mileMarker:235,longitude:-105.59,fetchedAt:instant})]);
  assert.equal(f.areas().length,1);
  const map=f.instances[0];map.zoom=12;map.listeners.get('zoom')();
  assert.equal(f.areas().length,0);assert.ok(f.signs().every(m=>!m.element.hidden));
  map.project=()=>({x:160,y:180});map.listeners.get('resize')();
  assert.equal(f.areas().length,1);assert.ok(f.signs().every(m=>m.element.hidden));
  const count=f.markers.length;map.listeners.get('moveend')();assert.equal(f.markers.length,count);
  map.project=coordinates=>({x:coordinates[0]===-105.61?100:400,y:180});map.listeners.get('moveend')();
  assert.equal(f.areas().length,0);assert.ok(f.signs().every(m=>!m.element.hidden));
  assert.deepEqual(f.reads,['/dashboard-api/map/config']);
});

test('failed or historical sign data removes area markers and successful recovery restores them',async()=>{
  const f=speedAreaFixture(),instant=new Date().toISOString(),sign=vslSign({fetchedAt:instant});
  await f.render([sign]);assert.equal(f.areas().length,1);
  const first=f.areas()[0];first.element.events.click({stopPropagation(){}});
  await f.render([{...sign,status:'FETCH_FAILED'}]);assert.equal(f.areas().length,0);assert.equal(f.signs().length,0);
  assert.equal(f.popups[0].removed,true);
  await f.render([sign]);assert.equal(f.areas().length,1);
  await f.render(null);assert.equal(f.areas().length,0);
  await f.render([sign]);f.d.context.window.CorridorMapPanel.hide();assert.equal(f.areas().length,0);
});

test('an increase is labeled changed instead of reduced and regular reports do not create overview alerts',async()=>{
  const f=speedAreaFixture(),instant=new Date().toISOString();
  await f.render([vslSign({reportedLimitMph:70,fetchedAt:instant})]);
  assert.equal(f.areas()[0].element.textContent,'Speed Limits Changed');
  await f.render([vslSign({reportedLimitMph:65,fetchedAt:instant})]);
  assert.equal(f.areas().length,0);assert.equal(f.signs().length,0);
  f.instances[0].zoom=14;f.instances[0].listeners.get('zoom')();
  assert.equal(f.areas().length,0);assert.equal(f.signs().length,0);
});

test('directional speed labels clear crossing route segments even when their vertices lie outside the labels',async()=>{
  const instances=[],markers=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  const feature={type:'Feature',properties:{},geometry:{type:'LineString',
    coordinates:[[-106,39.7],[-105,39.7],[-105,39.8],[-106,39.8]]}};
  const instant=new Date().toISOString();
  await d.context.window.CorridorMapPanel.render({corridor:'I70',corridorFeature:feature,
    variableSpeedSigns:vslSnapshot([vslSign({fetchedAt:instant}),
      vslSign({id:'west',direction:'WEST',reportedLimitMph:55,fetchedAt:instant})])});
  const canvas=d.nodes.get('corridorMap'),map=instances[0];
  canvas.clientWidth=320;canvas.clientHeight=400;map.zoom=12;
  const signs=markers.filter(marker=>marker.element.className.includes('corridor-variable-speed-sign'));
  const sourcePoints=signs.map(marker=>Array.from(marker.coordinates));
  let crossing=true;
  map.project=coordinates=>signs.some(sign=>sign.coordinates===coordinates)?{x:150,y:200}
    : {x:coordinates[0]===-106?50:250,y:crossing?(coordinates[1]===39.7?170:230):200};
  map.listeners.get('moveend')();
  assert.ok(200+signs[0].options.offset[1]+13<=162,'eastbound clears the upper crossing by eight pixels');
  assert.ok(200+signs[1].options.offset[1]-13>=238,'westbound clears the lower crossing by eight pixels');
  assert.ok(signs.every(sign=>sign.element.style.visibility!== 'hidden'));
  const lifted=signs[0].options.offset[1],count=markers.length;
  crossing=false;map.listeners.get('resize')();
  assert.ok(signs[0].options.offset[1]>lifted,'labels return closer when the crossing moves away');
  assert.equal(markers.length,count);
  assert.deepEqual(signs.map(sign=>Array.from(sign.coordinates)),sourcePoints);
});

test('I-25 reference labels clear the vertical route while staying inside the map',async()=>{
  const instances=[],markers=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  const feature={type:'Feature',properties:{startMileMarker:220,endMileMarker:230,
    speedLimitSegments:[{startMileMarker:220,endMileMarker:230,speedLimitMph:65}]},
    geometry:{type:'LineString',coordinates:[[-106,39.7],[-105,39.8]]}};
  await d.context.window.CorridorMapPanel.render({corridor:'I25',corridorFeature:feature});
  const sign=markers.find(marker=>marker.element.className.includes('corridor-speed-reference'));
  const canvas=d.nodes.get('corridorMap'),map=instances[0];
  canvas.clientWidth=400;canvas.clientHeight=400;
  map.project=coordinates=>coordinates===sign.coordinates?{x:150,y:200}
    : {x:190,y:coordinates[0]===-106?80:320};
  map.listeners.get('moveend')();
  assert.ok(150+sign.options.offset[0]-20>=198,'the reference clears the road casing');
  assert.ok(150+sign.options.offset[0]+20<=392);
  assert.equal(sign.options.offset[1],0);
  assert.equal(sign.element.style.visibility,'');
});

test('reduced-limit areas avoid incident circles and retain independently layered connectors',async()=>{
  const f=speedAreaFixture(),sign=vslSign({fetchedAt:new Date().toISOString()});
  await f.render([sign]);const map=f.instances[0],plainOffset=f.areas()[0].options.offset[1];
  map.project=coordinates=>({x:100+(coordinates[0]+105.61)*1000,y:coordinates[1]===39.7?180+plainOffset:180});
  await f.render([sign],{incidentFeatures:[{type:'Feature',properties:{corridor:'I70',mileMarker:234.5},
    geometry:{type:'Point',coordinates:[-105.605,39.7]}}]});
  map.listeners.get('moveend')();
  const area=f.areas()[0],connector=f.markers.find(m=>!m.removed&&m.element.className.includes('is-area'));
  assert.ok(area.options.offset[1]<0,'the area changes sides when its preferred side is occupied');
  assert.ok(180+area.options.offset[1]+16<180+plainOffset-16,'the area clears the incident circle');
  assert.deepEqual(connector.options.offset,area.options.offset);
  assert.equal(connector.element.attributes['aria-hidden'],'true');
  await f.render([sign]);map.listeners.get('moveend')();assert.equal(f.areas()[0].options.offset[1],plainOffset);
  f.d.context.window.CorridorMapPanel.hide();
  assert.ok(f.markers.every(m=>m.removed));
  assert.deepEqual(f.reads,['/dashboard-api/map/config']);
});

test('changed sign labels avoid visible mile markers at detail zoom',async()=>{
  const f=speedAreaFixture(),sign=vslSign({fetchedAt:new Date().toISOString()});
  const feature={type:'Feature',properties:{startMileMarker:234,endMileMarker:236},
    geometry:{type:'LineString',coordinates:[[-105.62,39.6],[-105.58,39.8]]}};
  await f.render([sign],{corridorFeature:feature});const map=f.instances[0];
  map.zoom=12;map.project=coordinates=>({x:coordinates===f.signs()[0].coordinates?160:170,y:coordinates===f.signs()[0].coordinates?180:154});
  map.listeners.get('zoom')();
  const reported=f.signs()[0];
  assert.ok(reported.options.offset[1]<-23);
  assert.ok(180+reported.options.offset[1]+13<154-12,'the changed sign clears the mile marker');
});

test('segment numbers have priority and changed-limit panels extend above or below without covering them',async()=>{
  const f=speedAreaFixture(),sign=vslSign({fetchedAt:new Date().toISOString()});
  const feature={type:'Feature',properties:{startMileMarker:230,endMileMarker:240,speedLimitSegments:[
    {startMileMarker:230,endMileMarker:235,speedLimitMph:65},
    {startMileMarker:235,endMileMarker:240,speedLimitMph:65}]},
    geometry:{type:'LineString',coordinates:[[-105.7,39.6],[-105.5,39.8]]}};
  await f.render([sign],{corridorFeature:feature});
  const map=f.instances[0];map.project=()=>({x:180,y:180});map.listeners.get('moveend')();
  const references=f.markers.filter(m=>!m.removed&&m.element.className.includes('corridor-speed-reference'));
  assert.equal(references.length,2,'adjacent segments keep separate numbers even when speeds match');
  assert.ok(references.every(m=>!m.element.hidden&&m.element.style.visibility===''));
  const offsets=references.map(m=>m.options.offset[1]);
  const area=f.areas()[0];
  assert.equal(area.element.style.visibility,'');
  assert.ok(area.options.offset[1]>=40&&area.options.offset[1]<64,'the summary stays closer below the road and numeric labels');
  assert.match(area.element.className,/is-below/);
  const connector=f.markers.find(m=>!m.removed&&m.element.className.includes('is-area'));
  assert.match(connector.element.className,/is-below/);
  assert.deepEqual(connector.options.offset,area.options.offset);
  area.element.events.click({stopPropagation(){}});
  assert.equal(f.popups.at(-1).options.anchor,'top');
  assert.ok(f.popups.at(-1).options.offset[1]>area.options.offset[1], 'details open outward from the summary');
  map.project=()=>({x:180,y:340});map.listeners.get('moveend')();
  assert.deepEqual(references.map(m=>m.options.offset[1]),offsets,'the panel never displaces segment numbers');
  assert.ok(area.options.offset[1]<-40,'the summary extends upward near the bottom map edge');
  assert.match(area.element.className,/is-above/);
  assert.match(connector.element.className,/is-above/);
  area.element.events.click({stopPropagation(){}});
  assert.equal(f.popups.at(-1).options.anchor,'bottom');
  assert.ok(f.popups.at(-1).options.offset[1]<area.options.offset[1]);
  for(const reference of references) assert.ok(Math.abs(area.options.offset[1]-reference.options.offset[1])>=36);
  assert.deepEqual(f.reads,['/dashboard-api/map/config']);
});

test('small incident dots allow closer labels while larger hotspot markers retain their clearance',async()=>{
  const f=speedAreaFixture(),sign=vslSign({fetchedAt:new Date().toISOString()});
  await f.render([sign]);const map=f.instances[0];
  map.project=coordinates=>({x:100+(coordinates[0]+105.61)*1000,y:coordinates[1]===39.7?188:180});
  const incident={type:'Feature',properties:{corridor:'I70',mileMarker:234.5},geometry:{type:'Point',coordinates:[-105.61,39.7]}};
  await f.render([sign],{incidentFeatures:[incident]});map.listeners.get('moveend')();
  const close=f.areas()[0].options.offset[1];
  assert.equal(close,40,'a small dot does not require the old full-size marker exclusion');
  await f.render([sign],{incidentFeatures:[{...incident,properties:{...incident.properties,isHotspot:true,incidentCount:20}}]});
  map.listeners.get('moveend')();
  assert.ok(f.areas()[0].options.offset[1]<0,'the larger hotspot still forces the panel to a clear position');
  await f.render([sign],{incidentFeatures:[incident]});map.listeners.get('moveend')();
  assert.equal(f.areas()[0].options.offset[1],close,'the label returns closer when the large obstacle is gone');
  assert.deepEqual(f.reads,['/dashboard-api/map/config']);
});

test('the reviewed westbound237 paired-site default clears the persistent alert but still detects future reductions',()=>{
  const devices=[{id:'OpenTMS-Sign465279',mileMarker:237},{id:'OpenTMS-Sign465294',mileMarker:237.05}];
  const reports=speed=>devices.map(device=>vslSign({...device,direction:'WEST',reportedLimitMph:speed,regularLimitMph:60}));
  const normal=variableSpeedSigns.summary(vslSnapshot(reports(65)),true,vslNow);
  assert.equal(normal.available.length,2);assert.equal(normal.changed.length,0);
  assert.ok(normal.records.every(sign=>sign.regularLimitMph===65&&sign.roadReferenceMph===60&&sign.referenceSource==='cdot-inventory'));
  for(const speed of [60,55,45]) {
    const reduced=variableSpeedSigns.summary(vslSnapshot(reports(speed)),true,vslNow);
    assert.equal(reduced.changed.length,1);assert.equal(reduced.reduced.length,1);
  }
  const increased=variableSpeedSigns.summary(vslSnapshot(reports(70)),true,vslNow);
  assert.equal(increased.changed.length,1);assert.equal(increased.reduced.length,0);
  const future=vslNow+7*86400000;
  const prolonged=variableSpeedSigns.summary(vslSnapshot(reports(45).map(sign=>({...sign,fetchedAt:new Date(future).toISOString()}))),true,future);
  assert.equal(prolonged.reduced.length,1,'a long-lived reduced limit never becomes normal merely through elapsed time');
  for(const change of [{direction:'EAST'},{id:'other-site'},{mileMarker:238}]) {
    const unreviewed=variableSpeedSigns.summary(vslSnapshot([{...reports(65)[0],...change}]),true,vslNow);
    assert.equal(unreviewed.changed.length,1,'the reviewed default cannot spread to another direction or location');
    assert.equal(unreviewed.records[0].regularLimitMph,60);
  }
});

test('the reviewed default clears Both/I70 notices and map alerts; a later60mph reading restores them',async()=>{
  const sign=vslSign({id:'OpenTMS-Sign465279',direction:'WEST',mileMarker:237,regularLimitMph:60,reportedLimitMph:65,fetchedAt:new Date().toISOString()});
  const d=dashboard();d.context.vslPayload=vslSnapshot([sign]);
  d.run("state.routeData.set('I70',{variableSpeedSigns:vslPayload,syncAvailability:{variableSpeedSigns:true}});renderVariableSpeedNotice()");
  assert.equal(d.nodes.get('variableLimitNotice').hidden,true);assert.equal(d.nodes.get('i70VariableLimitBadge').hidden,true);
  d.run("applyCorridorFocus('I70',false)");assert.equal(d.nodes.get('variableLimitNotice').hidden,true);
  const f=speedAreaFixture();await f.render([sign]);assert.equal(f.areas().length,0);assert.equal(f.signs().length,0);
  const reduced={...sign,reportedLimitMph:60};d.context.vslPayload=vslSnapshot([reduced]);
  d.run("state.routeData.set('I70',{variableSpeedSigns:vslPayload,syncAvailability:{variableSpeedSigns:true}});renderVariableSpeedNotice()");
  assert.equal(d.nodes.get('variableLimitNotice').hidden,false);assert.equal(d.nodes.get('i70VariableLimitBadge').hidden,false);
  await f.render([reduced]);assert.equal(f.areas().length,1);assert.equal(f.areas()[0].element.textContent,'Speed Limit Reduced');
  f.areas()[0].element.events.click({stopPropagation(){}});
  assert.match(popupText(f.popups.at(-1).content),/Regular sign reference:65 mph|Regular sign reference: 65 mph/);
  assert.match(popupText(f.popups.at(-1).content),/Configured combined-direction segment reference: 60 mph/);
  await f.render([{...reduced,status:'FETCH_FAILED'}]);assert.equal(f.areas().length,0);
  assert.deepEqual(f.reads,['/dashboard-api/map/config']);
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

test('coupled dashboard scripts invalidate old caches and precede coordinator startup', () => {
  const scripts = [...indexSource.matchAll(/<script src="([^"?]+)\?v=([^"]+)"[^>]*>/g)]
    .map(([, name, version]) => ({name, version}));
  const coordinator = scripts.findIndex(script => script.name === 'dashboard.js');
  assert.ok(coordinator >= 0);
  assert.notEqual(scripts[coordinator].version, 'shared-zone-estimates-1');
  assert.notEqual(scripts.find(script => script.name === 'dashboard-history.js').version, 'historical-window-summaries-2');
  assert.notEqual(scripts.find(script => script.name === 'dashboard-continuous.js').version, 'chart-compact-spacing-1');
  for (const name of ['dashboard-snapshots.js', 'dashboard-transport.js']) {
    const dependency = scripts.findIndex(script => script.name === name);
    if (dependency >= 0) assert.ok(dependency < coordinator, `${name} must load before initialization`);
  }
});

test('chart gaps preserve the ninety-minute boundary and invalid-point breaks', () => {
  const d = dashboard();
  d.context.points = [
    {timestamp: 0, verticalPosition: 10},
    {timestamp: 90 * 60_000, verticalPosition: 20},
    {timestamp: 180 * 60_000 + 1, verticalPosition: 30},
    {timestamp: 190 * 60_000, verticalPosition: NaN},
    {timestamp: 200 * 60_000, verticalPosition: 40},
    {timestamp: 210 * 60_000, verticalPosition: Infinity}
  ];
  assert.deepEqual(JSON.parse(d.run('JSON.stringify(chartSegments(points).map(segment => segment.map(point => point.timestamp)))')),
    [[0, 90 * 60_000], [180 * 60_000 + 1], [200 * 60_000]]);
  assert.deepEqual(JSON.parse(d.run("JSON.stringify(chartSeries.splitSpeedSeries(points).map(segment => segment.map(point => point.timestamp)))")),
    [[0, 90 * 60_000], [180 * 60_000 + 1, 190 * 60_000, 200 * 60_000, 210 * 60_000]]);
  assert.equal(d.run('chartSegments([{timestamp: 1, verticalPosition: NaN}]).length'), 0);
  assert.equal(d.run("chartSeries.splitSpeedSeries([]).length"), 0);
});
