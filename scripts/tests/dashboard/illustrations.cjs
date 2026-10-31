const { test } = require('node:test');
const { assert, informationStyles, indexSource, informationSource, informationPages } = require('../fixtures/core.cjs');
const { motionServerTest, motionDiagnostic, motionProbeTest, dataHero, informationPage, connectorFixture, verificationFixture } = require('../fixtures/information.cjs');
const { roadSignFixture } = require('../fixtures/maps.cjs');

test('motion diagnostics reject writes, traversal and non-dashboard files before fixture reads', async t => {
  let reads=0;
  const request=await motionServerTest(t,()=>{reads++;throw new Error('Unexpected fixture read');});
  for(const route of ['/dashboard-api/traffic/latest','/dashboard/system.html','/_motion/probe.js']) {
    assert.equal((await request(route,{method:'POST'})).status,405);
  }
  for(const route of ['/README.md','/dashboard/%2e%2e%2fREADME.md','/dashboard/.env','/dashboard/%ZZ']) {
    assert.ok([400,403].includes((await request(route)).status));
  }
  assert.equal(reads,0);
});

test('motion comparisons serve complete pinned source pages and matching source assets', async t => {
  const sourceReads=[];
  const originalPage=sha=>`<!doctype html><body><main>${sha}</main><script src="information-pages.js"></script></body>`;
  const originalStyle=sha=>`.source-${sha}{color:gold}`;
  const request=await motionServerTest(t,undefined,(sha,relative)=>{
    sourceReads.push([sha,relative]);
    return relative.endsWith('.html')?originalPage(sha):originalStyle(sha);
  });
  for(const [variant,sha]of Object.entries(motionDiagnostic.revisions)) {
    assert.match(sha,/^[a-f0-9]{40}$/);
    const page=await request(`/dashboard/system.html?motionRevision=${variant}`);
    assert.equal(page.status,200);
    assert.match(page.headers.get('set-cookie'),new RegExp('motionRevision='+variant));
    assert.equal(page.body.replace('<script src="/_motion/probe.js"></script>',''),originalPage(sha));
    const style=await request('/dashboard/information.css',{headers:{cookie:'motionRevision='+variant}});
    assert.equal(style.body,originalStyle(sha));
    assert.equal(style.headers.get('cache-control'),'no-store');
  }
  assert.equal((await request('/dashboard/system.html?motionRevision=main')).headers.get('set-cookie'),
    'motionRevision=current; Path=/; SameSite=Strict');
  assert.deepEqual(sourceReads,Object.values(motionDiagnostic.revisions)
    .flatMap(sha=>[[sha,'dashboard/system.html'],[sha,'dashboard/information.css']]));
});

test('missing comparison trees fail explicitly rather than substituting current assets',async t=>{
  const request=await motionServerTest(t,undefined,()=>{throw new Error('Missing comparison tree');});
  assert.equal((await request('/dashboard/system.html?motionRevision=original')).status,404);
  assert.equal((await request('/dashboard/information.css',{headers:{cookie:'motionRevision=stripped'}})).status,404);
  assert.equal((await request('/dashboard/system.html?motionRevision=current')).status,200);
});

test('motion diagnostics proxy only the owned provider-free fixture with a bounded deadline', async t => {
  let options,deadline,destroyed=false;
  const request=await motionServerTest(t,(opts,callback)=>{
    options=opts;
    const upstream=new(require('node:events').EventEmitter)();
    upstream.setTimeout=(ms,callback)=>{deadline={ms,callback};};
    upstream.destroy=()=>{destroyed=true;};
    queueMicrotask(()=>{
      const source=new(require('node:stream').PassThrough)();
      source.statusCode=200;source.headers={'content-type':'application/json'};
      callback(source);source.end('{"fixture":true}');
    });
    return upstream;
  });
  const result=await request('/dashboard-experimental-api/traffic/latest?corridor=I70');
  assert.equal(result.status,200);assert.equal(result.body,'{"fixture":true}');
  assert.equal(options.hostname,'127.0.0.1');assert.equal(options.port,8091);
  assert.equal(options.path,'/dashboard-experimental-api/traffic/latest?corridor=I70');
  assert.match(options.headers.referer,/fixture=live$/);assert.equal(deadline.ms,8000);
  assert.equal(destroyed,false);deadline.callback();assert.equal(destroyed,true);
});

