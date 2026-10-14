const { test } = require('node:test');

const motionDiagnostic = require('./dashboard-motion-preview.cjs');

async function motionServerTest(t, fixtureGet, readSource) {
  const server = motionDiagnostic.createMotionServer({ fixtureGet, readSource });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (pathname, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, options);
    return { status:response.status, headers:response.headers, body:await response.text() };
  };
}

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

function motionProbeTest() {
  let now=0,id=0;
  const timers=new Map(),frames=new Map(),events=new Map();
  const selected={value:'map',disabled:false},button={disabled:false},output={textContent:''};
  const target={scrollIntoView(){},querySelector(){return {};},querySelectorAll(){return [];},
    getAnimations(){return[{playState:'running'}];},focus(){},blur(){}};
  const controls={style:{},querySelector(selector){return selector==='select'?selected:selector==='button'?button:output;}};
  class Element {}
  Element.prototype.getBoundingClientRect=function(){return{width:400};};
  const original=Element.prototype.getBoundingClientRect;
  const eventApi={addEventListener(name,callback){events.set(name,callback);},
    removeEventListener(name,callback){if(events.get(name)===callback)events.delete(name);}};
  const document={...eventApi,hidden:false,createElement(){return controls;},
    body:{appendChild(){}},querySelector(){return target;},getElementById(){return null;}};
  const context={document,window:{...eventApi,__motionPaintCalls:0},Element,URLSearchParams,
    location:{search:'?motionRevision=current&motionScene=map'},innerWidth:1093,innerHeight:827,devicePixelRatio:2,
    performance:{now:()=>now},setTimeout(callback,ms){timers.set(++id,{callback,ms});return id;},
    clearTimeout(id){timers.delete(id);},requestAnimationFrame(callback){frames.set(++id,callback);return id;},
    cancelAnimationFrame(id){frames.delete(id);}};
  vm.runInNewContext(motionDiagnostic.probe,context);
  const fireTimer=ms=>{const entry=[...timers].find(([,timer])=>timer.ms===ms);assert.ok(entry);
    timers.delete(entry[0]);entry[1].callback();};
  const tick=()=>{now+=16.6667;const next=[...frames];frames.clear();for(const[,callback]of next)callback(now);};
  const start=async()=>{const completion=button.onclick();fireTimer(500);await new Promise(setImmediate);return{completion};};
  const clean=()=>{assert.equal(Element.prototype.getBoundingClientRect,original);
    assert.equal(frames.size,0);assert.equal(timers.size,0);assert.equal(events.size,0);
    assert.equal(button.disabled,false);assert.equal(selected.disabled,false);};
  return{start,tick,clean,fireTimer,document,events,output};
}

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

function roadSignFixture() {
  const frames=new Map(),windowEvents=new Map(),writes=[];
  let next=0,Sign;
  class Element {
    constructor(){this.events=new Map();this.isConnected=true;}
    attachShadow(){this.shadowRoot={};}
    addEventListener(name,callback){this.events.set(name,callback);}
    removeEventListener(name,callback){if(this.events.get(name)===callback)this.events.delete(name);}
    getAttribute(){return "I25";}
  }
  const context=vm.createContext({
    HTMLElement:Element,
    customElements:{get(){return undefined;},define(name,constructor){Sign=constructor;}},
    window:{innerWidth:1200,innerHeight:800,
      addEventListener(name,callback){windowEvents.set(name,callback);},
      removeEventListener(name,callback){if(windowEvents.get(name)===callback)windowEvents.delete(name);},
      requestAnimationFrame(callback){const id=++next;frames.set(id,callback);return id;},
      cancelAnimationFrame(id){frames.delete(id);}
    }
  });
  vm.runInContext(readFileSync(path.join(__dirname,
    '../../api-service/src/main/resources/static/dashboard/road-sign-display.js'),'utf8'),context);
  const sign=new Sign();
  sign.stage={style:{setProperty(name,value){writes.push({name,value});}},setAttribute(){}};
  sign.image={};
  const flush=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(callback=>callback());};
  sign.connectedCallback();
  return {sign,frames,windowEvents,writes,flush};
}

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

function connectorFixture() {
  const page=informationPage(),order=[],frames=new Map(),events={},observers=[];
  let id=0;
  for(const [name,top,bottom]of [['tomtomProvider',10,50],['routeAuthority',10,40],['ingestService',100,200]]) {
    const node=page.context.document.getElementById(name);
    node.getBoundingClientRect=()=>{order.push('read');return {top,bottom};};
  }
  const container={getBoundingClientRect(){order.push('read');return {top:60,bottom:100};}};
  const links=['tomtomProvider','routeAuthority'].map(from=>({
    dataset:{connectorFrom:from,connectorTo:'ingestService'},parentElement:container,
    style:{setProperty(name,value){order.push('write');this[name]=value;}}
  }));
  page.nodes.get('systemArchitecture').querySelectorAll=()=>links;
  Object.assign(page.context.window,{
    requestAnimationFrame(callback){const next=++id;frames.set(next,callback);return next;},
    cancelAnimationFrame(next){frames.delete(next);},
    addEventListener(name,callback){events[name]=callback;},
    IntersectionObserver:class {
      constructor(callback){this.callback=callback;observers.push(this);}
      observe(){} disconnect(){this.disconnected=true;}
    },
    ResizeObserver:class {
      constructor(callback){this.callback=callback;observers.push(this);}
      observe(){} disconnect(){this.disconnected=true;}
    }
  });
  page.context.document.addEventListener=(name,callback)=>events[name]=callback;
  const flush=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn());};
  page.run('initializeArchitectureConnectors()');
  return {page,order,frames,events,observers,links,flush};
}

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

function verificationFixture(reduced=false) {
  const page=informationPage(),timers=new Map(),events={};
  let next=0,observer;
  const panel=page.context.document.getElementById('verificationConsole');
  const gates=Array.from({length:6},()=>page.context.document.createElement('li'));
  panel.querySelectorAll=()=>gates;
  Object.assign(page.context.window,{
    matchMedia(){return {matches:reduced};},
    setTimeout(callback,delay){const id=++next;timers.set(id,{callback,delay});return id;},
    clearTimeout(id){timers.delete(id);},
    addEventListener(name,callback){events[name]=callback;},
    IntersectionObserver:class {
      constructor(callback){this.callback=callback;observer=this;}
      observe(){} disconnect(){this.disconnected=true;}
    }
  });
  page.context.document.addEventListener=(name,callback)=>events[name]=callback;
  page.run('initializeVerificationConsole()');
  return {page,panel,gates,timers,events,get observer(){return observer;}};
}

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
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
require('./stored-observations.test.cjs');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard.js'), 'utf8');
const estimatesSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/traffic-estimates.js'), 'utf8');
const historySource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard-history.js'), 'utf8');
const continuousSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard-continuous.js'), 'utf8');
const windowSummarySource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard-window-summary.js'), 'utf8');
const indexSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/index.html'), 'utf8');
const mapSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/corridor-map.js'), 'utf8');
const informationSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/information-pages.js'), 'utf8');
const informationStyles = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/information.css'), 'utf8');
const informationPages = Object.fromEntries(['system', 'data', 'api'].map(name => [
  name,
  readFileSync(path.join(__dirname, `../../api-service/src/main/resources/static/dashboard/${name}.html`), 'utf8')
]));
function prepareChartHistory(d) {
  d.run(`
    state.routeData = new Map([['I25', {summary: {latest: {polledAt:'2026-06-19T02:00:00Z'}}, incidentThreads: []}]]);
    chartHistory.bounds = new Map(CORRIDOR_IDS.map(corridor => [corridor, {
      firstObservedAt:'2026-04-12T02:00:00Z', firstZoneObservedAt:'2026-05-20T02:00:00Z'
    }]));
    chartHistory.enabled = true;
    drawAllCharts = () => {};
  `);
}

function historyHoverClock(d) {
  let now = 0, nextId = 0;
  const timers = new Map();
  d.context.window.setTimeout = (callback, delay) => {
    const id = ++nextId;
    timers.set(id, { callback, at: now + delay });
    return id;
  };
  d.context.window.clearTimeout = id => timers.delete(id);
  return {
    timers,
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now && timers.delete(id)) timer.callback();
      }
    }
  };
}

function clickHistoryRange(d, hours) {
  d.nodes.get('rangeControl').events.click({target:{closest:()=>({dataset:{hours:String(hours)}})}});
}

test('window details show numeric left, center and right times with their timezone', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run('state.selectedHours=24;updateHistoryControls()');
  assert.equal(d.nodes.get('chartHistoryWindow').textContent,
    'Current window · Left: 06/17/26, 8:00 PM MDT · Center: 06/18/26, 8:00 AM MDT · Right: 06/18/26, 8:00 PM MDT');
  d.run("state.selectedHours=2;chartHistory.endTime=Date.parse('2026-06-18T07:30:00Z');updateHistoryControls()");
  assert.equal(d.nodes.get('chartHistoryWindow').textContent,
    'Historical · Left: 06/17/26, 11:30 PM MDT · Center: 06/18/26, 12:30 AM MDT · Right: 06/18/26, 1:30 AM MDT');
  assert.equal(d.network.length, 0);
});

test('window details keep the elapsed-time midpoint across Denver daylight saving changes', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run("state.selectedHours=2;chartHistory.endTime=Date.parse('2026-03-08T10:30:00Z');updateHistoryControls()");
  assert.equal(d.nodes.get('chartHistoryWindow').textContent,
    'Historical · Left: 03/08/26, 1:30 AM MST · Center: 03/08/26, 3:30 AM MDT · Right: 03/08/26, 4:30 AM MDT');
  assert.equal(d.network.length, 0);
});

function timezoneDashboard(timeZone, search = '?historical=1') {
  return dashboard(undefined, search, '/dashboard/', undefined, undefined, timeZone);
}

test('sync clocks detect the browser timezone and retain the Colorado clock without duplicate Mountain time', () => {
  const instant = '2026-06-19T02:00:00Z';
  for (const [zone, expected] of [
    ['America/Denver', '8:00 PM MDT'],
    ['America/New_York', '10:00 PM EDT (8:00 PM MDT)'],
    ['America/Los_Angeles', '7:00 PM PDT (8:00 PM MDT)'],
    ['Asia/Kolkata', '7:30 AM GMT+5:30 (8:00 PM MDT)'],
    ['Asia/Kathmandu', '7:45 AM GMT+5:45 (8:00 PM MDT)'],
    ['UTC', '2:00 AM UTC (8:00 PM MDT)']
  ]) {
    const d = timezoneDashboard(zone, '');
    d.context.instant = instant;
    assert.equal(d.run('formatSyncTime(instant)'), expected);
    d.run('updateDashboardStatus({routeData:new Map(),health:{}},new Date(instant))');
    assert.equal(d.nodes.get('statusText').textContent, `Data synced at ${expected} · Syncs every 60 seconds`);
    assert.equal(d.network.length, 0);
  }
});

test('Mountain conversion signs, fractional offsets and standard time follow the displayed date', () => {
  for (const [zone, summer, winter] of [
    ['America/New_York', '−2 hours to MDT', '−2 hours to MST'],
    ['America/Los_Angeles', '+1 hour to MDT', '+1 hour to MST'],
    ['America/Phoenix', '+1 hour to MDT', '+0 hours to MST'],
    ['Asia/Kolkata', '−11.5 hours to MDT', '−12.5 hours to MST'],
    ['Asia/Kathmandu', '−11.75 hours to MDT', '−12.75 hours to MST'],
    ['UTC', '−6 hours to MDT', '−7 hours to MST']
  ]) {
    const d = timezoneDashboard(zone);
    assert.equal(d.run("mountainTimeOffset('2026-06-19T02:00:00Z')"), summer);
    assert.equal(d.run("mountainTimeOffset('2026-01-19T02:00:00Z')"), winter);
  }
  const winter = timezoneDashboard('America/New_York');
  assert.equal(winter.run("formatSyncTime('2026-01-19T02:00:00Z')"), '9:00 PM EST (7:00 PM MST)');
});

test('local historical anchors cross midnight without shifting query bounds or the midpoint', () => {
  const d = timezoneDashboard('America/New_York');
  prepareChartHistory(d);
  d.run("state.selectedHours=2;chartHistory.endTime=Date.parse('2026-06-18T05:30:00Z');updateHistoryControls()");
  assert.equal(d.nodes.get('chartHistoryWindow').textContent,
    'Historical · Left: 06/17/26, 11:30 PM EDT · Center: 06/18/26, 12:30 AM EDT · Right: 06/18/26, 1:30 AM EDT · (−2 hours to MDT)');
  assert.match(d.nodes.get('chartHistoryWindow').title, /America\/New_York/);
  assert.equal(d.run('chartHistory.endTime'), Date.parse('2026-06-18T05:30:00Z'));
  assert.equal(d.run('historyNavigationStep()'), 3_600_000);
  assert.equal(d.network.length, 0);
});

test('history labels distinguish repeated DST hours and identify a changing offset reference', () => {
  const d = timezoneDashboard('America/New_York');
  prepareChartHistory(d);
  assert.equal(d.run("formatShortDateTime('2026-11-01T05:30:00Z')"), 'Nov 1, 1:30 AM EDT');
  assert.equal(d.run("formatShortDateTime('2026-11-01T06:30:00Z')"), 'Nov 1, 1:30 AM EST');
  d.run("state.selectedHours=4;chartHistory.endTime=Date.parse('2026-03-08T10:30:00Z');updateHistoryControls()");
  assert.equal(d.nodes.get('chartHistoryWindow').textContent,
    'Historical · Left: 03/08/26, 1:30 AM EST · Center: 03/08/26, 4:30 AM EDT · Right: 03/08/26, 6:30 AM EDT · (−3 hours to MST at center)');
});

test('local chart labels keep fractional-hour minutes and local date boundaries', () => {
  for (const [zone, clock, midnight] of [
    ['America/New_York', '3 PM', '2026-09-11T04:00:00Z'],
    ['Asia/Kolkata', '12:30 AM', '2026-09-10T18:30:00Z'],
    ['Asia/Kathmandu', '12:45 AM', '2026-09-10T18:15:00Z']
  ]) {
    const d = timezoneDashboard(zone);
    for (const hours of [2,6,24]) assert.equal(d.run(`formatChartTime(Date.parse('2026-09-10T19:00:00Z'),${hours})`), clock);
    const days = d.run("displayDayTransitions(Date.parse('2026-09-10T12:00:00Z'),Date.parse('2026-09-11T12:00:00Z'))");
    assert.deepEqual(Array.from(days), [Date.parse(midnight)]);
    const ticks = d.run("buildTimeAxisTicks(Date.parse('2026-09-10T12:00:00Z'),Date.parse('2026-09-17T12:00:00Z'),720)");
    const guide = ticks.find(tick => tick.timestamp === Date.parse(midnight));
    assert.ok(guide?.guide, zone);
    assert.equal(guide.horizontalPosition, 720 * (Date.parse(midnight) - Date.parse('2026-09-10T12:00:00Z')) / (168 * 3_600_000));
  }
});

test('local day guides handle a timezone whose daylight saving transition skips midnight', () => {
  const d = timezoneDashboard('America/Santiago');
  const days = d.run("displayDayTransitions(Date.parse('2026-09-05T12:00:00Z'),Date.parse('2026-09-07T12:00:00Z'))");
  assert.deepEqual(Array.from(days), [Date.parse('2026-09-06T04:00:00Z'),Date.parse('2026-09-07T03:00:00Z')]);
});

test('visitor timezones leave Colorado baseline and daily travel semantics unchanged', () => {
  for (const zone of ['America/Denver','America/New_York','Asia/Kathmandu','Pacific/Auckland']) {
    const d = timezoneDashboard(zone);
    assert.equal(d.run("denverProfileKey('2026-06-19T02:00:00Z')"), '4|20');
    assert.equal(d.run("denverCalendarDay('2026-06-19T02:00:00Z')"), '2026-06-18');
  }
});

test('unavailable browser timezone detection falls back to Denver', () => {
  const d = timezoneDashboard(null);
  assert.equal(d.run('DISPLAY_TIME_ZONE'), 'America/Denver');
  assert.equal(d.run("formatSyncTime('2026-06-19T02:00:00Z')"), '8:00 PM MDT');
  assert.equal(d.run("formatSyncTime('not a timestamp')"), '—');
});

test('timezone formatters and day guides reuse bounded caches during chart redraws', () => {
  const d = timezoneDashboard('Asia/Kathmandu');
  d.run('displayDayTransitions(0,720*3600000)');
  const size = d.run('DISPLAY_TIME_FORMATTERS.size');
  d.run('for(let i=0;i<10;i++)displayDayTransitions(0,720*3600000)');
  assert.equal(d.run('DISPLAY_TIME_FORMATTERS.size'), size);
  d.run('displayDayTransitions(0,5000*3600000)');
  assert.equal(d.run('DISPLAY_DAY_CACHE.size'), 4096);
});

test('timeframe buttons preserve the graph midpoint across every range and detail view', () => {
  for (const continuous of [false, true]) for (const view of ['overall', 'zones']) {
    const d = dashboard(undefined, continuous ? '?historical=1&continuous=1' : '?historical=1');
    prepareChartHistory(d);
    d.run(`initializeControls();applyDashboardSnapshot=()=>{};state.focusedCorridor='I25';
      chartHistory.bounds.forEach(value=>value.firstZoneObservedAt='2026-01-01T00:00:00Z');`);
    for (const from of [2,6,24,168,720]) for (const to of [2,6,24,168,720]) {
      d.context.from=from;d.context.view=view;
      d.run(`state.chartView=view;state.selectedHours=from;
        chartHistory.endTime=Date.parse('2026-06-01T03:43:12.123Z');`);
      const midpoint = d.run('chartHistory.endTime-state.selectedHours*1800000');
      clickHistoryRange(d,to);
      assert.equal(d.run('state.selectedHours'),to);
      assert.equal(d.run('chartHistory.endTime-state.selectedHours*1800000'),midpoint,`${view} ${from} -> ${to}`);
      assert.equal(d.run('chartHistory.enabled'),true);
    }
  }
});

test('midpoint zoom preserves locked history, keeps ordinary Current live, and resets wheel readiness', () => {
  const d=dashboard(undefined,'?historical=1');prepareChartHistory(d);
  const clock=historyHoverClock(d);
  d.run('initializeControls();initializeHistoryControls();applyDashboardSnapshot=()=>{};chartHistory.enabled=false');
  clickHistoryRange(d,6);
  assert.equal(d.run('chartHistory.endTime'),null);
  d.run(`chartHistory.enabled=true;state.selectedHours=24;beginHistoryWheelHover(document.getElementById('i25Chart'))`);
  clock.advance(250);
  assert.equal(d.run('chartHistory.hoverReady'),true);
  clickHistoryRange(d,6);
  assert.equal(d.run('chartHistory.endTime'),Date.parse('2026-06-18T17:00:00Z'));
  assert.equal(d.run('chartHistory.hoverReady'),false);
  d.run('chartHistory.enabled=false');
  clickHistoryRange(d,2);
  assert.equal(d.run('chartHistory.endTime'),Date.parse('2026-06-18T15:00:00Z'));
  assert.equal(d.run('chartHistory.enabled'),false);
});

test('midpoint zoom clamps to current and dataset-specific oldest full windows', () => {
  const d=dashboard(undefined,'?historical=1');prepareChartHistory(d);
  d.run('initializeControls();applyDashboardSnapshot=()=>{}');
  for(const view of ['overall','zones']) {
    d.context.view=view;
    d.run(`state.chartView=view;state.selectedHours=2;chartHistory.endTime=historyLimits().firstEnd`);
    clickHistoryRange(d,720);
    const firstEnd=d.run('historyLimits().firstEnd');
    assert.equal(d.run('chartHistory.endTime'),firstEnd >= d.run('historyLimits().latest') ? null : firstEnd);
  }
  d.run(`state.chartView='overall';state.selectedHours=2;chartHistory.endTime=historyLimits().latest-3600000`);
  clickHistoryRange(d,24);
  assert.equal(d.run('chartHistory.endTime'),null);
});

test('historical scrolling defaults off and preserves page scrolling and browser zoom', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  const clock = historyHoverClock(d);
  d.run('chartHistory.enabled = false; initializeHistoryControls()');
  let prevented = 0;
  const canvas = d.nodes.get('i25Chart');
  canvas.clientWidth = 1000;
  canvas.events.pointerenter({pointerType:'mouse'});
  for (let i = 0; i < 20; i++) canvas.events.pointermove({pointerType:'mouse'});
  assert.equal(clock.timers.size, 0);
  const event = { deltaY:100, deltaX:0, preventDefault() { prevented++; } };
  canvas.events.wheel(event);
  assert.equal(d.run('chartHistory.endTime'), null);
  assert.equal(prevented, 0);
  d.run('chartHistory.enabled = true');
  canvas.events.pointerenter({pointerType:'mouse'});
  clock.advance(3000);
  canvas.events.wheel({...event, ctrlKey:true});
  canvas.events.wheel({...event, metaKey:true});
  assert.equal(prevented, 0);
  canvas.events.wheel(event);
  assert.equal(prevented, 1);
  assert.equal(d.run('chartHistory.endTime'), Date.parse('2026-06-19T02:00:00Z') - 24 * 3600000 * 0.1);
  assert.match(indexSource, /id="historyScrollToggle"[^>]*aria-pressed="false"/);
  assert.match(indexSource, /id="i25Chart"[^>]*tabindex="0"/);
});

test('graph wheel navigation requires a quarter-second hover and leaves scrolling native until ready', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  const clock = historyHoverClock(d);
  d.run('initializeHistoryControls()');
  const canvas = d.nodes.get('i25Chart');
  canvas.clientWidth = 1000;
  let prevented = 0;
  const wheel = {deltaY:100, preventDefault(){prevented++;}};
  canvas.events.pointerenter({pointerType:'mouse'});
  const timer = d.run('chartHistory.hoverTimer');
  clock.advance(100);
  canvas.events.pointermove({pointerType:'mouse'});
  assert.equal(d.run('chartHistory.hoverTimer'), timer);
  clock.advance(149);
  assert.equal(d.run('chartHistory.hoverReady'), false);
  canvas.events.wheel(wheel);
  assert.equal(prevented, 0);
  assert.equal(d.run('chartHistory.endTime'), null);
  clock.advance(249);
  assert.equal(d.run('chartHistory.hoverReady'), false);
  clock.advance(1);
  assert.equal(d.run('chartHistory.hoverReady'), true);
  assert.equal(canvas.dataset.historyWheel, 'ready');
  assert.equal(d.nodes.get('chartHistoryHelp').textContent, '');
  canvas.events.wheel(wheel);
  assert.equal(prevented, 1);
  assert.ok(d.run('chartHistory.endTime') > 0);
  canvas.events.pointerleave();
  assert.equal(d.run('chartHistory.hoverReady'), false);
  assert.equal(canvas.dataset.historyWheel, undefined);
  canvas.events.wheel(wheel);
  assert.equal(prevented, 1);
});

test('hover arming resets on another graph, toggle, cancellation and page lifecycle changes', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  const clock = historyHoverClock(d);
  d.run('initializeHistoryControls()');
  const first = d.nodes.get('i25Chart'), second = d.nodes.get('i70Chart');
  const enter = canvas => canvas.events.pointerenter({pointerType:'mouse'});
  first.events.pointerenter({pointerType:'touch'});
  assert.equal(clock.timers.size, 0);
  enter(first);
  const stale = [...clock.timers.values()][0].callback;
  clock.advance(150);
  first.events.pointerleave();
  enter(second);
  clock.advance(100);
  assert.equal(d.run('chartHistory.hoverReady'), false);
  clock.advance(150);
  assert.equal(second.dataset.historyWheel, 'ready');
  second.events.pointercancel();
  assert.equal(d.run('chartHistory.hoverReady'), false);
  enter(first);
  stale();
  assert.equal(d.run('chartHistory.hoverReady'), false);
  for (const reset of [
    () => d.context.window.events.blur(),
    () => {d.context.document.hidden = true; d.context.document.events.visibilitychange();},
    () => d.context.window.events.pagehide({persisted:true}),
    () => d.nodes.get('historyScrollToggle').events.click()
  ]) {
    d.context.document.hidden = false;
    d.run('chartHistory.disposed = false; chartHistory.enabled = true');
    enter(first);
    reset();
    clock.advance(3000);
    assert.equal(d.run('chartHistory.hoverReady'), false);
    assert.equal(d.run('chartHistory.hoverTimer'), null);
    assert.equal(first.dataset.historyWheel, undefined);
  }
});

test('historical wheel input normalizes mouse, trackpad and horizontal scrolling', () => {
  const d = dashboard();
  assert.equal(d.run('historyWheelPixels({deltaY:3, deltaMode:1}, 1000)'), 48);
  assert.equal(d.run('historyWheelPixels({deltaY:1, deltaMode:2}, 1000)'), 120);
  assert.equal(d.run('historyWheelPixels({deltaY:-400}, 1000)'), -120);
  assert.equal(d.run('historyWheelPixels({deltaY:0.75}, 1000)'), 0.75);
  assert.equal(d.run('historyWheelPixels({deltaX:60,deltaY:5}, 1000)'), -60);
  assert.equal(d.run('historyWheelPixels({deltaX:0,deltaY:0}, 1000)'), 0);
});

