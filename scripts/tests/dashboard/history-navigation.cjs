const { test } = require('node:test');
const { dashboard, assert, indexSource, readFileSync, path } = require('../fixtures/core.cjs');
const { prepareChartHistory, clickHistoryRange, historyHoverClock } = require('../fixtures/history.cjs');
const { testDirectory } = require('../fixtures/core.cjs');

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
  const css=readFileSync(path.join(testDirectory,'../../api-service/src/main/resources/static/dashboard/dashboard.css'),'utf8');
  const release=css.match(/\.chart-history-navigation button,\s*\.range-control button,\s*\.chart-view-options button\s*\{([^}]+)\}/)[1];
  assert.doesNotMatch(release,/transition|animation|transform/);
  const pressed=css.match(/button\[data-history-pressed="true"\],\s*\.range-control button\[aria-pressed="true"\],\s*\.chart-view-options button\[aria-pressed="true"\]\s*\{([^}]+)\}/)[1];
  assert.match(pressed,/box-shadow: inset 0 2px 4px/);
  assert.doesNotMatch(pressed,/transition|animation|transform/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0\.01ms !important/);
});

test('sync status ends beside its button and can shrink without separating the pair', () => {
  const css = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard.css'), 'utf8');
  const status = css.match(/\.toolbar-status\s*\{([^}]+)\}/)[1];
  const text = css.match(/\.toolbar-status span\s*\{([^}]+)\}/)[1];
  assert.match(status, /flex-wrap: nowrap;/);
  assert.match(text, /text-align: right;/);
  assert.match(text, /min-width: 0;/);
  assert.match(css, /\.toolbar-status \.refresh-button\s*\{\s*flex: 0 0 auto;/);
});

test('dark mode preserves the original inset shape with a subtle inverted shadow and no extra edge', () => {
  const css = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard.css'), 'utf8');
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
    assert.equal(d.run("chartSeries.denverProfileKey(timestamp)"), `${day}|${Number(parts.hour)}`);
  }
  assert.equal(d.run("chartSeries.denverCalendarDay('2026-06-19T05:59:59Z')"), '2026-06-18');
  assert.equal(d.run("chartSeries.denverCalendarDay('2026-06-19T06:00:00Z')"), '2026-06-19');
  const first = d.run('chartSeries.denverHourParts(0)');
  assert.equal(d.run('chartSeries.denverHourParts(1)'), first, 'observations in one UTC hour reuse the same parts');
  d.run('for (let i=1;i<4096;i++) chartSeries.denverHourParts(i * 3600000)');
  assert.equal(d.run('chartSeries.denverHourParts(0)'), first, 'the 4096-hour working set remains reusable');
  d.run('chartSeries.denverHourParts(4096 * 3600000)');
  assert.notEqual(d.run('chartSeries.denverHourParts(0)'), first, 'an older hour is evicted when the bound is exceeded');
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
  assert.deepEqual(JSON.parse(d.run("JSON.stringify(chartSeries.buildLegacyBaselineSeries(source, timestamps))")), expected);
});

test('valid baseline profiles do not scan unused legacy observations', () => {
  const d = dashboard();
  d.run(`
    const oldLegacy = chartSeries.buildLegacyBaselineSeries;
    chartSeries.buildLegacyBaselineSeries = (buckets, timestamps) => {
      if (timestamps.length) throw Error('Unused fallback scan');
      return oldLegacy(buckets, timestamps);
    };
    const profiles = Array.from({length:168}, (_,i) => ({dayOfWeek:Math.floor(i/24)+1,hourOfDay:i%24,meanSpeed:65,standardDeviation:3}));
    chartSeries.buildBaselineSeries([], Date.parse('2026-06-01T00:00:00Z'), Date.parse('2026-06-30T00:00:00Z'), profiles);
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
    chartPainter.drawCorridorChart = (canvas, corridor) => drawn.push(corridor);
    chartPainter.drawZoneChart = (canvas, corridor) => drawn.push(corridor + '-zones');
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
  d.run("state.focusedCorridor='I25';state.chartView='zones';panHistoryWindow(3600000);sizeCanvas=()=>({width:800,height:1028});drawEmptyChart=()=>{};chartPainter.drawZoneChart(canvas,'I25',null)");
  assert.deepEqual(changes,[]);
  d.run("chartHistory.dataKey=historyWindowKey();chartPainter.drawZoneChart(canvas,'I25',null)");
  assert.deepEqual(changes,['280px']);
});
