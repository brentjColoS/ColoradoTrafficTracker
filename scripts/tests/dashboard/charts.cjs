const { test } = require('node:test');
const { dashboard, assert, liveEdgeFixture, readFileSync, path, indexSource, event } = require('../fixtures/core.cjs');
const { historyHoverClock } = require('../fixtures/history.cjs');
const { testDirectory } = require('../fixtures/core.cjs');

function chartPaintFixture(search = '') {
  const d = dashboard(undefined, search), commands = [];
  const now = Date.parse('2026-10-30T12:00:00Z');
  d.context.Date = class extends Date {
    constructor(...values) { super(...(values.length ? values : [now])); }
    static now() { return now; }
  };
  d.context.recordPaint = command => commands.push(command);
  d.run(`window.devicePixelRatio=1;
    ctx=new Proxy({measureText:text=>({width:String(text).length*5})},{
      get:(target,key)=>key in target?target[key]:(...args)=>recordPaint([key,...args]),
      set:(target,key,value)=>{target[key]=value;recordPaint(['set',key,value]);return true;}});
    canvas={clientWidth:600,getBoundingClientRect:()=>({width:600,height:300}),getContext:()=>ctx,
      closest:()=>({style:{removeProperty:key=>recordPaint(['removeProperty',key]),
        setProperty:(key,value)=>recordPaint(['setProperty',key,value])}})};ctx.canvas=canvas;
    chartColors=()=>({ink:'black',muted:'gray',panel:'white',forest:'green',band:'pink',
      grid:'gray',gridStrong:'black','--gold-data':'orange','--rose':'red'});
    points=[{timestamp:Date.now()-3600000,speed:45,standardDeviation:5},{timestamp:Date.now(),speed:60,standardDeviation:5}];
    route={summary:{latest:{polledAt:new Date().toISOString(),avgCurrentSpeed:60}},
      history:{samples:points.map(p=>({polledAt:new Date(p.timestamp).toISOString(),avgCurrentSpeed:p.speed}))},
      incidentThreads:[{type:'Crash',firstSeenAt:new Date(points[0].timestamp).toISOString(),ongoing:true}]};
    group={key:'zone',referenceKey:'selected',referenceLabel:'Z1',marker:'MM 208–221',
      postedSpeedMph:65,latestSpeed:60,samples:points,baselineProfiles:[]};`);
  return {d, commands};
}

test('a captured paint frame renders independently of later coordinator and history changes', () => {
  const {d, commands} = chartPaintFixture();
  d.run(`state.focusedCorridor='I25';state.chartView='zones';state.zoneFinder=true;state.selectedZoneKey='selected';
    frame=chartPaintFrame('I25',route);
    Object.assign(frame,{samples:points,trendSamples:points,baseline:points,groups:[group],baselines:new Map([['zone',points]])});
    Object.freeze(frame);routeBefore=JSON.stringify(route);
    isolatedPainter=window.DashboardChartPainter.create({sizeCanvas,chartSeries,drawEmptyChart,chartColors,
      chartAxis,CORRIDOR_CONFIG,finiteNumber,formatMetricNumber,dateMillis,displayTimeFormatter,Path2D,types:window.IncidentTypes});`);
  for (const view of ['Corridor', 'Zone']) {
    commands.length = 0;
    d.run(`isolatedPainter.draw${view}Chart(canvas,'I25',route,frame)`);
    const first = JSON.stringify(commands);
    d.run(`state.selectedHours=720;state.referenceSigma=3;state.zoneFinder=false;state.selectedZoneKey='other';
      chartHistory.endTime=Date.now()-86400000;chartHistory.dataKey=null;chartHistory.error='later failure'`);
    commands.length = 0;
    d.run(`isolatedPainter.draw${view}Chart(canvas,'I25',route,frame)`);
    assert.equal(JSON.stringify(commands), first, view);
    assert.ok(commands.every(command => command.slice(1).every(value => typeof value !== 'number' || Number.isFinite(value))));
  }
  assert.equal(d.run('JSON.stringify(route)'), d.run('routeBefore'));
  assert.equal(d.network.length, 0);
});

test('a wider history strip retains selected-range smoothing, detail and tick policy in both views', () => {
  for (const rangeHours of [2, 6, 24, 168, 720]) for (const view of ['Corridor', 'Zone']) {
    const {d} = chartPaintFixture(), calls = [];
    d.context.recordPolicy = (...args) => calls.push(args);
    d.context.rangeHours = rangeHours;
    d.run(`state.selectedHours=rangeHours;state.chartView='${view === 'Zone' ? 'zones' : 'overall'}';
      frame=chartPaintFrame('I25',route,{end:Date.now(),hours:rangeHours*2,strip:true});
      chartSeries.buildCurrentSpeedSeries=(buckets,detail,hours)=>{recordPolicy('detail',detail.length,hours);return points;};
      chartSeries.groupZoneSeries=(zones,hours)=>{recordPolicy('groups',hours);return [group];};
      chartSeries.buildSmoothedSpeedSeries=(samples,hours)=>{recordPolicy('smoothing',hours);return samples;};
      chartAxis.buildTimeAxisTicks=(start,end,width,hours)=>{recordPolicy('ticks',hours,(end-start)/3600000);return [];};
      state.selectedHours=1;chartPainter.draw${view}Chart(canvas,'I25',route,frame)`);
    assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(['smoothing', rangeHours])));
    assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(['ticks', rangeHours, rangeHours * 2])));
    assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(view === 'Zone'
      ? ['groups', rangeHours * 2] : ['detail', rangeHours <= 24 ? 2 : 0, rangeHours * 2])));
  }
});

