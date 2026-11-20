const {test} = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../api-service/src/main/resources/static/dashboard/variable-speed-signs.js');
const {create} = require('../../api-service/src/main/resources/static/dashboard/variable-speed-history.js');
const hour=3600000, end=Date.parse('2026-11-18T12:00:00Z');
const sign=(ago,speed=45,changes={})=>({id:'a',mileMarker:234.5,direction:'EAST',longitude:-105.6,latitude:39.7,
  regularLimitMph:65,reportedLimitMph:speed,status:'AVAILABLE',displayStatus:'on',communicationStatus:'operational',
  fetchedAt:new Date(end-ago*hour).toISOString(),lastAttemptAt:new Date(end-ago*hour).toISOString(),...changes});
const history=(observations,start=end-24*hour,finish=end)=>({corridor:'I70',start:new Date(start).toISOString(),end:new Date(finish).toISOString(),observations});

test('observed reductions expire after one hour and never bridge six-hour read gaps',()=>{
  const rows=[sign(12),sign(6),sign(.5)], raw=JSON.stringify(rows);
  const periods=model.historyPeriods(history(rows));
  assert.deepEqual(periods.map(p=>[p.start,p.end]),[[end-12*hour,end-11*hour],[end-6*hour,end-5*hour],[end-.5*hour,end]]);
  assert.equal(JSON.stringify(rows),raw);
  assert.equal(model.historyPeriods({...history(rows),corridor:'I25'}).length,0);
});

test('normal, failed, unavailable and conflicting numeric reports end confirmation immediately',()=>{
  for(const stop of [sign(.75,65),sign(.75,45,{status:'FETCH_FAILED',fetchedAt:sign(1).fetchedAt}),
    sign(.75,45,{displayStatus:'off'}),sign(.75,65,{id:'b',mileMarker:234.55})]) {
    const periods=model.historyPeriods(history([sign(1),stop]));
    assert.equal(periods[0].end,end-.75*hour);
  }
  assert.deepEqual(model.historyPeriods(history([sign(0,45,{fetchedAt:new Date(end+hour).toISOString()})])),[]);
});

test('same-time companions resolve together and direction remains independent',()=>{
  const rows=[sign(1),sign(1,65,{id:'b',mileMarker:234.55}),sign(1,50,{id:'w',direction:'WEST'})];
  const periods=model.historyPeriods(history(rows.reverse()));
  assert.equal(periods.length,1);assert.equal(periods[0].direction,'WEST');assert.equal(periods[0].speed,50);
});

test('fresh observations just before the window clip correctly without using activation metadata',()=>{
  const periods=model.historyPeriods(history([sign(1.5,45,{activatedAt:'2020-01-01T00:00:00Z'})],end-hour));
  assert.equal(periods[0].start,end-hour);assert.equal(periods[0].end,end-.5*hour);
  assert.deepEqual(model.historyPeriods(history([sign(2.1)],end-hour)),[]);
});

test('zone membership is half-open, clips time and includes the final corridor edge only once',()=>{
  const groups=[{startMileMarker:216,endMileMarker:234.5},{startMileMarker:234.5,endMileMarker:274}];
  const periods=model.historyPeriods(history([sign(1)]));
  assert.equal(model.zonePeriods(periods,groups[0],groups,end-hour,end).length,0);
  assert.equal(model.zonePeriods(periods,groups[1],groups,end-hour,end).length,1);
  assert.equal(model.zonePeriods(periods,groups[1],groups,end-3*hour,end-2*hour).length,0);
});

test('reviewed directional references and invalid or oversized responses remain conservative',()=>{
  const west=sign(1,60,{id:'OpenTMS-Sign465279',mileMarker:237,direction:'WEST',regularLimitMph:60});
  assert.equal(model.historyPeriods(history([west]))[0].speed,60,'reviewed westbound reference is 65, not the eastbound road reference');
  assert.deepEqual(model.historyPeriods(history(Array(6001).fill(west))),[]);
  assert.deepEqual(model.historyPeriods(history([sign(1,45,{mileMarker:100})])),[]);
  assert.deepEqual(model.historyPeriods(history([sign(1,45,{communicationStatus:'error'})])),[]);
});

test('on-demand reader debounces, aborts obsolete windows, bounds cache and does not preload',async()=>{
  const jobs=new Map();let id=0,reads=[],paint=0;
  global.window={VariableSpeedSigns:model};
  const reader=create({timers:{setTimeout(fn){jobs.set(++id,fn);return id;},clearTimeout(key){jobs.delete(key);}},
    read:async(hours,finish,signal)=>{reads.push({hours,finish,signal});return history([sign(.5)],finish-hours*hour,finish);},repaint:()=>paint++});
  reader.ensure(false,end-24*hour,end);assert.equal(jobs.size,0);
  reader.ensure(true,end-24*hour,end);reader.ensure(true,end-6*hour,end);
  assert.equal(jobs.size,1);await [...jobs.values()][0]();jobs.clear();
  assert.equal(reads.length,1);assert.equal(reads[0].hours,6);assert.equal(reader.periods.length,1);assert.equal(paint,1);
  reader.ensure(true,end-6*hour,end);assert.equal(jobs.size,0);
  reader.ensure(false,end-6*hour,end);assert.equal(reader.periods.length,0);assert.equal(reader.status,'idle');
  delete global.window;
});

test('obsolete and failed requests cannot retain reductions from a previous window',async()=>{
  const jobs=new Map();let id=0,release,signal;
  global.window={VariableSpeedSigns:model};
  const reader=create({timers:{setTimeout(fn){jobs.set(++id,fn);return id;},clearTimeout(key){jobs.delete(key);}},
    read:(_hours,_finish,readSignal)=>{signal=readSignal;return new Promise(resolve=>release=resolve);},repaint:()=>{}});
  reader.ensure(true,end-hour,end);
  const outstanding=[...jobs.values()][0]();jobs.clear();
  reader.ensure(false,end-hour,end);assert.equal(signal.aborted,true);
  release(history([sign(.5)],end-hour,end));await outstanding;
  assert.equal(reader.periods.length,0);assert.equal(reader.status,'idle');
  delete global.window;
});
