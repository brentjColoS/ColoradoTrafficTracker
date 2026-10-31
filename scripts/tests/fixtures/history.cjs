const { dashboard, vm, windowSummarySource } = require('./core.cjs');

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
  const frames = [], arrows = [], attributes = {}, images=[];
  const context = {setTransform(){},clearRect(){},drawImage(...args){images.push(args);},save(){},restore(){},beginPath(){},
    moveTo(){},lineTo(){},stroke(){arrows.push(true);}};
  f.d.context.document.createElement=()=>({getContext:()=>context});
  f.d.context.canvas = {width:0,height:0,getBoundingClientRect:()=>({width:1000,height:180}),
    getContext:()=>context,closest:()=>({style:{removeProperty(){},setProperty(){}}}),
    setAttribute(key,value){attributes[key]=value;}};
  f.d.context.capture = frame => frames.push(frame);
  f.d.run('drawCorridorChart=(canvas,corridor,data,frame)=>capture(frame);chartColors=()=>({muted:"gray"})');
  return {...f, bakes:frames, arrows, attributes, images, paint:()=>f.d.run("window.ContinuousHistory.paint(canvas,'I25')")};
}

function setContinuousFetch(f, fetch) {
  const batch = require("../dashboard-batch-fixture.cjs").batchFetch(fetch);
  f.d.context.window.fetch = batch;
  f.reads = batch.network;
}

module.exports = { prepareChartHistory, historyHoverClock, clickHistoryRange, summaryFixture, progressiveSummaryFixture, continuousFixture, preparedFixture, axisFixture, setContinuousFetch };