test('current-day anchors are captured independently of freshness and both painters keep the captured view policy', () => {
  for(const historical of [false,true]) for(const view of ['Corridor','Zone']) {
    const {d}=chartPaintFixture(), anchors=[];
    d.context.captureAnchor=anchor=>anchors.push(anchor);
    d.run(`state.selectedHours=720;chartHistory.endTime=${historical ? 'Date.now()-86400000' : 'null'};
      route.summary.latest.polledAt=new Date(Date.now()-86400000).toISOString();
      frame={...chartPaintFrame('I25',route),groups:[group],samples:points,trendSamples:points,baseline:points};
      chartAxis.buildTimeAxisTicks=(start,end,width,hours,anchor)=>{captureAnchor(anchor);return [];};`);
    assert.equal(d.run('frame.currentDayAnchor'),historical ? null : d.run('Date.now()'));
    d.run(`chartHistory.endTime=${historical ? 'null' : 'Date.now()-86400000'};chartPainter.draw${view}Chart(canvas,'I25',route,frame)`);
    assert.deepEqual(anchors,[historical ? null : d.run('Date.now()')]);
  }
  for(const search of ['?historical=1','?replay=1']) {
    const {d}=chartPaintFixture(search);
    assert.equal(d.run("chartPaintFrame('I25',route,{hours:1440,strip:true}).currentDayAnchor"),null);
  }
});

test('pending zone height and loading text belong to the captured history window', () => {
  const {d, commands} = chartPaintFixture();
  d.run(`state.focusedCorridor='I25';state.chartView='zones';chartHistory.endTime=Date.now()-3600000;
    pendingFrame=Object.freeze(chartPaintFrame('I25',null));
    chartHistory.dataKey=historyWindowKey();chartHistory.error='a later window failed';
    chartPainter.drawZoneChart(canvas,'I25',null,pendingFrame)`);
  assert.ok(!commands.some(command => command[0] === 'setProperty'));
  assert.ok(commands.some(command => command[0] === 'fillText' && /Loading observations/.test(command[1])));
  commands.length = 0;
  d.run(`chartPainter.drawZoneChart(canvas,'I25',null,chartPaintFrame('I25',null))`);
  assert.ok(commands.some(command => command[0] === 'setProperty' && command[2] === '280px'));
});

test('zone speed labels retain Current, historical, replay, demo and long-range semantics', () => {
  for (const [search, hours, historical, label] of [
    ['',24,false,'Live:'],['',168,false,'Observed:'],['',24,true,'Observed:'],
    ['?historical=1',24,false,'Observed:'],['?replay=1',24,false,'Observed:'],['?demo=1',24,false,'Live:']
  ]) {
    const {d, commands} = chartPaintFixture(search);
    d.context.hours = hours;
    d.run(`state.selectedHours=hours;state.chartView='zones';state.focusedCorridor='I25';
      chartHistory.endTime=${historical ? 'Date.now()-3600000' : 'null'};
      frame={...chartPaintFrame('I25',route),groups:[group]};
      state.selectedHours=1;chartHistory.endTime=null;chartPainter.drawZoneChart(canvas,'I25',route,frame)`);
    assert.ok(commands.some(command => command[0] === 'fillText' && command[1] === label), search + hours + historical);
  }
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
  assert.equal(d.run("chartSeries.buildBaselineSeries(buckets, start, end).length"), 3);
  assert.equal(d.run("chartSeries.buildBaselineSeries(buckets, start, end)[0].timestamp"), d.context.start);
  assert.equal(d.run("chartSeries.buildBaselineSeries(buckets, start, end).at(-1).timestamp"), d.context.end);
  assert.equal(d.run("chartSeries.buildBaselineSeries(buckets, start, end)[0].standardDeviation"), 0);
  assert.deepEqual({ ...d.run("chartSeries.calculateSpeedDomain([62, 73])") }, { min: 60, max: 75, step: 5 });
  assert.deepEqual({ ...d.run("chartSeries.calculateSpeedDomain([64, 67])") }, { min: 62, max: 70, step: 2 });
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
  const series = d.run("chartSeries.buildBaselineSeries([], start, end, profiles)");
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
  d.context.point = d.run("chartSeries.buildBaselineSeries(buckets, start, start)[0]");
  assert.equal(d.context.point.speed, 65);
  assert.equal(d.context.point.standardDeviation, 5);
  assert.deepEqual({ ...d.run("chartPainter.referenceBandLimits(point, state.referenceSigma)") }, { lower: 55, upper: 75 });
  d.run('state.referenceSigma = 1');
  assert.deepEqual({ ...d.run("chartPainter.referenceBandLimits(point, state.referenceSigma)") }, { lower: 60, upper: 70 });
  d.run('state.referenceSigma = 3');
  assert.deepEqual({ ...d.run("chartPainter.referenceBandLimits(point, state.referenceSigma)") }, { lower: 50, upper: 80 });
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
  assert.deepEqual({ ...d.run("chartSeries.calculateCorridorSpeedDomain(samples, baseline)") }, { min: 45, max: 75, step: 5 });
  assert.deepEqual({ ...d.run("chartPainter.referenceBandLimits(baseline[0], state.referenceSigma)") }, { lower: 50, upper: 90 });
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
  const series = d.run("chartSeries.buildCurrentSpeedSeries(hourly, detailed, 24, end)");
  assert.equal(series[0].timestamp, d.context.start);
  assert.equal(series.at(-1).timestamp, d.context.end);
  assert.ok(series.some(point => point.timestamp < Date.parse(d.context.detailed[0].polledAt)));
  d.context.series = series;
  assert.equal(d.run("chartPainter.chartSegments(series.map(point => ({...point, verticalPosition:point.speed}))).length"), 1);
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
  assert.deepEqual(Array.from(d.run("chartSeries.normalizeSpeedSamples(samples)"), point => point.isCarryForward), [false, true, false]);
  d.context.hourly = [
    { bucketStart: '2026-06-18T20:00:00Z', avgCurrentSpeed: 60 },
    { bucketStart: '2026-06-18T21:00:00Z', avgCurrentSpeed: 60 }
  ];
  assert.deepEqual(Array.from(d.run("chartSeries.normalizeSpeedSamples(hourly)"), point => point.isCarryForward), [false, false]);
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
  assert.deepEqual(d.run("chartSeries.normalizeSpeedSamples(compact)"), d.run("chartSeries.normalizeSpeedSamples(full)"));
  assert.deepEqual(Array.from(d.run("chartSeries.normalizeSpeedSamples(compact)"), point => point.isCarryForward),
    [false, true, false, true, false]);
  d.context.end = Date.parse('2026-06-18T20:06:00Z');
  for (const hours of [2, 6, 24, 168, 720]) {
    assert.deepEqual(d.run(`chartSeries.buildCurrentSpeedSeries([], compact, ${hours}, end)`),
      d.run(`chartSeries.buildCurrentSpeedSeries([], full, ${hours}, end)`));
  }
});

