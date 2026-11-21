const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(readFileSync(path.join(__dirname,
  '../../api-service/src/main/resources/static/dashboard/traffic-estimates.js'), 'utf8'), {window});
const estimate = window.TrafficEstimates.estimateSpeedZoneTravelMinutes;
const zone = (start, end, speed = 60) => ({startMileMarker:start, endMileMarker:end, avgCurrentSpeed:speed});

test('zone travel adds distance over speed without changing the input order or values', () => {
  const zones = Object.freeze([Object.freeze(zone(3, 1)), Object.freeze(zone(1, 0, 30))]);
  assert.equal(estimate(zones, 3), 4);
});

test('zone travel counts the last report once by identity or matching geometry', () => {
  assert.equal(estimate([{...zone(0, 1, 30), zoneKey:'a'}, {...zone(0, 1), zoneKey:'a'}], 1), 1);
  assert.equal(estimate([zone(0, 1, 30), zone(1, 0)], 1), 1);
});

test('zone travel requires complete coverage without gaps, overlaps or a wrong corridor span', () => {
  for (const zones of [[zone(0, 1), zone(1.1, 2.1)], [zone(0, 1.5), zone(1, 2)], [zone(0, 1)]]) {
    assert.ok(Number.isNaN(estimate(zones, 2)));
  }
  assert.ok(Math.abs(estimate([zone(0, 1), zone(1.01, 2)], 2) - 1.99) < 1e-12);
});

test('zone travel retains unavailable results for missing markers or unusable speeds', () => {
  for (const value of [null, undefined, '', NaN, Infinity]) {
    assert.ok(Number.isNaN(estimate([zone(value, 1)], 1)));
    assert.ok(Number.isNaN(estimate([zone(0, value)], 1)));
    assert.ok(Number.isNaN(estimate([{...zone(0, 1), avgCurrentSpeed:value}], 1)));
  }
  for (const speed of [0, -1]) assert.ok(Number.isNaN(estimate([zone(0, 1, speed)], 1)));
  assert.equal(estimate([zone(0, 1), zone(null, 2)], 1), 1);
});

test('zone travel rejects invalid corridor distances and empty observations', () => {
  for (const distance of [null, undefined, '', '1', 0, -1, NaN, Infinity]) {
    assert.ok(Number.isNaN(estimate([zone(0, 1)], distance)));
  }
  for (const zones of [null, undefined, {}, []]) assert.ok(Number.isNaN(estimate(zones, 1)));
});
