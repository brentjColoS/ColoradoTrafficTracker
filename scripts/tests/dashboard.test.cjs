const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard.js'), 'utf8');
const estimatesSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/traffic-estimates.js'), 'utf8');
const historySource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard-history.js'), 'utf8');
const mapSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/corridor-map.js'), 'utf8');
const indexSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/index.html'), 'utf8');
const informationSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/information-pages.js'), 'utf8');
const informationStyles = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/information.css'), 'utf8');
const dataHeroMapSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/data-hero-map.js'), 'utf8');
const roadSignDisplaySource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/road-sign-display.js'), 'utf8');
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

test('historical scrolling defaults off and preserves page scrolling and browser zoom', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run('chartHistory.enabled = false; initializeHistoryControls()');
  let prevented = 0;
  const canvas = d.nodes.get('i25Chart');
  canvas.clientWidth = 1000;
  const event = { deltaY:100, deltaX:0, preventDefault() { prevented++; } };
  canvas.events.wheel(event);
  assert.equal(d.run('chartHistory.endTime'), null);
  assert.equal(prevented, 0);
  d.run('chartHistory.enabled = true');
  canvas.events.wheel({...event, ctrlKey:true});
  canvas.events.wheel({...event, metaKey:true});
  assert.equal(prevented, 0);
  canvas.events.wheel(event);
  assert.equal(prevented, 1);
  assert.equal(d.run('chartHistory.endTime'), Date.parse('2026-06-19T02:00:00Z') - 24 * 3600000 * 0.1);
  assert.match(indexSource, /id="historyScrollToggle"[^>]*aria-pressed="false"/);
  assert.match(indexSource, /id="i25Chart"[^>]*tabindex="0"/);
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

test('every chart range pans by the same fraction and clamps at both history boundaries', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  for (const hours of [2,6,24,168,720]) {
    d.context.hours = hours;
    d.run('state.selectedHours = hours; chartHistory.endTime = null; panHistoryWindow(hours * 3600000 / 4)');
    const expected = Date.parse('2026-06-19T02:00:00Z') - hours * 3600000 / 4;
    assert.equal(d.run('chartHistory.endTime'), expected);
    d.run('panHistoryWindow(1e15)');
    assert.equal(d.run('chartHistory.endTime'), d.run('historyLimits().firstEnd'));
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

test('turning scrolling off locks the window while Current still returns to latest', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run('initializeHistoryControls(); panHistoryWindow(3600000)');
  const end = d.run('chartHistory.endTime');
  d.nodes.get('historyScrollToggle').events.click();
  assert.equal(d.run('chartHistory.enabled'), false);
  assert.equal(d.run('panHistoryWindow(3600000)'), false);
  assert.equal(d.run('chartHistory.endTime'), end);
  assert.match(d.nodes.get('chartHistoryHelp').textContent, /locked/);
  d.nodes.get('historyCurrent').events.click();
  assert.equal(d.run('chartHistory.endTime'), null);
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
  assert.equal(d.run('chartHistory.cache.has("' + firstKey + '")'), true);
  await d.run('loadChartHistory()');
  assert.equal(d.run('chartHistory.dataKey'), d.run('historyWindowKey()'));
  assert.equal(reads, 7); // The matching weekly baseline is reused.
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
  assert.equal(d.run("chartRouteData('I25').baseline.profiles.length"), 0);
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
  assert.equal(d.run('chartHistory.enabled'), false);
  assert.equal(d.run('chartHistory.bounds'), null);
  assert.equal(d.run('panHistoryWindow(3600000)'), false);
  assert.match(d.nodes.get('chartHistoryHelp').textContent, /unavailable.*Retry/);
  d.context.window.fetch = async () => ({ok:true,json:async()=>({firstObservedAt:'2026-01-01T00:00:00Z'})});
  await d.run('loadHistoryCoverage()');
  assert.equal(d.run('chartHistory.bounds.size'), 2);
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
  assert.equal(d.run('chartHistory.data'), null);
  assert.equal(d.run('state.routeData.size'), 1);
  assert.match(d.nodes.get('chartHistoryHelp').textContent, /could not load.*Retry/);
});

test('switching to a wider range or different view does not reuse a narrow historical dataset', () => {
  const d = dashboard(undefined, '?historical=1');
  prepareChartHistory(d);
  d.run(`
    chartHistory.data = new Map([['I25', {chartHours:2,chartView:'overall', chartWeek:'2026-06-15', marker:'narrow'}]]);
    state.routeData.get('I25').marker = 'preloaded';
    panHistoryWindow(3600000);
  `);
  assert.equal(d.run("chartRouteData('I25').marker"), 'preloaded');
  assert.match(d.run("chartHistoryEmptyMessage('No data')"), /Loading observations/);
  d.run('state.selectedHours = 2');
  assert.equal(d.run("chartRouteData('I25').marker"), 'narrow');
  d.run("state.chartView = 'zones'");
  assert.equal(d.run("chartRouteData('I25').marker"), 'preloaded');
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
function dashboard(fetch = async () => { throw new Error('Offline'); }, search = '', pathname = '/dashboard/') {
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
  const context = vm.createContext({ URLSearchParams, URL, AbortSignal, console, Date, Intl,
    window: { location: { search, pathname }, fetch, requestAnimationFrame() {},
      setTimeout() { return 1; }, clearTimeout() {},
      localStorage: { getItem() { throw new Error('Blocked'); } } },
    document: { getElementById: get, createElement: node, createElementNS: node, querySelector: () => null,
      querySelectorAll: () => [], documentElement: node(), body: node() } });
  vm.runInContext(estimatesSource, context);
  vm.runInContext(historySource, context);
  vm.runInContext(source.replace('\ninitializeDashboard();', ''), context);
  return { nodes, context, run: code => vm.runInContext(code, context) };
}

test('uses relative dashboard assets so the UI can be mounted under either public path', () => {
  assert.doesNotMatch(indexSource, /(?:href|src)="\/dashboard\//);
  assert.match(mapSource, /import\("\.\/vendor\/maplibre-gl\/6\.10\.0\/maplibre-gl\.mjs"\)/);
});

test('routes dashboard reads through the matching production or experimental prefix', () => {
  const production = dashboard();
  assert.equal(production.run('DASHBOARD_RUNTIME.experimental'), false);
  assert.equal(production.run('DASHBOARD_RUNTIME.apiBase'), '/dashboard-api');
  assert.equal(production.run('DASHBOARD_RUNTIME.healthPath'), '/actuator/health');
  assert.equal(production.run("dashboardApi('/traffic/corridors')"), '/dashboard-api/traffic/corridors');

  const experimental = dashboard(undefined, '', '/dashboard-experimental/');
  assert.equal(experimental.run('DASHBOARD_RUNTIME.experimental'), true);
  assert.equal(experimental.run('DASHBOARD_RUNTIME.apiBase'), '/dashboard-experimental-api');
  assert.equal(experimental.run('DASHBOARD_RUNTIME.healthPath'), '/dashboard-experimental-health');
  assert.equal(
    experimental.run("dashboardApi('traffic/corridors')"),
    '/dashboard-experimental-api/traffic/corridors'
  );

  const productionReplay = dashboard(undefined, '?replay=1');
  const experimentalReplay = dashboard(undefined, '?replay=1', '/dashboard-experimental/');
  assert.equal(productionReplay.run('REPLAY_MODE'), true);
  assert.equal(experimentalReplay.run('REPLAY_MODE'), false);
});

function informationPage(fetch = async () => { throw new Error('Offline'); }, pathname = '/dashboard/system.html', architectureItems = []) {
  const nodes = new Map();
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
  const context = vm.createContext({ console, Date, Intl, Number, String,
    window: { location: { pathname }, fetch, localStorage: { getItem() { return null; }, setItem() {} } },
    document: { getElementById: get, createElement: node, createTextNode: text => ({ textContent: text }),
      querySelectorAll: () => architectureItems, documentElement: node('html') } });
  vm.runInContext(informationSource.replace('\ninitializeInformationPage();', ''), context);
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

test('information page heroes share one title scale', () => {
  assert.match(informationStyles, /\.information-hero h1\s*\{[^}]*font-size: clamp\(32px, 6vw, 58px\)/s);
  assert.doesNotMatch(informationStyles, /\.data-hero h1,\s*\.api-hero h1\s*\{[^}]*font-size:/s);
});

test('data hero uses the live corridor geometry in the API page layout', () => {
  assert.match(informationPages.data, /id="dataHeroMap"/);
  assert.match(informationPages.data, /Pulse · 1s \/ travel min/);
  assert.match(informationPages.data, /data-hero-map\.js/);
  assert.match(dataHeroMapSource, /\/traffic\/map\/corridors/);
  assert.match(dataHeroMapSource, /corridorLayer\("hero-i25"[\s\S]*corridorLayer\("hero-i70"/);
  assert.match(dataHeroMapSource, /interactive: false/);
  assert.match(dataHeroMapSource, /ResizeObserver\(fitOverview\)/);
  assert.match(dataHeroMapSource, /base-map-overview[\s\S]*detailMinZoom/);
  assert.match(dataHeroMapSource, /flow-cells\/current/);
  assert.doesNotMatch(dataHeroMapSource, /\/incidents/);
  assert.match(informationStyles, /\.data-hero-facts\s*\{[^}]*grid-column: 1 \/ -1[^}]*repeat\(4/s);
  assert.match(informationStyles, /\.data-hero-map-legend\s*\{[^}]*flex-wrap: wrap/s);
});

function heroMap(fetch = async () => { throw new Error('Offline'); }) {
  const elements = [];
  const makeNode = () => ({
    attributes: {}, children: [], classes: new Set(), dataset: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; },
    appendChild(child) { this.children.push(child); },
    classList: { add() {}, toggle() {} },
    animate(keyframes, options) {
      this.keyframes = keyframes; this.options = options;
      const animation = { currentTime: 0, playbackRate: 1, playState: 'running',
        cancel() { this.playState = 'idle'; }, pause() { this.playState = 'paused'; },
        play() { this.playState = 'running'; }, updatePlaybackRate(rate) { this.playbackRate = rate; } };
      this.animation = animation;
      return animation;
    }
  });
  const container = makeNode();
  Object.assign(container, { clientWidth: 400, clientHeight: 300 });
  container.classList.toggle = (name, active) => active ? container.classes.add(name) : container.classes.delete(name);
  let visibility, moveEnd, offset = 0, projectionCalls = 0, scheduled;
  const motionPreference = { matches: false, addEventListener() {} };
  const labels = new Map();
  const context = vm.createContext({
    AbortSignal, Date,
    window: { location: {}, fetch, matchMedia() { return motionPreference; },
      setTimeout(callback, delay) { scheduled = { callback, delay }; },
      clearTimeout() { scheduled = null; }, addEventListener() {}, IntersectionObserver: class {
      constructor(callback) { visibility = callback; } observe() {}
    } },
    document: { hidden: false, getElementById: id => {
      if (id === 'dataHeroMap') return container;
      if (!labels.has(id)) labels.set(id, makeNode());
      return labels.get(id);
    }, createElement() { const node = makeNode(); elements.push(node); return node; } },
    testMap: { on(event, callback) { if (event === 'moveend') moveEnd = callback; },
      project([x, y]) { projectionCalls++; return { x: x + offset, y }; }, resize() {}, fitBounds() {} }
  });
  vm.runInContext(estimatesSource, context);
  const withoutStartup = dataHeroMapSource.replace(/  initialize\(\)\.catch\(\(\) => \{[\s\S]*?\n  \}\);/, '');
  vm.runInContext(withoutStartup.replace(/\}\)\(\);\s*$/, `
    map = testMap;
    initializePulseOverlay([{ id: 'I25', properties: {startMileMarker: 0, endMileMarker: 63}, geometry: { type: 'MultiLineString', coordinates: [
      [[10, 20], [30, 40]], [[50, 60], [70, 80]] ] } },
      { properties: { corridor: 'I70', startMileMarker: 206, endMileMarker: 274 }, geometry: { type: 'LineString', coordinates: [[90, 100], [110, 120]] } }]);
    projectPulsePaths(); observeVisibility();
    window.testHero = { refreshPaces, syncPulseMotion };
  })();`), context);
  return { container, labels, context, motionPreference, visibility: value => visibility([{ isIntersecting: value }]),
    move: value => { offset = value; moveEnd(); }, calls: () => projectionCalls, scheduled: () => scheduled };
}

test('hero pulses travel both ways on full geometry without projecting on animation frames', () => {
  const h = heroMap();
  const container = h.container;
  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].attributes['aria-hidden'], 'true');
  const marker = container.children[0];
  assert.equal(marker.keyframes.length, 8, 'both disconnected parts travel out and back without bridging gaps');
  assert.equal(marker.keyframes[0].transform, 'translate3d(5px, 15px, 0)');
  assert.equal(marker.keyframes.at(-1).transform, marker.keyframes[0].transform);
  assert.equal(marker.keyframes[3].offset, 0.5, 'endpoint reached halfway through the round trip');
  assert.equal(marker.keyframes[1].offset, marker.keyframes[2].offset, 'no time spent in geometry gaps');
  assert.equal(h.calls(), 6);
  marker.animation.currentTime = 650;
  h.move(5);
  assert.equal(marker.keyframes[0].transform, 'translate3d(10px, 15px, 0)');
  assert.equal(marker.animation.currentTime, 650, 'resize preserves progress and direction');
  h.visibility(false);
  assert.equal(container.classes.has('motion-paused'), true);
  h.visibility(true);
  assert.equal(container.classes.has('motion-paused'), false);
  assert.match(informationStyles, /@media \(prefers-reduced-motion: reduce\)[^}]*\.data-hero-map-pulse \{ visibility: hidden;/);
});

test('hero pace follows dashboard rounding, refreshes without rewinding and pauses when hidden', async () => {
  let speed = 63 / 52 * 60, requests = 0;
  const h = heroMap(async url => {
    requests++;
    return url.includes('flow-cells') ? { ok: false } : { ok: true, json: async () => ({
      latest: {avgCurrentSpeed: speed, polledAt: new Date().toISOString()}
    }) };
  });
  await h.context.window.testHero.refreshPaces();
  const marker = h.container.children[0];
  assert.equal(marker.dataset.travelSeconds, '52');
  assert.equal(marker.animation.playbackRate, 1 / 52);
  assert.equal(marker.options.duration / marker.animation.playbackRate / 2, 52_000);
  assert.equal(h.labels.get('i25MapPace').textContent, '52 min');
  marker.animation.currentTime = 1200;
  speed = 63 / 40 * 60;
  await h.context.window.testHero.refreshPaces();
  assert.equal(marker.animation.playbackRate, 1 / 40);
  assert.equal(marker.animation.currentTime, 1200, 'new pace does not rewind the return journey');
  assert.equal(h.calls(), 6, 'refresh does not reproject map geometry');
  h.visibility(false);
  assert.equal(marker.animation.playState, 'paused');
  assert.equal(h.scheduled(), null);
  const before = requests;
  await h.context.window.testHero.refreshPaces();
  assert.equal(requests, before);
  h.visibility(true);
  assert.equal(marker.animation.playState, 'running');
  h.context.document.hidden = true;
  h.context.window.testHero.syncPulseMotion();
  assert.equal(marker.animation.playState, 'paused');
  h.context.document.hidden = false;
  h.motionPreference.matches = true;
  h.context.window.testHero.syncPulseMotion();
  assert.equal(marker.animation.playState, 'paused', 'reduced motion also pauses native animations');
  h.motionPreference.matches = false;
  speed = 0;
  await h.context.window.testHero.refreshPaces();
  assert.equal(marker.animation.playState, 'paused');
  assert.equal(h.labels.get('i25MapPace').textContent, 'pace unavailable');
});

test('hero and dashboard use the same complete snapshot estimate and label retained fallback honestly', async () => {
  const h = heroMap(async url => ({ ok: true, json: async () => url.includes('flow-cells') ? {
    observedAt: new Date().toISOString(), totalCellCount: 2, supportedCellCount: 2,
    cells: [ { startMileMarker: 0, endMileMarker: 0.5, speedMph: 60 },
      { startMileMarker: 0.5, endMileMarker: 1, speedMph: 30 } ]
  } : { latest: {avgCurrentSpeed: 60, polledAt: '2026-01-01T00:00:00Z'} } }));
  await h.context.window.testHero.refreshPaces();
  assert.equal(h.container.children[0].dataset.travelSeconds, '2');
  h.context.window.fetch = async url => ({ ok: true, json: async () => url.includes('flow-cells') ? {
    observedAt: new Date().toISOString(), totalCellCount: 2, supportedCellCount: 1,
    cells: [{ startMileMarker: 0, endMileMarker: 0.5, speedMph: 60 }]
  } : { latest: { avgCurrentSpeed: 60, polledAt: '2026-01-01T00:00:00Z' } } });
  await h.context.window.testHero.refreshPaces();
  assert.equal(h.labels.get('i25MapPace').textContent, '63 min · retained',
    'fresh partial cells must not make an older fallback estimate appear current');
  h.context.window.fetch = async url => ({ ok: !url.includes('flow-cells'), json: async () => ({
    latest: { avgCurrentSpeed: 60, polledAt: '2026-01-01T00:00:00Z' }
  }) });
  await h.context.window.testHero.refreshPaces();
  assert.equal(h.labels.get('i25MapPace').textContent, '63 min · retained');
});

test('information pages retain bounded and accurate data contracts', () => {
  assert.match(informationPages.data, /I-25 is included from mile marker 208 through mile marker 271/);
  assert.match(informationPages.data, /I-70 is included from mile marker 206 through mile marker 274 at I-25/);
  assert.match(informationPages.data, /combined-direction view/);
  assert.match(informationPages.data, /Denver time[\s\S]*restarts at midnight/);
  assert.match(informationPages.data, /Σ[\s\S]*every cell[\s\S]*× 60/);
  assert.match(informationPages.api, /These reads do not trigger new TomTom or CDOT requests/);
  assert.match(informationPages.api, /GET \/traffic\/zones\/baselines/);
  assert.match(informationSource, /\/system\/operational-status/);
});

test('data and API stories keep the concise source and access model visible', () => {
  assert.match(informationPages.data, /Road data, with the caveats kept visible/);
  assert.match(informationPages.data, /provider-tomtom\.svg/);
  assert.match(informationPages.data, /provider-cdot\.png/);
  assert.match(informationPages.data, /13 completed weeks/);
  assert.match(informationPages.data, /Visible gaps/);
  assert.match(informationPages.api, /The dashboard, in JSON/);
  assert.match(informationPages.api, /26[\s\S]*public GET routes/);
  assert.match(informationPages.api, /300\/min[\s\S]*cloud request ceiling/);
  assert.match(informationPages.api, /history ≤ 7 days/);
  assert.match(informationPages.api, /endpoint-atlas/);
  assert.match(informationPages.api, /Same data, two trust boundaries/);
  assert.match(informationPages.api, /One query layer, identical response meaning/);
  assert.match(informationPages.api, /300 reads per minute/);
  assert.match(informationPages.api, /id="apiExplorerForm"/);
  assert.match(informationPages.api, /GET only/);
  assert.match(informationPages.api, /Retained data only/);
  assert.doesNotMatch(informationPages.data, /migration V24/);
  assert.match(informationPages.api, /GET \/system\/operational-status/);
});

test('data page uses real resolution and geometry rules in reusable panels', () => {
  const data = informationPages.data;
  assert.match(data, /0\.5 mi[\s\S]*15 min[\s\S]*1 mi[\s\S]*13 weeks/);
  assert.match(data, /I-25 · MM 208–271[\s\S]*550 m/);
  assert.match(data, /I-70 · MM 206–274[\s\S]*68 mapped miles · 9 calibrated anchors[\s\S]*400 m/);
  assert.match(data, /0\.65–0\.95/);
  assert.match(data, /confidence[\s\S]*not a second publish threshold/i);
  assert.match(data, /architecture-node modular-panel source-card/);
  assert.match(data, /architecture-node modular-panel language-card/);
  assert.match(data, /href="#icon-eye"/);
  assert.match(data, /href="#icon-chart-area"/);
});

test('data page travel range uses only complete retained zone buckets', () => {
  const page = informationPage();
  const range = page.run(`retainedDailyTravelRange([
    { zoneKey: 'a', startMileMarker: 0, endMileMarker: 1, avgCurrentSpeed: 60, bucketStart: '2026-10-01T12:00:00Z' },
    { zoneKey: 'b', startMileMarker: 1, endMileMarker: 2, avgCurrentSpeed: 30, bucketStart: '2026-10-01T12:00:00Z' },
    { zoneKey: 'a', startMileMarker: 0, endMileMarker: 1, avgCurrentSpeed: 30, bucketStart: '2026-10-01T13:00:00Z' },
    { zoneKey: 'b', startMileMarker: 1, endMileMarker: 2, avgCurrentSpeed: 30, bucketStart: '2026-10-01T13:00:00Z' },
    { zoneKey: 'a', startMileMarker: 0, endMileMarker: 1, avgCurrentSpeed: 10, bucketStart: '2026-09-30T13:00:00Z' }
  ], 2, '2026-10-01T14:00:00Z')`);
  assert.equal(range.fastest, 3);
  assert.equal(range.slowest, 4);
});

test('API explorer builds bounded production and experimental reads without fetching on startup', () => {
  let fetches = 0;
  const production = informationPage(async () => { fetches += 1; });
  production.nodes.get('apiPreset').value = 'history';
  production.nodes.get('apiCorridor').value = 'I70';
  production.run('initializeApiExplorer()');
  assert.equal(fetches, 0);
  assert.equal(
    production.nodes.get('apiRequestPath').textContent,
    '/dashboard-api/traffic/history?corridor=I70&windowMinutes=120&limit=12&includeIncidents=false'
  );

  const experimental = informationPage(undefined, '/dashboard-experimental/api.html');
  experimental.nodes.get('apiPreset').value = 'status';
  experimental.run('initializeApiExplorer()');
  assert.equal(experimental.nodes.get('apiCorridor').disabled, true);
  assert.equal(
    experimental.nodes.get('apiRequestPath').textContent,
    '/dashboard-experimental-api/system/operational-status'
  );
});

test('information page initialization runs after API explorer presets are defined', () => {
  const presetsAt = informationSource.indexOf('const API_EXAMPLES');
  const initializeAt = informationSource.lastIndexOf('initializeInformationPage();');
  assert.ok(presetsAt >= 0);
  assert.ok(initializeAt > presetsAt);
});

test('API explorer renders a bounded JSON response and rate-limit context', async () => {
  const page = informationPage(async path => ({
    ok: true,
    status: 200,
    headers: { get(name) {
      if (name === 'content-type') return 'application/json';
      if (name === 'x-ratelimit-remaining') return '59';
      return null;
    } },
    async json() { return { corridor: path.includes('I70') ? 'I70' : 'I25', count: 12 }; }
  }), '/dashboard/api.html');
  page.run(`informationElements.apiResponseBody.closest = () => document.getElementById('apiResponsePanel')`);
  page.nodes.get('apiPreset').value = 'history';
  page.nodes.get('apiCorridor').value = 'I70';
  const rendered = await page.run(`(async () => {
    await runApiExplorerRequest();
    return {
      state: informationElements.apiResponseState.textContent,
      meta: informationElements.apiResponseMeta.textContent,
      body: informationElements.apiResponseBody.textContent,
      disabled: informationElements.apiRun.disabled
    };
  })()`);
  assert.equal(rendered.state, '200 OK');
  assert.match(rendered.meta, /59 reads remain this minute/);
  assert.match(rendered.body, /"corridor": "I70"/);
  assert.equal(rendered.disabled, false);
});

test('API explorer run button starts the read without relying on implicit form submission', async () => {
  let reads = 0;
  const page = informationPage(async () => {
    reads += 1;
    return {
      ok: true,
      status: 200,
      headers: { get(name) { return name === 'content-type' ? 'application/json' : null; } },
      async json() { return { status: 'HEALTHY' }; }
    };
  }, '/dashboard/api.html');
  page.run(`informationElements.apiResponseBody.closest = () => document.getElementById('apiResponsePanel')`);
  page.run('initializeApiExplorer()');
  const prevented = page.run(`(() => {
    let prevented = false;
    informationElements.apiRun.events.click({ preventDefault() { prevented = true; } });
    return prevented;
  })()`);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(reads, 1);
  assert.equal(page.nodes.get('apiResponseState').textContent, '200 OK');
});

test('system page describes the implemented architecture without overstating it', () => {
  const system = informationPages.system;
  assert.match(system, /131 mi<\/strong><span>of monitored highway/);
  assert.match(system, /0\.5 mi<\/strong><span>stable road sections/);
  assert.match(system, /2 → 1<\/strong><span>live feeds, one coordinated view/);
  assert.match(system, /One timeline<\/strong><span>current and archived data/);
  assert.match(system, /Collect, organize, explain/);
  assert.match(system, /View the dashboard/);
  assert.match(system, /aria-label="System page sections"/);
  assert.ok(system.indexOf('id="systemPageRoute"') < system.indexOf('id="systemIntro"'));
  assert.match(system, /href="#systemOperations">Operations/);
  assert.match(system, /Routes Service/);
  assert.match(system, /src="provider-tomtom\.svg"/);
  assert.match(system, /src="provider-cdot\.png"/);
  assert.match(system, /Traffic speeds/);
  assert.match(system, /Road incidents/);
  assert.match(system, /An incident keeps its history across updates/);
  assert.match(system, /failed or incomplete update does not replace the last complete report/);
  assert.match(system, /PostgreSQL \/ TimescaleDB/);
  assert.match(system, /Corridor speeds<br>Half-mile road state<br>Current incidents/);
  assert.match(system, /Live and archived views<br>Summary calculations<br>Time-series support/);
  assert.match(system, /Road and directional geometry/);
  assert.match(system, /Separate account budgets/);
  assert.match(system, /Fast answers, backed by retained history/);
  assert.match(system, /Store and update stable 0\.5-mile road sections/);
  assert.match(system, /Traffic age/);
  assert.match(system, /Backup age/);
  assert.match(system, /dashboard is served by the API container/);
  assert.match(system, /Routes<\/strong><small>Geometry/);
  assert.match(system, /Recurring safeguards<\/strong><small>Start · Detect · Preserve · Restore/);
  assert.match(system, /Six ways to catch a bad release/);
  assert.match(system, /Application<\/strong><small>Unit \+ integration/);
  assert.match(system, /Backup<\/strong><small>Windows client/);
  assert.match(system, /Technical health details/);
  assert.match(system, /class="status-ecg"/);
  assert.doesNotMatch(system, /machine.learning/i);
  assert.doesNotMatch(system, /Kafka/);
});

test('dashboard presentation follows the extended I-70 corridor definition', () => {
  assert.match(informationPages.data, /I-70 · <span id="i70MapPace">68 mi/);
  assert.match(informationPages.data, /<strong>136<\/strong><small>I-70 half-mile pieces/);
  assert.match(informationSource, /id: "I70", distanceMiles: 68/);
  assert.match(source, /label: "I-70 Mountain–Denver"[\s\S]*distanceMiles: 68/);
  assert.match(source, /I70-259-270_274[\s\S]*posted: 65/);
  assert.match(source, /I70-270_274-274[\s\S]*posted: 55/);
  assert.match(indexSource, /Exit 206–274/);
});

test('engineering verification motion only runs while its console is visible', () => {
  const page = informationPage();
  page.run(`
    window.IntersectionObserver = class {
      constructor(callback, options) {
        window.verificationObserverCallback = callback;
        window.verificationObserverOptions = options;
      }
      observe(target) { window.verificationObserved = target; }
    };
    initializeVerificationConsole();
  `);

  assert.equal(page.run('window.verificationObserverOptions.threshold'), 0.22);
  assert.equal(page.run('window.verificationObserved === informationElements.verificationConsole'), true);

  page.run('window.verificationObserverCallback([{ target: informationElements.verificationConsole, isIntersecting: true }])');
  assert.equal(page.nodes.get('verificationConsole').classList.contains('is-active'), true);

  page.run('window.verificationObserverCallback([{ target: informationElements.verificationConsole, isIntersecting: false }])');
  assert.equal(page.nodes.get('verificationConsole').classList.contains('is-active'), false);
});

test('engineering checks are shuffled through the one-to-five-second gate window', () => {
  const page = informationPage();
  const completionTimes = page.run(`
    const verificationGates = Array.from({ length: 6 }, () => ({
      dataset: {}
    }));
    const verificationPanel = { querySelectorAll() { return verificationGates; } };
    Math.random = () => 0;
    randomizeVerificationGates(verificationPanel)
      .map(entry => entry.completeAtSeconds)
      .sort((left, right) => left - right);
  `);

  assert.deepEqual([...completionTimes], [4.3, 5.1, 5.9, 6.7, 7.5, 8.3]);
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

test('system hero handoff follows the rendered headline positions', () => {
  const page = informationPage();
  const hero = page.nodes.get('systemIntro');
  const properties = {};
  hero.style = { setProperty(name, value) { properties[name] = value; } };
  page.nodes.get('systemHeroTitle').getBoundingClientRect = () => ({ left: 100, top: 50 });
  page.nodes.get('systemHeroSource').getClientRects = () => [{ left: 200, right: 400, bottom: 110 }];
  page.nodes.get('systemHeroTarget').getClientRects = () => [{ left: 460, right: 650, bottom: 110 }];
  page.nodes.get('systemHeroSignal').getBoundingClientRect = () => ({ width: 10 });

  page.run('positionSystemHeroSignal(informationElements.systemHero)');

  assert.deepEqual(properties, {
    '--system-signal-source-start-x': '100px',
    '--system-signal-source-start-y': '50px',
    '--system-signal-source-end-x': '300px',
    '--system-signal-source-end-y': '50px',
    '--system-signal-target-x': '350px',
    '--system-signal-target-y': '50px',
    '--system-signal-target-end-x': '540px',
    '--system-signal-target-end-y': '50px',
    '--system-signal-start-x': '295px',
    '--system-signal-start-y': '54.5px',
    '--system-signal-end-x': '355px',
    '--system-signal-end-y': '54.5px'
  });
  assert.equal(hero.classList.contains('has-signal-path'), true);
});

test('system hero uses one underline for adjacent highlighted words on each rendered line', () => {
  const page = informationPage();
  const hero = page.nodes.get('systemIntro');
  const title = page.nodes.get('systemHeroTitle');
  const target = page.nodes.get('systemHeroTarget');
  const lines = [];
  const words = [
    { getBoundingClientRect: () => ({ left: 460, right: 610, top: 80, bottom: 110 }) },
    { getBoundingClientRect: () => ({ left: 460, right: 530, top: 120, bottom: 150 }) },
    { getBoundingClientRect: () => ({ left: 540, right: 600, top: 120, bottom: 150 }) }
  ];
  hero.style = { setProperty() {} };
  title.getBoundingClientRect = () => ({ left: 100, top: 50 });
  title.querySelectorAll = () => lines;
  title.appendChild = line => lines.push(line);
  target.querySelectorAll = () => words;
  target.getClientRects = () => [{ left: 460, right: 610, bottom: 110 }];
  page.nodes.get('systemHeroSource').getClientRects = () => [{ left: 200, right: 400, bottom: 110 }];
  page.nodes.get('systemHeroSignal').getBoundingClientRect = () => ({ width: 10 });
  page.run(`
    document.createElement = () => ({
      className: '', hidden: false, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      style: { values: {}, setProperty(name, value) { this.values[name] = value; } }
    });
    positionSystemHeroSignal(informationElements.systemHero);
  `);

  assert.equal(lines.length, 2);
  assert.equal(lines[0].style.values['--system-highlight-width'], '150px');
  assert.equal(lines[1].style.values['--system-highlight-left'], '360px');
  assert.equal(lines[1].style.values['--system-highlight-width'], '140px');
});

test('system page route stays hidden until the visitor scrolls into the page', () => {
  const page = informationPage();
  const route = page.nodes.get('systemPageRoute');
  route.style = { setProperty() {} };
  page.run(`
    const routeTargets = ['systemIntro', 'systemDataPath', 'systemDecisions',
      'systemOperations', 'systemChecks', 'systemHealth'];
    const routeLinks = routeTargets.map(id => ({
      id, attributes: { href: '#' + id },
      classList: { toggle() {} },
      getAttribute(name) { return this.attributes[name]; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; }
    }));
    informationElements.systemPageRoute.querySelectorAll = () => routeLinks;
    routeTargets.forEach((id, index) => {
      document.getElementById(id).getBoundingClientRect = () => ({ top: index * 400 });
    });
    document.documentElement.scrollHeight = 2400;
    window.innerHeight = 800;
    window.scrollY = 0;
    window.routeListeners = {};
    window.addEventListener = (name, handler) => { window.routeListeners[name] = handler; };
    initializeSystemPageRoute();
  `);

  assert.equal(route.classList.contains('is-revealed'), false);
  page.run('window.scrollY = 65; window.routeListeners.scroll();');
  assert.equal(route.classList.contains('is-revealed'), true);
});

test('system architecture focus highlights only the active panel and its container', () => {
  function item(flow, focusable = false, children = []) {
    const classes = new Set();
    return { dataset: { architectureFlow: flow }, tabIndex: focusable ? 0 : undefined, events: {},
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        toggle(name, force) { force === false ? classes.delete(name) : classes.add(name); },
        contains(name) { return classes.has(name); }
      },
      addEventListener(name, handler) { this.events[name] = handler; },
      contains(candidate) { return children.includes(candidate); },
      matches(selector) { return selector === '[tabindex]' && this.tabIndex !== undefined; } };
  }
  const trafficPipeline = item('flow storage delivery', true);
  const database = item('flow incident storage delivery', true);
  const incidentPipeline = item('incident storage delivery', true);
  const ingest = item('route flow incident control storage delivery', true, [trafficPipeline, incidentPipeline]);
  const page = informationPage(undefined, '/dashboard/system.html', [trafficPipeline, database, incidentPipeline, ingest]);
  page.run('initializeArchitectureHighlights()');

  trafficPipeline.events.focus();
  assert.equal(page.nodes.get('systemArchitecture').classList.contains('has-active-flow'), true);
  assert.equal(trafficPipeline.classList.contains('is-related'), true);
  assert.equal(ingest.classList.contains('is-related'), true);
  assert.equal(database.classList.contains('is-related'), false);
  assert.equal(incidentPipeline.classList.contains('is-related'), false);
  assert.equal(incidentPipeline.classList.contains('is-muted'), false);

  trafficPipeline.events.blur();
  assert.equal(page.nodes.get('systemArchitecture').classList.contains('has-active-flow'), false);
  assert.equal(trafficPipeline.classList.contains('is-related'), false);
  assert.equal(ingest.classList.contains('is-related'), false);
});

test('system data-path connectors span the panel edges', () => {
  const page = informationPage();
  const geometry = page.run(`architectureConnectorGeometry(
    { bottom: 194.25 },
    { top: 241.75 },
    { top: 200 }
  )`);

  assert.equal(geometry.offset, -5.75);
  assert.equal(geometry.length, 47.5);
  assert.match(informationPages.system, /data-connector-from="tomtomProvider" data-connector-to="ingestService"/);
  assert.match(informationPages.system, /data-connector-from="trafficApi" data-connector-to="trafficDashboard"/);
});

test('information motion pauses offscreen, resumes on entry, and suspends with the tab', () => {
  const page = informationPage();
  const scope = page.context.document.getElementById('scope');
  const events = {};
  let observer;
  page.context.document.querySelectorAll = () => [scope];
  page.context.document.addEventListener = (name, callback) => { events[name] = callback; };
  page.context.window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(target) { assert.equal(target, scope); }
  };
  page.run('initializeMotionBudget()');
  assert.equal(scope.classList.contains('motion-paused'), true);
  observer.callback([{ target: scope, isIntersecting: true }]);
  assert.equal(scope.classList.contains('motion-paused'), false);
  observer.callback([{ target: scope, isIntersecting: false }]);
  assert.equal(scope.classList.contains('motion-paused'), true);
  page.context.document.hidden = true;
  events.visibilitychange();
  assert.equal(page.context.document.documentElement.classList.contains('motion-suspended'), true);
  page.context.document.hidden = false;
  events.visibilitychange();
  assert.equal(page.context.document.documentElement.classList.contains('motion-suspended'), false);
});

test('panel traces follow resized panels without changing their accessible content', () => {
  const page = informationPage();
  const panel = page.context.document.getElementById('panel');
  panel.textContent = 'Traffic flow';
  panel.clientWidth = 320;
  panel.clientHeight = 180;
  page.context.document.querySelectorAll = () => [panel];
  page.context.document.createElementNS = (_, name) => page.context.document.createElement(name);
  page.context.window.getComputedStyle = () => ({ borderTopLeftRadius: '12px' });
  let observer;
  page.context.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(target) { assert.equal(target, panel); }
  };
  page.run('initializePanelBorderTraces()');
  const svg = panel.children[0];
  assert.equal(panel.textContent, 'Traffic flow');
  assert.equal(svg.attributes['aria-hidden'], 'true');
  assert.equal(svg.attributes.focusable, 'false');
  assert.equal(svg.attributes.viewBox, '0 0 324 184');
  assert.equal(svg.children.length, 2);
  const paths = svg.children.map(path => path.attributes.d);
  let writes = 0;
  svg.children.forEach(path => {
    const setAttribute = path.setAttribute.bind(path);
    path.setAttribute = (...args) => { writes++; setAttribute(...args); };
  });
  observer.callback([{ target: panel }]);
  assert.equal(writes, 0);
  panel.clientWidth = 640;
  observer.callback([{ target: panel }]);
  assert.equal(writes, 2);
  assert.equal(svg.attributes.viewBox, '0 0 644 184');
  assert.notDeepEqual(svg.children.map(path => path.attributes.d), paths);
});

test('road sign reflection only follows the pointer while the sign is active', () => {
  assert.match(roadSignDisplaySource, /this\.addEventListener\("pointermove", this\.handlePointerMove/);
  assert.doesNotMatch(roadSignDisplaySource, /window\.addEventListener\("pointermove", this\.handlePointerMove/);
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
  assert.equal(page.nodes.get('systemStatusTitle').textContent, 'Some traffic information may be delayed');
  assert.equal(page.nodes.get('systemSummary').textContent, 'One check needs attention.');
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

test('a failed status request is not mislabeled as a traffic outage', () => {
  const page = informationPage();
  page.context.failure = new Error('HTTP 503');
  page.run('renderStatusUnavailable(failure)');
  assert.equal(page.nodes.get('systemOverview').dataset.status, 'UNAVAILABLE');
  assert.match(page.nodes.get('systemSummary').textContent, /does not by itself mean traffic ingestion is down/);
  assert.equal(page.nodes.get('statusCheckCount').textContent, 'Connection failed');
  assert.equal(page.nodes.get('statusSignalGrid').children[0].textContent, 'No live checks received');
  assert.match(page.nodes.get('operationalChecks').children[0].textContent, /HTTP 503/);
});

test('system health pulse follows the dashboard refresh cadence and reports completion', () => {
  const page = informationPage();
  assert.equal(page.run('SYSTEM_STATUS_REFRESH_MS'), 60_000);

  page.run('startStatusSyncPulse("automatic")');
  assert.equal(page.nodes.get('systemOverview').classList.contains('is-heartbeat'), true);
  assert.equal(page.nodes.get('statusSyncCalloutText').textContent, 'Dashboard sync · checking health…');

  page.run('finishStatusSyncPulse(true)');
  assert.equal(page.nodes.get('systemOverview').classList.contains('is-sync-complete'), true);
  assert.equal(page.nodes.get('statusSyncCalloutText').textContent, 'Dashboard health synced');
});
function event(overrides = {}) {
  return { properties: { incidentProvider: 'cdot', corridor: 'I25', providerEventId: 'one',
    normalizedCategory: 'DISABLED_VEHICLE', closestMileMarker: 225,
    locationLabel: 'MP 225 · Thornton', firstSeenAt: '2026-09-13T10:00:00Z',
    lastSeenAt: '2026-09-15T10:00:00Z', active: true, ...overrides } };
}

function corridorMap(rendererLoader) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: id === 'corridorMapPanel', textContent: '', title: '' });
    return nodes.get(id);
  };
  const attributionDetails = {
    open: true,
    compactShow: true,
    initiallyCollapsed: false,
    dataset: {},
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
    querySelector() { return null; },
    removeAttribute(key) { if (key === 'open') this.open = false; }
  };
  get('corridorMap').querySelector = selector => selector === '.maplibregl-ctrl-attrib' ? attributionDetails : null;
  const window = {
    CORRIDOR_MAP_RENDERER_LOADER: rendererLoader,
    location: { pathname: '/dashboard/' },
    setTimeout,
    clearTimeout,
    MutationObserver: undefined
  };
  const context = vm.createContext({
    console, URL,
    window,
    document: {
      getElementById: get,
      querySelectorAll: selector => selector.includes('frequency')
        ? [get('frequencyLegend')]
        : selector.includes('current') ? [get('currentLegend')] : [],
      createElement: tagName => ({ tagName, textContent: '', className: '', hidden: false, style: {}, attributes: {}, children: [],
        appendChild(child) { this.children.push(child); },
        setAttribute(key, value) { this.attributes[key] = value; } }),
      documentElement: { dataset: { theme: 'light' } }
    }
  });
  vm.runInContext(mapSource, context);
  return { nodes, context, attributionDetails };
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

test('preloads the corridor map renderer before the first focused corridor', async () => {
  const instances = [];
  let rendererLoads = 0;
  const d = corridorMap(async () => {
    rendererLoads += 1;
    return fakeMapRenderer(instances);
  });
  d.context.window.fetch = async () => ({ ok: false });
  await d.context.window.CorridorMapPanel.preload();
  assert.equal(rendererLoads, 1);
  assert.equal(instances.length, 1);

  await d.context.window.CorridorMapPanel.render({
    corridor: 'I25',
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-105, 39.7], [-104.9, 40.1]] } },
    incidentFeatures: []
  });
  assert.equal(rendererLoads, 1);
  assert.equal(instances.length, 1);
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
    once() {}
    loaded() { return false; }
    isStyleLoaded() { return true; }
    getSource(id) { return this.sources.get(id); }
    getLayer() { return true; }
    getCanvas() { return this.canvas; }
    getZoom() { return this.zoom; }
    queryRenderedFeatures() { return this.renderedFeatures || []; }
    setPaintProperty() {}
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
    constructor(options) { this.element = options.element; markers.push(this); }
    setLngLat(value) { this.coordinates = value; return this; }
    addTo(value) { this.map = value; return this; }
    getElement() { return this.element; }
    remove() { this.removed = true; }
  }
  return { default: { Map, Popup, Marker, NavigationControl: class {}, AttributionControl: class {} } };
}

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
  assert.equal(data.corridorFeatures.get('I25').properties.corridor, 'I25');
  assert.equal(data.routeData.get('I25').incidentThreads[0].type, 'Disabled Vehicle');
  assert.equal(data.routeData.get('I25').incidentThreads[0].ongoing, true);
  d.context.buckets = data.routeData.get('I25').trend.buckets;
  assert.equal(d.run("selectDisplayBuckets(buckets, 24, Date.parse('2026-06-19T02:51:46Z')).length"), 1);
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
  assert.equal(instances[0].loaded(), false);
  assert.equal(JSON.stringify(instances[0].bounds), JSON.stringify([[-105.2, 39.6], [-104.8, 40.7]]));
  assert.equal(instances[0].sources.get('corridor-route').data.features.length, 1);
  assert.equal(instances[0].sources.get('corridor-traffic').data.features.length, 0);
  assert.equal(instances[0].sources.get('corridor-incidents').data.features.length, 1);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /1 mapped CDOT report/);
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
  instances[0].listeners.get('click:corridor-incidents')({ features: [incident] });
  assert.equal(popups.length, 2);
  assert.equal(popups[0].removed, true);
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
  d.context.window.MutationObserver = class {
    constructor() { throw new Error('Attribution collapse must not install a DOM observer'); }
  };
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
  assert.match(d.nodes.get('corridorMapStatus').textContent, /No mapped CDOT reports/);
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
  assert.match(indexSource, /Low slowdown rate/);
  assert.match(indexSource, /Very high slowdown rate/);
  assert.match(indexSource, /Frequent near-stops/);

  instances[0].listeners.get('click:corridor-traffic')({
    lngLat: { lng: -105, lat: 39.995 }, features: [traffic[0]]
  });
  assert.match(popups[0].content.children[0].textContent, /High slowdown rate/);
  assert.match(popups[0].content.children[1].textContent, /12 of 24 sampled hours/);
  assert.match(popups[0].content.children[3].textContent, /24 of 168 requested hours available/);
});