test('trend smoothing emphasizes progressively broader patterns for longer chart ranges', () => {
  const d = dashboard();
  const center = Date.parse('2026-06-18T20:00:00Z');
  d.context.samples = Array.from({ length: 181 }, (_, index) => ({
    timestamp: center + index * 2 * 60_000,
    speed: index >= 80 && index <= 100 ? 72 : 60
  }));
  const shortRangePeak = Math.max(...d.run("chartSeries.buildSmoothedSpeedSeries(samples, 2)").map(point => point.speed));
  const mediumRangePeak = Math.max(...d.run("chartSeries.buildSmoothedSpeedSeries(samples, 6)").map(point => point.speed));
  const dayRangePeak = Math.max(...d.run("chartSeries.buildSmoothedSpeedSeries(samples, 24)").map(point => point.speed));
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
  const smoothed = d.run("chartSeries.buildSmoothedSpeedSeries(samples, 6)");
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
  const smoothed = d.run("chartSeries.buildSmoothedSpeedSeries(samples, 24)");
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
  assert.equal(d.run("chartSeries.buildSmoothedSpeedSeries(samples, 2)").length, 0);
});

test('long-range trend stays continuous within observations but stops at data gaps', () => {
  const d = dashboard();
  const start = Date.parse('2026-06-18T20:00:00Z');
  d.context.samples = Array.from({ length: 24 }, (_, index) => ({
    timestamp: start + index * 60 * 60_000,
    speed: 65 + Math.sin(index / 4) * 5
  }));
  const contiguous = d.run("chartSeries.buildSmoothedSpeedSeries(samples, 720)");
  assert.equal(d.run("chartPainter.chartSegments(chartSeries.buildSmoothedSpeedSeries(samples, 720).map(point => ({...point, verticalPosition: point.speed}))).length"), 1);
  assert.ok(contiguous.length >= d.context.samples.length);
  d.context.samples.splice(10, 3);
  assert.equal(d.run("chartPainter.chartSegments(chartSeries.buildSmoothedSpeedSeries(samples, 720).map(point => ({...point, verticalPosition: point.speed}))).length"), 2);
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
  const week = d.run("chartSeries.buildSmoothedSpeedSeries(samples.slice(-168), 168)");
  const month = d.run("chartSeries.buildSmoothedSpeedSeries(samples, 720)");
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
  const smoothed = d.run("chartSeries.buildSmoothedSpeedSeries(samples, 24)");
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
  const smoothed = d.run("chartSeries.buildSmoothedSpeedSeries(samples, 2)");
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
  assert.equal(d.run("chartPainter.pointMarkerRadius(120)"), 3.2);
  assert.equal(d.run("chartPainter.pointMarkerRadius(200)"), 2.5);
  assert.equal(d.run("chartPainter.pointMarkerRadius(500)"), 2.1);
});

test('synthetic window-edge points stay available to lines but are not observation markers', () => {
  const d = dashboard();
  d.context.samples = [
    { timestamp: 1_000, speed: 50 },
    { timestamp: 61_000, speed: 70 }
  ];
  const boundary = d.run("chartSeries.speedBoundaryPoint(samples, 31_000)");
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
  assert.equal(d.run("chartSeries.selectDisplayBuckets(buckets, 168, end).length"), 169);
  assert.equal(d.run("chartSeries.buildBaselineSeries(buckets, start, end).length"), 169);
  assert.equal(d.run("chartPainter.chartSegments(chartSeries.buildCurrentSpeedSeries(buckets, [], 168, end).map(point => ({...point, verticalPosition:point.speed}))).length"), 1);
});

