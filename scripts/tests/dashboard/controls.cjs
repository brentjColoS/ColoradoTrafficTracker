const { test } = require('node:test');
const { assert, indexSource, corridorButtonFixture, dashboard } = require('../fixtures/core.cjs');
const { prepareChartHistory } = require('../fixtures/history.cjs');

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