test('eight-second motion sampling restores instrumentation and reports unsupported long tasks as unknown',async()=>{
  const probe=motionProbeTest(),{completion}=await probe.start();
  for(let i=0;i<481;i++)probe.tick();
  await completion;probe.clean();
  const result=JSON.parse(probe.output.textContent);
  assert.ok(result.sampleMs>=8000&&result.sampleMs<8020);
  assert.ok(result.frames>=478);assert.equal(result.longTasks,null);assert.equal(result.longTaskMs,null);
  assert.equal(result.mapPaintCalls,0);assert.equal(result.visualStart.runningAnimations,1);
  assert.deepEqual(result.viewport,{width:1093,height:827,dpr:2});
});

test('hidden tabs abort motion sampling and release every instrument and scheduled frame',async()=>{
  const probe=motionProbeTest(),{completion}=await probe.start();
  for(let i=0;i<20;i++)probe.tick();
  probe.document.hidden=true;probe.events.get('visibilitychange')();
  await completion;probe.clean();
  assert.match(JSON.parse(probe.output.textContent).aborted,/Tab hidden/);
});

test('stalled frame sampling has a finite deadline and restores all instrumentation',async()=>{
  const probe=motionProbeTest(),{completion}=await probe.start();
  probe.fireTimer(9000);await completion;probe.clean();
  assert.match(JSON.parse(probe.output.textContent).aborted,/9-second deadline/);
});

test('bounded pace failures preserve the other corridor, geometry and the next refresh',async()=>{
  const controllers=[];
  const hero=dataHero({paceFetch(url,options){
    if(!url.includes('corridor=I70'))return undefined;
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  }});
  hero.context.AbortSignal={any:AbortSignal.any,timeout(ms){
    assert.equal(ms,8000);const controller=new AbortController();controllers.push(controller);return controller.signal;
  }};
  await hero.settle();assert.equal(controllers.length,4);
  assert.equal(hero.labels.i25MapPace.textContent,'63 min');
  controllers[2].abort();controllers[3].abort();await hero.settle();
  assert.equal(hero.labels.i70MapPace.textContent,'pace unavailable');
  assert.match(hero.status.textContent,/2 corridors/);assert.equal(hero.state.removed,0);
  assert.equal(hero.timers.size,1);assert.equal(hero.state.overlays[0].animations.at(-1).playState,'running');
  hero.events.pagehide({persisted:false});
});

test('duplicate corridor features cannot create extra pulse layers or repeated pace reads',async()=>{
  const feature={id:'I25',properties:{startMileMarker:208,endMileMarker:271},
    geometry:{type:'LineString',coordinates:[[-105,39],[-105,40]]}};
  const hero=dataHero({features:[feature,feature]});await hero.settle();
  assert.equal(hero.state.overlays.length,1);
  assert.equal(hero.state.reads.filter(r=>r.url.includes('/summary?')).length,1);
  assert.equal(hero.state.reads.filter(r=>r.url.includes('/flow-cells/current?')).length,1);
  assert.match(informationStyles,/\.data-hero-map-pulse\s*\{[^}]*width: 10px[^}]*height: 10px/s);
  assert.match(informationStyles,/\.data-hero-map-bar,\s*\.data-hero-map-legend\s*\{[^}]*position: relative[^}]*display: flex/s);
  assert.match(informationStyles,/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.data-hero-map-pulse\s*\{ visibility: hidden;/);
});

test('map pulses cross each corridor in one second per rounded travel minute and return on the same path',async()=>{
  const hero=dataHero();await hero.settle();hero.flushFrames();
  assert.deepEqual(hero.state.overlays.map(p=>p.dataset.travelSeconds),['63','68']);
  assert.equal(hero.labels.i25MapPace.textContent,'63 min');
  for(const [i,pulse]of hero.state.overlays.entries()){
    const animation=pulse.animations.at(-1),frames=animation.keyframes;
    assert.equal(animation.options.duration,2000);assert.equal(animation.options.iterations,Infinity);
    assert.equal(animation.playbackRate,1/[63,68][i]);assert.equal(animation.playState,'running');
    assert.equal(frames[0].offset,0);assert.equal(frames.at(-1).offset,1);
    assert.equal(frames[0].transform,frames.at(-1).transform);
    assert.equal(frames.filter(frame=>frame.offset===0.5).length,2);
  }
  const projected=hero.state.projected,paint=hero.state.paint.length;
  hero.fireTimer();await hero.settle();
  assert.equal(hero.state.projected,projected);assert.equal(hero.state.paint.length,paint);
  assert.equal(hero.frames.size,0);assert.equal(hero.state.overlays[0].animations.length,1);
});