test('short-range rulers keep quarter-hour marks and space labels to the canvas width', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-09-10T18:07:00Z');
  d.context.end = d.context.start + 2 * 3_600_000;
  const desktop = d.run("chartAxis.buildTimeAxisTicks(start, end, 720)");
  const mobile = d.run("chartAxis.buildTimeAxisTicks(start, end, 220)");
  assert.equal(desktop.length, 8);
  assert.equal(desktop.filter(tick => tick.label).length, 4);
  assert.equal(mobile.length, 8);
  assert.equal(mobile.filter(tick => tick.label).length, 2);
  assert.equal(desktop.find(tick => tick.timestamp === Date.parse('2026-09-10T19:15:00Z')).level, 'minor');
  assert.match(desktop.find(tick => tick.timestamp === Date.parse('2026-09-10T19:30:00Z')).label, /:30/);

  d.context.end = d.context.start + 6 * 3_600_000;
  const sixHours = d.run("chartAxis.buildTimeAxisTicks(start, end, 720)");
  assert.equal(sixHours.find(tick => tick.timestamp === Date.parse('2026-09-10T19:30:00Z')).level, 'medium');
  assert.equal(sixHours.find(tick => tick.timestamp === Date.parse('2026-09-10T19:00:00Z')).level, 'major');
  assert.ok(sixHours.every((tick, index) => index === 0 || tick.horizontalPosition - sixHours[index - 1].horizontalPosition >= 8));
  const narrow = d.run("chartAxis.buildTimeAxisTicks(start, end, 180)");
  assert.ok(narrow.every((tick, index) => index === 0 || tick.horizontalPosition - narrow[index - 1].horizontalPosition >= 8));
});

test('day and month rulers preserve visible ticks while thinning narrow layouts', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-09-10T18:07:00Z');
  d.context.end = d.context.start + 24 * 3_600_000;
  const dayDesktop = d.run("chartAxis.buildTimeAxisTicks(start, end, 720)");
  const dayMobile = d.run("chartAxis.buildTimeAxisTicks(start, end, 220)");
  assert.equal(dayDesktop.find(tick => tick.timestamp === Date.parse('2026-09-10T19:00:00Z')).level, 'medium');
  assert.equal(dayDesktop.find(tick => tick.timestamp === Date.parse('2026-09-10T19:30:00Z')).level, 'minor');
  assert.equal(dayMobile.some(tick => tick.timestamp === Date.parse('2026-09-10T19:30:00Z')), false);
  assert.equal(dayMobile.find(tick => tick.timestamp === Date.parse('2026-09-10T19:00:00Z')).level, 'medium');

  d.context.start = Date.parse('2026-10-31T00:00:00Z');
  d.context.end = d.context.start + 168 * 3_600_000;
  const week = d.run("chartAxis.buildTimeAxisTicks(start, end, 220)");
  const transitions = week.filter(tick => tick.guide);
  assert.equal(transitions.length, 7);
  assert.ok(transitions.some(tick => tick.timestamp === Date.parse('2026-11-01T06:00:00Z')));
  assert.ok(transitions.some(tick => tick.timestamp === Date.parse('2026-11-02T07:00:00Z')));
  assert.ok(transitions.filter(tick => tick.label && !tick.calendarBoundary).length <= 2);
  assert.equal(transitions.find(tick=>tick.calendarBoundary).label,'Nov 1 Sun');

  d.context.start = Date.parse('2026-09-01T12:00:00Z');
  d.context.end = d.context.start + 720 * 3_600_000;
  const monthDesktop = d.run("chartAxis.buildTimeAxisTicks(start, end, 900)");
  const monthMobile = d.run("chartAxis.buildTimeAxisTicks(start, end, 220)");
  assert.equal(monthDesktop.length, 30);
  assert.ok(monthMobile.length < monthDesktop.length);
  assert.ok(monthMobile.every((tick, index) => index === 0 || tick.horizontalPosition - monthMobile[index - 1].horizontalPosition >= 8));
  assert.deepEqual(Array.from(monthMobile.filter(tick => tick.label),tick=>tick.timestamp),
    Array.from(monthDesktop.filter(tick => tick.label),tick=>tick.timestamp),'calendar anchors do not move with width');
});

test('midnight labels name both dates including month, year and leap-day boundaries', () => {
  const d=dashboard();
  for(const hours of [2,6,24]) for(const [instant,label] of [
    ['2026-11-05T07:00:00Z','Nov 4 → Nov 5'],
    ['2026-11-01T06:00:00Z','Oct 31 → Nov 1'],
    ['2027-01-01T07:00:00Z','Dec 31 → Jan 1'],
    ['2028-03-01T07:00:00Z','Feb 29 → Mar 1']
  ]) assert.equal(d.run(`chartAxis.formatChartTime(Date.parse('${instant}'),${hours})`),label);
  assert.equal(d.run("chartAxis.formatChartTime(Date.parse('2026-11-05T07:30:00Z'),2)"),'12:30 AM');
});

test('calendar boundary labels keep their space near adjacent hours, plot edges and Live', () => {
  const {d}=chartPaintFixture(), labels=[];
  d.context.captureBoundary=(text,x,y)=>labels.push({text,x,y});
  d.run('ctx.measureText=text=>({width:text.length*6});ctx.fillText=(text,x,y)=>captureBoundary(text,x,y)');
  for(const width of [180,600]) for(const [hours,end] of [
    [24,'2026-11-01T18:00:00Z'],[24,'2026-11-01T06:01:00Z'],[168,'2026-11-05T18:00:00Z']
  ]) {
    labels.length=0;
    d.run(`end=Date.parse('${end}');ticks=chartAxis.buildTimeAxisTicks(end-${hours}*3600000,end,${width},${hours});
      chartPainter.drawXAxis(ctx,ticks,{width:${width+55},height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'},true)`);
    assert.ok(labels.some(label=>label.text===(hours===168?'Nov 1 Sun':'Oct 31 → Nov 1')));
    for(let index=0;index<labels.length;index++) {
      const label=labels[index];
      assert.ok(label.x>=50 && label.x+label.text.length*6<=width+50-40);
      if(index) assert.ok(label.x>=labels[index-1].x+labels[index-1].text.length*6+8);
    }
  }
});

