const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard.js'), 'utf8');
const mapSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/corridor-map.js'), 'utf8');
const indexSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/index.html'), 'utf8');
const informationSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/information-pages.js'), 'utf8');
const informationPages = Object.fromEntries(['system', 'data', 'api'].map(name => [
  name,
  readFileSync(path.join(__dirname, `../../api-service/src/main/resources/static/dashboard/${name}.html`), 'utf8')
]));
function dashboard(fetch = async () => { throw new Error('Offline'); }, search = '', pathname = '/dashboard/') {
  const nodes = new Map();
  function node() {
    return { textContent: '', style: {}, dataset: {}, children: [], attributes: {},
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      addEventListener() {}, querySelector() { return node(); }, querySelectorAll() { return []; } };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const context = vm.createContext({ URLSearchParams, URL, AbortSignal, console, Date, Intl,
    window: { location: { search, pathname }, fetch, requestAnimationFrame() {},
      localStorage: { getItem() { throw new Error('Blocked'); } } },
    document: { getElementById: get, createElement: node, createElementNS: node, querySelector: () => null,
      querySelectorAll: () => [], documentElement: node(), body: node() } });
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

function informationPage(fetch = async () => { throw new Error('Offline'); }, pathname = '/dashboard/system.html') {
  const nodes = new Map();
  function node(tagName = 'div') {
    return { tagName, textContent: '', className: '', dataset: {}, attributes: {}, children: [], disabled: false,
      appendChild(child) { this.children.push(child); return child; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener() {} };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const context = vm.createContext({ console, Date, Intl, Number, String,
    window: { location: { pathname }, fetch, localStorage: { getItem() { return null; }, setItem() {} } },
    document: { getElementById: get, createElement: node, createTextNode: text => ({ textContent: text }),
      documentElement: node('html') } });
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

test('information pages retain bounded and accurate data contracts', () => {
  assert.match(informationPages.data, /Mile markers 208–271/);
  assert.match(informationPages.data, /Mile markers 206–259/);
  assert.match(informationPages.data, /combined-direction view/);
  assert.match(informationPages.data, /since midnight in Denver/);
  assert.match(informationPages.api, /These reads do not trigger new TomTom or CDOT requests/);
  assert.match(informationPages.api, /\/dashboard-api\/system\/operational-status/);
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
  assert.equal(page.nodes.get('systemSummary').textContent, 'One check needs attention.');
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
  assert.match(page.nodes.get('operationalChecks').children[0].textContent, /HTTP 503/);
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

test('all incidents expand beyond three, and provider text stays text', () => {
  const d = dashboard();
  d.context.features = Array.from({ length: 5 }, (_, i) => event({ providerEventId: String(i), locationLabel: '<img onerror=alert(1)>' }));
  d.run("state.routeData.set('I25', buildRouteData('I25', {}, {}, {features})); renderDashboard()");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 3);
  d.run("state.expandedIncidents.add('I25'); renderDashboard()");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 5);
  assert.match(d.nodes.get('i25IncidentRows').children[0].children[1].children[0].textContent, /<img onerror/);
});

test('two and six hour incident tables collapse to ongoing events', () => {
  const d = dashboard();
  d.context.features = [
    event({ providerEventId: 'ongoing', active: true, locationLabel: 'Ongoing report' }),
    event({ providerEventId: 'ended-one', active: false, locationLabel: 'Recent report one' }),
    event({ providerEventId: 'ended-two', active: false, locationLabel: 'Recent report two' })
  ];
  d.run("state.selectedHours = 2; state.routeData.set('I25', buildRouteData('I25', {}, {}, {features})); renderIncidentTable('I25', state.routeData.get('I25').incidentThreads)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 1);
  assert.equal(d.nodes.get('i25IncidentRows').children[0].children[1].children[0].textContent, 'MP 225 · Ongoing report');

  d.run("state.expandedIncidents.add('I25'); renderIncidentTable('I25', state.routeData.get('I25').incidentThreads)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 3);
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
      : url.includes('/trends?') ? { buckets: [] }
      : url.includes('/operational-status') ? {status: 'HEALTHY', checks: []}
      : url.includes('/actuator') ? {status: 'UP'}
      : url.includes('/history?') ? {samples: []} : {features: [], samples: []};
    return { ok: true, json: async () => json };
  });
  await d.run('loadLiveDashboardData(24)');
  const detailRequests = requests.filter(url => url.includes('/history?') && url.includes('includeIncidents=false'));
  assert.equal(detailRequests.length, 2);
  assert.ok(detailRequests.every(url => url.includes('windowMinutes=1440') && url.includes('limit=1500')));
  assert.equal(
    requests.filter(url => url.includes('/zones/trends?') && url.includes('windowHours=24')).length,
    2
  );
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

test('rapid range change queues a new request and never commits the superseded response', async () => {
  const d = dashboard();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const ranges = [];
  d.context.loader = async hours => {
    ranges.push(hours);
    if (hours === 24) await pending;
    return d.run('buildDemoDashboardData()');
  };
  d.run('loadLiveDashboardData = loader');
  const first = d.run('refreshDashboard()');
  d.run('state.selectedHours = 720');
  await d.run('refreshDashboard()');
  release();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ranges, [24, 720]);
  assert.equal(d.run('state.refreshing'), false);
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