test('pace labels use complete cell observation time rather than a stale summary timestamp',async()=>{
  const old='2026-10-05T17:00:00Z';
  const hero=dataHero({summaries:{I25:{latest:{avgCurrentSpeed:120,polledAt:old}}}});
  await hero.settle();
  assert.equal(hero.labels.i25MapPace.textContent,'63 min');
  assert.match(hero.labels.i25MapPace.title,/current estimate observed 2026-10-07T16:59:00/);
  const stale=dataHero({snapshots:{I25:{observedAt:old,cells:[{startMileMarker:208,endMileMarker:271,speedMph:1}]}},
    summaries:{I25:{latest:{avgCurrentSpeed:60,polledAt:old}}}});
  await stale.settle();
  assert.equal(stale.labels.i25MapPace.textContent,'63 min · retained');
});

test('incomplete or directional cells use dashboard average fallback but zero speed does not fabricate a pace',async()=>{
  const stamp='2026-10-07T16:59:00Z';
  for(const cells of [
    [{startMileMarker:208,endMileMarker:270,speedMph:1}],
    [{startMileMarker:208,endMileMarker:271,direction:'NORTHBOUND',speedMph:1}],
    [{startMileMarker:208,endMileMarker:240,speedMph:1},{startMileMarker:241,endMileMarker:271,speedMph:1}]
  ]){
    const hero=dataHero({snapshots:{I25:{corridor:'I25',observedAt:stamp,cells}}});await hero.settle();
    assert.equal(hero.state.overlays[0].dataset.travelSeconds,'32');
  }
  const zero=dataHero({snapshots:{I25:{observedAt:stamp,cells:[{startMileMarker:208,endMileMarker:271,speedMph:0}]}}});
  await zero.settle();assert.equal(zero.labels.i25MapPace.textContent,'pace unavailable');
  assert.equal(zero.state.overlays[0].animations.at(-1).playState,'paused');
  assert.equal(zero.state.overlays[1].animations.at(-1).playState,'running');
});

test('unusable or future pace observations leave geometry and the other corridor intact',async()=>{
  for(const polledAt of ['invalid','2026-10-07T18:00:00Z']){
    const hero=dataHero({summaries:{I25:{latest:{avgCurrentSpeed:60,polledAt}}},
      snapshots:{I25:{observedAt:polledAt,cells:[{startMileMarker:208,endMileMarker:271,speedMph:60}]}}});
    await hero.settle();assert.equal(hero.state.maps.length,1);
    assert.match(hero.status.textContent,/2 corridors/);
    assert.equal(hero.labels.i25MapPace.textContent,'pace unavailable');
    assert.equal(hero.labels.i70MapPace.textContent,'68 min');
  }
});

test('pace reads and animation pause outside view, when hidden and in back-forward cache',async()=>{
  const hero=dataHero({visible:false});await hero.settle();hero.flushFrames();
  assert.equal(hero.state.reads.length,2);assert.equal(hero.timers.size,0);
  const observer=hero.observers[2];
  observer.callback([{isIntersecting:true}]);assert.equal(hero.timers.size,1);
  hero.fireTimer();await hero.settle();hero.flushFrames();assert.equal(hero.state.reads.length,6);
  assert.equal(hero.state.overlays[0].animations.at(-1).playState,'running');
  hero.document.hidden=true;hero.events.visibilitychange();
  assert.equal(hero.timers.size,0);assert.equal(hero.state.overlays[0].animations.at(-1).playState,'paused');
  hero.document.hidden=false;hero.events.visibilitychange();assert.equal(hero.timers.size,1);
  hero.events.pagehide({persisted:true});assert.equal(hero.timers.size,0);assert.equal(hero.state.removed,0);
  assert.equal(hero.state.overlays[0].animations.at(-1).playState,'paused');
  hero.events.pageshow({persisted:true});hero.flushFrames();assert.equal(hero.timers.size,1);
  observer.callback([{isIntersecting:false}]);assert.equal(hero.timers.size,0);
  hero.events.pagehide({persisted:false});
  assert.ok(hero.observers.every(o=>o.disconnected));
  assert.ok(hero.state.overlays.every(p=>p.animations.at(-1).cancelled));
  assert.ok(hero.state.reads.filter(r=>r.url.includes('/summary?')||r.url.includes('/flow-cells/')).every(r=>r.options.signal.aborted));
});