test('an hour label hidden beside midnight keeps an ordinary hour tick rather than double emphasis', () => {
  const {d}=chartPaintFixture(), strokes=[],labels=[];
  d.context.captureTick=(from,to,alpha,width)=>strokes.push({from:Array.from(from),to:Array.from(to),alpha,width});
  d.context.captureTickLabel=text=>labels.push(text);
  d.run(`ctx.moveTo=(x,y)=>ctx.from=[x,y];ctx.lineTo=(x,y)=>ctx.to=[x,y];
    ctx.stroke=()=>captureTick(ctx.from,ctx.to,ctx.globalAlpha,ctx.lineWidth);
    ctx.fillText=text=>captureTickLabel(text);
    ticks=[{timestamp:1,horizontalPosition:100,level:'major',label:'Nov 4 → Nov 5',calendarBoundary:true},
      {timestamp:2,horizontalPosition:125,level:'major',label:'1 AM'},
      {timestamp:3,horizontalPosition:150,level:'medium',label:''}];
    ticks.forEach(Object.freeze);Object.freeze(ticks);
    chartPainter.drawXAxis(ctx,ticks,{width:400,height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'});`);
  assert.deepEqual(labels,['Nov 4 → Nov 5']);
  assert.deepEqual(strokes[0],{from:[150,160],to:[150,169],alpha:0.95,width:1.5});
  assert.deepEqual(strokes[1],{from:[175,160],to:[175,167],alpha:0.75,width:1});
  assert.deepEqual(strokes[2],{from:[200,160],to:[200,167],alpha:0.75,width:1});
  assert.equal(d.run("ticks[1].level"),'major','painting does not mutate the axis model');
  labels.length=0;strokes.length=0;
  d.run("chartPainter.drawXAxis(ctx,[ticks[0],{...ticks[1],horizontalPosition:240}],{width:400,height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'})");
  assert.deepEqual(labels,['Nov 4 → Nov 5','1 AM']);
  assert.equal(strokes[1].to[1]-strokes[1].from[1],9,'visible hour labels keep their major marks');
});

test('30-day date labels pair the local weekday while shorter views stay unchanged', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-10-04T12:00:00Z');
  d.context.end = d.context.start + 720 * 3_600_000;
  const month = d.run('chartAxis.buildTimeAxisTicks(start,end,1200,720)');
  assert.equal(month.find(tick => tick.label === 'Oct 8th').weekday, 'Thu');
  assert.ok(month.filter(tick => tick.label).every(tick => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(tick.weekday)));
  for (const hours of [2,6,24,168]) {
    d.context.end = d.context.start + hours * 3_600_000;
    assert.ok(d.run(`chartAxis.buildTimeAxisTicks(start,end,1200,${hours})`).every(tick => !tick.weekday));
  }
  assert.equal(d.network.length,0);
});

test('calendar labels fit more on wider plots without collisions or crowding Live', () => {
  const {d} = chartPaintFixture(), labels = [], counts = [];
  d.context.captureLabel = (text,x,y,color) => labels.push({text,x,y,color});
  d.run(`ctx.measureText=text=>({width:text.length*6});ctx.fillText=(text,x,y)=>captureLabel(text,x,y,ctx.fillStyle);
    start=Date.parse('2026-10-04T12:00:00Z');end=start+720*3600000;`);
  for (const plotWidth of [220,600,1200]) {
    labels.length=0;
    d.run(`chartPainter.drawXAxis(ctx,chartAxis.buildTimeAxisTicks(start,end,${plotWidth},720),
      {width:${plotWidth+55},height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'},true)`);
    const fullLabels=labels.filter(label=>label.y===171);
    assert.ok(fullLabels.length>=2);
    counts.push(fullLabels.length);
    for (let index=0;index<fullLabels.length;index++) {
      const date=fullLabels[index];
      assert.equal(date.color,'black');
      assert.match(date.text,/^[A-Z][a-z]+ \d+(st|nd|rd|th)$/);
      assert.ok(date.x>=50);assert.ok(date.x+date.text.length*6<=plotWidth+50-40);
      if(index) assert.ok(date.x>=fullLabels[index-1].x+fullLabels[index-1].text.length*6+8);
    }
  }
  assert.ok(counts[0] < counts[1] && counts[1] <= counts[2]);
  assert.ok(counts[1]>=4 && counts[2]>=5,'wider plots show the fixed calendar anchors');
});