function corridorButtonFixture(search = '') {
  const d = dashboard(undefined, search);
  const buttons = ['ALL','I25','I70'].map(corridor => ({
    dataset: {corridorFocus:corridor}, disabled: false, attributes: {}, active: false,
    classList: {toggle(name, active) { buttons.find(button => button.dataset.corridorFocus === corridor).active = active; }},
    setAttribute(name, value) { this.attributes[name] = value; }
  }));
  const control = d.nodes.get('corridorControl');
  control.querySelectorAll = () => buttons;
  const urls = [];
  d.context.window.location.href = 'http://fixture/dashboard/' + search;
  d.context.window.history = {replaceState(_state, _title, url) { urls.push(String(url)); }};
  d.run('initializeCorridorFocus();initializeControls()');
  return {d, buttons, urls, click(corridor) {
    control.events.click({target: {closest: () => buttons.find(button => button.dataset.corridorFocus === corridor) || null}});
  }};
}

test('corridor selection uses labeled native buttons with the timeframe control styling', () => {
  assert.doesNotMatch(indexSource, /id="corridorSelect"|<select\b/);
  assert.match(indexSource, /id="corridorSelectorLabel"[^>]*><span>Corridor<\/span><span>Selector<\/span>/);
  assert.match(indexSource, /id="corridorControl" class="range-control" role="group" aria-labelledby="corridorSelectorLabel"/);
  for (const [corridor, label] of [['ALL','Both Corridors'],['I25','I-25'],['I70','I-70']]) {
    assert.match(indexSource, new RegExp(`<button type="button" data-corridor-focus="${corridor}"[^>]*>(?:<img[^>]*> )?${label}(?: <span class="corridor-direction"[^>]*>[\\s\\S]*?<\\/span>)?<\\/button>`));
  }
  const selector = indexSource.match(/id="corridorControl"[^>]*>([\s\S]*?)<\/div>/)[1];
  assert.doesNotMatch(selector, /data-corridor=/, 'content visibility rules must not hide corridor buttons');
});

test('corridor selector shields reuse the graph assets without duplicating accessible button labels', () => {
  for (const [corridor, number] of [['I25','25'],['I70','70']]) {
    const button = indexSource.match(new RegExp(`data-corridor-focus="${corridor}"[^>]*>([\\s\\S]*?)<\\/button>`))[1];
    assert.match(button, new RegExp(`<img src="interstate-${number}\\.svg" alt="" width="20" height="19"> I-${number}`));
    assert.match(indexSource, new RegExp(`<div class="lane-label">\\s*<img src="interstate-${number}\\.svg" alt="">`));
  }
});

test('corridor selector directions pair north–south with I25 and east–west with I70', () => {
  for (const [corridor, direction, icon] of [['I25','north–south','arrow-up-down'],['I70','east–west','arrow-left-right']]) {
    const button = indexSource.match(new RegExp(`<button[^>]*data-corridor-focus="${corridor}"[^>]*>[\\s\\S]*?<\\/button>`))[0];
    assert.match(button, new RegExp(`aria-label="I-${corridor.slice(1)}, ${direction} corridor"`));
    assert.match(button, new RegExp(`<span class="corridor-direction" aria-hidden="true"[^>]*>\\(<svg focusable="false"><use href="#icon-${icon}"><\\/use><\\/svg>\\)<\\/span>`));
    assert.match(indexSource, new RegExp(`<symbol id="icon-${icon}" viewBox="0 0 24 24">`));
  }
});

test('corridor buttons initialize one pressed selection from valid or fallback deep links', () => {
  for (const [search, expected] of [['','ALL'],['?corridor=I25','I25'],['?corridor=i70','I70'],['?corridor=unknown','ALL']]) {
    const {d, buttons, urls} = corridorButtonFixture(search);
    assert.equal(d.run('state.focusedCorridor'), expected);
    assert.deepEqual(buttons.filter(button => button.active).map(button => button.dataset.corridorFocus), [expected]);
    assert.deepEqual(buttons.filter(button => button.attributes['aria-pressed'] === 'true').map(button => button.dataset.corridorFocus), [expected]);
    assert.equal(urls.length, 0);
    assert.equal(d.network.length, 0);
  }
});

test('corridor button changes preserve ranges and URL options while returning to Current with scrolling off', () => {
  const {d, buttons, urls, click} = corridorButtonFixture('?historical=1&fixture=live#graphs');
  prepareChartHistory(d);
  for (const corridor of ['I25','I70','ALL']) {
    d.run("state.selectedHours=168;chartHistory.enabled=true;chartHistory.endTime=Date.parse('2026-06-12T02:00:00Z')");
    click(corridor);
    assert.equal(d.run('state.focusedCorridor'), corridor);
    assert.equal(d.run('state.selectedHours'), 168);
    assert.equal(d.run('chartHistory.endTime'), null);
    assert.equal(d.run('chartHistory.enabled'), false);
    assert.deepEqual(buttons.filter(button => button.attributes['aria-pressed'] === 'true').map(button => button.dataset.corridorFocus), [corridor]);
    const url = new URL(urls.at(-1));
    assert.equal(url.searchParams.get('corridor'), corridor === 'ALL' ? null : corridor);
    assert.equal(url.searchParams.get('fixture'), 'live');
    assert.equal(url.searchParams.get('historical'), '1');
    assert.equal(url.hash, '#graphs');
    assert.equal(d.nodes.get('chartViewControl').hidden, corridor === 'ALL');
  }
  assert.equal(urls.length, 3);
  assert.equal(d.network.length, 0);
});

test('pressing the selected corridor or a disabled button does not discard the historical window', () => {
  const {d, buttons, urls, click} = corridorButtonFixture('?corridor=I25');
  const end = Date.parse('2026-06-12T02:00:00Z');
  d.context.end = end;
  d.run('chartHistory.enabled=true;chartHistory.endTime=end');
  click('I25');
  click('not a button');
  buttons.find(button => button.dataset.corridorFocus === 'I70').disabled = true;
  click('I70');
  assert.equal(d.run('chartHistory.endTime'), end);
  assert.equal(d.run('chartHistory.enabled'), true);
  assert.equal(d.run('state.focusedCorridor'), 'I25');
  assert.equal(urls.length, 0);
  assert.equal(d.network.length, 0);
});

test('chart detail selector is available only for a specific corridor and resets in Both Corridors', () => {
  const d = dashboard();
  const selector = d.nodes.get('chartViewControl');
  assert.match(indexSource, /id="chartViewControl"[^>]*hidden/);
  d.run("applyCorridorFocus('ALL', false)");
  assert.equal(selector.hidden, true);
  for (const corridor of ['I25', 'I70']) {
    d.run(`applyCorridorFocus('${corridor}', false); setChartView('zones')`);
    assert.equal(selector.hidden, false);
    assert.equal(d.run('state.chartView'), 'zones');
  }
  d.run("applyCorridorFocus('ALL', false)");
  assert.equal(selector.hidden, true);
  assert.equal(d.run('state.chartView'), 'overall');
  d.run("applyCorridorFocus('I25', false); applyCorridorFocus('unknown', false)");
  assert.equal(selector.hidden, true);
  assert.equal(d.run('state.focusedCorridor'), 'ALL');
});

test('current history details stay collapsed with scrolling off and button-selected timing stays visible', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run('chartHistory.enabled = false; initializeHistoryControls(); updateHistoryControls()');
  const toggle = d.nodes.get('historyScrollToggle');
  const details = d.nodes.get('chartHistoryDetails');
  assert.equal(details.hidden, true);
  assert.equal(toggle.attributes['aria-expanded'], 'false');
  assert.match(indexSource, /id="chartHistoryDetails"[^>]*hidden/);
  assert.ok(indexSource.indexOf('id="chartViewControl"') < indexSource.indexOf('id="historyScrollToggle"'));
  assert.ok(indexSource.indexOf('id="historyScrollToggle"') < indexSource.indexOf('id="rangeControl"'));
  assert.ok(indexSource.indexOf('id="historyScrollToggle"') < indexSource.indexOf('id="historyFirst"'));
  assert.ok(indexSource.indexOf('id="historyCurrent"') < indexSource.indexOf('id="rangeControl"'));
  assert.ok(indexSource.indexOf('id="historyRetry"') < indexSource.indexOf('id="chartHistoryDetails" class='));
  for (const id of ['historyNewer', 'historyCurrent']) {
    assert.equal(d.nodes.get(id).disabled, true);
  }
  for (const id of ['historyFirst', 'historyOlder']) assert.equal(d.nodes.get(id).disabled, false);
  toggle.events.click();
  assert.equal(details.hidden, false);
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  d.run('panHistoryWindow(3600000)');
  const end = d.run('chartHistory.endTime');
  toggle.events.click();
  assert.equal(details.hidden, false);
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  assert.equal(d.run('chartHistory.endTime'), end);
  toggle.events.click();
  assert.equal(details.hidden, false);
  assert.equal(d.nodes.get('historyCurrent').disabled, false);
  d.nodes.get('historyCurrent').events.click();
  assert.equal(d.run('chartHistory.endTime'), null);
  toggle.events.click();
  assert.equal(details.hidden, true);
  assert.equal(toggle.attributes['aria-expanded'], 'false');
});

test('scroll directions describe wheel navigation only while enabled', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run('chartHistory.enabled=false;initializeHistoryControls();updateHistoryControls()');
  const toggle = d.nodes.get('historyScrollToggle');
  assert.equal(toggle.attributes['aria-describedby'], 'chartHistoryHelp');
  assert.match(toggle.title, /Enable Historical Scroll/);
  toggle.events.click();
  assert.equal(toggle.attributes['aria-describedby'], 'chartHistoryHelp chartHistoryScrollGuide');
  assert.match(toggle.title, /↑ Forward: scroll up toward Current/);
  assert.match(toggle.title, /↓ Backward: scroll down into older history/);
  assert.match(toggle.title, /quarter-second/);
  toggle.events.click();
  assert.equal(toggle.attributes['aria-describedby'], 'chartHistoryHelp');
  assert.doesNotMatch(toggle.title, /↑ Forward/);
});

test('navigation labels describe the existing time step in every view and disabled state', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run('initializeHistoryControls()');
  for (const [hours, label] of [[2,'1h'],[6,'3h'],[24,'12h'],[168,'3d12h'],[720,'15d']]) {
    d.context.hours = hours;
    d.run('state.selectedHours=hours;chartHistory.endTime=null;updateHistoryControls()');
    assert.equal(d.nodes.get('historyOlder').textContent, `−${label}`);
    assert.equal(d.nodes.get('historyNewer').textContent, `+${label}`);
    assert.equal(d.nodes.get('historyOlder').attributes['aria-label'], `Earlier chart window by up to ${hours / 2} hours`);
    assert.equal(d.nodes.get('historyOlder').disabled, false);
    assert.equal(d.nodes.get('historyNewer').disabled, true);
    d.nodes.get('historyOlder').events.click();
    assert.equal(d.run('chartHistory.endTime'), Date.parse('2026-06-19T02:00:00Z') - hours * 3600000 / 2);
    d.run('updateHistoryControls()');
    assert.equal(d.nodes.get('historyOlder').disabled, false);
    assert.equal(d.nodes.get('historyNewer').disabled, false);
    d.nodes.get('historyNewer').events.click();
    assert.equal(d.run('chartHistory.endTime'), null);
    d.run('chartHistory.enabled=false;updateHistoryControls()');
    assert.equal(d.nodes.get('historyOlder').textContent, `−${label}`);
    assert.equal(d.nodes.get('historyNewer').disabled, true);
    d.nodes.get('historyOlder').events.click();
    assert.equal(d.run('chartHistory.endTime'), Date.parse('2026-06-19T02:00:00Z') - hours * 3600000 / 2);
    assert.equal(d.run('chartHistory.enabled'), false);
    d.run('updateHistoryControls()');
    assert.equal(d.nodes.get('historyNewer').disabled, false);
    d.nodes.get('historyNewer').events.click();
    assert.equal(d.run('chartHistory.endTime'), null);
  }
});

test('navigation releases immediately and selected timeframes and chart views share its pressed depth', () => {
  const css=readFileSync(path.join(__dirname,'../../api-service/src/main/resources/static/dashboard/dashboard.css'),'utf8');
  const release=css.match(/\.chart-history-navigation button,\s*\.range-control button,\s*\.chart-view-options button\s*\{([^}]+)\}/)[1];
  assert.doesNotMatch(release,/transition|animation|transform/);
  const pressed=css.match(/button\[data-history-pressed="true"\],\s*\.range-control button\[aria-pressed="true"\],\s*\.chart-view-options button\[aria-pressed="true"\]\s*\{([^}]+)\}/)[1];
  assert.match(pressed,/box-shadow: inset 0 2px 4px/);
  assert.doesNotMatch(pressed,/transition|animation|transform/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0\.01ms !important/);
});

test('sync status ends beside its button and can shrink without separating the pair', () => {
  const css = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard.css'), 'utf8');
  const status = css.match(/\.toolbar-status\s*\{([^}]+)\}/)[1];
  const text = css.match(/\.toolbar-status span\s*\{([^}]+)\}/)[1];
  assert.match(status, /flex-wrap: nowrap;/);
  assert.match(text, /text-align: right;/);
  assert.match(text, /min-width: 0;/);
  assert.match(css, /\.toolbar-status \.refresh-button\s*\{\s*flex: 0 0 auto;/);
});

test('dark mode preserves the original inset shape with a subtle inverted shadow and no extra edge', () => {
  const css = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard.css'), 'utf8');
  const rule = css.match(/(:root\[data-theme="dark"\] \.chart-history-navigation button\[data-history-pressed="true"\],[^{]+)\{([^}]+)\}/);
  assert.ok(rule);
  const selectors = rule[1].split(',').map(selector => selector.trim());
  assert.equal(selectors.length, 5);
  assert.ok(selectors.every(selector => selector.startsWith(':root[data-theme="dark"] ')));
  for (const control of ['.chart-history-navigation', '.range-control', '.chart-view-options', '.sigma-rocker', '.refresh-button']) {
    assert.ok(selectors.some(selector => selector.includes(control)), control);
  }
  assert.match(rule[2], /box-shadow: inset 0 2px 4px rgb\(255 255 255 \/ 0\.08\);/);
  assert.doesNotMatch(rule[2], /,|transition|animation|transform/);
  const toggles = css.match(/:root\[data-theme="dark"\] #historyScrollToggle\[aria-pressed="true"\],\s*:root\[data-theme="dark"\] \.chart-view-control #zoneFinderToggle\[aria-pressed="true"\]\s*\{([^}]+)\}/)[1];
  assert.match(toggles, /box-shadow: inset 0 1px 4px rgb\(255 255 255 \/ 0\.08\);/);
  assert.doesNotMatch(toggles, /,|transition|animation|transform/);
  assert.doesNotMatch(rule[2], /transition|animation|transform/);
});

test('each navigation button briefly acknowledges activation without adding reads or changing its label', () => {
  for (const id of ['historyFirst','historyCurrent','historyOlder','historyNewer']) {
    const d=dashboard(undefined,'?historical=1');prepareChartHistory(d);
    const clock=historyHoverClock(d);
    d.run("chartHistory.endTime=Date.parse('2026-06-18T02:00:00Z');initializeHistoryControls();updateHistoryControls()");
    const button=d.nodes.get(id),label=button.textContent;
    assert.equal(button.disabled,false);
    button.events.click();
    assert.equal(button.attributes['data-history-pressed'],'true',id);
    assert.equal(button.textContent,label);
    clock.advance(449);
    assert.equal(button.attributes['data-history-pressed'],'true',id);
    clock.advance(1);
    assert.equal(button.attributes['data-history-pressed'],undefined,id);
    assert.equal(d.network.length,0);
  }
});

test('repeated navigation presses restart feedback and only the latest button stays pressed', () => {
  const d=dashboard(undefined,'?historical=1');prepareChartHistory(d);
  const clock=historyHoverClock(d);
  d.run('initializeHistoryControls();updateHistoryControls()');
  const older=d.nodes.get('historyOlder'),newer=d.nodes.get('historyNewer');
  older.events.click();clock.advance(300);older.events.click();clock.advance(150);
  assert.equal(older.attributes['data-history-pressed'],'true');
  d.run('updateHistoryControls()');newer.events.click();
  assert.equal(older.attributes['data-history-pressed'],undefined);
  assert.equal(newer.attributes['data-history-pressed'],'true');
  clock.advance(450);
  assert.equal(newer.attributes['data-history-pressed'],undefined);
});

test('disabled navigation never shows press feedback and scope resets clear it immediately', () => {
  const d=dashboard(undefined,'?historical=1');prepareChartHistory(d);
  const clock=historyHoverClock(d);
  d.run('initializeHistoryControls();updateHistoryControls()');
  const current=d.nodes.get('historyCurrent'),older=d.nodes.get('historyOlder');
  current.events.click();
  assert.equal(current.attributes['data-history-pressed'],undefined);
  older.events.click();
  d.nodes.get('historyScrollToggle').events.click();
  clock.advance(450);
  assert.equal(older.attributes['data-history-pressed'],undefined);
  older.events.click();
  assert.equal(older.attributes['data-history-pressed'],'true');
  d.run('chartHistory.enabled=true;updateHistoryControls()');older.events.click();
  d.run('resetCorridorHistory()');
  assert.equal(older.attributes['data-history-pressed'],undefined);
  d.run('chartHistory.enabled=true;updateHistoryControls()');older.events.click();
  d.context.window.events.pagehide();
  assert.equal(older.attributes['data-history-pressed'],undefined);
  assert.equal(d.run('historyButtonFeedback.timer'),null);
  clock.advance(450);
  assert.equal(older.attributes['data-history-pressed'],undefined);
});

test('every chart range pans by the same fraction and clamps at both history boundaries', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  for (const hours of [2,6,24,168,720]) {
    d.context.hours = hours;
    d.run('state.selectedHours = hours; chartHistory.endTime = null; panHistoryWindow(historyNavigationStep())');
    const expected = Date.parse('2026-06-19T02:00:00Z') - hours * 3600000 / 2;
    assert.equal(d.run('chartHistory.endTime'), expected);
    d.run('panHistoryWindow(1e15)');
    assert.equal(d.run('chartHistory.endTime'), d.run('historyLimits().firstEnd'));
    d.run('updateHistoryControls()');
    assert.equal(d.nodes.get('historyOlder').disabled, true);
    assert.equal(d.nodes.get('historyNewer').disabled, false);
    assert.equal(d.run('panHistoryWindow(1000)'), false);
    d.run('panHistoryWindow(-1e15)');
    assert.equal(d.run('chartHistory.endTime'), null);
    assert.equal(d.run('panHistoryWindow(-1000)'), false);
  }
  assert.equal(d.run('clampHistoryEnd(5, 20, 10)'), 10);
});

test('historical browsing uses the selected dataset boundary, not a guessed archive limit', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  assert.equal(d.run('historyLimits().firstEnd'), Date.parse('2026-04-13T02:00:00Z'));
  d.run("state.focusedCorridor = 'I25'; state.chartView = 'zones'");
  assert.equal(d.run('historyLimits().firstEnd'), Date.parse('2026-05-21T02:00:00Z'));
  d.run("chartHistory.bounds.get('I25').firstZoneObservedAt = null");
  assert.equal(d.run('historyLimits().available'), false);
  assert.equal(d.run('panHistoryWindow(3600000)'), false);
});

test('a wheel burst schedules only one canvas frame and a debounced history load', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  let frames = 0, pending;
  d.context.window.requestAnimationFrame = () => { frames++; };
  d.context.window.setTimeout = callback => { pending = callback; return 1; };
  for (let i=0;i<40;i++) d.run('panHistoryWindow(30000)');
  assert.equal(frames, 1);
  assert.equal(typeof pending, 'function');
  assert.equal(d.run('chartHistory.loading'), false);
});

test('turning scrolling off preserves button navigation without intercepting graph wheel or keys', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run('initializeHistoryControls(); panHistoryWindow(3600000)');
  const end = d.run('chartHistory.endTime');
  d.nodes.get('historyScrollToggle').events.click();
  assert.equal(d.run('chartHistory.enabled'), false);
  assert.equal(d.nodes.get('chartHistoryDetails').hidden, false);
  assert.doesNotMatch(d.nodes.get('chartHistoryHelp').textContent, /locked|Enable scrolling to navigate/);
  const canvas = d.nodes.get('i25Chart');
  const event = {deltaY:120, key:'ArrowLeft', preventDefault(){throw new Error('Disabled scrolling captured input');}};
  canvas.events.wheel(event);
  canvas.events.keydown(event);
  assert.equal(d.run('chartHistory.endTime'), end);
  for (const id of ['historyFirst', 'historyNewer', 'historyOlder', 'historyCurrent']) {
    assert.equal(d.nodes.get(id).disabled, false);
    d.nodes.get(id).events.click();
    d.run('updateHistoryControls()');
    assert.equal(d.run('chartHistory.enabled'), false);
  }
  assert.equal(d.run('chartHistory.endTime'), null);
  assert.equal(d.nodes.get('chartHistoryDetails').hidden, true);
  assert.equal(d.nodes.get('historyCurrent').disabled, true);
  assert.equal(d.nodes.get('historyNewer').disabled, true);
});

test('history status omits hover instructions without hiding actionable coverage failures', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run('initializeHistoryControls(); updateHistoryControls()');
  assert.equal(d.nodes.get('chartHistoryHelp').textContent, '');
  d.run('chartHistory.hoverReady = true; updateHistoryControls()');
  assert.equal(d.nodes.get('chartHistoryHelp').textContent, '');
  d.run("chartHistory.coverageFailures.set('I70', 'I-70 history bounds unavailable'); updateHistoryControls()");
  assert.match(d.nodes.get('chartHistoryHelp').textContent, /I-70.*unavailable.*Retry/);
  assert.equal(d.nodes.get('historyRetry').hidden, false);
  assert.equal(d.nodes.get('historyRetry').disabled, false);
  assert.doesNotMatch(d.nodes.get('chartHistoryHelp').textContent, /Hover over|Graph scrolling ready/);
});

test('historical windows remain independent of live summaries and automatic refresh', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run('panHistoryWindow(3600000)');
  const end = d.run('chartHistory.endTime');
  d.run("state.routeData.get('I25').summary.latest.polledAt = '2026-06-20T02:00:00Z'");
  assert.equal(d.run('chartEndTime(state.routeData.get("I25"))'), end);
  assert.equal(d.run('routeEndTime(state.routeData.get("I25"))'), Date.parse('2026-06-20T02:00:00Z'));
});

test('history requests are bounded and fetch only graph data for the focused corridor', async () => {
  const paths = [];
  const d = dashboard(async path => { paths.push(path); return {ok:true,json:async()=>({buckets:[],samples:[],features:[],profiles:[]})}; });
  for (const hours of [2,6,24,168,720]) {
    paths.length = 0;
    d.context.hours = hours;
    await d.run("loadChartHistoryRoute('I25', hours, Date.parse('2026-06-18T02:00:00Z'), 'overall')");
    for (const path of paths) {
      assert.match(path, /corridor=I25/);
      assert.match(path, /asOf=/);
      assert.doesNotMatch(path, /summary|operational-status|flow-cells|\/map\/corridors/);
      const url = new URL(path, 'http://test');
      if (url.searchParams.has('limit')) assert.ok(Number(url.searchParams.get('limit')) <= (path.includes('/history?') ? 2000 : 1000));
      if (url.pathname.endsWith('/incidents/timeline')) assert.ok(Number(url.searchParams.get('windowMinutes')) <= 43200);
    }
    assert.equal(paths.some(path => path.includes('/history?')), hours <= 24);
  }
});

test('late history results cannot replace a newer window and only one batch runs at a time', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let reads = 0;
  const d = dashboard(async () => { reads++; await waiting; return {ok:true,json:async()=>({buckets:[],profiles:[],samples:[],features:[]})}; }, '?historical=1');
  prepareChartHistory(d);
  d.run("state.focusedCorridor = 'I25'; panHistoryWindow(3600000)");
  const loading = d.run('loadChartHistory()');
  const firstKey = d.run('historyWindowKey()');
  await d.run('loadChartHistory()');
  assert.equal(reads, 4);
  d.run('panHistoryWindow(3600000)');
  assert.notEqual(d.run('historyWindowKey()'), firstKey);
  release();
  await loading;
  assert.equal(d.run('chartHistory.dataKey'), null);
  assert.equal(d.run('chartHistory.loading'), false);
  assert.equal(d.run('chartHistory.cache.has("' + firstKey + '")'), false);
  await d.run('loadChartHistory()');
  assert.equal(d.run('chartHistory.dataKey'), d.run('historyWindowKey()'));
  assert.equal(reads, 8); // Aborted data, including its baseline, is not cached.
});

test('returning to Current during a historical read prevents a late response from reopening history', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const d = dashboard(async () => { await waiting; return {ok:true,json:async()=>({buckets:[],profiles:[],samples:[],features:[]})}; }, '?historical=1');
  prepareChartHistory(d);
  d.run('panHistoryWindow(3600000)');
  const loading = d.run('loadChartHistory()');
  d.run('setHistoryEnd(null)');
  release(); await loading;
  assert.equal(d.run('chartHistory.endTime'), null);
  assert.equal(d.run('chartHistory.data'), null);
});