test('reduced motion hides travel overlays without changing estimates and can resume without duplicate reads',async()=>{
  const hero=dataHero({reduced:true});await hero.settle();hero.flushFrames();
  assert.equal(hero.labels.i25MapPace.textContent,'63 min');
  assert.ok(hero.state.overlays.every(p=>p.animations.at(-1).playState==='paused'));
  const count=hero.state.reads.length;hero.motion.matches=false;hero.motion.callback();
  assert.ok(hero.state.overlays.every(p=>p.animations.at(-1).playState==='running'));
  assert.equal(hero.state.reads.length,count);
  hero.state.overlays[0].animations.at(-1).currentTime=5432;
  hero.node.clientWidth=960;hero.observers[1].callback();hero.flushFrames();
  assert.equal(hero.state.overlays[0].animations.at(-1).currentTime,1432);
});

test('disjoint corridor lines teleport invisibly across gaps rather than tracing a false roadway',async()=>{
  const hero=dataHero({features:[{id:'I25',properties:{startMileMarker:208,endMileMarker:271},
    geometry:{type:'MultiLineString',coordinates:[
      [[-105,39],[-105,39.5]], [[-104,40],[-104,40.5]]
    ]}}]});await hero.settle();
  const frames=hero.state.overlays[0].animations[0].keyframes;
  const jumps=frames.slice(1).map((frame,i)=>({frame,previous:frames[i]}))
    .filter(({frame,previous})=>frame.transform!==previous.transform && frame.offset===previous.offset);
  assert.equal(jumps.length,2);
  assert.ok(jumps.every(({frame,previous})=>frame.opacity===0&&previous.opacity===0));
});

test('unsupported overlay animation keeps the map and pace text without allocating a fallback loop',async()=>{
  const hero=dataHero({animate:false});await hero.settle();hero.flushFrames();
  assert.equal(hero.state.maps.length,1);assert.equal(hero.labels.i25MapPace.textContent,'63 min');
  assert.ok(hero.state.overlays.every(p=>p.animations.length===0));assert.equal(hero.frames.size,0);
});

test('standalone road-sign reflection only observes pointers over the sign and coalesces frames',()=>{
  const f=roadSignFixture();f.flush();f.writes.length=0;
  assert.deepEqual([...f.windowEvents.keys()],['resize']);
  assert.deepEqual([...f.sign.events.keys()],['pointermove','pointerleave']);
  assert.equal(f.frames.size,0);
  f.sign.events.get('pointermove')({clientX:700,clientY:180});
  f.sign.events.get('pointermove')({clientX:900,clientY:260});
  assert.equal(f.frames.size,1);f.flush();
  assert.ok(f.writes.length>0);
  const moved=f.writes.find(write=>write.name==='--sheet-x').value;
  f.writes.length=0;f.sign.events.get('pointerleave')();f.flush();
  assert.notEqual(f.writes.find(write=>write.name==='--sheet-x').value,moved);
});

test('disconnect cancels pending sign reflection and reconnect binds one local listener set',()=>{
  const f=roadSignFixture(),stale=[...f.frames.values()][0];
  f.sign.isConnected=false;f.sign.disconnectedCallback();
  assert.equal(f.frames.size,0);assert.equal(f.sign.events.size,0);assert.equal(f.windowEvents.size,0);
  f.writes.length=0;stale();assert.equal(f.writes.length,0);
  f.sign.isConnected=true;f.sign.connectedCallback();
  assert.equal(f.frames.size,1);f.flush();assert.ok(f.writes.length>0);
  assert.equal(f.sign.events.size,2);assert.equal(f.windowEvents.size,1);
});