test('30-day weekday initials sit between complete local days and disappear on compact plots', () => {
  const d=dashboard();
  d.run("start=Date.parse('2026-10-05T18:00:00Z');end=start+720*3600000");
  const ticks=d.run('chartAxis.buildTimeAxisTicks(start,end,900,720)');
  const daily=ticks.filter(tick=>tick.dayLabel);
  assert.equal(daily.length,29,'omit partial edge days rather than shifting their letters');
  assert.deepEqual(Array.from(daily.slice(0,7),tick=>tick.dayLabel.text),['Tu','W','Th','F','Sa','Su','M']);
  for(const tick of daily) {
    const next=ticks.find(next=>next.timestamp>tick.timestamp);
    assert.ok(Math.abs(tick.dayLabel.horizontalPosition-(tick.horizontalPosition+next.horizontalPosition)/2)<1e-6);
  }
  assert.ok(d.run('chartAxis.buildTimeAxisTicks(start,end,500,720)').every(tick=>!tick.dayLabel));
  for(const hours of [2,6,24,168]) {
    assert.ok(d.run(`chartAxis.buildTimeAxisTicks(start,start+${hours}*3600000,900,${hours})`).every(tick=>!tick.dayLabel));
  }
  assert.equal(d.network.length,0);
});

test('daily weekday letters sit between ticks above the date row and leave month-start tags clear', () => {
  const {d}=chartPaintFixture(), labels=[];
  d.context.captureDayLabel=(text,x,y,color,alpha,font,align)=>labels.push({text,x,y,color,alpha,font,align});
  d.run(`ctx.fillText=(text,x,y)=>captureDayLabel(text,x,y,ctx.fillStyle,ctx.globalAlpha,ctx.font,ctx.textAlign);
    ticks=[{horizontalPosition:0,level:'major',label:'Oct 5th',weekday:'Mon',dayLabel:{text:'M',horizontalPosition:15}}];
    chartPainter.drawXAxis(ctx,ticks,{width:400,height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'},true)`);
  assert.deepEqual(labels[1],{text:'M',x:65,y:161,color:'black',alpha:1,font:'9px IBM Plex Mono, monospace',align:'center'});
  assert.deepEqual(labels.filter(label=>label.y===171).map(label=>[label.text,label.color]),[['Oct 5th','black']]);
  labels.length=0;
  d.run("ticks[0].label='';chartPainter.drawXAxis(ctx,ticks,{width:400,height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'},true)");
  assert.equal(labels[0].color,'gray');assert.equal(labels[0].alpha,0.7);
  labels.length=0;
  d.run("ticks[0].label='Oct 5th';ticks[0].horizontalPosition=340;ticks[0].dayLabel.horizontalPosition=325;chartPainter.drawXAxis(ctx,ticks,{width:400,height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'},true)");
  assert.deepEqual(labels.map(label=>[label.text,label.color]),[['M','gray']],'a date hidden near Live must not highlight its weekday');
  labels.length=0;
  d.run("ticks[0].monthStart=true;ticks[0].label='';chartPainter.drawXAxis(ctx,ticks,{width:400,height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'},true)");
  assert.deepEqual(labels.map(label=>label.text),['1st'],'the compact first replaces that day letter rather than overlapping it');
});

test('30-day markers stay anchored to calendar weeks across scrolling and month boundaries', () => {
  const d=dashboard();
  d.context.start=Date.parse('2026-10-01T06:00:00Z');d.context.end=Date.parse('2026-10-31T06:00:00Z');
  const original=d.run('chartAxis.buildTimeAxisTicks(start,end,1200,720)').filter(tick=>tick.label);
  assert.deepEqual(Array.from(original,tick=>tick.label),['Oct 1st','Oct 8th','Oct 15th','Oct 22nd','Oct 29th']);
  const shifted=d.run('chartAxis.buildTimeAxisTicks(start+86400000,end+86400000,1200,720)').filter(tick=>tick.label);
  for(const tick of shifted.filter(tick=>tick.timestamp<Date.parse('2026-10-31T06:00:00Z'))) {
    assert.equal(tick.label,original.find(previous=>previous.timestamp===tick.timestamp)?.label);
  }
  const leap=d.run("chartAxis.buildTimeAxisTicks(Date.parse('2028-02-01T07:00:00Z'),Date.parse('2028-03-02T07:00:00Z'),1200,720)").filter(tick=>tick.label);
  assert.deepEqual(Array.from(leap,tick=>tick.label),['Feb 1st','Feb 8th','Feb 15th','Feb 22nd','Feb 29th','Mar 1st']);
  assert.deepEqual(Array.from(leap.filter(tick=>tick.monthStart),tick=>tick.label),['Feb 1st','Mar 1st']);
  for(const [day,suffix] of [[1,'st'],[8,'th'],[11,'th'],[12,'th'],[13,'th'],[21,'st'],[22,'nd'],[23,'rd'],[29,'th'],[31,'st']]) {
    assert.equal(d.run(`chartAxis.formatChartTime(Date.UTC(2026,9,${day},12),720)`),`Oct ${day}${suffix}`);
  }
});

test('current 30-day labels count back by local weeks from today while preserving every month start', () => {
  const d=dashboard();
  const ticks=d.run("chartAxis.buildTimeAxisTicks(Date.parse('2026-10-05T20:00:00Z'),Date.parse('2026-11-04T20:00:00Z'),1200,720,Date.parse('2026-11-04T20:00:00Z'))");
  assert.deepEqual(Array.from(ticks.filter(tick=>tick.label),tick=>tick.label),['Oct 7th','Oct 14th','Oct 21st','Oct 28th','Nov 4th']);
  assert.ok(ticks.filter(tick=>tick.label).every(tick=>tick.weekday==='Wed'));
  assert.equal(ticks.find(tick=>tick.monthStart).label,'','off-week month starts keep their marker without displacing weekly text');
  const historical=d.run("chartAxis.buildTimeAxisTicks(Date.parse('2026-10-05T20:00:00Z'),Date.parse('2026-11-04T20:00:00Z'),1200,720)").filter(tick=>tick.label);
  assert.deepEqual(Array.from(historical,tick=>tick.label),['Oct 8th','Oct 15th','Oct 22nd','Oct 29th','Nov 1st']);
});

