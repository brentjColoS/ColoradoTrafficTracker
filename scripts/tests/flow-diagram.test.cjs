const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const indexSource=readFileSync(path.join(__dirname,'../../api-service/src/main/resources/static/dashboard/index.html'),'utf8');

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
  assert.match(flowDiagramStyles,/@container flow-diagram \(max-width: 43rem\)/);
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