test('primary dashboard does not mount or fetch the legacy reflective sign component',()=>{
  assert.doesNotMatch(indexSource,/<road-sign-display|src=["']road-sign-display\.js/);
});

test('connector geometry follows actual panel gaps and clamps overlapping nodes',()=>{
  const page=informationPage();
  assert.equal(JSON.stringify(page.run('architectureConnectorGeometry({bottom:25},{top:90},{top:20})')),
    JSON.stringify({offset:5,length:65}));
  assert.equal(page.run('architectureConnectorGeometry({bottom:90},{top:25},{top:20}).length'),0);
});

test('connector updates batch shared reads and coalesce only visible resize work',()=>{
  const f=connectorFixture();
  assert.ok(f.order.lastIndexOf('read')<f.order.indexOf('write'));
  assert.equal(f.order.filter(x=>x==='read').length,4);
  assert.equal(f.links[0].style['--architecture-link-length'],'50px');
  assert.equal(f.frames.size,0);
  f.events.resize();assert.equal(f.frames.size,0);
  f.observers[0].callback([{target:f.page.nodes.get('systemArchitecture'),isIntersecting:true}]);
  f.observers[1].callback();f.observers[1].callback();
  assert.equal(f.frames.size,1);f.order.length=0;f.flush();
  assert.ok(f.order.lastIndexOf('read')<f.order.indexOf('write'));assert.equal(f.frames.size,0);
  f.page.context.document.hidden=true;f.events.resize();assert.equal(f.frames.size,0);
  f.page.context.document.hidden=false;f.events.visibilitychange();assert.equal(f.frames.size,1);
  f.events.pagehide({persisted:true});assert.equal(f.frames.size,0);
  f.events.pageshow();assert.equal(f.frames.size,1);f.flush();
  f.events.pagehide({persisted:false});f.events.resize();f.events.pageshow();
  assert.equal(f.frames.size,0);assert.ok(f.observers.every(o=>o.disconnected));
});

test('verification illustration has one finite visible sequence and stops all timers when hidden',()=>{
  const f=verificationFixture();
  assert.equal(f.timers.size,0);
  f.observer.callback([{target:f.panel,isIntersecting:true}]);
  assert.equal(f.timers.size,7);
  assert.deepEqual([...f.timers.values()].map(t=>t.delay),[4300,5100,5900,6700,7500,8300,16000]);
  assert.equal(new Set(f.gates.map(g=>g.dataset.verificationOrder)).size,6);
  f.observer.callback([{target:f.panel,isIntersecting:true}]);assert.equal(f.timers.size,7);
  const stale=[...f.timers.values()][0].callback;
  f.page.context.document.hidden=true;f.events.visibilitychange();assert.equal(f.timers.size,0);
  stale();assert.ok(f.gates.every(g=>!g.classList.contains('is-complete')));
  f.page.context.document.hidden=false;f.events.visibilitychange();assert.equal(f.timers.size,7);
  f.events.pagehide({persisted:true});assert.equal(f.timers.size,0);
  f.events.pageshow();assert.equal(f.timers.size,7);
  f.observer.callback([{target:f.panel,isIntersecting:false}]);assert.equal(f.timers.size,0);
  f.events.pagehide({persisted:false});f.events.pageshow();assert.equal(f.timers.size,0);
  assert.ok(f.observer.disconnected);
});

test('reduced motion shows completed illustration gates without creating timers',()=>{
  const f=verificationFixture(true);
  f.observer.callback([{target:f.panel,isIntersecting:true}]);
  assert.equal(f.timers.size,0);assert.ok(f.gates.every(g=>g.classList.contains('is-complete')));
});

test('history gradient is clipped to its rail and shares visibility and reduced-motion controls',()=>{
  const page=informationPage(undefined,'/dashboard/data.html');
  const track=page.context.document.createElement('div');
  page.context.document.querySelectorAll=()=>[track];
  page.run('initializeHistoryTrackLights()');
  assert.equal(track.children.length,1);
  assert.equal(track.children[0].className,'history-track-light');
  assert.equal(track.children[0].attributes['aria-hidden'],'true');
  assert.equal(track.children[0].children.length,1);
  assert.match(informationStyles,/\.history-track-light \{[^}]*overflow: hidden/);
  assert.match(informationStyles,/prefers-reduced-motion: reduce[^@]*\.history-track-light span,[\s\S]*?animation: none/);
});

test('traveling diagram keyframes use transforms without layout or animated shadows',()=>{
  function frames(name) {
    const start=informationStyles.indexOf('@keyframes '+name);
    assert.ok(start>=0,name);
    const opening=informationStyles.indexOf('{',start);let depth=1,end=opening+1;
    for(;depth>0&&end<informationStyles.length;end++) {
      if(informationStyles[end]==='{')depth++;
      if(informationStyles[end]==='}')depth--;
    }
    return informationStyles.slice(opening,end);
  }
  for(const name of ['system-signal','runtime-packet','runtime-packet-mobile','verification-runner',
    'verification-console-scan','api-terminal-scan','access-merge-left','access-merge-right','history-track-flow']) {
    assert.match(frames(name),/transform:/);
    assert.doesNotMatch(frames(name),/(?:^|[;{])\s*(?:left|right|top|bottom|box-shadow|filter):/m);
  }
  for(const name of ['verification-stage-glow','geometry-gate-glow','api-path-glow']) {
    assert.match(frames(name),/opacity:/);assert.doesNotMatch(frames(name),/box-shadow:/);
  }
  assert.match(informationSource,/MOTION_SCOPE_SELECTOR[\s\S]*?\.api-explorer/);
  assert.equal((informationPages.system.match(/data-connector-from=/g)||[]).length,6);
  assert.match(informationStyles,/\.provider-control \{[^}]*border-top: 3px solid var\(--gold-data\)/);
});

test('grid beams share the original diagonal but sweep left to right without animated masks',()=>{
  assert.match(informationStyles,/linear-gradient\(112deg, transparent 42%/);
  const sweep=informationStyles.slice(informationStyles.indexOf('@keyframes grid-light-sweep'),
    informationStyles.indexOf('@keyframes grid-light-descent'));
  assert.ok(sweep.indexOf('translate3d(-42%')<sweep.indexOf('translate3d(42%'));
  assert.doesNotMatch(sweep,/mask-position|background-position|filter/);
  assert.doesNotMatch(informationStyles,/animation-direction:\s*reverse/);
  assert.match(informationStyles,/prefers-reduced-motion:[^}]+\.grid-light\s*\{\s*display: none/s);
});

test('grid decoration pauses outside its visible scope and throughout a hidden document',()=>{
  const scopes=[{classes:new Set()},{classes:new Set()}].map(scope=>({...scope,
    children:[],appendChild(child){this.children.push(child);},
    classList:{add(name){scope.classes.add(name);},
      toggle(name,force){force?scope.classes.add(name):scope.classes.delete(name);}}
  }));
  const page=informationPage(undefined,'/dashboard/data.html');
  let observed,settings;const events={};
  page.context.document.querySelectorAll=()=>scopes;
  page.context.document.addEventListener=(name,callback)=>events[name]=callback;
  page.context.window.IntersectionObserver=class {
    constructor(callback,options){observed=callback;settings=options;}
    observe(){} disconnect(){}
  };
  page.run('initializeGridLights(); initializeMotionBudget()');
  assert.ok(scopes.every(scope=>scope.children[0].attributes['aria-hidden']==='true'
    &&scope.children[0].children[0].className==='grid-light-beam'));
  assert.ok(scopes.every(scope=>scope.classes.has('motion-paused')));
  assert.equal(settings.rootMargin,'48px 0px');
  observed([{target:scopes[0],isIntersecting:true},{target:scopes[1],isIntersecting:false}]);
  assert.ok(!scopes[0].classes.has('motion-paused'));assert.ok(scopes[1].classes.has('motion-paused'));
  page.context.document.hidden=true;events.visibilitychange();
  assert.ok(page.context.document.documentElement.classList.contains('motion-suspended'));
  page.context.document.hidden=false;events.visibilitychange();
  assert.ok(!page.context.document.documentElement.classList.contains('motion-suspended'));
});