test('month starts take priority over a crowded 29th without reserving space for an invisible label', () => {
  const {d}=chartPaintFixture(), labels=[];
  d.context.captureLabel=text=>labels.push(text);
  d.run(`ctx.measureText=text=>({width:text.length*6});ctx.fillText=text=>captureLabel(text);
    ticks=[{timestamp:1,horizontalPosition:150,level:'major',label:'Oct 29th',weekday:'Thu'},
      {timestamp:2,horizontalPosition:200,level:'major',label:'Nov 1st',weekday:'Sun',monthStart:true}];`);
  d.run("chartPainter.drawXAxis(ctx,ticks,{width:400,height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'},true)");
  assert.deepEqual(labels,['Nov 1st']);
  labels.length=0;
  d.run("chartPainter.drawXAxis(ctx,ticks,{width:300,height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'},true)");
  assert.deepEqual(labels,['Oct 29th','1st'],'keep the 29th and a compact first when its full label would collide with Live');
});

test('a month start retains an in-bounds compact label in the tick row when full text cannot fit', () => {
  const {d}=chartPaintFixture(), labels=[];
  d.context.captureLabel=(text,x,y)=>labels.push({text,x,y});
  d.run(`ctx.measureText=text=>({width:text.length*6});ctx.fillText=(text,x,y)=>captureLabel(text,x,y);
    ticks=[{timestamp:1,horizontalPosition:140,level:'major',label:'Nov 1st',weekday:'Sun',monthStart:true}];
    chartPainter.drawXAxis(ctx,ticks,{width:200,height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'},true);`);
  assert.equal(labels.length,1);assert.equal(labels[0].text,'1st');assert.equal(labels[0].y,161);
  assert.ok(labels[0].x>=50 && labels[0].x+18<=195);
  labels.length=0;
  d.run("ticks[0].label='';ticks[0].weekday='';chartPainter.drawXAxis(ctx,ticks,{width:200,height:190},{left:50,right:5,bottom:30},{ink:'black',muted:'gray'},true)");
  assert.deepEqual(labels.map(label=>label.text),['1st'],'off-week month starts retain a compact tag even without a full label');
});

test('Live edge stays dashed in theme green with its label rendered separately', () => {
  const f = liveEdgeFixture();
  f.draw();
  assert.deepEqual(f.labels, []);
  assert.deepEqual(f.moves, [[295,34]]);
  assert.deepEqual(f.lines, [[295,160]]);
  assert.deepEqual(f.dashes, [[3,4]]);
  assert.equal(f.d.context.ctx.strokeStyle, '#82c99c');
});

test('time-axis labels leave room for Live and its dot without removing ticks', () => {
  const f = liveEdgeFixture();
  f.d.context.ticks=[{horizontalPosition:100,level:'major',label:'Noon'},
    {horizontalPosition:210,level:'major',label:'12:30'},
    {horizontalPosition:232,level:'major',label:'1 PM'}];
  f.d.run("chartPainter.drawXAxis(ctx,ticks,dimensions,padding,colors,true)");
  assert.deepEqual(f.labels,['Noon']);
  assert.equal(f.moves.length,3);
  f.labels.length=0;
  f.d.run("chartPainter.drawXAxis(ctx,ticks,dimensions,padding,colors)");
  assert.deepEqual(f.labels,['Noon','12:30','1 PM']);
});

test('wide charts right-align Live like compact charts without reserving extra plot width', () => {
  const f=liveEdgeFixture();
  f.d.context.ticks=[{horizontalPosition:480,level:'major',label:'12:30'},
    {horizontalPosition:532,level:'major',label:'1 PM'}];
  f.d.run("dimensions.width=600;chartPainter.drawXAxis(ctx,ticks,dimensions,padding,colors,true)");
  assert.deepEqual(f.labels,['12:30']);
  assert.equal(f.d.run('padding.right'),5);
  const css=readFileSync(path.join(testDirectory,'../../api-service/src/main/resources/static/dashboard/dashboard.css'),'utf8');
  assert.match(css,/\.chart-canvas-wrap\s*\{[^}]*container: chart-plot \/ inline-size;/);
  assert.match(css,/\.chart-live-label\s*\{[^}]*transform: none;/);
});

