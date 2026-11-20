const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../../api-service/src/main/resources/static/dashboard/dashboard-live-transition.js');
function fixture() {
  let clock=0,id=0,draws=0;
  const frames=new Map();
  const model=create({now:()=>clock,draw:()=>draws++,
    requestFrame:callback=>{frames.set(++id,callback);return id;},cancelFrame:id=>frames.delete(id)});
  const observe=changes=>model.observe({key:'current',corridor:'I70',end:1000,latest:500,animate:true,...changes});
  const advance=ms=>{clock+=ms;const pending=[...frames.values()];frames.clear();for(const frame of pending)frame();};
  return {model,observe,advance,frames,get draws(){return draws;}};
}
test('live window slides to the new time, then the actual arriving marker grows',()=>{
  const f=fixture();f.observe();assert.equal(f.frames.size,0);
  f.observe({end:61000,latest:60500});
  assert.equal(f.model.frame('I70').end,1000);assert.equal(f.frames.size,1);
  f.advance(210);assert.ok(f.model.frame('I70').end>1000&&f.model.frame('I70').end<61000);
  f.advance(210);assert.equal(f.model.frame('I70').end,61000);
  assert.equal(f.model.frame('I70').incoming.after,500);assert.equal(f.model.frame('I70').incoming.until,60500);
  assert.equal(f.model.frame('I70').incoming.scale,.12);
  f.advance(120);assert.ok(f.model.frame('I70').incoming.scale>.12&&f.model.frame('I70').incoming.scale<1);
  f.advance(120);assert.equal(f.model.frame('I70').incoming,null);assert.equal(f.frames.size,0);
  f.observe({end:61000,latest:60500});assert.equal(f.frames.size,0,'unchanged observations do not restart an animation');
});
test('initial, reduced-motion, offscreen, scope changes and long gaps snap without replay',()=>{
  const f=fixture();
  f.observe({latest:0});f.observe({end:61000,latest:60500});assert.equal(f.frames.size,0,'first load is not an arrival');
  f.observe({end:121000,latest:120500,animate:false});assert.equal(f.model.frame('I70').active,false);
  f.observe({end:721000,latest:720500});assert.equal(f.model.frame('I70').active,false);
  f.observe({end:781000,latest:780500});assert.equal(f.frames.size,1);
  f.observe({key:'historical',animate:false,end:1000});assert.equal(f.frames.size,0);
  f.model.reset();assert.equal(f.model.frame('I70'),null);
});
test('updates without a new point slide time but do not replay marker growth',()=>{
  const f=fixture();f.observe();f.observe({end:61000,latest:500});
  assert.equal(f.model.frame('I70').incoming,null);f.advance(420);assert.equal(f.model.frame('I70').active,false);
});
