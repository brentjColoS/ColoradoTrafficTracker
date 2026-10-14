const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function fixture(reduced=false) {
  const node=()=>({textContent:'',attributes:{},setAttribute(key,value){this.attributes[key]=value;}});
  const cards=['total','I25','I70'].map(key=>{
    const classes=new Set(), number=node(), gain=node();
    return {dataset:{observationCounter:key},classes,number,gain,
      querySelector:selector=>selector.includes('number')?number:gain,
      classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}};
  });
  const note=node(),panel={querySelectorAll:()=>cards,querySelector:()=>note};
  const frames=new Map(),events={},motion={matches:reduced,addEventListener:(name,fn)=>events.motion=fn};
  let observer,sequence=0;
  const document={hidden:false,querySelector:()=>panel,addEventListener:(name,fn)=>events[name]=fn};
  const window={matchMedia:()=>motion,addEventListener:(name,fn)=>events[name]=fn,
    requestAnimationFrame(fn){const id=++sequence;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    IntersectionObserver:class {constructor(fn){observer=fn;}observe(){}disconnect(){events.disconnected=true;}}};
  vm.runInNewContext(readFileSync(path.join(__dirname,'../../api-service/src/main/resources/static/dashboard/stored-observations.js'),'utf8'),{document,window,Date,Number});
  return {cards,note,frames,events,motion,document,receive:window.StoredObservations.receive,
    visible(value=true){observer([{isIntersecting:value}]);},
    tick(time){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));},
    values(){return cards.map(card=>Number(card.number.textContent.replaceAll(',','')));}};
}
const section=(total=100,minute=0)=>({status:200,version:`v${minute}`,data:{synthetic:true,
  observedAt:new Date(Date.UTC(2026,9,14,22,minute)).toISOString(),total,corridors:{I25:total-40,I70:40}}});

test('initial totals appear immediately; only a reported increase ticks to its exact target',()=>{
  const f=fixture();f.visible();f.receive(section());
  assert.deepEqual(f.values(),[100,60,40]);assert.equal(f.frames.size,0);
  f.receive(section(104,1));assert.deepEqual(f.values(),[100,60,40]);
  const update=section(104,1);
  f.receive({...update,data:undefined},update);
  assert.equal(f.frames.size,2,'a duplicate version hint does not prematurely finish an active tick');
  f.tick(0);f.tick(450);assert.deepEqual(f.values(),[102,62,40]);
  f.tick(900);assert.deepEqual(f.values(),[104,64,40]);assert.equal(f.frames.size,0);
  assert.equal(f.cards[0].gain.textContent,'+4 added');assert.equal(f.cards[2].gain.textContent,'');
  f.receive(section(104,2));assert.equal(f.frames.size,0);assert.equal(f.cards[0].gain.textContent,'');
  assert.match(f.note.textContent,/Demo database/);
});

test('cached metadata, decreases and older snapshots never manufacture growth',()=>{
  const f=fixture();f.visible();const first=section();f.receive(first);
  f.receive({...first,data:undefined},first);assert.equal(f.frames.size,0);
  f.receive(section(98,1));assert.deepEqual(f.values(),[98,58,40]);assert.equal(f.cards[0].gain.textContent,'');
  f.receive(section(200,0));assert.deepEqual(f.values(),[98,58,40]);
  f.receive(section(106,2));f.tick(0);f.tick(300);
  f.receive(section(108,3));f.tick(400);f.tick(1300);
  assert.deepEqual(f.values(),[108,68,40]);assert.equal(f.frames.size,0);
});

test('unavailable and invalid totals cancel motion and never display zero as a fallback',()=>{
  const f=fixture();f.visible();f.receive(section());f.receive(section(104,1));
  for(const invalid of [{status:503},{status:200,data:{total:-1}},
    {...section(104,2),data:{...section(104,2).data,total:99}},
    {...section(104,2),data:{...section(104,2).data,total:'104'}}]) {
    f.receive(invalid);assert.equal(f.frames.size,0);
    assert.equal(f.cards[0].number.textContent,'—');assert.match(f.note.textContent,/unavailable/);
  }
  f.receive(section(100,2));assert.deepEqual(f.values(),[100,60,40]);
});

test('visibility and reduced motion settle to the authoritative total without replay',()=>{
  const f=fixture();f.visible();f.receive(section());f.receive(section(104,1));
  f.visible(false);assert.deepEqual(f.values(),[104,64,40]);assert.equal(f.frames.size,0);
  f.visible();assert.equal(f.frames.size,0);
  f.receive(section(108,2));f.document.hidden=true;f.events.visibilitychange();
  assert.deepEqual(f.values(),[108,68,40]);assert.equal(f.frames.size,0);
  f.document.hidden=false;f.events.visibilitychange();assert.equal(f.frames.size,0);
  f.receive(section(112,3));f.motion.matches=true;f.events.motion();assert.equal(f.frames.size,0);
  assert.deepEqual(f.values(),[112,72,40]);
  const staticMode=fixture(true);staticMode.visible();staticMode.receive(section());staticMode.receive(section(104,1));
  assert.equal(staticMode.frames.size,0);assert.deepEqual(staticMode.values(),[104,64,40]);
});

test('page lifecycle does not leave a counting animation running or replay it',()=>{
  const f=fixture();f.visible();f.receive(section());f.receive(section(104,1));
  f.events.pagehide({persisted:true});assert.equal(f.frames.size,0);assert.deepEqual(f.values(),[104,64,40]);
  f.events.pageshow();assert.equal(f.frames.size,0);
  f.receive(section(108,2));f.events.pagehide({persisted:false});assert.equal(f.frames.size,0);
  assert.equal(f.events.disconnected,true);
});

test('fixture totals are elapsed-time based, not request or chart-window based',()=>{
  const {storedObservationFixture}=require('./dashboard-preview.cjs');
  const start=new Date('2026-10-14T22:00:00Z');
  assert.deepEqual(storedObservationFixture(1,start),storedObservationFixture(1,start));
  assert.equal(storedObservationFixture(2,start).total-storedObservationFixture(1,start).total,4);
  assert.equal(storedObservationFixture(2,start).synthetic,true);
});
