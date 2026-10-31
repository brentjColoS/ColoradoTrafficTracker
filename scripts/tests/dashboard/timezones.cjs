const { test } = require('node:test');
const { dashboard, assert, timezoneDashboard } = require('../fixtures/core.cjs');
const { prepareChartHistory } = require('../fixtures/history.cjs');

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
    for (const hours of [2,6,24]) assert.equal(d.run(`chartAxis.formatChartTime(Date.parse('2026-09-10T19:00:00Z'),${hours})`), clock);
    const days = d.run("chartAxis.displayDayTransitions(Date.parse('2026-09-10T12:00:00Z'),Date.parse('2026-09-11T12:00:00Z'))");
    assert.deepEqual(Array.from(days), [Date.parse(midnight)]);
    const ticks = d.run("chartAxis.buildTimeAxisTicks(Date.parse('2026-09-10T12:00:00Z'),Date.parse('2026-09-17T12:00:00Z'),720)");
    const guide = ticks.find(tick => tick.timestamp === Date.parse(midnight));
    assert.ok(guide?.guide, zone);
    assert.equal(guide.horizontalPosition, 720 * (Date.parse(midnight) - Date.parse('2026-09-10T12:00:00Z')) / (168 * 3_600_000));
  }
});

test('local day guides handle a timezone whose daylight saving transition skips midnight', () => {
  const d = timezoneDashboard('America/Santiago');
  const days = d.run("chartAxis.displayDayTransitions(Date.parse('2026-09-05T12:00:00Z'),Date.parse('2026-09-07T12:00:00Z'))");
  assert.deepEqual(Array.from(days), [Date.parse('2026-09-06T04:00:00Z'),Date.parse('2026-09-07T03:00:00Z')]);
});

test('visitor timezones leave Colorado baseline and daily travel semantics unchanged', () => {
  for (const zone of ['America/Denver','America/New_York','Asia/Kathmandu','Pacific/Auckland']) {
    const d = timezoneDashboard(zone);
    assert.equal(d.run("chartSeries.denverProfileKey('2026-06-19T02:00:00Z')"), '4|20');
    assert.equal(d.run("chartSeries.denverCalendarDay('2026-06-19T02:00:00Z')"), '2026-06-18');
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
  d.run("chartAxis.displayDayTransitions(0,720*3600000)");
  const size = d.run('DISPLAY_TIME_FORMATTERS.size');
  d.run("for(let i=0;i<10;i++)chartAxis.displayDayTransitions(0,720*3600000)");
  assert.equal(d.run('DISPLAY_TIME_FORMATTERS.size'), size);
  let formatted = 0;
  d.context.countedFormatter = options => {
    const formatter = new Intl.DateTimeFormat('en-US', {...options, timeZone: 'Asia/Kathmandu'});
    return {format(date) { formatted++; return formatter.format(date); }};
  };
  d.run('axisProbe = window.DashboardChartAxis.create({displayTimeFormatter: countedFormatter}); axisProbe.displayDayTransitions(0,4094*3600000)');
  const filled = formatted;
  d.run('axisProbe.displayDayTransitions(0,0)');
  assert.equal(formatted, filled, 'a retained day-boundary lookup needs no formatting');
  d.run('axisProbe.displayDayTransitions(4095*3600000,4096*3600000)');
  const advanced = formatted;
  d.run('axisProbe.displayDayTransitions(0,0)');
  assert.ok(formatted > advanced, 'the oldest lookup is recomputed after the 4096-hour cache bound');
});