test('historical baseline cache follows Denver weeks across DST and is bounded', async () => {
  const d = dashboard(async () => ({ok:true,json:async()=>({profiles:[]})}));
  assert.equal(d.run("historyWeekKey(Date.parse('2026-03-09T05:59:00Z'))"), '2026-03-02');
  assert.equal(d.run("historyWeekKey(Date.parse('2026-03-09T06:00:00Z'))"), '2026-03-09');
  assert.equal(d.run("historyWeekKey(Date.parse('2026-11-02T07:00:00Z'))"), '2026-11-02');
  for (let i=0;i<20;i++) {
    d.context.week = i;
    await d.run("historyBaseline('I25', Date.parse('2026-01-05T12:00:00Z') + week * 7 * 86400000, false)");
  }
  assert.equal(d.run('chartHistory.baselines.size'), 16);
});

test('scrolling to a different week never applies the previous window baseline to it', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run("state.routeData.get('I25').baseline = {profiles:[{meanSpeed:70}]}; panHistoryWindow(14 * 86400000)");
  assert.equal(d.run("chartRouteData('I25')"), null);
  assert.equal(d.run("state.routeData.get('I25').baseline.profiles.length"), 1);
});

test('cached Denver hour parts preserve midnight and both DST transitions', () => {
  const d = dashboard();
  const formatter = new Intl.DateTimeFormat('en-US', {weekday:'short',hour:'numeric',hourCycle:'h23',timeZone:'America/Denver'});
  for (const timestamp of ['2026-03-08T08:59:59Z','2026-03-08T09:00:00Z','2026-11-01T07:59:59Z',
    '2026-11-01T08:00:00Z','2026-11-01T08:59:59Z','2026-11-01T09:00:00Z','2026-06-19T05:59:59Z','2026-06-19T06:00:00Z']) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type,part.value]));
    const day = {Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7}[parts.weekday];
    d.context.timestamp = timestamp;
    assert.equal(d.run('denverProfileKey(timestamp)'), `${day}|${Number(parts.hour)}`);
  }
  assert.equal(d.run("denverCalendarDay('2026-06-19T05:59:59Z')"), '2026-06-18');
  assert.equal(d.run("denverCalendarDay('2026-06-19T06:00:00Z')"), '2026-06-19');
  d.run('for (let i=0;i<5000;i++) denverHourParts(i * 3600000)');
  assert.equal(d.run('DENVER_HOUR_CACHE.size'), 4096);
});

test('indexed legacy baseline matching preserves means and bands without changing samples', () => {
  const d = dashboard();
  const end = Date.parse('2026-11-02T12:00:00Z');
  const source = Array.from({length:192}, (_, i) => ({bucketStart:new Date(end - i * 3600000).toISOString(),avgCurrentSpeed:50 + i % 17}));
  const timestamps = [end - 23.5 * 3600000,end - 15 * 3600000,end - 6 * 3600000,end];
  const hour = new Intl.DateTimeFormat('en-US', {hour:'numeric',hourCycle:'h23',timeZone:'America/Denver'});
  const expected = timestamps.map(timestamp => {
    const previous = source.filter(point => Date.parse(point.bucketStart) >= timestamp - 168 * 3600000
      && Date.parse(point.bucketStart) < timestamp && hour.format(new Date(point.bucketStart)) === hour.format(new Date(timestamp)))
      .sort((a,b) => Date.parse(a.bucketStart) - Date.parse(b.bucketStart));
    const speed = previous.reduce((sum, point) => sum + point.avgCurrentSpeed, 0) / previous.length;
    return {timestamp,speed,standardDeviation:Math.sqrt(previous.reduce((sum,point)=>sum+(point.avgCurrentSpeed-speed)**2,0)/previous.length)};
  });
  d.context.source = source; d.context.timestamps = timestamps;
  assert.deepEqual(JSON.parse(d.run('JSON.stringify(buildLegacyBaselineSeries(source, timestamps))')), expected);
});

test('valid baseline profiles do not scan unused legacy observations', () => {
  const d = dashboard();
  d.run(`
    const oldLegacy = buildLegacyBaselineSeries;
    buildLegacyBaselineSeries = (buckets, timestamps) => {
      if (timestamps.length) throw Error('Unused fallback scan');
      return oldLegacy(buckets, timestamps);
    };
    const profiles = Array.from({length:168}, (_,i) => ({dayOfWeek:Math.floor(i/24)+1,hourOfDay:i%24,meanSpeed:65,standardDeviation:3}));
    buildBaselineSeries([], Date.parse('2026-06-01T00:00:00Z'), Date.parse('2026-06-30T00:00:00Z'), profiles);
  `);
});

test('failed coverage leaves normal scrolling available and can be retried', async () => {
  const d = dashboard(async () => ({ok:false,status:503}));
  d.run('chartHistory.enabled = true');
  await d.run('loadHistoryCoverage()');
  assert.equal(d.run('chartHistory.enabled'), true);
  assert.equal(d.nodes.get('chartHistoryDetails').hidden, false);
  assert.equal(d.run('chartHistory.bounds'), null);
  assert.equal(d.run('panHistoryWindow(3600000)'), false);
  assert.match(d.nodes.get('chartHistoryHelp').textContent, /unavailable.*Retry/);
  d.context.window.fetch = async () => ({ok:true,json:async()=>({firstObservedAt:'2026-01-01T00:00:00Z'})});
  await d.run('loadHistoryCoverage()');
  assert.equal(d.run('chartHistory.bounds.size'), 2);
});

test('button navigation discovers and retries coverage without enabling wheel scrolling', async () => {
  let failed = true;
  const d = dashboard(async () => failed ? {ok:false,status:503}
    : {ok:true,json:async()=>({firstObservedAt:'2026-01-01T00:00:00Z'})});
  d.run('initializeHistoryControls();updateHistoryControls();loadHistoryCoverage()');
  assert.equal(d.nodes.get('historyFirst').disabled, true);
  assert.equal(d.nodes.get('historyOlder').disabled, true);
  await d.run('chartHistory.coveragePromise');
  assert.equal(d.run('chartHistory.enabled'), false);
  assert.equal(d.nodes.get('chartHistoryDetails').hidden, false);
  assert.equal(d.nodes.get('historyRetry').disabled, false);
  assert.match(d.nodes.get('chartHistoryHelp').textContent, /unavailable.*Retry/);
  failed = false;
  d.nodes.get('historyRetry').events.click();
  await d.run('chartHistory.coveragePromise');
  assert.equal(d.run('chartHistory.enabled'), false);
  assert.equal(d.nodes.get('historyFirst').disabled, false);
  assert.equal(d.nodes.get('historyOlder').disabled, false);
  assert.equal(d.nodes.get('chartHistoryDetails').hidden, true);
});

test('empty zone history and partial baseline reads are explicit, never borrowed from the live window', async () => {
  const d = dashboard(async path => path.includes('/zones/trends') ? {ok:false,status:404}
    : path.includes('/baselines') ? {ok:false,status:503} : {ok:true,json:async()=>({features:[]})});
  const route = await d.run("loadChartHistoryRoute('I25', 2, Date.parse('2026-06-18T02:00:00Z'), 'zones')");
  assert.equal(route.zones.length, 0);
  assert.equal(route.zoneBaseline.zones.length, 0);
  assert.equal(route.chartPartial, true);
});

test('historical graph failures show a retry path and do not change live dashboard data', async () => {
  const d = dashboard(async () => ({ok:false,status:503}), '?historical=1');
  prepareChartHistory(d);
  d.run('panHistoryWindow(3600000)');
  await d.run('loadChartHistory()');
  assert.equal(d.run("chartHistory.data.get('I25').trend.buckets.length"), 0);
  assert.equal(d.run("chartHistory.data.get('I70').chartPartial"), true);
  assert.equal(d.run('state.routeData.size'), 1);
  assert.match(d.nodes.get('chartHistoryHelp').textContent, /observations unavailable.*Retry/);
});

test('switching to a wider range or different view does not reuse a narrow historical dataset', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run(`
    chartHistory.data = new Map([['I25', {chartHours:2,chartView:'overall', chartWeek:'2026-06-15', marker:'narrow'}]]);
    state.routeData.get('I25').marker = 'preloaded';
    panHistoryWindow(3600000);
  `);
  assert.equal(d.run("chartRouteData('I25')"), null);
  assert.match(d.run("chartHistoryEmptyMessage('No data')"), /Loading observations/);
  d.run('state.selectedHours = 2');
  assert.equal(d.run("chartRouteData('I25')"), null);
  d.run("state.chartView = 'zones'");
  assert.equal(d.run("chartRouteData('I25')"), null);
  d.run('chartHistory.dataKey = historyWindowKey()');
  assert.equal(d.run("chartHistoryEmptyMessage('No data')"), 'No data');
});

test('demo scrolling uses bounded local chart snapshots without issuing API reads', async () => {
  let reads = 0;
  const d = dashboard(async () => { reads++; throw Error('Unexpected read'); }, '?demo=1');
  prepareChartHistory(d);
  d.run('state.selectedHours = 2');
  for (let i=0;i<10;i++) {
    d.run('panHistoryWindow(3600000)');
    await d.run('loadChartHistory()');
  }
  assert.equal(reads, 0);
  assert.equal(d.run('chartHistory.cache.size'), 8);
});

test('focused chart redraws skip hidden corridors without changing the visible renderer', () => {
  const d = dashboard();
  d.context.drawn = [];
  d.run(`
    state.focusedCorridor = 'I70';
    drawCorridorChart = (canvas, corridor) => drawn.push(corridor);
    drawZoneChart = (canvas, corridor) => drawn.push(corridor + '-zones');
    drawAllCharts();
  `);
  assert.deepEqual(Array.from(d.context.drawn), ['I70']);
  d.run("drawn.length = 0; state.chartView = 'zones'; drawAllCharts()");
  assert.deepEqual(Array.from(d.context.drawn), ['I70-zones']);
});

test('capped historical incident markers explain the limit instead of suggesting an ineffective retry', async () => {
  const d = dashboard(async path => ({ok:true,json:async()=>path.includes('/incidents/timeline')
    ? {features:Array.from({length:1000},(_,i)=>({id:i,properties:{firstSeenAt:'2026-06-18T00:00:00Z',lastSeenAt:'2026-06-18T01:00:00Z'}}))}
    : {buckets:[],profiles:[]}}));
  const route = await d.run("loadChartHistoryRoute('I25', 720, Date.parse('2026-06-18T02:00:00Z'), 'overall')");
  assert.equal(route.chartPartial, false);
  assert.match(route.chartNote, /latest 1,000.*shorter range/);
});

test('marker limits stay inline and remain available with wheel scrolling disabled', async () => {
  const d = dashboard(async path => ({ok:true,json:async()=>path.includes('/incidents/timeline')
    ? {features:Array.from({length:1000},(_,i)=>({id:i,properties:{firstSeenAt:'2026-06-18T00:00:00Z',lastSeenAt:'2026-06-18T01:00:00Z'}}))}
    : {buckets:[],profiles:[]}}), '?historical=1');
  prepareChartHistory(d);
  const route = await d.run("loadChartHistoryRoute('I25', 24, Date.parse('2026-06-18T02:00:00Z'), 'overall')");
  d.context.cappedRoute = route;
  d.run("chartHistory.endTime=Date.parse('2026-06-18T02:00:00Z');chartHistory.data=new Map([['I25',cappedRoute]]);chartHistory.dataKey=historyWindowKey();chartHistory.enabled=false;updateHistoryControls()");
  const notice = d.nodes.get('chartHistoryMarkerNotice');
  assert.equal(d.nodes.get('chartHistoryDetails').hidden, false);
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, 'Incident markers limited');
  assert.match(notice.title, /I-25.*latest 1,000.*shorter range/);
  assert.equal(notice.attributes['aria-label'], notice.title);
  assert.doesNotMatch(d.nodes.get('chartHistoryHelp').textContent, /1,000|markers are limited/);
  assert.doesNotMatch(d.nodes.get('chartHistoryHelp').textContent, /locked/);
  d.run('chartHistory.dataKey="stale";updateHistoryControls()');
  assert.equal(notice.hidden, true);
  assert.equal(notice.title, '');
  d.run('chartHistory.endTime=null;updateHistoryControls()');
  assert.equal(d.nodes.get('chartHistoryDetails').hidden, true);
});
test('history keyboard navigation and wheel edges preserve normal page and modifier behavior', () => {
  const d=dashboard(undefined,'?historical=1'); prepareChartHistory(d);
  const clock=historyHoverClock(d);d.run('initializeHistoryControls()');
  const canvas=d.nodes.get('i25Chart');let prevented=0;
  const key=key=>({key,preventDefault(){prevented++;}});
  canvas.events.pointerenter({pointerType:'mouse'});clock.advance(3000);
  canvas.events.keydown(key('Home'));assert.equal(d.run('chartHistory.endTime'),d.run('historyLimits().firstEnd'));
  canvas.events.wheel({deltaY:100,preventDefault(){prevented++;}});assert.equal(prevented,1);
  assert.equal(d.run('chartHistory.hoverReady'),false);
  canvas.events.keydown({...key('ArrowRight'),shiftKey:true});assert.equal(prevented,1);
  canvas.events.keydown(key('End'));assert.equal(d.run('chartHistory.endTime'),null);
  clock.advance(3000);
  canvas.events.wheel({deltaY:-100,preventDefault(){prevented++;}});assert.equal(prevented,2);
  canvas.events.keydown(key('ArrowLeft'));assert.ok(d.run('chartHistory.endTime')>0);
  assert.equal(prevented,3);
});

test('one failed coverage read keeps the other corridor navigable and retries only missing bounds', async () => {
  let failed=true;const reads=[];
  const d=dashboard(async path=>{reads.push(path);return path.includes('I70')&&failed
    ? {ok:false,status:503}:{ok:true,json:async()=>({firstObservedAt:'2026-01-01T00:00:00Z'})};});
  d.run('chartHistory.enabled=true');await d.run('loadHistoryCoverage()');
  assert.equal(d.run('chartHistory.enabled'),true);assert.equal(d.run('chartHistory.bounds.size'),1);
  assert.equal(d.run('historyLimits().available'),true);assert.equal(reads.length,2);
  d.run("state.focusedCorridor='I70';updateHistoryControls()");
  assert.equal(d.run('historyLimits().available'),false);
  assert.match(d.nodes.get('chartHistoryHelp').textContent,/I-70.*unavailable.*Retry/);
  assert.equal(d.nodes.get('historyRetry').hidden,false);
  failed=false;await d.run('loadHistoryCoverage()');
  assert.equal(reads.length,3);assert.match(reads[2],/corridor=I70/);
  assert.equal(d.run('chartHistory.bounds.size'),2);
});

test('failed historical observations cannot hide the successful corridor or replace live metrics', async () => {
  const d=dashboard(async path=>path.includes('I70')&&path.includes('/analytics/trends')
    ? {ok:false,status:503}:{ok:true,json:async()=>({buckets:[{bucketStart:'2026-06-18T00:00:00Z',avgCurrentSpeed:55}],profiles:[],samples:[],features:[]})},'?historical=1');
  prepareChartHistory(d);d.run("state.routeData.get('I25').summary.latest.avgCurrentSpeed=61;panHistoryWindow(3600000)");
  await d.run('loadChartHistory()');
  assert.equal(d.run("chartRouteData('I25').trend.buckets.length"),1);
  assert.equal(d.run("chartRouteData('I70').trend.buckets.length"),0);
  assert.equal(d.run("chartRouteData('I70').chartPartial"),true);
  assert.equal(d.run("chartHistoryEmptyMessage('No retained data','I70')"),'History could not load. Choose Retry or Current.');
  assert.equal(d.run("chartHistoryEmptyMessage('No retained data','I25')"),'No retained data');
  assert.equal(d.run("state.routeData.get('I25').summary.latest.avgCurrentSpeed"),61);
  assert.match(d.nodes.get('chartHistoryHelp').textContent,/I-70.*unavailable.*Retry/);
});

test('Current aborts every in-flight chart request and never caches cancelled observations', async () => {
  const signals=[];const d=dashboard(async (path,options)=>{signals.push(options.signal);
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  },'?historical=1');
  prepareChartHistory(d);d.run("state.focusedCorridor='I25';panHistoryWindow(3600000)");
  const pending=d.run('loadChartHistory()');await new Promise(setImmediate);assert.equal(signals.length,4);
  d.run('setHistoryEnd(null)');await pending;
  assert.ok(signals.every(signal=>signal.aborted));
  assert.equal(d.run('chartHistory.cache.size'),0);assert.equal(d.run('chartHistory.baselines.size'),0);
  assert.equal(d.run('chartHistory.endTime'),null);assert.equal(d.run('chartHistory.loading'),false);
});

test('history pauses hidden reads and late drawings and resumes a preserved back-forward window', () => {
  const d=dashboard(undefined,'?historical=1');prepareChartHistory(d);
  let frame,draws=0,timers=0;d.context.draws=()=>draws++;
  d.context.window.requestAnimationFrame=callback=>{frame=callback;};
  d.context.window.setTimeout=()=>{timers++;return timers;};
  d.run('drawAllCharts=()=>draws();initializeHistoryControls();panHistoryWindow(3600000)');
  const end=d.run('chartHistory.endTime');d.context.document.hidden=true;
  d.context.document.events.visibilitychange();frame();
  assert.equal(draws,0);assert.equal(d.run('chartHistory.timer'),null);
  d.context.window.events.pagehide({persisted:true});
  assert.equal(d.run('chartHistory.disposed'),true);
  d.context.document.hidden=false;d.context.window.events.pageshow({persisted:true});
  assert.equal(d.run('chartHistory.disposed'),false);assert.equal(d.run('chartHistory.endTime'),end);
  assert.ok(d.run('chartHistory.timer')>0);assert.ok(timers>=2);
});

test('rapid window changes share one drawing and paced latest-window read without immediate fetches', () => {
  let reads=0;const d=dashboard(async()=>{reads++;throw Error('Unexpected immediate read');},'?historical=1');
  prepareChartHistory(d);let delay,scheduled=0,frames=0;
  d.context.window.setTimeout=(callback,ms)=>{delay=ms;scheduled++;return scheduled;};
  d.context.window.requestAnimationFrame=()=>{frames++;};
  d.run('chartHistory.lastReadAt=Date.now();for(let i=0;i<40;i++)panHistoryWindow(30000)');
  assert.ok(delay>=3900&&delay<=4000);assert.equal(frames,1);assert.equal(reads,0);
  assert.equal(d.run('chartHistory.timer'),scheduled);
});

test('a server Retry-After suspends historical reads without automatically retrying or locking Current', async () => {
  let reads=0;const d=dashboard(async()=>{reads++;return{ok:false,status:429,headers:{get:()=> '60'}};},'?historical=1');
  prepareChartHistory(d);d.run("state.focusedCorridor='I25';panHistoryWindow(3600000)");
  await d.run('loadChartHistory()');assert.equal(reads,4);
  assert.ok(d.run('chartHistory.rateUntil')>Date.now()+59000);
  assert.equal(d.nodes.get('historyRetry').disabled,true);
  assert.match(d.nodes.get('chartHistoryHelp').textContent,/read limit.*Retry available/);
  d.run('panHistoryWindow(3600000)');await d.run('loadChartHistory()');assert.equal(reads,4);
  d.run('setHistoryEnd(null)');assert.equal(d.run('chartHistory.endTime'),null);
});

test('partial historical windows are never mistaken for a reusable complete cache entry', async () => {
  let reads=0;const d=dashboard(async path=>{reads++;return path.includes('/baselines')?{ok:false,status:503}
    :{ok:true,json:async()=>({buckets:[],samples:[],features:[]})};},'?historical=1');
  prepareChartHistory(d);d.run("state.focusedCorridor='I25';panHistoryWindow(3600000)");
  await d.run('loadChartHistory()');const before=reads;
  d.run('chartHistory.dataKey=null;refreshHistorySelection()');
  assert.equal(d.run('chartHistory.dataKey'),null);assert.equal(d.run("chartRouteData('I25')"),null);
  await d.run('loadChartHistory()');assert.equal(reads,before+4);
});

test('invalid and future coverage times cannot create a navigable historical range', () => {
  const d=dashboard(undefined,'?historical=1');prepareChartHistory(d);
  d.run("chartHistory.bounds=new Map([['I25',{firstObservedAt:'invalid'}],['I70',{firstObservedAt:'2999-01-01T00:00:00Z'}]])");
  assert.equal(d.run('historyLimits().available'),false);assert.equal(d.run('panHistoryWindow(1000)'),false);
});

test('switching to unavailable coverage preserves the window and retry resumes it without false reads', async () => {
  let reads=0;const d=dashboard(async()=>{reads++;return{ok:true,json:async()=>({firstObservedAt:'2026-01-01T00:00:00Z',firstZoneObservedAt:'2026-01-01T00:00:00Z'})};},'?historical=1');
  prepareChartHistory(d);d.run("state.focusedCorridor='I25';panHistoryWindow(3600000)");
  const end=d.run('chartHistory.endTime');
  d.run("chartHistory.bounds.delete('I70');chartHistory.coverageFailures.set('I70','I-70 history bounds unavailable');state.focusedCorridor='I70';refreshHistorySelection();updateHistoryControls()");
  assert.equal(d.run('chartHistory.endTime'),end);assert.equal(d.run('chartHistory.timer'),null);
  assert.equal(d.run("chartRouteData('I70')"),null);assert.equal(reads,0);
  assert.match(d.nodes.get('chartHistoryHelp').textContent,/I-70.*unavailable.*Retry/);
  await d.run('loadHistoryCoverage()');
  assert.equal(reads,1);assert.equal(d.run('chartHistory.endTime'),end);
  assert.ok(d.run('chartHistory.timer')>0);
});

test('pending speed-zone windows preserve chart height instead of moving the pointer off the graph', () => {
  const d=dashboard(undefined,'?historical=1');prepareChartHistory(d);
  const changes=[];d.context.canvas={closest(){return{style:{setProperty(key,value){changes.push(value);}}};},getContext(){return{clearRect(){}};}};
  d.run("state.focusedCorridor='I25';state.chartView='zones';panHistoryWindow(3600000);sizeCanvas=()=>({width:800,height:1028});drawEmptyChart=()=>{};drawZoneChart(canvas,'I25',null)");
  assert.deepEqual(changes,[]);
  d.run("chartHistory.dataKey=historyWindowKey();drawZoneChart(canvas,'I25',null)");
  assert.deepEqual(changes,['280px']);
});