test('long-range maps replace event clouds with the five busiest one-mile hotspots', async () => {
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
    point: { x: 10, y: 10 },
    lngLat: { lng: -105, lat: 39.995 },
    features: [{ geometry: { type: 'LineString', coordinates: [[-105, 39.99], [-105, 40]] },
      properties: { resolution: 'SLOWDOWN_FREQUENCY' } }]
  });
  assert.equal(popups.length, 1);
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
  assert.match(failed.nodes.get('corridorMapStatus').textContent, /Select Refresh to retry/);
});

test('corridor map retries after a transient renderer startup failure', async () => {
  const instances = [];
  let attempts = 0;
  const d = corridorMap(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Sidecar restarted while loading the renderer');
    return fakeMapRenderer(instances);
  });
  const payload = {
    corridor: 'I70',
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-106, 39.6], [-105, 39.8]] } },
    incidentFeatures: []
  };

  await d.context.window.CorridorMapPanel.render(payload);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Select Refresh to retry/);
  await d.context.window.CorridorMapPanel.render(payload);
  assert.equal(attempts, 2);
  assert.equal(instances.length, 1);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Local flow is unavailable/);
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

test('default replay follows the latest retained data shared by both corridors', async () => {
  const requests = [];
  const d = dashboard(async url => {
    requests.push(url);
    const polledAt = url.includes('corridor=I70')
      ? '2026-06-19T02:50:00Z'
      : '2026-06-19T02:51:00Z';
    return { ok: true, json: async () => ({ polledAt }) };
  }, '?replay=1');

  await d.run('resolveDefaultReplayWindow()');
  assert.equal(d.run('new Date(REPLAY_CONFIG.end).toISOString()'), '2026-06-19T02:50:00.000Z');
  assert.equal(d.run('new Date(REPLAY_CONFIG.start).toISOString()'), '2026-06-18T21:50:00.000Z');
  assert.equal(requests.filter(url => url.includes('/traffic/latest?')).length, 2);
});