test('the red dot follows current per-corridor freshness and fades in CSS without graph redraws', () => {
  const f = liveEdgeFixture();
  f.d.run(`state.routeData=new Map([['I25',route],['I70',{...route,summary:{latest:{polledAt:new Date(Date.now()-3600001).toISOString(),avgCurrentSpeed:60}}}]]);
    chartPainter.drawCorridorChart=()=>{};drawAllCharts()`);
  assert.equal(f.d.nodes.get('i25LiveDot').hidden,false);
  assert.equal(f.d.nodes.get('i70LiveDot').hidden,true);
  f.d.run('chartHistory.endTime=Date.now()-3600000;drawAllCharts()');
  assert.equal(f.d.nodes.get('i25LiveDot').hidden,true);
  f.d.run('chartHistory.endTime=null;drawAllCharts()');
  assert.equal(f.d.nodes.get('i25LiveDot').hidden,false);
  const css=readFileSync(path.join(testDirectory,'../../api-service/src/main/resources/static/dashboard/dashboard.css'),'utf8');
  assert.match(css,/\.chart-live-dot\s*\{[^}]*animation: chart-live-fade 10s ease-in-out infinite/);
  assert.match(css,/@keyframes chart-live-fade\s*\{\s*0%, 100% \{ opacity: 0\.15; \}\s*50% \{ opacity: 1; \}/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.chart-live-dot \{ animation: none;/);
  for (const corridor of ['i25','i70']) assert.match(indexSource,new RegExp(`id="${corridor}LiveDot" class="chart-live-label" aria-hidden="true" hidden><span class="chart-live-dot"></span>Live</span>`));
  assert.match(css,/\.chart-live-label\s*\{[^}]*right: 15px;[^}]*transform: none;/);
  assert.match(css,/\.chart-live-label\[hidden\] \{ display: none; \}/);
});

test('Live edge disappears in history and returns at Current regardless of wheel preference', () => {
  const f = liveEdgeFixture();
  f.d.run('chartHistory.endTime=Date.now()-3600000'); f.draw();
  assert.deepEqual(f.moves, []);
  for (const enabled of [false,true]) {
    f.d.run(`chartHistory.endTime=null;chartHistory.enabled=${enabled}`); f.draw();
  }
  assert.equal(f.moves.length,2);
});

test('Live edge never labels stale, missing, unusable or simulated data as live', () => {
  for (const setup of [
    'route=null', 'route.chartUnavailable=true', 'route.summary.latest.polledAt="invalid"',
    'route.summary.latest.polledAt=new Date(Date.now()-3600001).toISOString()',
    'route.summary.latest.avgCurrentSpeed=null'
  ]) {
    const f = liveEdgeFixture(); f.d.run(setup); f.draw();
    assert.deepEqual(f.moves, [], setup);
  }
  for (const search of ['?historical=1','?replay=1','?demo=1']) {
    const f = liveEdgeFixture(search); f.draw(); assert.deepEqual(f.moves, [], search);
  }
  const stopped = liveEdgeFixture(); stopped.d.run('route.summary.latest.avgCurrentSpeed=0'); stopped.draw();
  assert.equal(stopped.moves.length,1);
});

test('both chart modes align Live with the plot edge at each width and omit it from history strips', () => {
  const f = liveEdgeFixture();
  f.d.run(`canvas={getContext:()=>ctx,getBoundingClientRect:()=>dimensions,
    closest:()=>({style:{removeProperty(){},setProperty(){}}})};
    chartColors=()=>({forest:'#82c99c'});
    chartSeries.groupZoneSeries=()=>[{key:'zone',samples:[{timestamp:Date.now(),speed:60}],baselineProfiles:[],postedSpeedMph:65}];`);
  for (const width of [300,600,1200]) for (const corridor of ['I25','I70']) for (const mode of ['Corridor','Zone']) {
    f.d.run(`dimensions.width=${width}`);
    f.dashes.length=0;
    f.d.run(`chartPainter.draw${mode}Chart(canvas,'${corridor}',route,chartPaintFrame('${corridor}',route))`);
    assert.equal(f.dashes.filter(dash => JSON.stringify(dash) === '[3,4]').length, 1, corridor + mode);
    assert.equal(f.moves.at(-1)[0],width-5,corridor + mode + ' live line matches the grid endpoint');
    assert.equal(f.lines.at(-1)[0],width-5);
    f.dashes.length=0;
    f.d.run(`chartPainter.draw${mode}Chart(canvas,'${corridor}',route,chartPaintFrame('${corridor}',route,{end:Date.now(),hours:24,strip:true}))`);
    assert.equal(f.dashes.some(dash => JSON.stringify(dash) === '[3,4]'), false, corridor + mode + ' historical strip');
  }
});

test('30-day labeled-day guides gain contrast and weight without highlighting unlabeled ticks', () => {
  const {d} = chartPaintFixture(), guides=[];
  d.context.captureGuide=(alpha,width,color)=>guides.push({alpha,width,color});
  d.run(`ctx.stroke=()=>captureGuide(ctx.globalAlpha,ctx.lineWidth,ctx.strokeStyle);
    ticks=[{horizontalPosition:20,guide:true,label:'Oct 5',weekday:'Monday'},
      {horizontalPosition:40,guide:false,label:''}];`);
  for(const hours of [24,168,720]) d.run(`chartPainter.drawTimeGuides(ctx,ticks,50,30,160,{muted:'gray'},${hours})`);
  assert.equal(guides.length,3,'only the labeled-day guide is drawn in each range');
  assert.ok(guides[2].alpha>guides[0].alpha);
  assert.ok(guides[2].width>guides[0].width);
  assert.equal(guides[2].color,'gray');
  assert.equal(guides[1].alpha,0.42);assert.equal(guides[1].width,1,'seven-day styling stays unchanged');
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
  d.run("chartPainter.drawTimeGuides(ctx, ticks, 50, 30, 160, {muted:'#555'}, state.selectedHours)");
  d.run("chartPainter.drawXAxis(ctx, ticks, {width:250,height:190}, {left:50,right:20,bottom:30}, {muted:'#555',ink:'#111'})");
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
  assert.equal(d.run("chartPainter.buildIncidentChartGroups(incidents, start, end, 50, 400)[0].count"), 2);
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
  const groups = d.run("chartPainter.buildIncidentDayGroups(incidents, start, end, 5)");
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
  assert.equal(d.run("chartPainter.buildIncidentDayGroups(incidents,start,start+1000,5)[0].count"),1);
});