function dashboard(fetch = async () => { throw new Error('Offline'); }, search = '', pathname = '/dashboard/', replayEnabled, preparedHistory, timeZone = 'America/Denver') {
  const batchedFetch = require("./dashboard-batch-fixture.cjs").batchFetch(fetch);
  const nodes = new Map();
  function node() {
    return { textContent: '', style: {}, dataset: {}, children: [], attributes: {}, events: {},
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      addEventListener(name, handler) { this.events[name] = handler; }, querySelector() { return node(); }, querySelectorAll() { return []; } };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const browserIntl = Object.create(Intl);
  browserIntl.DateTimeFormat = function(locale, options) {
    if (timeZone === null && !options) throw new Error('Timezone detection unavailable');
    return new Intl.DateTimeFormat(locale, { timeZone: timeZone || 'America/Denver', ...options });
  };
  const context = vm.createContext({ URLSearchParams, URL, AbortSignal, AbortController, console, Date, Intl: browserIntl,
    window: { events: {}, addEventListener(name,handler) { this.events[name]=handler; }, location: { search, pathname }, fetch: batchedFetch, requestAnimationFrame() {},
      setTimeout() { return 1; }, clearTimeout() {},
      localStorage: { getItem() { throw new Error('Blocked'); } } },
    document: { events: {}, addEventListener(name,handler) { this.events[name]=handler; }, getElementById: get, createElement: node, createElementNS: node, querySelector: () => null,
      querySelectorAll: () => [], documentElement: node(), body: node() } });
  if (preparedHistory !== undefined) context.document.documentElement.dataset.preparedHistory = String(preparedHistory);
  if (replayEnabled !== undefined) context.document.documentElement.dataset.replayEnabled = String(replayEnabled);
  vm.runInContext(estimatesSource, context);
  vm.runInContext(historySource, context);
  vm.runInContext(continuousSource, context);
  vm.runInContext(source.replace('\ninitializeDashboard();', ''), context);
  return { nodes, context, network: batchedFetch.network, run: code => vm.runInContext(code, context) };
}
function summaryFixture(load = async path => {
  const url=new URL(path,'http://fixture');const hours=Number(url.searchParams.get('hours'));
  const end=Date.parse(url.searchParams.get('asOf'));
  return {ok:true,json:async()=>Object.fromEntries(url.searchParams.get('corridors').split(',').map(corridor=>[corridor,{
    corridor,hours,start:new Date(end-hours*3600000).toISOString(),end:new Date(end).toISOString(),bucketMinutes:15,
    averageSpeed:55,averageTravelMinutes:70,fastestTravelMinutes:60,slowestTravelMinutes:90,
    observedIncidents:1501,worstZone:{startMileMarker:220,endMileMarker:221,speedMph:40},
    speedAvailable:true,zonesAvailable:true,incidentsAvailable:true}]))};
}) {
  const reads=[];const d=dashboard(async(path,options)=>{reads.push({path,options});return load(path,options);},'?historical=1');
  prepareChartHistory(d);
  const clock=historyHoverClock(d);
  d.run("chartHistory.endTime=Date.parse('2026-06-18T02:00:00Z');state.selectedHours=24;chartHistory.data=new Map(CORRIDOR_IDS.map(c=>[c,{trend:{buckets:[]}}]));chartHistory.dataKey=historyWindowKey()");
  vm.runInContext(windowSummarySource,d.context);
  return {d,reads,clock,async settle(){await new Promise(setImmediate);await new Promise(setImmediate);},
    move(end,hours=24){d.run(`chartHistory.endTime=${end};state.selectedHours=${hours};chartHistory.dataKey=historyWindowKey();window.HistoricalSummary.schedule()`);}};
}

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

function progressiveSummaryFixture() {
  let streamController,url;
  const f=summaryFixture(async path=>{
    url=new URL(path,'http://fixture');
    return {ok:true,headers:{get:name=>name==='Content-Type'?'application/x-ndjson':null},
      body:new ReadableStream({start(controller){streamController=controller;}})};
  });
  f.d.context.TextDecoder=TextDecoder;f.d.context.ReadableStream=ReadableStream;
  const summary=(corridor,fields={})=>{
    const hours=Number(url.searchParams.get('hours')),end=Date.parse(url.searchParams.get('asOf'));
    return {corridor,hours,start:new Date(end-hours*3600000).toISOString(),end:new Date(end).toISOString(),
      averageSpeed:55,lowestObservedSpeed:41,speedAvailable:true,zonesAvailable:false,incidentsAvailable:false,...fields};
  };
  return {...f,summary,
    async start(){f.d.run('window.HistoricalSummary.schedule()');f.clock.advance(150);await f.settle();},
    push(summaries,complete=false){streamController.enqueue(new TextEncoder().encode(JSON.stringify({summaries,complete})+'\n'));},
    raw(text){streamController.enqueue(new TextEncoder().encode(text));},
    end(){streamController.close();}};
}

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

function continuousFixture(search = '?historical=1&continuous=1') {
  const reads = [];
  const d = dashboard(async (path) => {
    reads.push(path);
    const url = new URL(path, 'http://fixture');
    const end = Date.parse(url.searchParams.get('asOf'));
    const hours = Math.min(720, Number(url.searchParams.get('windowHours') || 24));
    const buckets = Number.isFinite(end) ? Array.from({length: hours + 1}, (_, i) => ({
      bucketStart: new Date(end - (hours - i) * 3600000).toISOString(), avgCurrentSpeed: 40 + i % 20
    })) : [];
    return {ok:true,json:async()=>({buckets, profiles:[], points:[], samples:[], features:[]})};
  }, search);
  prepareChartHistory(d);
  let now = Date.parse('2026-06-19T02:00:00Z'), next = 0;
  d.context.Date = class extends Date {static now(){return now;}};
  const timers = historyHoverClock(d), frames = new Map();
  d.context.window.requestAnimationFrame = callback => {frames.set(++next, callback);return next;};
  d.context.window.cancelAnimationFrame = id => frames.delete(id);
  return {d, reads: d.network, frames,
    advance(ms) {now += ms;timers.advance(ms);},
    frame(ms = 16) {now += ms;const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(now));},
    settle: () => new Promise(resolve=>setImmediate(resolve))};
}

function preparedFixture() {
  const f = continuousFixture('?historical=1&continuous=1&prepared=1');
  f.d.run(`chartHistory.enabled=false;
    chartHistory.bounds.forEach(value=>value.firstZoneObservedAt=value.firstObservedAt);
    state.snapshots=new Map(DASHBOARD_RANGE_HOURS.map(hours=>[hours,{routeData:new Map(CORRIDOR_IDS.map(
      corridor=>[corridor,{...state.routeData.get('I25'),baseline:{profiles:[]},zoneBaseline:{zones:[]}}]))}]));`);
  return f;
}

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

function axisFixture() {
  const f = continuousFixture();
  f.d.context.profiles = Array.from({length:168}, (_, i) => ({dayOfWeek:Math.floor(i/24)+1,
    hourOfDay:i%24, meanSpeed:60, standardDeviation:15}));
  f.d.run(`state.selectedHours=2;state.referenceSigma=2;
    state.routeData.set('I25',{summary:{latest:{polledAt:'2026-06-19T02:00:00Z'}},
      trend:{buckets:[]},history:{samples:[
        {polledAt:'2026-06-19T00:10:00Z',avgCurrentSpeed:58},
        {polledAt:'2026-06-19T01:50:00Z',avgCurrentSpeed:62}]},
      baseline:{profiles},incidentThreads:[]});`);
  setContinuousFetch(f, async path => {
    const end = Date.parse(new URL(path,'http://fixture').searchParams.get('asOf'));
    return {ok:true,json:async()=>({buckets:[],points:[],profiles:f.d.context.profiles,
      samples:[{polledAt:new Date(end-1800000).toISOString(),avgCurrentSpeed:60}],features:[]})};
  });
  const frames = [], arrows = [], attributes = {};
  const context = {setTransform(){},clearRect(){},drawImage(){},save(){},restore(){},beginPath(){},
    moveTo(){},lineTo(){},stroke(){arrows.push(true);}};
  f.d.context.document.createElement=()=>({getContext:()=>context});
  f.d.context.canvas = {width:0,height:0,getBoundingClientRect:()=>({width:1000,height:180}),
    getContext:()=>context,closest:()=>({style:{removeProperty(){},setProperty(){}}}),
    setAttribute(key,value){attributes[key]=value;}};
  f.d.context.capture = frame => frames.push(frame);
  f.d.run('drawCorridorChart=(canvas,corridor,data,frame)=>capture(frame);chartColors=()=>({muted:"gray"})');
  return {...f, bakes:frames, arrows, attributes, paint:()=>f.d.run("window.ContinuousHistory.paint(canvas,'I25')")};
}

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
  const success=require('./dashboard-batch-fixture.cjs').batchFetch(async()=>({ok:true,
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

function setContinuousFetch(f, fetch) {
  const batch = require('./dashboard-batch-fixture.cjs').batchFetch(fetch);
  f.d.context.window.fetch = batch;
  f.reads = batch.network;
}

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
  const server=require('node:http').createServer(require('./dashboard-preview.cjs').handleRequest);
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

function informationPage(fetch = async () => { throw new Error('Offline'); }, pathname = '/dashboard/system.html', architectureItems = [], initialize = false) {
  const nodes = new Map();
  const pageName = pathname.endsWith('/data.html') ? 'data' : pathname.endsWith('/api.html') ? 'api' : 'system';
  const ownedIds = new Set([...informationPages[pageName].matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]));
  function node(tagName = 'div') {
    const classes = new Set();
    return { tagName, textContent: '', className: '', dataset: {}, attributes: {}, children: [], disabled: false,
      events: {}, classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        toggle(name, force) { force === false ? classes.delete(name) : classes.add(name); },
        contains(name) { return classes.has(name); }
      },
      appendChild(child) { this.children.push(child); return child; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(name, handler) { this.events[name] = handler; },
      querySelector() { return node(); },
      closest() { return null; },
      matches(selector) { return selector === '[tabindex]' && this.tabIndex !== undefined; } };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const context = vm.createContext({ console, Date, Intl, Number, String, AbortSignal,
    window: { location: { pathname }, fetch, setTimeout() { return 1; }, clearTimeout() {},
      localStorage: { getItem() { return null; }, setItem() {} } },
    document: { getElementById: id => ownedIds.has(id) ? get(id) : null,
      createElement: node, createTextNode: text => ({ textContent: text }),
      querySelectorAll: () => architectureItems, documentElement: node('html') } });
  vm.runInContext(initialize ? informationSource : informationSource.replace('\ninitializeInformationPage();', ''), context);
  return { nodes, context, run: code => vm.runInContext(code, context) };
}

test('primary navigation stays within the dashboard for project information pages', () => {
  assert.match(indexSource, /href="system\.html">System/);
  assert.match(indexSource, /href="data\.html">About the Data/);
  assert.match(indexSource, /href="api\.html">API/);
  assert.doesNotMatch(indexSource, /href="#system-health">System/);
  assert.match(informationPages.system, /class="active" href="system\.html" aria-current="page"/);
  assert.match(informationPages.data, /class="active" href="data\.html" aria-current="page"/);
  assert.match(informationPages.api, /class="active" href="api\.html" aria-current="page"/);
});

function borderTraceFixture() {
  const order=[],frames=new Map(),events={},observers=[];
  let nextFrame=0;
  const panels=[240,360].map(width=>{
    const classes=new Set(),children=[];
    return { get clientWidth(){order.push('read');return width;},
      get clientHeight(){order.push('read');return 120;},
      classList:{add(name){classes.add(name);}},children,
      appendChild(child){children.push(child);},classes };
  });
  const page=informationPage(undefined,'/dashboard/system.html',panels);
  const create=page.context.document.createElement;
  page.context.document.createElementNS=(_,tag)=>{
    const node=create(tag),set=node.setAttribute.bind(node);
    node.setAttribute=(name,value)=>{if(name==='viewBox'||name==='d')order.push('write');set(name,value);};
    return node;
  };
  Object.assign(page.context.window,{
    requestAnimationFrame(callback){const id=++nextFrame;frames.set(id,callback);return id;},
    cancelAnimationFrame(id){frames.delete(id);},
    getComputedStyle(){order.push('read');return {borderTopLeftRadius:'12px'};},
    addEventListener(name,callback){events[name]=callback;},
    ResizeObserver:class {
      constructor(callback){this.callback=callback;observers.push(this);}
      observe(){} disconnect(){this.disconnected=true;}
    }
  });
  const flush=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(callback=>callback());};
  page.run('initializePanelBorderTraces()');
  return {panels,page,frames,order,observers,events,flush};
}

test('panel traces draw two bounded halves after batched geometry reads and then settle',()=>{
  const f=borderTraceFixture();
  assert.equal(f.frames.size,1);f.flush();
  assert.equal(f.frames.size,0);
  assert.ok(f.order.lastIndexOf('read')<f.order.indexOf('write'));
  for(const panel of f.panels){
    assert.ok(panel.classes.has('has-border-trace'));
    const svg=panel.children[0];assert.equal(svg.attributes['aria-hidden'],'true');
    assert.equal(svg.children.length,2);
    assert.ok(svg.children.every(path=>path.attributes.pathLength==='1'&&!/NaN|Infinity/.test(path.attributes.d)));
    assert.notEqual(svg.children[0].attributes.d,svg.children[1].attributes.d);
  }
  f.order.length=0;
  f.observers[0].callback(f.panels.map(target=>({target})));
  f.observers[0].callback(f.panels.map(target=>({target})));
  assert.equal(f.frames.size,1);f.flush();assert.ok(!f.order.includes('write'));
});

test('panel trace resizing is cancelled on disposal but preserved through back-forward caching',()=>{
  const f=borderTraceFixture();
  f.events.pagehide({persisted:true});assert.equal(f.frames.size,1);
  f.events.pagehide({persisted:false});assert.equal(f.frames.size,0);
  assert.equal(f.observers[0].disconnected,true);
  f.observers[0].callback(f.panels.map(target=>({target})));
  assert.equal(f.frames.size,0);
});

test('drawn borders preserve timed travel without hover shadows or reduced-motion transitions',()=>{
  assert.match(informationStyles,/stroke-dashoffset 720ms/);
  assert.match(informationStyles,/\.has-border-trace::after\s*\{\s*display: none/);
  assert.match(informationStyles,/\.panel-border-trace path\s*\{\s*transition: none/);
  const panelRule=informationStyles.match(/\.architecture-node,\s*\.pipeline-card,\s*\.provider-control\s*\{([^}]+)\}/)[1];
  assert.doesNotMatch(panelRule,/transition:[^;]*(box-shadow|filter)/);
});

test('information heroes use one shared title scale across pages and breakpoints', () => {
  assert.match(informationStyles,/\.information-hero h1\s*\{[^}]*font-size: clamp\(32px, 6vw, 58px\)/s);
  assert.doesNotMatch(informationStyles,/\.(?:data|api)-hero h1\s*\{[^}]*font-size:/s);
});

const dataHeroSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/data-hero-map.js'), 'utf8');

function dataHero({ pathname='/dashboard-experimental/data.html', features, fetch, delayedGeometry,
  styleLoaded=true, loader, visible, reduced=false, animate=true, summaries, snapshots, paceFetch } = {}) {
  const classes=new Set(), events={}, frames=new Map(), timers=new Map(), observers=[];
  const state={ maps:[], reads:[], paint:[], fits:[], removed:0, resized:0, projected:0, options:null, overlays:[] };
  const classList=set=>({add(...names){names.forEach(name=>set.add(name));},toggle(name,value){if(value)set.add(name);else set.delete(name);}});
  const node={clientWidth:480,clientHeight:320,classList:classList(classes),querySelector:()=>null,
    appendChild(overlay){state.overlays.push(overlay);}};
  const status={textContent:''},labels={i25MapPace:{},i70MapPace:{}},canvas={setAttribute(){}};
  const clock=Date.parse('2026-10-07T17:00:00Z');
  class FixtureDate extends Date {static now(){return clock;}}
  let serial=0;
  const renderer={Map:class {
    constructor(options){state.maps.push(this);state.options=options;this.handlers={};}
    addControl(){}
    on(name,handler){this.handlers[name]=handler;}
    once(name,handler){this.handlers[name]=handler;}
    isStyleLoaded(){return styleLoaded;}
    getCanvas(){return canvas;}
    resize(){state.resized++;}
    fitBounds(bounds,options){state.fits.push({bounds,options});}
    project([longitude,latitude]){state.projected++;return {x:(longitude+106)*100*node.clientWidth/480,y:(41-latitude)*100*node.clientHeight/320};}
    getLayer(id){return state.options.style.layers.some(layer=>layer.id===id);}
    setPaintProperty(...args){state.paint.push(args);}
    remove(){state.removed++;}
  },AttributionControl:class {}};
  const validFeatures=features??[
    {type:'Feature',id:'I25',properties:{corridor:'I25',startMileMarker:208,endMileMarker:271},geometry:{type:'LineString',coordinates:[[-105,39.6],[-105,40.4]]}},
    {type:'Feature',id:'I70',properties:{corridor:'I70',startMileMarker:206,endMileMarker:274},geometry:{type:'MultiLineString',coordinates:[[[-106,39.7],[-105,39.8]]]}}
  ];
  class Observer{
    constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}
    observe(){}
    disconnect(){this.disconnected=true;}
  }
  const motion={matches:reduced,addEventListener(name,callback){this.callback=callback;},removeEventListener(){this.callback=null;}};
  const document={hidden:false,documentElement:{dataset:{}},
    addEventListener(name,callback){events[name]=callback;},
    getElementById:id=>id==='dataHeroMap'?node:id==='dataHeroMapStatus'?status:labels[id]||null,
    createElement(){
      const overlay={classList:classList(new Set()),dataset:{},setAttribute(){},animations:[]};
      if(animate)overlay.animate=(keyframes,options)=>{
        const animation={keyframes,options,currentTime:0,playbackRate:1,playState:'running',
          cancel(){this.playState='idle';this.cancelled=true;},pause(){this.playState='paused';},
          play(){this.playState='running';},updatePlaybackRate(rate){this.playbackRate=rate;}};
        overlay.animations.push(animation);return animation;
      };
      return overlay;
    }
  };
  const context=vm.createContext({console,Number,String,URL,AbortSignal,AbortController,Date:FixtureDate,document,
    window:{
      location:{pathname}, DATA_HERO_RENDERER_LOADER:loader??(async()=>renderer),matchMedia:()=>motion,
      ...(visible===undefined?{}:{IntersectionObserver:class extends Observer{
        observe(){this.callback([{target:node,isIntersecting:visible}]);}
      }}),
      fetch:async(url,options)=>{
        state.reads.push({url,options});
        if(fetch)return fetch(url,options);
        const override=paceFetch?.(url,options);
        if(override!==undefined)return override;
        const corridor=new URL(url,'https://example.test').searchParams.get('corridor')||'I25';
        let payload;
        if(url.endsWith('/map/config'))payload={tileUrl:'https://example.test/detail/{z}/{x}/{y}.png',
          overviewTileUrl:'https://example.test/normal/{z}/{x}/{y}.png',detailMinZoom:10,maxZoom:19,attribution:'Test'};
        else if(url.includes('/summary?'))payload=summaries?.[corridor]??{corridor,
          latest:{avgCurrentSpeed:120,polledAt:new Date(clock-60000).toISOString()}};
        else if(url.includes('/flow-cells/current?'))payload=snapshots?.[corridor]??{corridor,
          observedAt:new Date(clock-60000).toISOString(),cells:[{
            startMileMarker:corridor==='I25'?208:206,endMileMarker:corridor==='I25'?271:274,
            direction:'COMBINED',speedMph:60}]};
        else payload=delayedGeometry?delayedGeometry():{type:'FeatureCollection',features:validFeatures};
        return {ok:true,json:async()=>payload};
      },
      requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},
      cancelAnimationFrame:id=>frames.delete(id),
      setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},
      clearTimeout:id=>timers.delete(id),ResizeObserver:Observer,MutationObserver:Observer,
      addEventListener:(name,fn)=>events[name]=fn
    }});
  vm.runInContext(estimatesSource,context);
  vm.runInContext(dataHeroSource,context);
  const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
  const flushFrames=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());};
  const fireTimer=()=>{const [id,timer]=[...timers][0];timers.delete(id);timer.fn();};
  return {context,node,state,status,labels,classes,events,frames,timers,observers,settle,flushFrames,fireTimer,document,motion,clock};
}