test('explicit replay bounds do not request a replacement window', async () => {
  let requests = 0;
  const d = dashboard(async () => { requests += 1; throw new Error('Unexpected request'); },
    '?replay=1&replayStart=2026-06-18T21%3A00%3A00Z&replayEnd=2026-06-18T22%3A00%3A00Z');
  await d.run('resolveDefaultReplayWindow()');
  assert.equal(requests, 0);
  assert.equal(d.run('new Date(REPLAY_CONFIG.start).toISOString()'), '2026-06-18T21:00:00.000Z');
});

test('travel time and worst segment use the current half-mile snapshot', () => {
  const d = dashboard();
  const current = new Date().toISOString();
  d.context.flowCells = {
    observedAt: current,
    totalCellCount: 2,
    supportedCellCount: 2,
    cells: [
      { cellId: 'fast', startMileMarker: 220, endMileMarker: 220.5, direction: 'COMBINED', speedMph: 60 },
      { cellId: 'slow', startMileMarker: 220.5, endMileMarker: 221, direction: 'COMBINED', speedMph: 30 },
      { cellId: 'slow', startMileMarker: 220.5, endMileMarker: 221, direction: 'SOUTHBOUND', speedMph: 5 }
    ]
  };
  d.context.current = current;
  assert.equal(d.run('estimateCorridorTravelMinutes(flowCells, 63, 42)'), 1.5);
  assert.equal(d.run('slowestCurrentCell(flowCells).cellId'), 'slow');
  assert.equal(d.run(`estimateCorridorTravelMinutes({observedAt: current, totalCellCount: 2,
    supportedCellCount: 1, cells: [flowCells.cells[0]]}, 60, 30)`), 120);
  d.context.zones = [
    { bucketStart: current, avgCurrentSpeed: 40, zoneLabel: 'latest' },
    { bucketStart: new Date(Date.now() - 60_000).toISOString(), avgCurrentSpeed: 10, zoneLabel: 'older' }
  ];
  assert.equal(d.run('slowestCurrentZone(zones, current).zoneLabel'), 'latest');

  d.run(`renderCorridorSummary('I25', {
    summary: {latest: {avgCurrentSpeed: 42, polledAt: current}},
    currentFlowCells: flowCells,
    zones: [], incidentThreads: [], incidentsAvailable: true
  })`);
  assert.equal(d.nodes.get('i25TravelTime').textContent, '2');
  assert.equal(d.nodes.get('i25FastestTravelTime').textContent, '2');
  assert.equal(d.nodes.get('i25SlowestTravelTime').textContent, '2');
  assert.equal(d.nodes.get('i25WorstMileMarker').textContent, 'MM 220.5–221');
  assert.equal(d.nodes.get('i25WorstSpeed').textContent, '30 mph');
  assert.match(indexSource, /Estimated Travel Time/);
  assert.doesNotMatch(indexSource, /Estimated Average Delay/);
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
  assert.equal(d.nodes.get('i25WorstSpeed').textContent, '53 mph');
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
  labels.length = 0;
  d.run('drawSpeedZoneDescriptor(ctx, group, baselineSeries, 0, 124, {ink:"black",muted:"gray"}, 92)');
  assert.ok(labels.includes('Live:'));
  labels.length = 0;
  d.run('chartHistory.endTime = Date.now(); drawSpeedZoneDescriptor(ctx, group, baselineSeries, 0, 124, {ink:"black",muted:"gray"}, 92)');
  assert.ok(labels.includes('Observed:'));
  assert.ok(!labels.includes('Live:'));
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
  assert.equal(d.run('demoRoute.dailyZones.length'), d.run('demoRoute.zones.length'));
  assert.equal(d.run('Number.isFinite(dailyTravelTimeRange(demoRoute, 68, 60).fastest)'), true);
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

test('incident page scrolling is combined into one update per animation frame', () => {
  const d = dashboard();
  const frames = [];
  const pageScrolls = [];
  d.context.window.requestAnimationFrame = callback => frames.push(callback);
  d.context.window.scrollBy = options => pageScrolls.push(options.top);

  d.run('queueIncidentPageScroll(8); queueIncidentPageScroll(14)');
  assert.equal(frames.length, 1);
  assert.deepEqual(pageScrolls, []);
  frames.shift()();
  assert.deepEqual(pageScrolls, [22]);

  d.run('queueIncidentPageScroll(-6)');
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(pageScrolls, [22, -6]);
});

test('short-range incident tables keep ongoing reports ahead of cleared reports', () => {
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
});

test('incident rows use specific CDOT details and show an observed duration', () => {
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
  assert.equal(lastSeenCell.children[2].textContent, 'Observed 1 hr 30 min');
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
  assert.equal(
    requests.filter(url => url.includes('/map/flow-cells/frequency?') && url.includes('windowHours=720')).length,
    2
  );
});

test('24-hour charts request enough compact observations to cover a one-minute cadence', async () => {
  const requests = [];
  const d = dashboard(async url => {
    requests.push(url);
    const json = url.includes('/summary?') ? { latest: { avgCurrentSpeed: 42 } }
      : url.includes('/zones/trends?') ? { points: [{ zoneKey: 'zone-history' }] }
      : url.includes('/zones/baselines?') ? { zones: [{ zoneKey: 'zone-baseline' }] }
      : url.includes('/trends?') ? { buckets: [] }
      : url.includes('/operational-status') ? {status: 'HEALTHY', checks: []}
      : url.includes('/actuator') ? {status: 'UP'}
      : url.includes('/history?') ? {samples: []} : {features: [], samples: []};
    return { ok: true, json: async () => json };
  });
  const data = await d.run('loadLiveDashboardData(24)');
  const detailRequests = requests.filter(url => url.includes('/history?') && url.includes('includeIncidents=false'));
  assert.equal(detailRequests.length, 2);
  assert.ok(detailRequests.every(url => url.includes('windowMinutes=1440') && url.includes('limit=1500')));
  assert.equal(
    requests.filter(url => url.includes('/zones/trends?') && url.includes('windowHours=24')).length,
    2
  );
  assert.equal(data.routeData.get('I25').dailyZones[0].zoneKey, 'zone-history');
  assert.equal(data.routeData.get('I25').zoneBaseline.zones[0].zoneKey, 'zone-baseline');
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
  assert.equal(
    requests.filter(url => url.includes('/zones/trends?') && url.includes('windowHours=24')).length,
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
  assert.equal(requests.filter(url => url.includes('/incidents/recent?')).length, 10);
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

test('sync status omits internal preload details', () => {
  const d = dashboard(undefined, '?demo=1');
  d.run(`dashboardData = buildDemoDashboardData();
    updateDashboardStatus(dashboardData, new Date('2026-09-28T13:00:00Z'));`);
  assert.match(d.nodes.get('statusText').textContent, /Syncs every 60 seconds/);
  assert.doesNotMatch(d.nodes.get('statusText').textContent, /All views preloaded/);
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

test('overlapping refresh requests do not queue another full sync', async () => {
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

test('a replay range change queues one refresh behind an active sync', async () => {
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
  await d.run('refreshDashboard({ queueIfBusy: true })');
  release();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(syncCount, 2);
  assert.equal(d.run('state.refreshing'), false);
});

test('manual refresh ignores click spam and remains on cooldown after completion', async () => {
  const d = dashboard();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let syncCount = 0;
  d.context.loader = async () => {
    syncCount += 1;
    await pending;
    return d.run('buildDemoDashboardSnapshots()');
  };
  d.run('loadLiveDashboardSnapshots = loader');
  d.run('requestManualRefresh()');
  for (let click = 0; click < 20; click += 1) d.run('requestManualRefresh()');
  assert.equal(syncCount, 1);
  assert.equal(d.nodes.get('refreshButton').disabled, true);
  release();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(syncCount, 1);
  assert.equal(d.nodes.get('refreshButton').disabled, true);
  d.run('state.manualRefreshTimer = null; updateRefreshButtonState()');
  assert.equal(d.nodes.get('refreshButton').disabled, false);
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