test('Data hero uses tracked geometry, normal overview tiles and six bounded startup reads', async()=>{
  const hero=dataHero();await hero.settle();
  assert.equal(hero.state.maps.length,1);
  assert.equal(hero.state.reads.length,6);
  assert.ok(hero.state.reads.every(read=>read.url.startsWith('/dashboard-experimental-api/') && read.options.signal instanceof AbortSignal));
  const style=hero.state.options.style;
  assert.equal(style.sources['base-map-overview'].tiles[0],'https://example.test/normal/{z}/{x}/{y}.png');
  assert.equal(style.layers.find(layer=>layer.id==='hero-base-map-overview').maxzoom,10);
  assert.equal(style.layers.find(layer=>layer.id==='hero-base-map').minzoom,10);
  assert.equal(style.layers.find(layer=>layer.id==='hero-i25').paint['line-color'],'#4fbe7d');
  assert.equal(style.layers.find(layer=>layer.id==='hero-i70').paint['line-color'],'#df7680');
  assert.equal(hero.state.options.interactive,false);
  assert.match(hero.status.textContent,/2 corridors/);
  hero.flushFrames();assert.equal(hero.frames.size,0);
  assert.equal(hero.timers.size,1);
  assert.ok([...hero.timers.values()][0].ms <= 60000);
  assert.doesNotMatch(dataHeroSource,/setInterval|requestAnimationFrame\(animate|pulse-opacity|line-gradient/);
});

test('Data hero rejects empty, malformed and out-of-world lines before allocating WebGL', async()=>{
  for(const coordinates of [[],[[-105,40]],[[NaN,40],[-105,40]],[[181,40],[-105,40]],[[-105,91],[-105,40]]]){
    const hero=dataHero({features:[{properties:{corridor:'I25'},geometry:{type:'LineString',coordinates}}]});
    await hero.settle();assert.equal(hero.state.maps.length,0);
    assert.match(hero.status.textContent,/Refresh this page to retry/);
  }
});

test('Data hero coalesces resize notifications without an ongoing render loop', async()=>{
  const hero=dataHero();await hero.settle();hero.flushFrames();
  const resize=hero.observers[1];
  resize.callback();resize.callback();resize.callback();
  assert.equal(hero.frames.size,1);
  const count=hero.state.resized;hero.flushFrames();
  assert.equal(hero.state.resized,count+1);assert.equal(hero.frames.size,0);
});

test('Data hero preserves its renderer through the back-forward cache and cleans up real navigation', async()=>{
  const hero=dataHero();await hero.settle();hero.flushFrames();
  hero.events.pagehide({persisted:true});assert.equal(hero.state.removed,0);
  hero.events.pageshow({persisted:true});assert.equal(hero.frames.size,1);hero.flushFrames();
  hero.events.pagehide({persisted:false});assert.equal(hero.state.removed,1);
  assert.ok(hero.observers.every(observer=>observer.disconnected));
  assert.equal(hero.frames.size,0);
});

test('Data hero cannot allocate a renderer after geometry resolves on a departed page', async()=>{
  let release;
  const hero=dataHero({delayedGeometry:()=>new Promise(resolve=>release=resolve)});
  await hero.settle();hero.events.pagehide({persisted:false});
  release({features:[{properties:{corridor:'I25'},geometry:{type:'LineString',coordinates:[[-105,39],[-105,40]]}}]});
  await hero.settle();assert.equal(hero.state.maps.length,0);
});

test('Data hero explains missing WebGL without interfering with other page content', async()=>{
  const hero=dataHero({loader:async()=>{throw new Error('No WebGL');}});
  await hero.settle();assert.match(hero.status.textContent,/Geometry could not be loaded/);
  assert.ok(hero.classes.has('is-unavailable'));assert.equal(hero.state.maps.length,0);
});

test('Data hero keeps raster failure truthful and falls back from unavailable configuration', async()=>{
  const hero=dataHero({pathname:'/dashboard/data.html',fetch:async(url)=>url.endsWith('/map/config')
    ? {ok:false}
    : {ok:true,json:async()=>({features:[{properties:{corridor:'I25'},geometry:{type:'LineString',coordinates:[[-105,39],[-105,40]]}}]})}});
  await hero.settle();
  assert.ok(hero.state.reads.every(read=>read.url.startsWith('/dashboard-api/')));
  assert.equal(new URL(hero.state.options.style.sources['base-map'].tiles[0]).hostname,'basemap.nationalmap.gov');
  hero.state.maps[0].handlers.error({sourceId:'base-map'});
  assert.match(hero.status.textContent,/Basemap unavailable; tracked geometry remains visible/);
});

test('Data hero renderer loading has an eight-second deadline and rejects late initialization', async()=>{
  let release;
  const hero=dataHero({loader:()=>new Promise(resolve=>release=resolve)});
  await hero.settle();
  assert.equal(hero.timers.size,1);const deadline=[...hero.timers.values()][0];assert.equal(deadline.ms,8000);
  deadline.fn();await hero.settle();
  assert.match(hero.status.textContent,/Refresh this page to retry/);assert.equal(hero.timers.size,0);
  release({});await hero.settle();assert.equal(hero.state.maps.length,0);
});

test('Data hero cancels a pending renderer deadline on navigation', async()=>{
  const hero=dataHero({loader:()=>new Promise(()=>{})});
  await hero.settle();hero.events.pagehide({persisted:false});await hero.settle();
  assert.equal(hero.timers.size,0);assert.equal(hero.state.maps.length,0);
});

test('Data hero bounds style initialization and cancels its deadline on navigation', async()=>{
  const hero=dataHero({styleLoaded:false});await hero.settle();
  assert.equal(hero.timers.size,1);assert.equal([...hero.timers.values()][0].ms,15000);
  hero.events.pagehide({persisted:false});await hero.settle();
  assert.equal(hero.timers.size,0);assert.equal(hero.state.removed,1);assert.equal(hero.frames.size,0);
});

test('information-page anchors and icons resolve to unique owners', () => {
  for (const [name, html] of Object.entries(informationPages)) {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    const owners = new Set(ids);
    assert.equal(owners.size, ids.length, `${name} has duplicate IDs`);
    for (const match of html.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(owners.has(match[1]), `${name} has a missing anchor or icon: ${match[1]}`);
    }
  }
});

test('information pages retain bounded and accurate data contracts', () => {
  assert.match(informationPages.data, /I-25 · MM 208–271/);
  assert.match(informationPages.data, /I-70 · MM 206–274/);
  assert.match(informationPages.data, /combined-direction view/);
  assert.match(informationPages.api, /These reads do not trigger new TomTom or CDOT requests/);
  assert.match(informationPages.api, /GET \/system\/operational-status/);
});

test('API page describes verified public routes and deployment-controlled access', () => {
  assert.match(informationPages.api, /The dashboard, in JSON/);
  assert.match(informationPages.api, /Twelve useful starting points/);
  assert.match(informationPages.api, /Deployment configured/);
  assert.doesNotMatch(informationPages.api, /300\/min|300 reads/);
  const root=path.join(__dirname,'../../api-service/src/main/java/com/example/api_service');
  const controllers=require('node:fs').readdirSync(root).filter(file=>file.endsWith('Controller.java'));
  const count=controllers.filter(file=>!['IncidentModelParityController.java','DashboardPageController.java'].includes(file))
    .reduce((total,file)=>total+new Set((readFileSync(path.join(root,file),'utf8').match(/@GetMapping(?:\([^)]*\))?/g)||[])
      .map(mapping=>mapping.match(/@GetMapping\((?:value\s*=\s*)?"([^"]+)"/)?.[1]||mapping)).size,0);
  const advertised = Number(informationPages.api.match(/<dt>(\d+)<\/dt><dd>public GET routes/)[1]);
  assert.equal(count,30);
  assert.equal(advertised,count);
});

test('API explorer boot creates bounded paths without any startup read', () => {
  let fetches=0;
  const page=informationPage(async()=>{fetches++;}, '/dashboard-experimental/api.html',[],true);
  assert.equal(fetches,0);
  assert.equal(page.nodes.get('apiRequestPath').textContent,'/dashboard-experimental-api/traffic/latest?corridor=I25&preferUsable=true');
  page.nodes.get('apiPreset').value='history'; page.nodes.get('apiCorridor').value='I70';
  page.nodes.get('apiPreset').events.change();
  assert.equal(page.nodes.get('apiRequestPath').textContent,'/dashboard-experimental-api/traffic/history?corridor=I70&windowMinutes=120&limit=12&includeIncidents=false');
  page.nodes.get('apiPreset').value='status'; page.nodes.get('apiPreset').events.change();
  assert.equal(page.nodes.get('apiCorridor').disabled,true);
  assert.equal(page.run('apiExplorerPath()'),'/dashboard-experimental-api/system/operational-status');
  page.nodes.get('apiPreset').value='constructor'; page.nodes.get('apiCorridor').value='I70&limit=9000';
  assert.equal(page.run('apiExplorerPath()'),'/dashboard-experimental-api/traffic/latest?corridor=I25&preferUsable=true');
});

test('API integration recipe uses the real bounded history preset without sending a read until Run', () => {
  for(const prefix of ['/dashboard','/dashboard-experimental']) {
    let fetches=0;
    const page=informationPage(async()=>{fetches++;},prefix+'/api.html',[],true);
    const base=prefix==='/dashboard' ? '/dashboard-api' : '/dashboard-experimental-api';
    const request=base+'/traffic/history?corridor=I70&windowMinutes=120&limit=12&includeIncidents=false';
    assert.equal(page.nodes.get('apiRecipePath').textContent,request);
    page.nodes.get('apiPreset').value='status';page.nodes.get('apiPreset').events.change();
    page.nodes.get('apiHistoryRecipe').events.click();
    assert.equal(page.nodes.get('apiPreset').value,'history');
    assert.equal(page.nodes.get('apiCorridor').value,'I70');
    assert.equal(page.nodes.get('apiCorridor').disabled,false);
    assert.equal(page.nodes.get('apiRequestPath').textContent,request);
    assert.equal(fetches,0);
  }
  assert.doesNotMatch(informationPages.api,/api-route-composer|Build the route/);
  for(const field of ['samples[].polledAt','samples[].avgCurrentSpeed','returned']) {
    assert.ok(informationPages.api.includes('<code>'+field+'</code>'));
  }
  assert.match(informationPages.api,/Up to 12 samples—not necessarily the full window/);
});

test('API explorer limits responses and displays the real read ceiling including zero remaining', async () => {
  let options;
  const page=informationPage(async(p,o)=>{options=o; return {ok:true,status:200,headers:{get:n=>({'content-type':'application/json','x-ratelimit-remaining':'0','x-ratelimit-limit':'120'}[n]??null)},json:async()=>({text:'x'.repeat(19000)})};},'/dashboard/api.html');
  page.run("informationElements.apiResponseBody.closest=()=>informationElements.apiExplorerForm");
  await page.run('runApiExplorerRequest()');
  assert.ok(options.signal instanceof AbortSignal);
  assert.match(page.nodes.get('apiResponseMeta').textContent,/0 \/ 120 reads remain/);
  assert.equal(page.nodes.get('apiResponseState').textContent,'200 OK');
  assert.equal(page.nodes.get('apiRun').disabled,false);
  assert.match(page.nodes.get('apiResponseBody').textContent,/response shortened/);
  assert.ok(page.nodes.get('apiResponseBody').textContent.length<18100);
  assert.equal(page.run('apiResponseText(undefined)'),'');
  assert.equal(page.run('apiResponseText("<script>bad()</script>")'),'<script>bad()</script>');
});

test('API explorer blocks overlapping requests and recovers from timeout and HTTP429', async () => {
  let release,fetches=0;
  const page=informationPage(()=>{fetches++;return new Promise(resolve=>release=resolve);},'/dashboard/api.html');
  page.run("informationElements.apiResponseBody.closest=()=>informationElements.apiExplorerForm");
  const first=page.run('runApiExplorerRequest()');
  await page.run('runApiExplorerRequest()'); assert.equal(fetches,1);
  release({ok:false,status:429,headers:{get:n=>n==='content-type'?'application/json':n==='retry-after'?'60':null},json:async()=>({error:'rate_limited'})});
  await first;
  assert.equal(page.nodes.get('apiResponseState').textContent,'HTTP 429');
  assert.match(page.nodes.get('apiResponseMeta').textContent,/Retry-After: 60/);
  page.context.window.fetch=async()=>{throw Object.assign(new Error('Read timed out'),{name:'TimeoutError'});};
  await page.run('runApiExplorerRequest()');
  assert.equal(page.nodes.get('apiResponseState').textContent,'Timed out');
  assert.match(page.nodes.get('apiResponseMeta').textContent,/eight-second.*retry/);
  assert.equal(page.nodes.get('apiRun').disabled,false);
});

test('data decorative card headings do not become nested keyboard stops', () => {
  const html=informationPages.data;
  const cards=[...html.matchAll(/<([a-z]+) class="[^"]*modular-panel[^\"]*"[^>]*>/g)];
  assert.equal(cards.length,14);
  assert.ok(cards.every(match=>match[1]==='article'&&match[0].includes('tabindex="0"')));
  assert.doesNotMatch(html, /class="[^"]*modular-panel derived-card-title/);
});

test('data daily estimates require complete contiguous positive-speed zone coverage', () => {
  const page = informationPage();
  page.context.points = [
    {startMileMarker:208,endMileMarker:230,avgCurrentSpeed:55},
    {startMileMarker:230,endMileMarker:271,avgCurrentSpeed:70}
  ];
  assert.equal(page.run('estimateZoneTravelMinutes(points,63)'), (22/55+41/70)*60);
  page.context.points[1].startMileMarker = 231;
  assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes(points,63)')));
  page.context.points[1].startMileMarker = 229;
  assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes(points,63)')));
  page.context.points[1].startMileMarker = 230;
  page.context.points[1].avgCurrentSpeed = 0;
  assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes(points,63)')));
  for (const invalid of [null, undefined, '', ' ', false]) {
    page.context.points = [{startMileMarker:invalid,endMileMarker:63,avgCurrentSpeed:60}];
    assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes(points,63)')));
  }
  assert.ok(Number.isNaN(page.run('estimateZoneTravelMinutes([],NaN)')));
});

test('data daily range excludes incomplete days, earlier Denver days and future buckets', () => {
  const page = informationPage();
  page.context.points = [
    {bucketStart:'2026-10-07T05:45:00Z',startMileMarker:208,endMileMarker:271,avgCurrentSpeed:5},
    {bucketStart:'2026-10-07T06:00:00Z',startMileMarker:208,endMileMarker:271,avgCurrentSpeed:63},
    {bucketStart:'2026-10-07T08:00:00Z',startMileMarker:208,endMileMarker:271,avgCurrentSpeed:42},
    {bucketStart:'2026-10-07T09:00:00Z',startMileMarker:208,endMileMarker:230,avgCurrentSpeed:5},
    {bucketStart:'2026-10-07T11:00:00Z',startMileMarker:208,endMileMarker:271,avgCurrentSpeed:2}
  ];
  const range = page.run('retainedDailyTravelRange(points,63,"2026-10-07T10:00:00Z")');
  assert.equal(range.fastest,60);
  assert.equal(range.slowest,90);
  assert.ok(Number.isNaN(page.run('retainedDailyTravelRange(points,63,"invalid").fastest')));
});

test('data daily reads use the matching retained mount and label each corridor date', async () => {
  const calls=[];
  const page=informationPage(async (url,options)=>{
    calls.push({url,options});
    const i25=url.includes('corridor=I25');
    const date=i25?'2026-10-07T10:00:00Z':'2026-10-06T10:00:00Z';
    return {ok:true,json:async()=>url.includes('/summary?')?{latest:{polledAt:date}}:{points:[
      {bucketStart:date,startMileMarker:i25?208:206,endMileMarker:i25?271:274,avgCurrentSpeed:60}
    ]}};
  },'/dashboard-experimental/data.html');
  await page.run('initializeDataDailyRange()');
  assert.equal(calls.length,4);
  assert.ok(calls.every(({url,options})=>url.startsWith('/dashboard-experimental-api/traffic/')&&options.signal));
  for(const corridor of ['I25','I70']) {
    const reads=calls.filter(({url})=>url.includes(`corridor=${corridor}`));
    assert.equal(reads[0].options.signal,reads[1].options.signal);
  }
  assert.ok(calls.some(({url})=>url.includes('asOf=2026-10-06T10%3A00%3A00Z')));
  assert.equal(page.nodes.get('i25DailyFastest').textContent,'63 min');
  assert.equal(page.nodes.get('i70DailyFastest').textContent,'68 min');
  assert.match(page.nodes.get('dailyRangeStatus').textContent,/I-25 · Oct 7, 2026 \/ I-70 · Oct 6, 2026/);
});

test('a data daily partial failure preserves the other range and offers a retry', async () => {
  const page=informationPage(async url=>{
    if(url.includes('corridor=I70')) throw new Error('offline');
    return {ok:true,json:async()=>url.includes('/summary?')?{latest:{polledAt:'2026-10-07T10:00:00Z'}}:{points:[
      {bucketStart:'2026-10-07T10:00:00Z',startMileMarker:208,endMileMarker:271,avgCurrentSpeed:63}
    ]}};
  },'/dashboard/data.html');
  await page.run('initializeDataDailyRange()');
  assert.equal(page.nodes.get('i25DailyFastest').textContent,'60 min');
  assert.equal(page.nodes.get('i70DailyFastest').textContent,'Unavailable');
  assert.match(page.nodes.get('dailyRangeStatus').textContent,/I-70 · retained data could not be loaded/);
  assert.match(page.nodes.get('dailyRangeStatus').textContent,/Refresh this page to retry/);
  assert.doesNotMatch(page.nodes.get('dailyRangeStatus').textContent,/out of service/i);
});

test('data daily reads share an eight-second deadline per corridor and settle after timeout', async () => {
  const requests=[];
  const controllers=[];
  const page=informationPage((url,options)=>{
    requests.push({url,signal:options.signal});
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  },'/dashboard/data.html');
  page.context.AbortSignal={timeout(ms){assert.equal(ms,8000);const controller=new AbortController();controllers.push(controller);return controller.signal;}};
  const pending=page.run('initializeDataDailyRange()');
  const timeout=new Error('Deadline exceeded');timeout.name='TimeoutError';
  controllers.forEach(controller=>controller.abort(timeout));
  await pending;
  assert.equal(requests.length,2);
  assert.match(page.nodes.get('dailyRangeStatus').textContent,/I-25 · request timed out \/ I-70 · request timed out/);
  assert.match(page.nodes.get('dailyRangeStatus').textContent,/Refresh this page to retry/);
});

test('invalid data observation time avoids an unanchored trend read', async () => {
  const requests=[];
  const page=informationPage(async url=>{
    requests.push(url);return {ok:true,json:async()=>({latest:{polledAt:'invalid'}})};
  },'/dashboard/data.html');
  await page.run('initializeDataDailyRange()');
  assert.equal(requests.length,2);
  assert.ok(requests.every(url=>url.includes('/summary?')));
  assert.equal(page.nodes.get('i25DailyFastest').textContent,'Unavailable');
});

test('a complete data page boot initializes its retained ranges without System reads', async () => {
  const reads=[];
  const page=informationPage(async url=>{
    reads.push(url);const i25=url.includes('corridor=I25');
    return {ok:true,json:async()=>url.includes('/summary?')?{latest:{polledAt:'2026-10-07T10:00:00Z'}}:{points:[
      {bucketStart:'2026-10-07T10:00:00Z',startMileMarker:i25?208:206,endMileMarker:i25?271:274,avgCurrentSpeed:60}
    ]}};
  },'/dashboard/data.html',[],true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads.length,4);
  assert.ok(reads.every(url=>url.startsWith('/dashboard-api/traffic/')));
  assert.equal(page.nodes.get('i25DailyFastest').textContent,'63 min');
  assert.equal(page.nodes.get('i70DailyFastest').textContent,'68 min');
});

test('information styles remain structurally valid across declarations, comments and strings', () => {
  const stack=[];
  let quote='',comment=false,line=1;
  for(let i=0;i<informationStyles.length;i++){
    const character=informationStyles[i];
    if(character==='\n')line++;
    if(comment){if(character==='*'&&informationStyles[i+1]==='/'){comment=false;i++;}continue;}
    if(quote){if(character==='\\'){i++;continue;}if(character===quote)quote='';continue;}
    if(character==='/'&&informationStyles[i+1]==='*'){comment=true;i++;continue;}
    if(character==='"'||character==="'"){quote=character;continue;}
    if(character==='{')stack.push(line);
    if(character==='}'){
      assert.ok(stack.length,`Unmatched CSS closing block at line ${line}`);
      stack.pop();
    }
  }
  assert.equal(comment,false,'Unterminated CSS comment');
  assert.equal(quote,'','Unterminated CSS string');
  assert.deepEqual(stack,[],'Unterminated CSS blocks');
  assert.match(informationStyles,/\.ingest-node\s*\{[^}]*padding:[^}]*border-top:/s);
});

test('System retains its five technical documentation destinations after the architecture',()=>{
  const system=informationPages.system;
  const navigation=system.match(/<nav class="architecture-doc-links"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation);
  assert.ok(system.indexOf('architecture-doc-links')>system.indexOf('id="trafficDashboard"'));
  for(const filename of ['corridor-geometry-sources.md','corridor-traffic-map-plan.md',
    'incident-event-operations.md','data-history-coverage.md']){
    assert.ok(navigation.includes('/docs/'+filename));
    assert.ok(readFileSync(path.join(__dirname,'../../docs',filename),'utf8').length>0);
  }
  assert.ok(navigation.includes('href="api.html"'));
  assert.equal((navigation.match(/<a /g)||[]).length,5);
});

test('Data and API fact typography and desktop spacing use the same design scale',()=>{
  const declaration=selector=>informationStyles.match(new RegExp('\\.'+selector+'\\s*\\{([^}]+)\\}'))[1];
  for(const property of ['font-family','font-size','font-weight','letter-spacing','line-height']){
    const value=body=>body.match(new RegExp(property+':\\s*([^;]+)'))?.[1];
    assert.equal(value(declaration('data-hero-facts dt')),value(declaration('api-hero-facts dt')),property);
  }
  assert.match(informationStyles,/\.api-shell\s*\{[^}]*calc\(100% - 32px\)[^}]*clamp\(24px, 4vw, 48px\)/s);
  assert.match(informationStyles,/\.api-section, \.api-explorer\s*\{[^}]*clamp\(52px, 7vw, 92px\)/s);
  const versions=Object.values(informationPages).map(page=>page.match(/information\.css\?v=([^"\s]+)/)[1]);
  assert.equal(new Set(versions).size,1);
});

test('external dashboard links open separately while internal navigation stays in the page',()=>{
  const sources=[['index.html',indexSource],...Object.entries(informationPages),
    ...['corridor-map.js','data-hero-map.js'].map(name=>[name,readFileSync(path.join(__dirname,
      '../../api-service/src/main/resources/static/dashboard',name),'utf8')])];
  let outgoing=0,internal=0;
  for(const [name,source] of sources) for(const [anchor] of source.matchAll(/<a\b[^>]*>/g)){
    const attribute=key=>anchor.match(new RegExp('\\b'+key+'="([^"]*)"'))?.[1];
    const href=attribute('href');
    if(!href) continue;
    const url=new URL(href,'https://dashboard.test/dashboard-experimental/');
    if(url.origin!=='https://dashboard.test'){
      outgoing++;
      assert.equal(attribute('target'),'_blank',`${name}: ${href}`);
      assert.ok((attribute('rel')||'').split(/\s+/).includes('noopener'),`${name}: ${href}`);
    }else{
      internal++;
      assert.equal(attribute('target'),undefined,`${name}: internal navigation must stay in the current tab`);
    }
  }
  assert.ok(outgoing>0&&internal>0);
});

const flowDiagramSource=readFileSync(path.join(__dirname,'../../api-service/src/main/resources/static/dashboard/flow-diagram.js'),'utf8');
const flowDiagramStyles=readFileSync(path.join(__dirname,'../../api-service/src/main/resources/static/dashboard/flow-diagram.css'),'utf8');

function flowDiagramFixture(randomValues=[.5]) {
  const frames=new Map(),classes=new Set(),attributes={},styles={},observers=[],links=[{},{},{},{}];let next=0,writes=0;
  let randomCalls=0;
  const car={events:{},addEventListener(name,callback){this.events[name]=callback;},removeEventListener(name){delete this.events[name];}};
  let bounds={left:100,top:50,width:1000,height:140};
  let markers=[0,1,2].map(i=>({left:120+i*300,top:64,width:18,height:18}));
  const track={querySelectorAll:()=>links.map(link=>({setAttribute(name,value){link[name]=value;writes++;}})),setAttribute(name,value){attributes[name]=value;}};
  const root={getBoundingClientRect:()=>bounds,querySelectorAll:()=>markers.map((_,i)=>({getBoundingClientRect:()=>markers[i]})),
    querySelector:selector=>selector==='.flow-track'?track:car,style:{setProperty(name,value){styles[name]=value;}},
    classList:{toggle(name,enabled){enabled?classes.add(name):classes.delete(name);}}};
  class Observer {
    constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}
    observe(){} disconnect(){this.disconnected=true;}
  }
  const window={IntersectionObserver:Observer,ResizeObserver:Observer,events:{},
    requestAnimationFrame(callback){frames.set(++next,callback);return next;},cancelAnimationFrame(id){frames.delete(id);},
    addEventListener(name,callback){this.events[name]=callback;}};
  const document={hidden:false,events:{},querySelectorAll:()=>[root],addEventListener(name,callback){this.events[name]=callback;}};
  const math=Object.create(Math);math.random=()=>randomValues[randomCalls++ % randomValues.length];
  const context=vm.createContext({window,document,Math:math});vm.runInContext(flowDiagramSource,context);
  return {window,document,root,observers,frames,classes,attributes,styles,links,get writes(){return writes;},
    car,get randomCalls(){return randomCalls;},
    flush(){const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback());},
    layout(value,points){bounds=value;markers=points;}};
}

test('flow geometry follows actual stage positions when a wide diagram stacks on a phone',()=>{
  const f=flowDiagramFixture();f.flush();
  assert.equal(f.styles['--flow-link-0'],`path("${f.links[0].d}")`);
  assert.equal(f.links[0].d,'M 29 23 C 129 47 229 47 329 23');
  assert.equal(f.links[1].d,'M 329 23 C 429 47 529 47 629 23');
  f.observers[0].callback();f.observers[0].callback();assert.equal(f.frames.size,1);f.flush();
  assert.equal(f.writes,2,'unchanged geometry is not rewritten');
  f.layout({left:10,top:100,width:330,height:400},[0,1,2].map(i=>({left:30,top:114+i*120,width:18,height:18})));
  f.observers[0].callback();f.flush();
  assert.equal(f.links[0].d,'M 29 23 C 5 63 5 103 29 143');
  assert.equal(f.styles['--flow-link-0'],`path("${f.links[0].d}")`);
  assert.equal(f.attributes.viewBox,'0 0 330 400');
  assert.equal(f.writes,4);
});

test('packet routes reject incomplete geometry and keep compact bends proportional',()=>{
  const context=vm.createContext({document:{querySelectorAll:()=>[]}});
  vm.runInContext(flowDiagramSource,context);
  const bounds={left:0,top:0,width:50,height:50};
  const markers=[{left:1,top:4,width:2,height:2},{left:9,top:4,width:2,height:2}];
  assert.equal(context.flowDiagramPath(bounds,markers),'M 2 5 C 4.67 7 7.33 7 10 5');
  assert.equal(context.flowDiagramPath({...bounds,width:0},markers),null);
  assert.equal(context.flowDiagramPath(bounds,markers.slice(0,1)),null);
  assert.equal(context.flowDiagramPath(bounds,[markers[0],{...markers[1],left:NaN}]),null);
});

test('flow motion pauses offscreen and through hidden or cached pages without extra polling',()=>{
  const f=flowDiagramFixture();assert.ok(f.classes.has('motion-paused'));
  const visibility=f.observers[1];visibility.callback([{target:f.root,isIntersecting:true}]);
  assert.equal(f.classes.has('motion-paused'),false);f.flush();
  f.document.hidden=true;f.document.events.visibilitychange();
  assert.ok(f.classes.has('motion-paused'));f.observers[0].callback();assert.equal(f.frames.size,0);
  f.document.hidden=false;f.document.events.visibilitychange();assert.equal(f.frames.size,1);f.flush();
  f.window.events.pagehide({persisted:true});assert.ok(f.classes.has('motion-paused'));
  assert.ok(f.observers.every(observer=>!observer.disconnected));
  f.window.events.pageshow();f.flush();assert.equal(f.classes.has('motion-paused'),false);
  f.window.events.pagehide({persisted:false});assert.ok(f.observers.every(observer=>observer.disconnected));
  assert.equal(f.frames.size,0);assert.doesNotMatch(flowDiagramSource,/fetch\(|setInterval\(/);
});

test('Under the Hood keeps five readable service stages without colored card backgrounds',()=>{
  const section=indexSource.slice(indexSource.indexOf('<section id="under-the-hood"'));
  assert.equal((section.match(/class="flow-station"/g)||[]).length,5);
  assert.doesNotMatch(section,/flow-step-number/);
  for(const title of ['Traffic Providers','Ingest Service','PostgreSQL','API Service','Web Dashboard'])assert.ok(section.includes(title));
  assert.doesNotMatch(section,/class="flow-arrow"/);
  assert.match(section,/Illustrated/,'decorative animation is not presented as live telemetry');
  assert.doesNotMatch(flowDiagramStyles.match(/\.flow-diagram > ol > li \{([^}]+)\}/)[1],/background:/);
  assert.match(flowDiagramStyles,/@container flow-diagram \(max-width: 50rem\)/);
  assert.match(flowDiagramStyles,/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
});

test('flow handoffs distinguish observations, inserts, queries and bounded chart windows',()=>{
  const section=indexSource.slice(indexSource.indexOf('<section id="under-the-hood"'));
  for(const cue of ['flow-observation','flow-event','flow-record','flow-query','flow-response','Sliding window'])assert.ok(section.includes(cue));
  assert.doesNotMatch(section,/flow-link-label|Flow \+ events|Record inserts|Query \/ response/,'connector captions are omitted while visual handoffs remain');
  assert.match(flowDiagramStyles,/\.flow-track \.flow-link \{ stroke: var\(--line\); stroke-width: 1\.5; stroke-dasharray: 3 5;/);
  assert.doesNotMatch(flowDiagramStyles,/\.flow-track \.flow-link-(?:observations|records|query|window) \{[^}]*(?:stroke:|stroke-dasharray:)/,'all handoffs share the same connector pattern');
  assert.doesNotMatch(section,/src="provider-/,'the alternate provider illustration is logo-free');
  assert.doesNotMatch(section,/flow-pulse|flow-road-surface|flow-source-streams/,'no generic car/road travels through software services');
  assert.match(flowDiagramStyles,/\.flow-window \{[^}]*overflow: hidden/,'chart packets are clipped to the visible window');
  assert.match(flowDiagramStyles,/\.flow-diagram\.motion-paused \*[^}]*animation-play-state: paused/);
  assert.match(flowDiagramStyles,/@media \(prefers-reduced-motion: reduce\) \{\s*\.flow-diagram \*[^}]*animation: none/);
});

test('the logo-free observation scene keeps the car below the camera and inside its stage',()=>{
  const section=indexSource.slice(indexSource.indexOf('<section id="under-the-hood"'));
  assert.doesNotMatch(section,/provider-tomtom|provider-cdot|flow-provider-bubble|flow-impact/);
  assert.match(section,/<small>TomTom \+ CDOT<\/small>/,'provider names remain available without brand visuals');
  const car=flowDiagramStyles.match(/\.flow-diagram \.flow-scene-car \{([^}]+)\}/)[1];
  const [startX,startY,endX,endY]=car.match(/offset-path: path\("M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)"\)/).slice(1).map(Number);
  const width=Number(car.match(/width: ([\d.]+)px/)[1]),height=Number(car.match(/height: ([\d.]+)px/)[1]);
  const sceneWidth=Number(flowDiagramStyles.match(/\.flow-provider-scene \{ width: ([\d.]+)px/)[1]);
  assert.ok(startX-width/2>=0 && endX+width/2<=sceneWidth);
  assert.equal(startY,endY);
  assert.ok(startY-height/2>54,'car never overlaps the camera station');
});

test('the provider road fades for the car run while its outgoing connector stays visible',()=>{
  const section=indexSource.slice(indexSource.indexOf('<section id="under-the-hood"'));
  for(const layer of ['edge','surface','center'])assert.ok(section.includes('class="flow-scene-road-'+layer+'"'));
  assert.match(flowDiagramStyles,/\.flow-scene-road \{[^}]*opacity: 0;[^}]*animation: flow-scene-road-visible/);
  assert.match(flowDiagramStyles,/\.flow-scene-road-surface \{[^}]*stroke-width: 9;/);
  assert.match(flowDiagramStyles,/\.flow-scene-road \{[^}]*transform: translateY\(7px\)/,'road sits beneath the wheels without moving either car path');
  assert.match(flowDiagramStyles,/@keyframes flow-scene-road-visible \{ 0% \{ opacity: 0; \} 3%, 20% \{ opacity: 1; \} 25%, 100% \{ opacity: 0; \}/);
  assert.doesNotMatch(flowDiagramStyles,/flow-observation-link-visible|\.flow-link-observations \{[^}]*(?:opacity|animation)/,'provider-to-ingest connector uses the always-visible shared style');
});

test('the equal-width provider stage retains its local recording dot and compact title row',()=>{
  const section=indexSource.slice(indexSource.indexOf('<section id="under-the-hood"'));
  assert.ok(section.indexOf('flow-caption')<section.indexOf('data-flow-diagram'));
  assert.match(section,/<svg class="architecture-icon" viewBox="0 0 24 24"[^>]*>[\s\S]*?<path class="flow-recording-led" d="M7 9h\.01"/);
  assert.match(flowDiagramStyles,/\.flow-recording-led \{[^}]*animation: flow-recording-blink/);
  assert.match(flowDiagramStyles,/@keyframes flow-recording-blink \{[\s\S]*?28%, 100% \{ stroke: var\(--forest-soft\); opacity: 1;/);
  assert.match(flowDiagramStyles,/grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(flowDiagramStyles,/li:first-child/,'provider follows the same narrow layout as every other stage');
});

test('the rare collision is selected independently once per car cycle without extra polling',()=>{
  const f=flowDiagramFixture([0,.099999,.1,.9]);
  assert.equal(f.randomCalls,1);assert.ok(f.classes.has('has-collision'));
  f.flush();f.observers[0].callback();f.flush();
  assert.equal(f.randomCalls,1,'layout changes never choose another scene');
  f.car.events.animationiteration({target:f.car,animationName:'flow-car-collision'});
  assert.ok(f.classes.has('has-collision'));
  f.car.events.animationiteration({target:f.car,animationName:'flow-car-collision'});
  assert.equal(f.classes.has('has-collision'),false,'the ten-percent boundary is exclusive');
  f.car.events.animationiteration({target:{},animationName:'flow-car-observation'});
  f.car.events.animationiteration({target:f.car,animationName:'flow-recording-blink'});
  assert.equal(f.randomCalls,3,'other animations cannot reroll the car scene');
  f.document.hidden=true;f.document.events.visibilitychange();
  assert.equal(f.randomCalls,3,'pausing does not reroll');
  f.window.events.pagehide({persisted:true});f.window.events.pageshow();f.flush();
  assert.ok(f.car.events.animationiteration,'cached pages keep one cycle listener');
  f.car.events.animationiteration({target:f.car,animationName:'flow-car-observation'});
  assert.equal(f.classes.has('has-collision'),false);
  f.window.events.pagehide({persisted:false});
  assert.equal(f.car.events.animationiteration,undefined,'departed pages release the listener');
});

test('opposing cars meet bumper-to-bumper in the center without crossing the camera',()=>{
  const section=indexSource.slice(indexSource.indexOf('<section id="under-the-hood"'));
  assert.match(section,/class="flow-scene-car flow-oncoming-car"[\s\S]*?transform="translate\(24 0\) scale\(-1 1\)"/);
  const route=selector=>flowDiagramStyles.match(new RegExp(selector+' \\{([^}]+)\\}'))[1].match(/path\("M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)"\)/).slice(1).map(Number);
  const main=route('\\.flow-diagram\\.has-collision \\.flow-scene-car:not\\(\\.flow-oncoming-car\\)');
  const other=route('\\.flow-diagram \\.flow-oncoming-car');
  assert.equal(main[2]+11,70);assert.equal(other[2]-11,70);
  assert.ok(main[0]<main[2] && other[0]>other[2]);
  assert.equal(main[1],64);assert.equal(other[1],64);assert.equal(main[3],other[3]);
  assert.match(flowDiagramStyles,/\.flow-oncoming-car \{[^}]*visibility: hidden/);
  assert.match(flowDiagramStyles,/\.flow-diagram\.has-collision \.flow-oncoming-car \{ visibility: visible/);
});

test('window arrows connect the upper and lower bars in opposite directions',()=>{
  const section=indexSource.slice(indexSource.indexOf('<section id="under-the-hood"'));
  const data=section.match(/class="flow-window-forward" d="M(\d+) (\d+) (\d+) (\d+)/).slice(1).map(Number);
  const ack=section.match(/class="flow-window-backward" d="M(\d+) (\d+) (\d+) (\d+)/).slice(1).map(Number);
  assert.ok(data[1]<data[3] && ack[1]>ack[3],'DATA moves down to the receiver; ACK returns to the sender');
  assert.equal(data[1],ack[3]);assert.equal(data[3],ack[1]);
  assert.ok(data[0]<data[2] && ack[0]>ack[2]);
  assert.match(flowDiagramStyles,/\.flow-window \{[^}]*animation-name: flow-window-visible;/);
  assert.match(flowDiagramStyles,/@keyframes flow-window-visible \{ 0%, 60% \{ opacity: 0; \} 65%, 94% \{ opacity: 1; \} 99%, 100% \{ opacity: 0; \}/,'window fades in and out around the exchange rather than staying visible');
  assert.match(flowDiagramStyles,/\.flow-window-exchange \{[^}]*top: 16px;[^}]*height: 24px/,'exchange occupies only the space between the bars');
  assert.match(flowDiagramStyles,/@keyframes flow-window-data \{[\s\S]*?72%, 87% \{ stroke-dashoffset: 0/);
  assert.match(flowDiagramStyles,/@keyframes flow-window-reply \{[\s\S]*?77%, 93% \{ stroke-dashoffset: 0/);
});

test('the slow sliding-window illustration retains ordered packets and a three-packet acknowledgement cue',()=>{
  const section=indexSource.slice(indexSource.indexOf('<section id="under-the-hood"'));
  assert.match(section,/three packets in flight; acknowledgements advance the window/);
  assert.ok(section.includes('W=3')&&section.includes('>ACK<'));
  for(const lane of ['send','receive']){
    const bar=section.match(new RegExp(`flow-window-${lane}"><span class="flow-window-strip">([\\s\\S]*?)<\\/span>`))[1];
    assert.deepEqual([...bar.matchAll(/<i>(\d{2})<\/i>/g)].map(match=>match[1]),['01','02','03','04','05','06','07','08','09']);
  }
  assert.match(flowDiagramStyles,/--flow-cycle: 16s/);
  assert.match(flowDiagramStyles,/\.flow-window-lane \{[^}]*overflow: hidden/);
  assert.match(flowDiagramStyles,/@keyframes flow-window-receiver \{\s*0%, 72%/,'receive window advances after DATA arrives');
  assert.match(flowDiagramStyles,/@keyframes flow-window-sender \{\s*0%, 77%/,'send window waits until ACK returns');
  assert.doesNotMatch(flowDiagramStyles,/@keyframes flow-window-select\s|animation: flow-window-select\s|--flow-select-x/,'packets advance through a fixed bounded window');
});

test('all dashboard pages use fresh consistent release keys for existing application assets',()=>{
  const references=new Map();
  for(const page of [indexSource,...Object.values(informationPages)]){
    for(const [,filename,version] of page.matchAll(/(?:src|href)="([^"?]+\.(?:css|js))\?v=([^"\s]+)"/g)){
      assert.ok(!filename.startsWith('vendor/'));
      assert.equal(version, ['health-panel.css','health-panel.js','stored-observations.js','dashboard.js'].includes(filename) ? 'stored-observations-1' : ['flow-diagram.css','flow-diagram.js'].includes(filename) ? 'under-hood-cross-bar-2' : ['dashboard-continuous.js','dashboard-window-summary.js'].includes(filename) ? 'historical-card-parallel-1' : filename === 'dashboard.css' ? 'historical-card-type-1' : filename === 'dashboard-history.js' ? 'historical-window-summaries-2' : filename === 'corridor-map.js' ? 'dashboard-mobile-polish-1' : ['information.css','information-pages.js'].includes(filename)
          ? 'system-progress-removal-1' : 'dashboard-incident-scroll-preview-1');
      assert.equal(references.get(filename)||version,version,filename);
      references.set(filename,version);
      assert.ok(readFileSync(path.join(__dirname,'../../api-service/src/main/resources/static/dashboard',filename)).length>0);
    }
  }
  assert.deepEqual([...references.keys()].sort(),['corridor-map.js','dashboard-continuous.js','dashboard-history.js','dashboard-window-summary.js','dashboard.css','dashboard.js','data-hero-map.js','flow-diagram.css','flow-diagram.js','health-panel.css','health-panel.js','information-pages.js','information.css','stored-observations.js','traffic-estimates.js']);
  assert.match(indexSource,/vendor\/maplibre-gl\/6\.10\.0\/maplibre-gl\.css"/);
});

test('System sections remain deep-linkable without the obsolete progress bar', () => {
  assert.doesNotMatch(informationPages.system, /System page sections|systemPageRoute|system-page-route/);
  assert.doesNotMatch(informationSource, /systemPageRoute|initializeSystemPageRoute|system-route-progress/);
  assert.doesNotMatch(informationStyles, /system-page-route|system-route-progress/);
  for (const id of ['systemIntro', 'systemDataPath', 'systemDecisions', 'systemOperations', 'systemChecks', 'systemHealth']) {
    assert.ok(informationPages.system.includes('id="' + id + '"'));
  }
});

test('system page describes the implemented architecture without overstating it', () => {
  const system = informationPages.system;
  assert.match(system, /131 mi<\/strong><span>of monitored highway/);
  assert.match(system, /0\.5 mi<\/strong><span>stable road sections/);
  assert.match(system, /Routes Service/);
  assert.match(system, /Traffic speeds/);
  assert.match(system, /Road incidents/);
  assert.match(system, /An incident keeps its history across updates/);
  assert.match(system, /A failed or incomplete update does not replace the last complete report/);
  assert.match(system, /PostgreSQL \/ TimescaleDB/);
  assert.match(system, /Short local trends/);
  assert.match(system, /Fast answers, backed by retained history/);
  assert.match(system, /The dashboard and public API share one service but use separate routes/);
  assert.match(system, /Four isolated containers with explicit health checks/);
  assert.match(system, /The dashboard is served by the API container/);
  assert.doesNotMatch(system, /machine.learning/i);
  assert.doesNotMatch(system, /Kafka/);
});

test('system detail rows use consistent sentence capitalization without pipeline emphasis', () => {
  const system = informationPages.system;
  for (const group of ['persistence-groups', 'api-capabilities']) {
    const content = system.match(new RegExp(`<div class="${group}">([\\s\\S]*?)<\\/div>`))[1];
    for (const paragraph of content.matchAll(/<p>(.*?)<\/p>/g)) {
      for (const row of paragraph[1].split('<br>')) assert.match(row, /^[A-Z]/);
    }
  }
  const control = system.match(/<aside class="provider-control"[\s\S]*?<ul>([\s\S]*?)<\/ul>/)[1];
  for (const item of control.matchAll(/<li>(.*?)<\/li>/g)) assert.match(item[1], /^[A-Z]/);
  const steps = system.match(/<section class="pipeline-card flow-pipeline"[\s\S]*?<\/section>/)[0];
  assert.equal([...steps.matchAll(/<li>/g)].length, 5);
  assert.doesNotMatch(steps, /pipeline-emphasis|<strong>/);
  assert.match(steps, /Project speeds onto the monitored roadway/);
  assert.doesNotMatch(steps, /direction/i);
  const checks = system.match(/<div class="operations-coverage">([\s\S]*?)<\/div>/)[1];
  assert.equal([...checks.matchAll(/<li>/g)].length, 8);
  for (const item of checks.matchAll(/<li>(.*?)<\/li>/g)) assert.match(item[1], /^[A-Z]/);
});

test('system hero underline replays when the heading returns to view', () => {
  const page = informationPage();
  page.run(`
    window.IntersectionObserver = class {
      constructor(callback, options) {
        window.heroObserverCallback = callback;
        window.heroObserverOptions = options;
      }
      observe(target) { window.heroObserved = target; }
    };
    initializeSystemHero();
  `);
  assert.equal(page.run('window.heroObserverOptions.threshold'), 0.18);
  assert.equal(page.run('window.heroObserved === informationElements.systemHero'), true);
  page.run('window.heroObserverCallback([{ target: informationElements.systemHero, isIntersecting: true }])');
  assert.equal(page.nodes.get('systemIntro').classList.contains('is-visible'), true);
  page.run('window.heroObserverCallback([{ target: informationElements.systemHero, isIntersecting: false }])');
  assert.equal(page.nodes.get('systemIntro').classList.contains('is-visible'), false);
});

test('hero resize and font changes share one pending geometry update', () => {
  const page = informationPage();
  page.run(`
    let geometryUpdates = 0;
    let fontReady;
    let fontChanged;
    const frames = [];
    const listeners = {};
    positionSystemHeroSignal = () => { geometryUpdates++; };
    window.requestAnimationFrame = callback => frames.push(callback);
    window.addEventListener = (name, callback) => { listeners[name] = callback; };
    document.fonts = {
      ready: { then(callback) { fontReady = callback; } },
      addEventListener(name, callback) { fontChanged = callback; }
    };
    initializeSystemHero();
    listeners.resize();
    listeners.resize();
    fontReady();
    fontChanged();
  `);
  assert.equal(page.run('frames.length'), 1);
  assert.equal(page.run('geometryUpdates'), 0);
  page.run('frames.shift()();');
  assert.equal(page.run('geometryUpdates'), 1);
  assert.equal(page.nodes.get('systemIntro').classList.contains('is-visible'), true);
  page.run('listeners.resize(); frames.shift()();');
  assert.equal(page.run('geometryUpdates'), 2);
});

test('hero underline follows wrapped words and reads geometry before mutating lines', () => {
  const page = informationPage();
  page.run(`
    let writes = 0;
    const lines = [];
    const lineNode = () => ({
      hidden: false,
      values: {},
      setAttribute() {},
      style: { setProperty(key, value) { this[key] = value; writes++; } }
    });
    document.createElement = lineNode;
    informationElements.systemHero.style = { setProperty() { writes++; } };
    informationElements.systemHeroTitle.getBoundingClientRect = () => ({ left: 100, top: 40 });
    informationElements.systemHeroTitle.querySelectorAll = () => lines;
    informationElements.systemHeroTitle.appendChild = line => { lines.push(line); writes++; };
    informationElements.systemHeroSource.getClientRects = () => [{left: 100,right: 300,bottom: 80}];
    informationElements.systemHeroTarget.getClientRects = () => [{left: 350,right: 500,bottom: 80}];
    let wordRects = [
      {left: 350,right: 440,top: 50,bottom: 80},
      {left: 450,right: 500,top: 50,bottom: 80},
      {left: 100,right: 220,top: 90,bottom: 120}
    ];
    informationElements.systemHeroTarget.querySelectorAll = () => wordRects.map(rect => ({getBoundingClientRect: () => rect}));
    informationElements.systemHeroSignal.getBoundingClientRect = () => {
      if (writes) throw new Error('Geometry read after layout mutation');
      return {width: 10};
    };
    positionSystemHeroSignal(informationElements.systemHero);
  `);
  assert.equal(page.run('lines.length'), 2);
  assert.equal(page.run('lines[0].style["--system-highlight-width"]'), '150px');
  assert.equal(page.run('lines[1].style["--system-highlight-width"]'), '120px');
  assert.equal(page.run('lines[1].style["--system-highlight-top"]'), '80px');
  page.run(`
    writes = 0;
    wordRects = [{left: 350,right: 600,top: 50,bottom: 80}];
    positionSystemHeroSignal(informationElements.systemHero);
  `);
  assert.equal(page.run('lines.length'), 2);
  assert.equal(page.run('lines[1].hidden'), true);
});

test('system architecture focus traces only the selected panel, not every shared flow', () => {
  function item(flow, focusable = false) {
    const classes = new Set();
    return { dataset: { architectureFlow: flow }, tabIndex: focusable ? 0 : undefined, events: {},
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        toggle(name, force) { force === false ? classes.delete(name) : classes.add(name); },
        contains(name) { return classes.has(name); }
      },
      addEventListener(name, handler) { this.events[name] = handler; },
      matches(selector) { return selector === '[tabindex]' && this.tabIndex !== undefined; } };
  }
  const trafficPipeline = item('flow storage delivery', true);
  const database = item('flow incident storage delivery', true);
  const incidentPipeline = item('incident storage delivery', true);
  const containingPanel = item('flow incident', true);
  containingPanel.contains = source => source === trafficPipeline;
  const page = informationPage(undefined, '/dashboard/system.html', [trafficPipeline, database, incidentPipeline, containingPanel]);
  page.run('initializeArchitectureHighlights()');

  trafficPipeline.events.focus();
  assert.equal(page.nodes.get('systemArchitecture').classList.contains('has-active-flow'), true);
  assert.equal(trafficPipeline.classList.contains('is-related'), true);
  assert.equal(containingPanel.classList.contains('is-related'), true);
  assert.equal(database.classList.contains('is-related'), false);
  assert.equal(incidentPipeline.classList.contains('is-related'), false);
  assert.equal(incidentPipeline.classList.contains('is-muted'), false);
  trafficPipeline.events.pointerleave({relatedTarget:{closest(){return containingPanel;}}});
  assert.equal(trafficPipeline.classList.contains('is-related'), false);
  assert.equal(containingPanel.classList.contains('is-related'), true);

  trafficPipeline.events.blur();
  assert.equal(page.nodes.get('systemArchitecture').classList.contains('has-active-flow'), false);
  assert.equal(database.classList.contains('is-related'), false);
});

test('system status uses the matching production or experimental API prefix', () => {
  const production = informationPage();
  const experimental = informationPage(undefined, '/dashboard-experimental/system.html');
  assert.equal(production.run("informationRuntime(window.location.pathname).apiBase"), '/dashboard-api');
  assert.equal(experimental.run("informationRuntime(window.location.pathname).apiBase"), '/dashboard-experimental-api');
});

test('system status presents degraded reasons and a concrete next action', () => {
  const page = informationPage();
  page.context.status = {
    status: 'DEGRADED',
    checkedAt: '2026-09-26T15:30:00Z',
    summary: 'One check needs attention.',
    checks: [{ component: 'flow:I25', status: 'DEGRADED', code: 'FLOW_SAMPLE_STALE',
      message: 'The latest usable I25 flow sample is 75 minutes old.', ageMinutes: 75,
      thresholdMinutes: 60, suggestedAction: 'Check the ingest scheduler.' }]
  };
  page.run('renderOperationalStatus(status)');
  assert.equal(page.nodes.get('systemOverview').dataset.status, 'DEGRADED');
  assert.equal(page.nodes.get('systemSummary').textContent, 'One check needs attention.');
  assert.equal(page.nodes.get('systemStatusTitle').textContent, 'Some traffic information may be delayed');
  assert.equal(page.nodes.get('statusCheckCount').textContent, '0 / 1 clear');
  assert.equal(page.nodes.get('statusDetailCount').textContent, '1 check needs attention');
  assert.equal(page.nodes.get('statusSignalGrid').children[0].children[0].textContent, 'I-25 flow');
  assert.equal(page.nodes.get('statusSignalGrid').children[0].children[1].textContent, '1 hr old');
  const card = page.nodes.get('operationalChecks').children[0];
  assert.equal(card.dataset.status, 'DEGRADED');
  assert.equal(card.children[1].textContent, 'The latest usable I25 flow sample is 75 minutes old.');
  assert.equal(card.children[2].textContent, 'flow sample stale · 75 min old · 60 min threshold');
  assert.equal(card.children[3].children[1].textContent, 'Check the ingest scheduler.');
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

function heartbeatLifecycleFixture() {
  let reads = 0, serial = 0, observed;
  const timers = new Map(), events = {document: {}, window: {}};
  const page = informationPage(async () => {
    reads++;
    return {ok: true, json: async () => ({status: 'HEALTHY', checks: []})};
  });
  const panel = page.nodes.get('systemOverview');
  const animations = ['status-ecg-reveal', 'status-ecg-handoff', 'status-content-yield',
    'status-snapshot-yield', 'status-beacon-pulse', 'grid-light-sweep'].map(animationName => ({
    animationName, currentTime: 2600,
    play() { throw new Error('CSS visibility must control playback'); }
  }));
  panel.getAnimations = options => {
    assert.deepEqual({...options}, {subtree: true});
    return animations;
  };
  Object.defineProperty(panel, 'offsetWidth', {get() { throw new Error('Forced layout'); }});
  const listen = target => (name, callback) => (events[target][name] ||= []).push(callback);
  page.context.document.addEventListener = listen('document');
  page.context.document.querySelectorAll = () => [panel];
  Object.assign(page.context.window, {
    addEventListener: listen('window'),
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    IntersectionObserver: class {
      constructor(callback) { observed = callback; }
      observe() {} disconnect() {}
    }
  });
  page.run('initializeMotionBudget()');
  const view = visible => observed([{target: panel, isIntersecting: visible}]);
  const emit = (target, name, value = {}) => events[target][name]?.forEach(fn => fn(value));
  const fire = () => {
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0];
    timers.delete(id); timer.fn();
  };
  return {page, panel, timers, animations, view, emit, fire, reads: () => reads};
}

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

test('a failed status request is not mislabeled as a traffic outage', () => {
  const page = informationPage();
  page.context.failure = new Error('HTTP 503');
  page.run('renderStatusUnavailable(failure)');
  assert.equal(page.nodes.get('systemOverview').dataset.status, 'UNAVAILABLE');
  assert.match(page.nodes.get('systemSummary').textContent, /does not by itself mean traffic ingestion is down/);
  assert.match(page.nodes.get('operationalChecks').children[0].textContent, /HTTP 503/);
});

function event(overrides = {}) {
  return { properties: { incidentProvider: 'cdot', corridor: 'I25', providerEventId: 'one',
    normalizedCategory: 'DISABLED_VEHICLE', closestMileMarker: 225,
    locationLabel: 'MP 225 · Thornton', firstSeenAt: '2026-09-13T10:00:00Z',
    lastSeenAt: '2026-09-15T10:00:00Z', active: true, ...overrides } };
}

test('uses relative dashboard assets under both public paths', () => {
  assert.doesNotMatch(indexSource, /(?:href|src)="\/dashboard\//);
  assert.match(mapSource, /import\("\.\/vendor\/maplibre-gl\/6\.10\.0\/maplibre-gl\.mjs"\)/);
});

test('inactive traffic map legend items remain hidden despite flex styling', () => {
  const css = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard.css'), 'utf8');
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
  assert.equal(requests.length, 19);
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/map/flow-cells/current?corridor=I25'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/map/flow-cells/current?corridor=I70'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/analytics/baselines?corridor=I25'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/analytics/baselines?corridor=I70'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/zones/baselines?corridor=I25'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/zones/baselines?corridor=I70'));
  assert.ok(requests.includes('/dashboard-experimental-health'));
  assert.ok(requests.every(url => url === '/dashboard-experimental-health' || url.startsWith('/dashboard-experimental-api/')));
});

function corridorMap(rendererLoader) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: id === 'corridorMapPanel', textContent: '', title: '', children: [], events: {},
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
      addEventListener(name, callback) { this.events[name] = callback; } });
    return nodes.get(id);
  };
  const attributionButton = { dataset: {}, listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; } };
  const attributionDetails = {
    open: true, compactShow: true, initiallyCollapsed: false, dataset: {},
    classList: {
      add(name) {
        if (name === 'corridor-map-attribution-collapsed') attributionDetails.initiallyCollapsed = true;
        if (name === 'maplibregl-compact-show') attributionDetails.compactShow = true;
      },
      contains(name) { return name === 'corridor-map-attribution-collapsed' && attributionDetails.initiallyCollapsed; },
      remove(name) {
        if (name === 'maplibregl-compact-show') attributionDetails.compactShow = false;
        if (name === 'corridor-map-attribution-collapsed') attributionDetails.initiallyCollapsed = false;
      }
    },
    querySelector: () => attributionButton,
    removeAttribute(key) { if (key === 'open') this.open = false; },
    setAttribute(key) { if (key === 'open') this.open = true; }
  };
  get('corridorMap').querySelector = selector => selector === '.maplibregl-ctrl-attrib' ? attributionDetails : null;
  const window = {
    CORRIDOR_MAP_RENDERER_LOADER: rendererLoader,
    location: { pathname: '/dashboard/' },
    setTimeout,
    clearTimeout
  };
  const context = vm.createContext({
    console, URL, AbortSignal,
    window,
    document: {
      getElementById: get,
      querySelectorAll: selector => selector.includes('frequency')
        ? [get('frequencyLegend')]
        : selector.includes('current') ? [get('currentLegend')] : [],
      createElement: tagName => ({ tagName, textContent: '', className: '', hidden: false, style: {setProperty(key,value){this[key]=value;}}, attributes: {}, children: [], dataset: {}, events: {},
        appendChild(child) { this.children.push(child); },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(name, callback) { this.events[name] = callback; } }),
      documentElement: { dataset: { theme: 'light' } }
    }
  });
  vm.runInContext(mapSource, context);
  return { nodes, context, attributionDetails, attributionButton };
}

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

function fakeMapRenderer(instances, popups = [], markers = []) {
  class Map {
    constructor(options) {
      this.options = options;
      this.sources = new globalThis.Map();
      for (const [id, source] of Object.entries(options.style.sources)) {
        this.sources.set(id, { data: source.data, setData(data) { this.data = data; } });
      }
      this.canvas = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
      this.canvas.style = {};
      this.zoom = 8;
      this.listeners = new globalThis.Map();
      instances.push(this);
    }
    addControl() {}
    on(event, layerOrHandler, handler) {
      this.listeners.set(handler ? `${event}:${layerOrHandler}` : event, handler || layerOrHandler);
    }
    once(event, callback) { this.listeners.set(event, callback); }
    loaded() { return false; }
    isStyleLoaded() { return true; }
    getSource(id) { return this.sources.get(id); }
    getLayer() { return true; }
    getCanvas() { return this.canvas; }
    getZoom() { return this.zoom; }
    queryRenderedFeatures() { return this.renderedFeatures || []; }
    setPaintProperty(layer, property, value) {
      this.paintChanges ||= [];
      this.paintChanges.push({ layer, property, value });
    }
    setLayoutProperty(layer, property, value) {
      this.layoutChanges ||= [];
      this.layoutChanges.push({layer,property,value});
    }
    remove() { this.removed = true; }
    resize() { this.resized = true; }
    fitBounds(bounds, options) { this.bounds = bounds; this.fitOptions = options; }
  }
  class Popup {
    constructor() { popups.push(this); }
    setLngLat(value) { this.coordinates = value; return this; }
    setDOMContent(value) { this.content = value; return this; }
    addTo(value) { this.map = value; return this; }
    remove() { this.removed = true; return this; }
  }
  class Marker {
    constructor(options) { this.element = options.element; this.options = options; markers.push(this); }
    setLngLat(value) { this.coordinates = value; return this; }
    addTo(value) { this.map = value; return this; }
    getElement() { return this.element; }
    getLngLat() { return this.coordinates; }
    setOffset(offset) { this.options.offset = offset; return this; }
    remove() { this.removed = true; }
  }
  return { default: { Map, Popup, Marker, NavigationControl: class {}, AttributionControl: class {} } };
}

test('zone references keep configured numbering when observations omit earlier zones', () => {
  const d = dashboard();
  d.context.rows = [0, 2, 7].map(order => ({zoneKey:`zone-${order}`,zoneOrder:order,
    startMileMarker:206+order,endMileMarker:207+order,avgCurrentSpeed:50,bucketStart:'2026-06-19T01:00:00Z'}));
  assert.deepEqual(Array.from(d.run("groupZoneSeries(rows,24,Date.parse('2026-06-19T02:00:00Z')).map(group=>group.referenceLabel)")), ['Z1','Z3','Z8']);
  assert.equal(d.network.length,0);
});

test('different definitions sharing an order receive distinct deterministic references', () => {
  const d = dashboard();
  d.context.groups = [{key:'old|206|213',order:0},{key:'new|206|214',order:0},{key:'other',order:2}];
  const labels = Array.from(d.run('labelSpeedZoneGroups(groups).map(group=>[group.key,group.referenceLabel])'), row=>Array.from(row));
  const reversed = Array.from(d.run('labelSpeedZoneGroups([...groups].reverse()).map(group=>[group.key,group.referenceLabel])'), row=>Array.from(row));
  assert.deepEqual(labels,[['old|206|213','Z1b'],['new|206|214','Z1a'],['other','Z3']]);
  assert.deepEqual(new Map(labels),new Map(reversed));
});

test('zone identity colors follow configured order rather than visible row position', () => {
  const d=dashboard();
  d.context.groups=[{key:'west',order:0},{key:'middle',order:2},{key:'east',order:7}];
  const full=Array.from(d.run('labelSpeedZoneGroups(groups).map(group=>group.referenceColor)'));
  const omitted=Array.from(d.run('labelSpeedZoneGroups(groups.slice(1)).map(group=>group.referenceColor)'));
  assert.deepEqual(omitted,full.slice(1));
  assert.equal(new Set(full).size,3);
});

test('zone selection identity survives current-to-continuous key changes but not changed geometry',()=>{
  const d=dashboard();
  d.context.groups=[{key:'live',order:1,startMileMarker:213.1,endMileMarker:216,postedSpeedMph:50},
    {key:'live|213.1|216|50',order:1,startMileMarker:213.1,endMileMarker:216,postedSpeedMph:50},
    {key:'different',order:1,startMileMarker:213.1,endMileMarker:217,postedSpeedMph:50}];
  const references=Array.from(d.run('labelSpeedZoneGroups(groups).map(group=>group.referenceKey)'));
  assert.equal(references[0],references[1]);
  assert.notEqual(references[0],references[2]);
});

test('active zone finder pin keeps its original outline around a rose fill and transparent center', () => {
  const cssSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard.css'), 'utf8');
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

function zoneMotionFixture(reduced = false, withShield = false) {
  const d = dashboard(), motions = [], frames = [];
  d.context.window.matchMedia = () => ({matches: reduced});
  d.context.window.requestAnimationFrame = callback => frames.push(callback);
  d.run("state.focusedCorridor='I70';state.chartView='zones';drawAllCharts=()=>{}");
  const graph = {hidden:false, classList:{add(){},remove(){}},
    getBoundingClientRect:()=>({left:withShield && !d.run('state.zoneFinder') ? 72 : 0,
      top:400,width:d.run('state.zoneFinder') ? 800 : withShield ? 1128 : 1200})};
  const shield = {hidden:false, classList:{add(){},remove(){}},
    getBoundingClientRect:()=>({left:d.run('state.zoneFinder') ? -72 : 0,top:400,width:72})};
  const map = d.run("document.getElementById('corridorMapPanel')");
  map.hidden = false;
  map.getBoundingClientRect = () => d.run('state.zoneFinder')
    ? {left:800,top:400,width:400} : {left:600,top:1500,width:600};
  for (const node of [graph,shield,map]) node.animate = (keyframes,options) => {
    const motion = {node,keyframes,options,cancelled:false,cancel(){this.cancelled=true;}};
    motions.push(motion); return motion;
  };
  d.run("document.getElementById('i70Chart')").closest = selector => selector === '.chart-lane'
    ? {querySelector:()=>withShield ? shield : null} : graph;
  return {d,motions,frames};
}

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

async function zoneMapFixture() {
  const instances=[],markers=[],selections=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  const feature={type:'Feature',properties:{startMileMarker:206,endMileMarker:216,direction:'EASTBOUND',
    speedLimitSegments:[{startMileMarker:206,endMileMarker:213.1,description:'West approach'},
      {startMileMarker:213.1,endMileMarker:216,description:'Tunnel'}]},
    geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}};
  const groups=[{key:'west',referenceLabel:'Z1',referenceColor:'#58c4e6',postedSpeedMph:60,startMileMarker:206,endMileMarker:213.1},
    {key:'tunnel',referenceLabel:'Z2',referenceColor:'#b39aff',postedSpeedMph:50,startMileMarker:213.1,endMileMarker:216}];
  await d.context.window.CorridorMapPanel.render({corridor:'I70',zoneMode:true,corridorFeature:feature});
  d.context.window.CorridorMapPanel.setZones(groups,null,key=>selections.push(key));
  return {d,instances,markers,groups,selections};
}

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

test('standalone relative freshness uses sentence capitalization without changing time units',()=>{
  const d=dashboard();
  assert.equal(d.run('formatRelativeTime(new Date())'),'Just now');
  assert.equal(d.run('formatRelativeTime(new Date(Date.now()-120000))'),'2 min ago');
});

test('fixture basemap defaults stay offline while configured previews reuse one bounded read',async()=>{
  const {createPreviewBasemapLoader}=require('./dashboard-preview.cjs');
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
  const {createPreviewBasemapLoader}=require('./dashboard-preview.cjs');
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
  assert.match(popups[0].content.children[2].textContent, /CDOT report · Ongoing · Southbound · MM 220/);
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
  assert.match(popups[0].content.children[4].textContent, /CDOT report · Ongoing/);
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
  assert.equal(boundaries[0].element.textContent, '55 / 65 mph');
  assert.equal(boundaries[0].element.title, 'Posted speed changes near MM 221.5');
  assert.ok(Math.abs(boundaries[0].coordinates[1] - 40.005) < 1e-9);
  assert.match(boundaries[0].element.attributes['aria-label'], /mile marker 221\.5: 55 and 65/);
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
  const rows = d.run('aggregateIncidentThreads(features)');
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
  const rows = d.run('aggregateIncidentThreads(features)');
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.key === 'cdot|I25|one').ongoing, false);
});

test('incident locations do not repeat an existing MP or MM reference', () => {
  const d = dashboard();
  assert.equal(d.run("buildIncidentLocation({closestMileMarker:260.3, locationLabel:'I-25 southbound near MM 260.3'})"), 'I-25 southbound near MM 260.3');
  assert.equal(d.run("buildIncidentLocation({closestMileMarker:225, locationLabel:'Thornton'})"), 'MP 225 · Thornton');
});

test('worst-segment context formats usable mile-marker ranges', () => {
  const d = dashboard();
  assert.equal(d.run('formatZoneMileMarkerRange({startMileMarker:244, endMileMarker:232.5})'), 'MM 232.5–244');
  assert.equal(d.run('formatZoneMileMarkerRange({startMileMarker:225, endMileMarker:225})'), 'MM 225');
  assert.equal(d.run('formatZoneMileMarkerRange({})'), '');
});

test('rolling baseline excludes the current point, future points and observations older than seven days', () => {
  const d = dashboard();
  d.context.buckets = [
    { bucketStart: '2026-09-01T16:00:00Z', avgCurrentSpeed: 100 },
    { bucketStart: '2026-09-08T16:00:00Z', avgCurrentSpeed: 50 },
    { bucketStart: '2026-09-14T16:00:00Z', avgCurrentSpeed: 70 },
    { bucketStart: '2026-09-14T17:00:00Z', avgCurrentSpeed: 1 },
    { bucketStart: '2026-09-15T16:00:00Z', avgCurrentSpeed: 10 },
    { bucketStart: '2026-09-16T16:00:00Z', avgCurrentSpeed: 100 }
  ];
  assert.equal(d.run("buildRollingBaselines(buckets).get(Date.parse('2026-09-15T16:00:00Z'))"), 60);
  assert.ok(Number.isNaN(d.run("buildRollingBaselines(buckets).get(Date.parse('2026-09-01T16:00:00Z'))")));
});

test('Denver hour matching respects daylight saving offsets', () => {
  const d = dashboard();
  d.context.buckets = [
    { bucketStart: '2026-10-31T15:00:00Z', avgCurrentSpeed: 60 }, // 9 AM MDT
    { bucketStart: '2026-11-01T16:00:00Z', avgCurrentSpeed: 30 } // 9 AM MST
  ];
  assert.equal(d.run("buildRollingBaselines(buckets).get(Date.parse('2026-11-01T16:00:00Z'))"), 60);
});

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
  const preview=require('./dashboard-preview.cjs');
  const zones=preview.speedZones('I70');
  assert.deepEqual(zones.map(z=>[z.startMileMarker,z.endMileMarker,z.postedSpeedMph]),expected);
  const anchors=preview.corridorAnchors.I70;
  assert.equal(anchors.length,9);assert.equal(anchors.at(-1)[0],274);
  assert.equal(anchors.at(-1)[1],-104.990514722445);
  const geometry=JSON.parse(readFileSync(path.join(__dirname,'../../routes-service/src/main/resources/routes/i70.geojson'),'utf8'));
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
  assert.equal(d.nodes.get('i25IncidentCount').textContent, '5 ongoing · 5 total');
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
  assert.equal(d.nodes.get('i25IncidentCount').textContent, '1 ongoing · 3 total');
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
  assert.equal(d.nodes.get('i25IncidentCount').textContent, '0 ongoing · 1 total');
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
  const incident = d.run('aggregateIncidentThreads(features)[0]');
  const nameCell = d.run('buildIncidentNameCell(aggregateIncidentThreads(features)[0])');
  const locationCell = d.run('buildIncidentLocationCell(aggregateIncidentThreads(features)[0])');
  const lastSeenCell = d.run('buildLastSeenCell(aggregateIncidentThreads(features)[0])');
  assert.equal(incident.type, 'Crash');
  assert.equal(nameCell.children[0].children[1].textContent, 'Two-vehicle crash');
  assert.equal(locationCell.children[1].children[0].textContent, 'Incident details');
  assert.equal(locationCell.children[1].children[1].textContent,
    'Impact: Southbound: right lane closed · Slower speeds advised');
  assert.equal(locationCell.children[1].children[2].textContent, 'CDOT severity: Major');
  assert.equal(locationCell.children[1].children[3].textContent, 'CDOT note: Expect delays.');
  assert.equal(lastSeenCell.children[1].textContent, 'Cleared');
  assert.equal(lastSeenCell.children[2].textContent, 'Reported 1 hr 30 min');
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
  const incident = d.run('aggregateIncidentThreads(features)[0]');
  assert.equal(incident.ongoing, false);
  assert.equal(d.run('incidentStatusLabel(aggregateIncidentThreads(features)[0])'), 'Planned');
});

test('health never infers successful checks from existing route data', () => {
  const d = dashboard();
  d.run("state.routeData = buildDemoDashboardData().routeData; state.health = {apiUp:false}; renderSystemHealth()");
  assert.equal(d.nodes.get('apiServiceStatus').textContent, 'Unavailable');
  assert.equal(d.nodes.get('pipelineStatus').textContent, 'Unconfirmed');
});

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
  const style=readFileSync(path.join(__dirname,'../../api-service/src/main/resources/static/dashboard/health-panel.css'),'utf8');
  const source=readFileSync(path.join(__dirname,'../../api-service/src/main/resources/static/dashboard/health-panel.js'),'utf8');
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

function healthActivityFixture(reduced=false) {
  const make=()=>({classes:new Set(),events:{},dataset:{},textContent:'',
    classList:{add(name){this.owner.classes.add(name);},remove(name){this.owner.classes.delete(name);},toggle(name,on){on?this.add(name):this.remove(name);}},
    addEventListener(name,callback){this.events[name]=callback;}});
  const node=()=>{const value=make();value.classList.owner=value;return value;};
  const cards=new Map(['routes','ingest','api','database'].map(key=>{
    const card=node(),label=node();card.dataset.healthChannel=key;card.label=label;card.querySelector=()=>label;return[key,card];
  }));
  const panel=node(),counts=[node(),node()];
  counts.forEach(value=>{value.parentElement=node();value.textContent='100';});
  panel.querySelectorAll=selector=>selector.includes('SampleCount')?counts:counts.map(n=>n.parentElement).filter(n=>n.classes.has('pipeline-window-updated'));
  const root=node();root.querySelectorAll=()=>[...cards.values()];root.querySelector=()=>panel;
  let observer,clock=Date.parse('2026-10-14T22:00:00Z');
  class ClockDate extends Date{constructor(value){super(value===undefined?clock:value);}static now(){return clock;}}
  const document={hidden:false,events:{},querySelectorAll:()=>[root],addEventListener(name,fn){this.events[name]=fn;}};
  const motion={matches:reduced,events:{},addEventListener(name,fn){this.events[name]=fn;}};
  const window={events:{},matchMedia:()=>motion,addEventListener(name,fn){this.events[name]=fn;},IntersectionObserver:class{
    constructor(fn){observer=this;this.callback=fn;}observe(){}disconnect(){}
  }};
  const source=readFileSync(path.join(__dirname,'../../api-service/src/main/resources/static/dashboard/health-panel.js'),'utf8');
  vm.runInNewContext(source,{window,document,Date:ClockDate,URLSearchParams});
  return {cards,panel,counts,root,document,window,motion,monitor:window.HealthMonitor,
    advance(){clock+=1000;},visible(value=true){observer.callback([{target:root,isIntersecting:value}]);},
    clear(){cards.forEach(card=>card.classes.clear());panel.classes.clear();counts.forEach(n=>n.parentElement.classes.clear());}};
}

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

test('observation desk retains metric meanings and decorative receipts stay separate',()=>{
  const section=indexSource.slice(indexSource.indexOf('<div class="pipeline-summary"'),indexSource.indexOf('<section id="under-the-hood"'));
  assert.match(section,/across live and archive tables; not all database tables/);
  assert.doesNotMatch(section,/Samples · Window|Last Usable Sample/);
  assert.equal([...section.matchAll(/data-observation-number/g)].length,3);
  assert.match(section,/class="pipeline-mail-slot" aria-hidden="true"/);
  assert.equal([...section.matchAll(/class="pipeline-paper-stack" aria-hidden="true"/g)].length,2);
  const style=readFileSync(path.join(__dirname,'../../api-service/src/main/resources/static/dashboard/health-panel.css'),'utf8');
  assert.match(style,/\.pipeline-counter-active \.pipeline-mail-slot i \{[^}]*animation: health-store-record/);
  assert.match(style,/\.pipeline-counter-active \.pipeline-paper-stack \{[^}]*animation: pipeline-drawer-sort/);
  assert.match(style,/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.pipeline-paper-stack i[\s\S]*animation: none !important/);
  assert.doesNotMatch(style,/infinite/);
});

test('only database metadata feeds stored counters, including version hints but not chart windows',()=>{
  const d=dashboard();
  d.run('window.counterReads=[];window.StoredObservations={receive(section,previous){window.counterReads.push({section,previous})}}');
  d.run("acceptDashboardSections({'/traffic/database/observations?':{status:200,version:'db1',data:{total:10}}})");
  d.run("acceptDashboardSections({'/traffic/database/observations?':{status:200,version:'db1'}})");
  assert.equal(d.run('window.counterReads.length'),2);
  assert.equal(d.run('window.counterReads[1].previous.data.total'),10);
  d.run("acceptDashboardSections({'/traffic/database/observations?':{status:200,version:'db2',data:{total:20}}},true)");
  d.run('renderSystemHealth();renderSystemHealth()');
  assert.equal(d.run('window.counterReads.length'),2);
  d.run("acceptDashboardSections({'/traffic/database/observations?':{status:503}})");
  assert.equal(d.run('window.counterReads[2].section.status'),503);
});

test('cached rendering and historical reads never report a new live snapshot response',async()=>{
  const d=dashboard(async()=>({ok:true,json:async()=>({})}));
  d.run('window.activity=[];window.HealthMonitor={receive(){window.activity.push(true)},setRetained(){},windowCounts(){}};renderSystemHealth();renderSystemHealth()');
  assert.equal(d.run('window.activity.length'),0);
  await d.run('readDashboardBatch(dashboardApi("/traffic/dashboard/snapshot?ranges=24&selectedHours=24&historical=false"))');
  assert.equal(d.run('window.activity.length'),1);
  await d.run('readDashboardBatch(dashboardApi("/traffic/dashboard/history?hours=2&asOf=2026-10-14T21%3A00%3A00Z&corridors=I25"))');
  assert.equal(d.run('window.activity.length'),1);
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

test('disabled browser storage does not break startup theme', () => {
  const d = dashboard();
  d.run('initializeTheme()');
  assert.equal(d.context.document.documentElement.dataset.theme, 'light');
});

test('device color scheme is the default when no theme override is stored', () => {
  const d = dashboard();
  d.context.window.matchMedia = () => ({ matches: true, addEventListener() {} });
  d.run('initializeTheme()');
  assert.equal(d.context.document.documentElement.dataset.theme, 'dark');
});

test('baseline fills the visible timeline with two-sigma variability and axes fit the observed range', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-09-15T16:00:00Z');
  d.context.end = Date.parse('2026-09-15T18:00:00Z');
  d.context.buckets = [
    { bucketStart: '2026-09-14T16:00:00Z', avgCurrentSpeed: 60 },
    { bucketStart: '2026-09-14T17:00:00Z', avgCurrentSpeed: 65 },
    { bucketStart: '2026-09-14T18:00:00Z', avgCurrentSpeed: 70 }
  ];
  assert.equal(d.run('buildBaselineSeries(buckets, start, end).length'), 3);
  assert.equal(d.run('buildBaselineSeries(buckets, start, end)[0].timestamp'), d.context.start);
  assert.equal(d.run('buildBaselineSeries(buckets, start, end).at(-1).timestamp'), d.context.end);
  assert.equal(d.run('buildBaselineSeries(buckets, start, end)[0].standardDeviation'), 0);
  assert.deepEqual({ ...d.run('calculateSpeedDomain([62, 73])') }, { min: 60, max: 75, step: 5 });
  assert.deepEqual({ ...d.run('calculateSpeedDomain([64, 67])') }, { min: 62, max: 70, step: 2 });
});

test('weekly profiles replace the legacy baseline by matching Denver weekday and hour', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-09-15T16:00:00Z'); // Tuesday, 10 AM MDT
  d.context.end = Date.parse('2026-09-15T17:00:00Z');
  d.context.profiles = [
    { dayOfWeek: 2, hourOfDay: 10, sourceProfile: 'EXACT_DAY', sampleCount: 13,
      effectiveSampleSize: 10.5, meanSpeed: 67.5, standardDeviation: 2.25,
      coverageOneSigma: 70.1, coverageTwoSigma: 94.8, coverageThreeSigma: 99.2 },
    { dayOfWeek: 2, hourOfDay: 11, sourceProfile: 'EXACT_DAY', sampleCount: 13,
      effectiveSampleSize: 10.5, meanSpeed: 65.5, standardDeviation: 3,
      coverageOneSigma: 68.4, coverageTwoSigma: 93.6, coverageThreeSigma: 100 }
  ];
  const series = d.run('buildBaselineSeries([], start, end, profiles)');
  assert.equal(series.length, 2);
  assert.deepEqual(Array.from(series, point => point.speed), [67.5, 65.5]);
  assert.equal(series[0].standardDeviation, 2.25);
  assert.equal(series[0].sourceProfile, 'EXACT_DAY');
  assert.equal(series[0].coverageTwoSigma, 94.8);
});

test('reference band uses the selected population-standard-deviation width', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-09-15T16:00:00Z');
  d.context.buckets = [
    { bucketStart: '2026-09-13T16:00:00Z', avgCurrentSpeed: 60 },
    { bucketStart: '2026-09-14T16:00:00Z', avgCurrentSpeed: 70 }
  ];
  d.context.point = d.run('buildBaselineSeries(buckets, start, start)[0]');
  assert.equal(d.context.point.speed, 65);
  assert.equal(d.context.point.standardDeviation, 5);
  assert.deepEqual({ ...d.run('referenceBandLimits(point)') }, { lower: 55, upper: 75 });
  d.run('state.referenceSigma = 1');
  assert.deepEqual({ ...d.run('referenceBandLimits(point)') }, { lower: 60, upper: 70 });
  d.run('state.referenceSigma = 3');
  assert.deepEqual({ ...d.run('referenceBandLimits(point)') }, { lower: 50, upper: 80 });
});

test('reference band presses share brief depth feedback without changing bounds or making reads', () => {
  const d=dashboard();
  const clock=historyHoverClock(d);
  d.run('initializeControls()');
  for(const [id,step,value] of [['sigmaDecrease',-1,1],['sigmaIncrease',1,2]]){
    const button=d.nodes.get(id);button.dataset.sigmaStep=String(step);
    d.nodes.get('sigmaControl').events.click({target:{closest:()=>button}});
    assert.equal(d.run('state.referenceSigma'),value);
    assert.equal(button.attributes['data-history-pressed'],'true');
    clock.advance(450);
    assert.equal(button.attributes['data-history-pressed'],undefined);
  }
  d.run('setReferenceSigma(1)');
  const disabled=d.nodes.get('sigmaDecrease');
  d.nodes.get('sigmaControl').events.click({target:{closest:()=>disabled}});
  assert.equal(disabled.attributes['data-history-pressed'],undefined);
  assert.equal(d.run('state.referenceSigma'),1);
  assert.equal(d.network.length,0);
});

test('reference band rocker clamps to one through three sigma and reports coverage', () => {
  const d = dashboard();
  d.run('setReferenceSigma(1)');
  assert.equal(d.run('state.referenceSigma'), 1);
  assert.equal(d.nodes.get('sigmaValue').textContent, '±1σ');
  assert.equal(d.nodes.get('sigmaCoverage').textContent, '68.3%');
  assert.equal(d.nodes.get('sigmaDecrease').disabled, true);
  d.run('setReferenceSigma(0)');
  assert.equal(d.run('state.referenceSigma'), 1);
  d.run('setReferenceSigma(9)');
  assert.equal(d.run('state.referenceSigma'), 3);
  assert.equal(d.nodes.get('sigmaValue').textContent, '±3σ');
  assert.equal(d.nodes.get('sigmaCoverage').textContent, '99.7%');
  assert.equal(d.nodes.get('sigmaIncrease').disabled, true);
});

test('reference band reports empirical profile coverage when it is available', () => {
  const d = dashboard(undefined, '?historical=1');
  d.run(`state.selectedHours = 2;
    state.focusedCorridor = 'I25';
    state.routeData.set('I25', {
      dataAnchor: '2026-09-15T18:00:00Z',
      trend: {buckets: []},
      baseline: {profiles: [
        {dayOfWeek:2,hourOfDay:10,meanSpeed:68,standardDeviation:2,effectiveSampleSize:10,coverageOneSigma:71,coverageTwoSigma:94,coverageThreeSigma:99},
        {dayOfWeek:2,hourOfDay:11,meanSpeed:67,standardDeviation:2,effectiveSampleSize:10,coverageOneSigma:69,coverageTwoSigma:96,coverageThreeSigma:100},
        {dayOfWeek:2,hourOfDay:12,meanSpeed:66,standardDeviation:2,effectiveSampleSize:10,coverageOneSigma:70,coverageTwoSigma:95,coverageThreeSigma:100}
      ]}
    });
    updateReferenceBandControl()`);
  assert.equal(d.nodes.get('sigmaCoverage').textContent, '95.0%');
  assert.match(d.nodes.get('sigmaCoverage').title, /historical observations/);
  d.run('setReferenceSigma(1)');
  assert.equal(d.nodes.get('sigmaCoverage').textContent, '70.0%');
});

test('broad statistical bands do not zoom out the current-speed chart', () => {
  const d = dashboard();
  d.context.samples = [{ speed: 50 }, { speed: 65 }];
  d.context.baseline = [{ speed: 70, standardDeviation: 10 }];
  assert.deepEqual({ ...d.run('calculateCorridorSpeedDomain(samples, baseline)') }, { min: 45, max: 75, step: 5 });
  assert.deepEqual({ ...d.run('referenceBandLimits(baseline[0])') }, { lower: 50, upper: 90 });
});

test('24-hour charts merge older hourly history with recent detailed samples and meet both window edges', () => {
  const d = dashboard();
  d.context.end = Date.parse('2026-06-18T22:24:00Z');
  d.context.start = d.context.end - 24 * 3_600_000;
  d.context.hourly = Array.from({ length: 27 }, (_, index) => ({
    bucketStart: new Date(Date.parse('2026-06-17T20:00:00Z') + index * 3_600_000).toISOString(),
    avgCurrentSpeed: 66 + Math.sin(index / 3) * 3
  }));
  d.context.detailed = Array.from({ length: 500 }, (_, index) => ({
    polledAt: new Date(d.context.end - (499 - index) * 60_000).toISOString(),
    avgCurrentSpeed: 62 + Math.sin(index / 12) * 4
  }));
  const series = d.run('buildCurrentSpeedSeries(hourly, detailed, 24, end)');
  assert.equal(series[0].timestamp, d.context.start);
  assert.equal(series.at(-1).timestamp, d.context.end);
  assert.ok(series.some(point => point.timestamp < Date.parse(d.context.detailed[0].polledAt)));
  d.context.series = series;
  assert.equal(d.run("chartSegments(series.map(point => ({...point, verticalPosition:point.speed}))).length"), 1);
});

test('detailed chart samples distinguish fresh provider states from repeated states', () => {
  const d = dashboard();
  d.context.samples = [
    { polledAt: '2026-06-18T20:00:00Z', sourceMode: 'tile', avgCurrentSpeed: 60,
      avgFreeflowSpeed: 68, speedSampleCount: 40, incidentCount: 2 },
    { polledAt: '2026-06-18T20:01:00Z', sourceMode: 'tile', avgCurrentSpeed: 60,
      avgFreeflowSpeed: 68, speedSampleCount: 40, incidentCount: 2 },
    { polledAt: '2026-06-18T20:02:00Z', sourceMode: 'tile', avgCurrentSpeed: 60,
      avgFreeflowSpeed: 68, speedSampleCount: 40, incidentCount: 3 }
  ];
  assert.deepEqual(Array.from(d.run('normalizeSpeedSamples(samples)'), point => point.isCarryForward), [false, true, false]);
  d.context.hourly = [
    { bucketStart: '2026-06-18T20:00:00Z', avgCurrentSpeed: 60 },
    { bucketStart: '2026-06-18T21:00:00Z', avgCurrentSpeed: 60 }
  ];
  assert.deepEqual(Array.from(d.run('normalizeSpeedSamples(hourly)'), point => point.isCarryForward), [false, false]);
});

test('compact chart history preserves plotted points and canonical and fallback repeat states', () => {
  const d = dashboard();
  const fields = ['sourceMode', 'avgCurrentSpeed', 'avgFreeflowSpeed', 'minCurrentSpeed',
    'confidence', 'speedSampleCount', 'p10Speed', 'p50Speed', 'p90Speed',
    'speedStateSignature', 'incidentCount', 'polledAt'];
  const base = { sourceMode: 'tile', avgCurrentSpeed: 60, avgFreeflowSpeed: 68,
    minCurrentSpeed: 42, confidence: .9, speedSampleCount: 40, p10Speed: 52,
    p50Speed: 61, p90Speed: 67, incidentCount: 2, flowProvider: 'TomTom',
    incidentsJson: '[{"details":"not needed by charts"}]', archived: true };
  d.context.full = [
    { ...base, polledAt: '2026-06-18T20:00:00Z', speedStateSignature: 'one' },
    { ...base, polledAt: '2026-06-18T20:01:00Z', speedStateSignature: 'one' },
    { ...base, polledAt: '2026-06-18T20:02:00Z' },
    { ...base, polledAt: '2026-06-18T20:03:00Z' },
    { ...base, polledAt: '2026-06-18T20:04:00Z', incidentCount: 3, avgCurrentSpeed: 12 },
    { ...base, polledAt: '2026-06-18T20:05:00Z', avgCurrentSpeed: null },
    { ...base, polledAt: null }
  ];
  d.context.compact = d.context.full.map(row => Object.fromEntries(fields
    .filter(field => row[field] != null).map(field => [field, row[field]])));
  assert.deepEqual(d.run('normalizeSpeedSamples(compact)'), d.run('normalizeSpeedSamples(full)'));
  assert.deepEqual(Array.from(d.run('normalizeSpeedSamples(compact)'), point => point.isCarryForward),
    [false, true, false, true, false]);
  d.context.end = Date.parse('2026-06-18T20:06:00Z');
  for (const hours of [2, 6, 24, 168, 720]) {
    assert.deepEqual(d.run(`buildCurrentSpeedSeries([], compact, ${hours}, end)`),
      d.run(`buildCurrentSpeedSeries([], full, ${hours}, end)`));
  }
});

test('trend smoothing emphasizes progressively broader patterns for longer chart ranges', () => {
  const d = dashboard();
  const center = Date.parse('2026-06-18T20:00:00Z');
  d.context.samples = Array.from({ length: 181 }, (_, index) => ({
    timestamp: center + index * 2 * 60_000,
    speed: index >= 80 && index <= 100 ? 72 : 60
  }));
  const shortRangePeak = Math.max(...d.run('buildSmoothedSpeedSeries(samples, 2)').map(point => point.speed));
  const mediumRangePeak = Math.max(...d.run('buildSmoothedSpeedSeries(samples, 6)').map(point => point.speed));
  const dayRangePeak = Math.max(...d.run('buildSmoothedSpeedSeries(samples, 24)').map(point => point.speed));
  assert.ok(shortRangePeak > mediumRangePeak + 1);
  assert.ok(mediumRangePeak > dayRangePeak + 1);
});

test('six-hour trend responds to sustained slowdowns without following a single spike', () => {
  const d = dashboard();
  const start = Date.parse('2026-06-18T20:00:00Z');
  d.context.samples = Array.from({ length: 181 }, (_, index) => ({
    timestamp: start + index * 2 * 60_000,
    speed: index === 125 ? 86 : index >= 75 && index <= 105 ? 64 : 72
  }));
  const smoothed = d.run('buildSmoothedSpeedSeries(samples, 6)');
  const nearMinute = minute => smoothed.reduce((nearest, point) =>
    Math.abs(point.timestamp - start - minute * 60_000) < Math.abs(nearest.timestamp - start - minute * 60_000)
      ? point : nearest);
  assert.ok(nearMinute(180).speed < 67);
  assert.ok(nearMinute(120).speed > 70);
  assert.ok(Math.max(...smoothed.map(point => point.speed)) < 76);
});

test('24-hour trend keeps broad morning and evening slowdowns without tracing sample noise', () => {
  const d = dashboard();
  const start = Date.parse('2026-06-18T20:00:00Z');
  d.context.samples = Array.from({ length: 97 }, (_, index) => {
    const hour = index / 4;
    const slowdown = Math.max(0, 1 - Math.abs(hour - 6) / 3)
      + Math.max(0, 1 - Math.abs(hour - 18) / 3);
    return {
      timestamp: start + index * 15 * 60_000,
      speed: 70 - 9 * slowdown + (index % 2 ? 1.5 : -1.5)
    };
  });
  const smoothed = d.run('buildSmoothedSpeedSeries(samples, 24)');
  const nearHour = hour => smoothed.reduce((nearest, point) =>
    Math.abs(point.timestamp - start - hour * 3_600_000) < Math.abs(nearest.timestamp - start - hour * 3_600_000)
      ? point : nearest);
  const rawVariation = d.context.samples.slice(1).reduce((sum, sample, index) =>
    sum + Math.abs(sample.speed - d.context.samples[index].speed), 0);
  const trendVariation = smoothed.slice(1).reduce((sum, sample, index) =>
    sum + Math.abs(sample.speed - smoothed[index].speed), 0);
  assert.ok(smoothed.length < d.context.samples.length / 2);
  assert.ok(nearHour(6).speed < nearHour(12).speed - 2);
  assert.ok(nearHour(18).speed < nearHour(12).speed - 2);
  assert.ok(nearHour(6).speed < 65);
  assert.ok(nearHour(18).speed < 65);
  assert.ok(trendVariation < rawVariation / 3);
});

test('a sparse pair of speed observations does not imply a trend', () => {
  const d = dashboard();
  d.context.samples = [
    { timestamp: Date.parse('2026-06-18T20:00:00Z'), speed: 60 },
    { timestamp: Date.parse('2026-06-18T20:01:00Z'), speed: 70 }
  ];
  assert.equal(d.run('buildSmoothedSpeedSeries(samples, 2)').length, 0);
});

test('long-range trend stays continuous within observations but stops at data gaps', () => {
  const d = dashboard();
  const start = Date.parse('2026-06-18T20:00:00Z');
  d.context.samples = Array.from({ length: 24 }, (_, index) => ({
    timestamp: start + index * 60 * 60_000,
    speed: 65 + Math.sin(index / 4) * 5
  }));
  const contiguous = d.run('buildSmoothedSpeedSeries(samples, 720)');
  assert.equal(d.run('chartSegments(buildSmoothedSpeedSeries(samples, 720).map(point => ({...point, verticalPosition: point.speed}))).length'), 1);
  assert.ok(contiguous.length >= d.context.samples.length);
  d.context.samples.splice(10, 3);
  assert.equal(d.run('chartSegments(buildSmoothedSpeedSeries(samples, 720).map(point => ({...point, verticalPosition: point.speed}))).length'), 2);
});

test('week and month trends retain daily slowdowns and an exceptional traffic day', () => {
  const d = dashboard();
  const start = Date.parse('2026-06-01T00:00:00Z');
  d.context.samples = Array.from({ length: 30 * 24 }, (_, index) => {
    const day = Math.floor(index / 24);
    const hour = index % 24;
    let speed = hour >= 7 && hour <= 9 ? 64 : 72;
    if (day === 27 && hour >= 6 && hour <= 11) speed = 54;
    if (day === 26 && hour === 15) speed = 45;
    return {
      timestamp: start + index * 3_600_000,
      speed
    };
  });
  const at = (series, day, hour) => series.find(point =>
    point.timestamp === start + (day * 24 + hour) * 3_600_000).speed;
  const week = d.run('buildSmoothedSpeedSeries(samples.slice(-168), 168)');
  const month = d.run('buildSmoothedSpeedSeries(samples, 720)');
  for (const series of [week, month]) {
    const dailyDrop = at(series, 25, 14) - at(series, 25, 8);
    const exceptionalDrop = at(series, 25, 8) - at(series, 27, 8);
    const isolatedHour = at(series, 26, 15);
    assert.ok(dailyDrop > 4, `daily change ${dailyDrop}`);
    assert.ok(exceptionalDrop > 5);
    assert.ok(isolatedHour < 69 && isolatedHour > 50);
  }
});

test('isolated speed outliers have limited influence on the normalized trend', () => {
  const d = dashboard();
  const start = Date.parse('2026-06-18T20:00:00Z');
  d.context.samples = Array.from({ length: 61 }, (_, index) => ({
    timestamp: start + index * 60_000,
    speed: index === 30 ? 100 : 60
  }));
  const smoothed = d.run('buildSmoothedSpeedSeries(samples, 24)');
  assert.ok(Math.max(...smoothed.map(point => point.speed)) < 62);
});

test('repeated carry-forward polls do not drown out sustained fresh changes', () => {
  const d = dashboard();
  const start = Date.parse('2026-06-18T20:00:00Z');
  const freshSpeeds = new Map([[0, 70], [30, 62], [60, 70], [90, 62], [120, 70]]);
  let speed = 70;
  d.context.samples = Array.from({ length: 121 }, (_, index) => {
    if (freshSpeeds.has(index)) speed = freshSpeeds.get(index);
    return {
      timestamp: start + index * 60_000,
      speed,
      isCarryForward: !freshSpeeds.has(index)
    };
  });
  const smoothed = d.run('buildSmoothedSpeedSeries(samples, 2)');
  const nearMinute = minute => smoothed.reduce((nearest, point) =>
    Math.abs(point.timestamp - start - minute * 60_000) < Math.abs(nearest.timestamp - start - minute * 60_000)
      ? point : nearest);
  assert.ok(nearMinute(45).speed < nearMinute(75).speed,
    `first slowdown ${nearMinute(45).speed}, recovery ${nearMinute(75).speed}`);
  assert.ok(nearMinute(105).speed < nearMinute(75).speed,
    `second slowdown ${nearMinute(105).speed}, recovery ${nearMinute(75).speed}`);
});

test('sample markers remain prominent while scaling gently for dense ranges', () => {
  const d = dashboard();
  assert.equal(d.run('pointMarkerRadius(120)'), 3.2);
  assert.equal(d.run('pointMarkerRadius(200)'), 2.5);
  assert.equal(d.run('pointMarkerRadius(500)'), 2.1);
});

test('synthetic window-edge points stay available to lines but are not observation markers', () => {
  const d = dashboard();
  d.context.samples = [
    { timestamp: 1_000, speed: 50 },
    { timestamp: 61_000, speed: 70 }
  ];
  const boundary = d.run('speedBoundaryPoint(samples, 31_000)');
  assert.equal(boundary.speed, 60);
  assert.equal(boundary.isBoundary, true);
});

test('seven-day charts use a complete hourly current series and a complete preceding-week baseline', () => {
  const d = dashboard();
  d.context.end = Date.parse('2026-06-18T22:00:00Z');
  d.context.start = d.context.end - 168 * 3_600_000;
  d.context.buckets = Array.from({ length: 337 }, (_, index) => ({
    bucketStart: new Date(d.context.end - (336 - index) * 3_600_000).toISOString(),
    avgCurrentSpeed: 60 + Math.sin(index / 8) * 8
  }));
  assert.equal(d.run('selectDisplayBuckets(buckets, 168, end).length'), 169);
  assert.equal(d.run('buildBaselineSeries(buckets, start, end).length'), 169);
  assert.equal(d.run("chartSegments(selectDisplaySamples(buckets, 168, end).map(point => ({...point, verticalPosition:point.speed}))).length"), 1);
});

test('short-range rulers keep quarter-hour marks and space labels to the canvas width', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-09-10T18:07:00Z');
  d.context.end = d.context.start + 2 * 3_600_000;
  const desktop = d.run('buildTimeAxisTicks(start, end, 720)');
  const mobile = d.run('buildTimeAxisTicks(start, end, 220)');
  assert.equal(desktop.length, 8);
  assert.equal(desktop.filter(tick => tick.label).length, 4);
  assert.equal(mobile.length, 8);
  assert.equal(mobile.filter(tick => tick.label).length, 2);
  assert.equal(desktop.find(tick => tick.timestamp === Date.parse('2026-09-10T19:15:00Z')).level, 'minor');
  assert.match(desktop.find(tick => tick.timestamp === Date.parse('2026-09-10T19:30:00Z')).label, /:30/);

  d.context.end = d.context.start + 6 * 3_600_000;
  const sixHours = d.run('buildTimeAxisTicks(start, end, 720)');
  assert.equal(sixHours.find(tick => tick.timestamp === Date.parse('2026-09-10T19:30:00Z')).level, 'medium');
  assert.equal(sixHours.find(tick => tick.timestamp === Date.parse('2026-09-10T19:00:00Z')).level, 'major');
  assert.ok(sixHours.every((tick, index) => index === 0 || tick.horizontalPosition - sixHours[index - 1].horizontalPosition >= 8));
  const narrow = d.run('buildTimeAxisTicks(start, end, 180)');
  assert.ok(narrow.every((tick, index) => index === 0 || tick.horizontalPosition - narrow[index - 1].horizontalPosition >= 8));
});

test('day and month rulers preserve visible ticks while thinning narrow layouts', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-09-10T18:07:00Z');
  d.context.end = d.context.start + 24 * 3_600_000;
  const dayDesktop = d.run('buildTimeAxisTicks(start, end, 720)');
  const dayMobile = d.run('buildTimeAxisTicks(start, end, 220)');
  assert.equal(dayDesktop.find(tick => tick.timestamp === Date.parse('2026-09-10T19:00:00Z')).level, 'medium');
  assert.equal(dayDesktop.find(tick => tick.timestamp === Date.parse('2026-09-10T19:30:00Z')).level, 'minor');
  assert.equal(dayMobile.some(tick => tick.timestamp === Date.parse('2026-09-10T19:30:00Z')), false);
  assert.equal(dayMobile.find(tick => tick.timestamp === Date.parse('2026-09-10T19:00:00Z')).level, 'medium');

  d.context.start = Date.parse('2026-10-31T00:00:00Z');
  d.context.end = d.context.start + 168 * 3_600_000;
  const week = d.run('buildTimeAxisTicks(start, end, 220)');
  const transitions = week.filter(tick => tick.guide);
  assert.equal(transitions.length, 7);
  assert.ok(transitions.some(tick => tick.timestamp === Date.parse('2026-11-01T06:00:00Z')));
  assert.ok(transitions.some(tick => tick.timestamp === Date.parse('2026-11-02T07:00:00Z')));
  assert.ok(transitions.filter(tick => tick.label).length <= 2);

  d.context.start = Date.parse('2026-09-01T12:00:00Z');
  d.context.end = d.context.start + 720 * 3_600_000;
  const monthDesktop = d.run('buildTimeAxisTicks(start, end, 900)');
  const monthMobile = d.run('buildTimeAxisTicks(start, end, 220)');
  assert.equal(monthDesktop.length, 30);
  assert.ok(monthMobile.length < monthDesktop.length);
  assert.ok(monthMobile.every((tick, index) => index === 0 || tick.horizontalPosition - monthMobile[index - 1].horizontalPosition >= 8));
  assert.ok(monthMobile.filter(tick => tick.label).length <= 2);
});

test('time guides and ticks use the chart plot origin', () => {
  const d = dashboard();
  const moves = [];
  const lines = [];
  d.context.ctx = new Proxy({
    moveTo(x, y) { moves.push([x, y]); },
    lineTo(x, y) { lines.push([x, y]); }
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  d.context.ticks = [{ horizontalPosition: 25, level: 'major', label: 'Noon', guide: true }];
  d.run("drawTimeGuides(ctx, ticks, 50, 30, 160, {muted:'#555'})");
  d.run("drawXAxis(ctx, ticks, {width:250,height:190}, {left:50,right:20,bottom:30}, {muted:'#555',ink:'#111'})");
  assert.deepEqual(moves, [[75, 30], [75, 160]]);
  assert.deepEqual(lines, [[75, 160], [75, 169]]);
});

test('duplicate chart incidents collapse into one counted marker', () => {
  const d = dashboard();
  d.context.incidents = [event(), event({ providerEventId: 'two' })].map(row => ({
    type: 'Disabled Vehicle', locationLabel: row.properties.locationLabel,
    firstSeenAt: new Date(row.properties.firstSeenAt), lastSeenAt: new Date(row.properties.lastSeenAt)
  }));
  d.context.start = Date.parse('2026-09-13T09:00:00Z');
  d.context.end = Date.parse('2026-09-15T11:00:00Z');
  assert.equal(d.run('buildIncidentChartGroups(incidents, start, end, 50, 400)[0].count'), 2);
});

test('long-range charts show the five busiest incident days', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-09-01T00:00:00Z');
  d.context.end = Date.parse('2026-09-08T00:00:00Z');
  d.context.incidents = [1, 6, 2, 5, 4, 3].flatMap((count, dayIndex) =>
    Array.from({ length: count }, (_, incidentIndex) => ({
      type: 'Crash',
      firstSeenAt: new Date(Date.UTC(2026, 8, dayIndex + 1, 18, incidentIndex))
    }))
  );
  const groups = d.run('buildIncidentDayGroups(incidents, start, end, 5)');
  assert.deepEqual(Array.from(groups, group => group.count), [6, 2, 5, 4, 3]);
  assert.deepEqual(Array.from(groups, group => group.label), [
    '6 incidents · Sep 2', '2 incidents · Sep 3', '5 incidents · Sep 4',
    '4 incidents · Sep 5', '3 incidents · Sep 6'
  ]);
  assert.equal(groups.every(group => group.combined), true);
});

test('incident day groups include the first instant of the selected window', () => {
  const d=dashboard();
  d.context.start=Date.parse('2026-09-01T18:00:00Z');
  d.context.incidents=[{type:'Crash',firstSeenAt:new Date(d.context.start)}];
  assert.equal(d.run('buildIncidentDayGroups(incidents,start,start+1000,5)[0].count'),1);
});

test('speed-zone incident markers stay inside the plot and use the open side of the speed point', () => {
  const d = dashboard();
  d.context.bounds = { top: 20, bottom: 120 };
  assert.equal(d.run("incidentFlagPlacement(32, bounds, 0, 'below').y"), 50);
  assert.equal(d.run("incidentFlagPlacement(32, bounds, 0, 'below').side"), 'below');
  assert.equal(d.run("incidentFlagPlacement(108, bounds, 0, 'above').y"), 90);
  assert.equal(d.run("incidentFlagPlacement(108, bounds, 0, 'above').side"), 'above');
  assert.equal(d.run("incidentFlagPlacement(25, bounds, 1, 'above').y"), 58);
  assert.equal(d.run("incidentFlagPlacement(25, bounds, 1, 'above').side"), 'below');
});

test('speed-zone incident labels extend past nearby traffic lines', () => {
  const d = dashboard();
  d.context.bounds = { top: 20, bottom: 120 };
  d.context.blocked = [{ min: 48, max: 56 }];
  assert.equal(d.run("incidentFlagPlacement(32, bounds, 0, 'below', blocked).y"), 72);
  assert.equal(d.run("incidentFlagPlacement(32, bounds, 0, 'below', blocked).side"), 'below');

  d.context.series = [[
    { horizontalPosition: 40, verticalPosition: 30 },
    { horizontalPosition: 80, verticalPosition: 70 }
  ]];
  assert.equal(d.run('trafficLineRanges(series, 50, 70)[0].min'), 40);
  assert.equal(d.run('trafficLineRanges(series, 50, 70)[0].max'), 60);
});

test('incident label backgrounds stay inside the chart edge', () => {
  const d = dashboard();
  const boxes = [];
  d.context.boxes = boxes;
  d.context.ctx = new Proxy({
    roundRect(left, top, width, height) { boxes.push({ left, top, width, height }); }
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  d.run("drawIncidentLabelBackground(ctx, 390, 60, 80, true, '#700', '#fff', 50, 400)");
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
  d.run("drawIncidentFlags(ctx, 'I25', incidents, points, 0, 20000, {left:43,right:18}, {panel:'#fff','--rose':'red'})");
  assert.equal(labels.length, 1);
  assert.equal(labels[0], '3 incidents');
  labels.length = 0;
  d.context.points = [{timestamp:10_000_000,verticalPosition:100,horizontalPosition:50}];
  d.run("drawIncidentFlags(ctx, 'I25', incidents, points, 0, 20000, {left:43,right:18}, {panel:'#fff','--rose':'red'})");
  assert.equal(labels.length, 0);
  assert.equal(d.run("incidentIconHref(normalizeIncidentType('weather'))"), '#icon-other');
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
    d.run("drawIncidentFlags(ctx,'I25',incidents,points,0,20000,{left:43,right:18},{panel:'#fff','--rose':'red'})");
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
  const server=require('node:http').createServer(require('./dashboard-preview.cjs').handleRequest);
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
