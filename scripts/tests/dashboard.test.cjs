const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard.js'), 'utf8');
const estimatesSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/traffic-estimates.js'), 'utf8');
const indexSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/index.html'), 'utf8');
const mapSource = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/corridor-map.js'), 'utf8');
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
      setTimeout() { return 1; }, clearTimeout() {},
      localStorage: { getItem() { throw new Error('Blocked'); } } },
    document: { getElementById: get, createElement: node, createElementNS: node, querySelector: () => null,
      querySelectorAll: () => [], documentElement: node(), body: node() } });
  vm.runInContext(estimatesSource, context);
  vm.runInContext(source.replace('\ninitializeDashboard();', ''), context);
  return { nodes, context, run: code => vm.runInContext(code, context) };
}
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

test('information pages retain bounded and accurate data contracts', () => {
  assert.match(informationPages.data, /Mile markers 208–271/);
  assert.match(informationPages.data, /Mile markers 206–259/);
  assert.match(informationPages.data, /combined-direction view/);
  assert.match(informationPages.api, /These reads do not trigger new TomTom or CDOT requests/);
  assert.match(informationPages.api, /\/dashboard-api\/system\/operational-status/);
});

test('system page describes the implemented architecture without overstating it', () => {
  const system = informationPages.system;
  assert.match(system, /3<\/strong><span>application services/);
  assert.match(system, /0\.5 mi<\/strong><span>corridor traffic grid/);
  assert.match(system, /Routes Service/);
  assert.match(system, /Traffic flow/);
  assert.match(system, /Incident events/);
  assert.match(system, /Incidents are modeled as events, not snapshots/);
  assert.match(system, /Failed or incomplete provider cycles do not replace the previous complete snapshot/);
  assert.match(system, /PostgreSQL \/ TimescaleDB/);
  assert.match(system, /local-linear forecasts/);
  assert.match(system, /Same deployable · deliberately separated API contract/);
  assert.match(system, /No Kubernetes or separately deployed frontend is implied/);
  assert.doesNotMatch(system, /machine.learning/i);
  assert.doesNotMatch(system, /Kafka/);
});

test('system architecture focus traces the related data path', () => {
  function item(flow, focusable = false) {
    const classes = new Set();
    return { dataset: { architectureFlow: flow }, tabIndex: focusable ? 0 : undefined, events: {},
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        toggle(name, force) { force === false ? classes.delete(name) : classes.add(name); },
        contains(name) { return classes.has(name); }
      },
      addEventListener(name, handler) { this.events[name] = handler; },
      matches(selector) { return selector === '[tabindex]' && this.tabIndex !== undefined; } };
  }
  const trafficPipeline = item('flow storage delivery', true);
  const database = item('flow incident storage delivery', true);
  const incidentPipeline = item('incident storage delivery', true);
  const page = informationPage(undefined, '/dashboard/system.html', [trafficPipeline, database, incidentPipeline]);
  page.run('initializeArchitectureHighlights()');

  trafficPipeline.events.focus();
  assert.equal(page.nodes.get('systemArchitecture').classList.contains('has-active-flow'), true);
  assert.equal(database.classList.contains('is-related'), true);
  assert.equal(incidentPipeline.classList.contains('is-related'), false);
  assert.equal(incidentPipeline.classList.contains('is-muted'), true);

  trafficPipeline.events.blur();
  assert.equal(page.nodes.get('systemArchitecture').classList.contains('has-active-flow'), false);
  assert.equal(database.classList.contains('is-related'), false);
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

test('information health loads only the matching retained-data endpoint and releases refresh', async () => {
  const reads = [];
  const page = informationPage(async (url, options) => {
    reads.push({ url, options });
    return { ok: true, json: async () => ({ status: 'HEALTHY', summary: 'Recent observations.', checks: [] }) };
  }, '/dashboard-experimental/system.html');
  await page.run('loadOperationalStatus()');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].url, '/dashboard-experimental-api/system/operational-status');
  assert.equal(reads[0].options.method, undefined);
  assert.equal(reads[0].options.headers.Accept, 'application/json');
  assert.equal(page.nodes.get('systemOverview').dataset.status, 'HEALTHY');
  assert.equal(page.nodes.get('systemSummary').textContent, 'Recent observations.');
  assert.equal(page.nodes.get('statusRefresh').disabled, false);
});

test('failed information health requests remain retryable without reporting a traffic outage', async () => {
  const page = informationPage(async () => ({ ok: false, status: 503 }));
  await page.run('loadOperationalStatus()');
  assert.equal(page.nodes.get('systemOverview').dataset.status, 'UNAVAILABLE');
  assert.match(page.nodes.get('systemSummary').textContent, /does not by itself mean traffic ingestion is down/);
  assert.equal(page.nodes.get('statusRefresh').disabled, false);
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

test('uses relative dashboard assets under both public paths', () => {
  assert.doesNotMatch(indexSource, /(?:href|src)="\/dashboard\//);
  assert.match(mapSource, /import\("\.\/vendor\/maplibre-gl\/6\.10\.0\/maplibre-gl\.mjs"\)/);
});

test('inactive traffic map legend items remain hidden despite flex styling', () => {
  const css = readFileSync(path.join(__dirname, '../../api-service/src/main/resources/static/dashboard/dashboard.css'), 'utf8');
  assert.match(css, /\.corridor-map-key\s+\[hidden\]\s*\{\s*display:\s*none/);
});

test('routes reads through the matching production or experimental prefix', () => {
  const production = dashboard();
  assert.equal(production.run('DASHBOARD_RUNTIME.experimental'), false);
  assert.equal(production.run('DASHBOARD_RUNTIME.healthPath'), '/actuator/health');
  assert.equal(production.run("dashboardApi('/traffic/corridors')"), '/dashboard-api/traffic/corridors');
  for (const pathname of ['/dashboard-experimental', '/dashboard-experimental/', '/dashboard-experimental/index.html']) {
    const experimental = dashboard(undefined, '', pathname);
    assert.equal(experimental.run('DASHBOARD_RUNTIME.experimental'), true);
    assert.equal(experimental.run('DASHBOARD_RUNTIME.healthPath'), '/dashboard-experimental-health');
    assert.equal(experimental.run("dashboardApi('traffic/corridors')"), '/dashboard-experimental-api/traffic/corridors');
  }
  assert.equal(dashboard(undefined, '', '/dashboard-experimental-other/').run('DASHBOARD_RUNTIME.experimental'), false);
  assert.equal(dashboard(undefined, '?replay=1').run('REPLAY_MODE'), true);
  assert.equal(dashboard(undefined, '?replay=1', '/dashboard-experimental/').run('REPLAY_MODE'), false);
});

test('experimental refresh cannot read production API routes', async () => {
  const requests = [];
  const d = dashboard(async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ status: 'UP', features: [] }) };
  }, '', '/dashboard-experimental/');
  await d.run('loadLiveDashboardData(24)');
  assert.equal(requests.length, 19);
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/map/flow-cells/current?corridor=I25'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/map/flow-cells/current?corridor=I70'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/analytics/baselines?corridor=I25'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/analytics/baselines?corridor=I70'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/zones/baselines?corridor=I25'));
  assert.ok(requests.includes('/dashboard-experimental-api/traffic/zones/baselines?corridor=I70'));
  assert.ok(requests.includes('/dashboard-experimental-health'));
  assert.ok(requests.every(url => url === '/dashboard-experimental-health' || url.startsWith('/dashboard-experimental-api/')));
});

function corridorMap(rendererLoader) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: id === 'corridorMapPanel', textContent: '', title: '' });
    return nodes.get(id);
  };
  const attributionButton = { dataset: {}, listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; } };
  const attributionDetails = {
    open: true, compactShow: true, initiallyCollapsed: false, dataset: {},
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
    querySelector: () => attributionButton,
    removeAttribute(key) { if (key === 'open') this.open = false; },
    setAttribute(key) { if (key === 'open') this.open = true; }
  };
  get('corridorMap').querySelector = selector => selector === '.maplibregl-ctrl-attrib' ? attributionDetails : null;
  const window = {
    CORRIDOR_MAP_RENDERER_LOADER: rendererLoader,
    location: { pathname: '/dashboard/' },
    setTimeout,
    clearTimeout
  };
  const context = vm.createContext({
    console, URL, AbortSignal,
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
  return { nodes, context, attributionDetails, attributionButton };
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
    once(event, callback) { this.listeners.set(event, callback); }
    loaded() { return false; }
    isStyleLoaded() { return true; }
    getSource(id) { return this.sources.get(id); }
    getLayer() { return true; }
    getCanvas() { return this.canvas; }
    getZoom() { return this.zoom; }
    queryRenderedFeatures() { return this.renderedFeatures || []; }
    setPaintProperty(layer, property, value) {
      this.paintChanges ||= [];
      this.paintChanges.push({ layer, property, value });
    }
    remove() { this.removed = true; }
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

test('map preloading warms one module without hidden WebGL or basemap reads', async () => {
  const instances=[];
  let loads=0,reads=0;
  const d=corridorMap(async()=>{loads++;return fakeMapRenderer(instances);});
  d.context.window.fetch=async()=>{reads++;return {ok:false};};
  await Promise.all([d.context.window.CorridorMapPanel.preload(),d.context.window.CorridorMapPanel.preload()]);
  assert.equal(loads,1);
  assert.equal(instances.length,0);
  assert.equal(reads,0);
  assert.equal(d.nodes.get('corridorMapPanel').hidden,true);
  await d.context.window.CorridorMapPanel.render({corridor:'I25',corridorFeature:{type:'Feature',properties:{},
    geometry:{type:'LineString',coordinates:[[-105,39.7],[-104.9,40.1]]}},incidentFeatures:[]});
  assert.equal(loads,1);
  assert.equal(instances.length,1);
});

test('failed module warm-up can retry on a focused map render', async () => {
  const instances=[],attempts=[];
  const d=corridorMap(async attempt=>{
    attempts.push(attempt);
    if(attempt===0)throw new Error('Transient module failure');
    return fakeMapRenderer(instances);
  });
  await d.context.window.CorridorMapPanel.preload();
  assert.equal(instances.length,0);
  await d.context.window.CorridorMapPanel.render({corridor:'I25',corridorFeature:{type:'Feature',properties:{},
    geometry:{type:'LineString',coordinates:[[-105,39.7],[-104.9,40.1]]}},incidentFeatures:[]});
  assert.deepEqual(attempts,[0,1]);
  assert.equal(instances.length,1);
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
  assert.equal(JSON.stringify(instances[0].bounds), JSON.stringify([[-105.2, 39.6], [-104.8, 40.7]]));
  assert.equal(instances[0].sources.get('corridor-route').data.features.length, 1);
  assert.equal(instances[0].sources.get('corridor-incidents').data.features.length, 1);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /1 mapped CDOT report/);
  assert.equal(instances[0].sources.get('corridor-traffic').data.features.length, 0);
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

test('optional basemap configuration has a bounded timeout and uses the matching API prefix', async () => {
  for (const pathname of ['/dashboard/', '/dashboard-experimental/']) {
    const instances = [];
    const d = corridorMap(async () => fakeMapRenderer(instances));
    d.context.window.location.pathname = pathname;
    const signals = [];
    d.context.AbortSignal = { timeout(milliseconds) {
      assert.equal(milliseconds, 3000);
      const signal = { configuredTimeout: milliseconds };
      signals.push(signal);
      return signal;
    } };
    const requests = [];
    d.context.window.fetch = async (url, options) => {
      requests.push(url);
      assert.equal(options.signal, signals[0]);
      assert.equal(options.cache, 'no-store');
      throw new DOMException('Configuration timed out', 'TimeoutError');
    };
    await d.context.window.CorridorMapPanel.render({
      corridor: 'I25', corridorFeature: { type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: [[-105, 39], [-105, 40]] } },
      incidentFeatures: []
    });
    assert.deepEqual(requests, [pathname.includes('experimental')
      ? '/dashboard-experimental-api/map/config' : '/dashboard-api/map/config']);
    assert.equal(instances.length, 1);
    assert.match(instances[0].options.style.sources['base-map'].tiles[0], /nationalmap/);
    assert.match(d.nodes.get('corridorMapStatus').textContent, /Local flow is unavailable/);
  }
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
  assert.match(indexSource, /Frequent near-stops/);
  assert.match(indexSource, /Low slowdown rate/);
  assert.match(indexSource, /Very high slowdown rate/);

  instances[0].listeners.get('click:corridor-traffic')({
    lngLat: { lng: -105, lat: 39.995 }, features: [traffic[0]]
  });
  assert.match(popups[0].content.children[0].textContent, /High slowdown rate/);
  assert.match(popups[0].content.children[1].textContent, /12 of 24 sampled hours/);
  assert.match(popups[0].content.children[3].textContent, /24 of 168 requested hours available/);
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I25', selectedHours: 24,
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-105,39.99],[-105,40]] } },
    incidentFeatures: [], flowCells: null
  });
  assert.equal(d.nodes.get('currentLegend').hidden, false);
  assert.equal(d.nodes.get('frequencyLegend').hidden, true);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Local flow is unavailable for this time/);
});

+test('long-range maps replace event clouds with the five busiest one-mile hotspots', async () => {
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
    point: { x: 10, y: 10 }, lngLat: { lng: -105, lat: 40 },
    features: [{ geometry: { type: 'LineString', coordinates: [[-105, 39.99], [-105, 40]] },
      properties: { resolution: 'SLOWDOWN_FREQUENCY' } }]
  });
  assert.equal(popups.length, 1);
  instances[0].listeners.get('click:corridor-incidents')({ features: [hotspots[2]] });
  assert.match(popups[1].content.children[0].textContent, /^1 incident ·/);
  assert.equal(popups[0].removed, true);
  d.context.window.CorridorMapPanel.hide();
  assert.equal(popups[1].removed, true);
});

test('unavailable long-range flow shows a neutral route and no fabricated slowdown data', async () => {
  const instances = [];
  const d = corridorMap(async () => fakeMapRenderer(instances));
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I70', selectedHours: 720,
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-106,39.6],[-105,39.8]] } },
    incidentFeatures: [], flowCells: null
  });
  assert.equal(instances[0].sources.get('corridor-traffic').data.features.length, 0);
  assert.equal(instances[0].sources.get('corridor-route').data.features.length, 1);
  assert.match(d.nodes.get('corridorMapSubtitle').textContent, /30 days/);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Slowdown history is unavailable for this range/);
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
  assert.match(failed.nodes.get('corridorMapStatus').textContent, /Select Sync now to retry/);
});

test('corridor map retries after a transient renderer startup failure', async () => {
  const instances = [];
  let attempts = 0;
  const d = corridorMap(async attempt => {
    assert.equal(attempt, attempts);
    if (++attempts === 1) throw new Error('Renderer temporarily unavailable');
    return fakeMapRenderer(instances);
  });
  const payload = { corridor: 'I70', corridorFeature: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[-106, 39.6], [-105, 39.8]] } },
    incidentFeatures: [] };
  await d.context.window.CorridorMapPanel.render(payload);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Select Sync now to retry/);
  await d.context.window.CorridorMapPanel.render(payload);
  assert.equal(attempts, 2);
  assert.equal(instances.length, 1);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Local flow is unavailable/);
});

test('renderer network retries are bounded before requiring a page reload', async () => {
  const attempts = [];
  const d = corridorMap(async attempt => { attempts.push(attempt); throw new Error('Offline'); });
  const payload = { corridor: 'I25', corridorFeature: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[-105, 39], [-105, 40]] } }, incidentFeatures: [] };
  for (let index = 0; index < 5; index++) await d.context.window.CorridorMapPanel.render(payload);
  assert.deepEqual(attempts, [0,1,2,2,2]);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /reload if startup still fails/);
});

test('failed partial map startup is removed before a fresh attempt', async () => {
  const instances = [];
  const module = fakeMapRenderer(instances);
  const OriginalMap = module.default.Map;
  module.default.Map = class extends OriginalMap {
    addControl() { if (instances.length === 1) throw new Error('Control initialization failed'); }
  };
  let moduleLoads = 0;
  const d = corridorMap(async () => { moduleLoads += 1; return module; });
  const payload = { corridor: 'I25', corridorFeature: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[-105, 39], [-105, 40]] } }, incidentFeatures: [] };
  await d.context.window.CorridorMapPanel.render(payload);
  assert.equal(instances[0].removed, true);
  await d.context.window.CorridorMapPanel.render(payload);
  assert.equal(instances.length, 2);
  assert.equal(moduleLoads, 1);
  assert.equal(instances[1].sources.get('corridor-route').data.features.length, 1);
});

test('style-ready route context does not wait for raster load and retains imagery failures across refresh', async () => {
  const instances = [];
  const module = fakeMapRenderer(instances);
  const OriginalMap = module.default.Map;
  module.default.Map = class extends OriginalMap {
    isStyleLoaded() { return this.styleReady || false; }
    once(event, callback) {
      assert.equal(event, 'style.load');
      this.listeners.get('error')({ sourceId: 'base-map' });
      this.styleReady = true;
      callback();
    }
  };
  const d = corridorMap(async () => module);
  const payload = { corridor: 'I70', corridorFeature: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[-106, 39.6], [-105, 39.8]] } }, incidentFeatures: [] };
  await d.context.window.CorridorMapPanel.render(payload);
  assert.equal(instances[0].loaded(), false);
  assert.equal(instances[0].sources.get('corridor-route').data.features.length, 1);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /tiles could not load.*Reload to retry/);
  await d.context.window.CorridorMapPanel.render(payload);
  assert.equal(instances.length, 1);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /tiles could not load.*Local flow is unavailable/);
  d.context.window.CorridorMapPanel.setTheme('dark');
  assert.ok(instances[0].paintChanges.some(change =>
    change.layer === 'map-background' && change.value === '#17221c'));
});

test('changing corridor or timeframe removes a popup from the previous map context', async () => {
  const instances = [];
  const popups = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, popups));
  const payload = { corridor: 'I25', selectedHours: 24, corridorFeature: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[-105, 39], [-105, 40]] } }, incidentFeatures: [] };
  const incident = { features: [{ geometry: { type: 'Point', coordinates: [-105, 40] },
    properties: { incidentTypeLabel: 'Crash', locationLabel: 'MM 220', active: true } }] };
  await d.context.window.CorridorMapPanel.render(payload);
  instances[0].listeners.get('click:corridor-incidents')(incident);
  await d.context.window.CorridorMapPanel.render({...payload, corridor: 'I70'});
  assert.equal(popups[0].removed, true);
  instances[0].listeners.get('click:corridor-incidents')(incident);
  await d.context.window.CorridorMapPanel.render({...payload, corridor: 'I70', selectedHours: 168});
  assert.equal(popups[1].removed, true);
});

test('attribution stays initially collapsed without observers and opens on its button', async () => {
  const d = corridorMap(async () => fakeMapRenderer([]));
  d.context.window.MutationObserver = class {
    constructor() { throw new Error('No attribution DOM observer should be installed'); }
  };
  await d.context.window.CorridorMapPanel.render({ corridor: 'I25',
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-105, 39], [-105, 40]] } },
    incidentFeatures: [] });
  assert.equal(d.attributionDetails.initiallyCollapsed, true);
  assert.equal(d.attributionDetails.open, false);
  let prevented = false;
  d.attributionButton.listeners.click({ preventDefault() { prevented = true; } });
  assert.equal(d.attributionDetails.initiallyCollapsed, false);
  assert.equal(d.attributionDetails.open, true);
  assert.equal(d.attributionDetails.compactShow, true);
  assert.equal(prevented, true);
});

test('hourly map reports the observation time rather than a later bucket boundary', async () => {
  const d = corridorMap(async () => fakeMapRenderer([]));
  await d.context.window.CorridorMapPanel.render({
    corridor:'I25',
    corridorFeature:{type:'Feature',properties:{startMileMarker:220,endMileMarker:221,
      speedLimitSegments:[{startMileMarker:220,endMileMarker:221,speedLimitMph:60}]},
      geometry:{type:'LineString',coordinates:[[-105,39.99],[-105,40]]}},
    flowCells:{corridor:'I25',resolution:'HOURLY',hourEnd:'2026-09-23T20:00:00Z',
      cells:[{cellId:'I25:220.000-221.000',startMileMarker:220,endMileMarker:221,
        direction:'COMBINED',avgSpeedMph:50,fullCellObservationCount:60,
        lastObservedAt:'2026-09-23T19:41:00Z'}]},
    incidentFeatures:[]
  });
  assert.match(d.nodes.get('corridorMapStatus').textContent, /^Hourly traffic observed/);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /1:41 PM MDT/);
  assert.doesNotMatch(d.nodes.get('corridorMapStatus').textContent, /2:00 PM MDT/);
});

test('imagery failure retains route context and provider popup content stays text', async () => {
  const instances = [];
  const popups = [];
  const d = corridorMap(async () => fakeMapRenderer(instances, popups));
  await d.context.window.CorridorMapPanel.render({
    corridor: 'I70',
    corridorFeature: { type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-106, 39.6], [-105, 39.8]] } },
    incidentFeatures: []
  });
  instances[0].listeners.get('error')({ sourceId: 'base-map' });
  assert.match(d.nodes.get('corridorMapStatus').textContent, /imagery tiles could not load.*Reload to retry/);
  assert.equal(instances[0].sources.get('corridor-route').data.features.length, 1);
  const malicious = '<img src=x onerror=alert(1)>';
  instances[0].listeners.get('click:corridor-incidents')({ features: [{
    geometry: { type: 'Point', coordinates: [-105, 39.8] },
    properties: { incidentTypeLabel: malicious, locationLabel: malicious }
  }] });
  assert.equal(popups[0].content.children[0].textContent, malicious);
  assert.equal(popups[0].content.children[1].textContent, malicious);
  assert.equal(popups[0].content.children[0].tagName, 'strong');
  await d.context.window.CorridorMapPanel.render({ corridor: 'I70' });
  assert.equal(instances[0].sources.get('corridor-route').data.features.length, 0);
  assert.match(d.nodes.get('corridorMapStatus').textContent, /Route geometry is unavailable/);
  assert.doesNotMatch(d.nodes.get('corridorMapStatus').textContent, /route and traffic remain available/);
});

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
  assert.equal(data.routeData.get('I25').incidentThreads[0].type, 'Disabled Vehicle');
  assert.equal(data.routeData.get('I25').incidentThreads[0].ongoing, true);
  d.context.buckets = data.routeData.get('I25').trend.buckets;
  assert.equal(d.run("selectDisplayBuckets(buckets, 24, Date.parse('2026-06-19T02:51:46Z')).length"), 1);
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

test('default replay uses the latest window shared by both corridors', async () => {
  const d=dashboard(undefined,'?replay=1');
  const requests=[];
  d.context.request=async path=>{
    requests.push(path);
    return {polledAt:path.includes('I25')?'2026-10-07T12:00:00Z':'2026-10-07T11:55:00Z'};
  };
  await d.run('resolveDefaultReplayWindow(request)');
  assert.equal(d.run('REPLAY_CONFIG.end'),Date.parse('2026-10-07T11:55:00Z'));
  assert.equal(d.run('REPLAY_CONFIG.end-REPLAY_CONFIG.start'),5*3600000);
  assert.deepEqual(requests.sort(),[
    '/dashboard-api/traffic/latest?corridor=I25&preferUsable=true',
    '/dashboard-api/traffic/latest?corridor=I70&preferUsable=true']);
});

test('default replay keeps safe bounds when either latest observation is missing or invalid', async () => {
  for(const bad of [null,{}, {polledAt:'invalid'}, {polledAt:'1970-01-01T00:00:00Z'},new Error('Unavailable')]) {
    const d=dashboard(undefined,'?replay=1');
    const original=d.run('JSON.stringify(REPLAY_CONFIG)');
    d.context.request=async path=>{
      if(path.includes('I25'))return {polledAt:'2026-10-07T12:00:00Z'};
      if(bad instanceof Error)throw bad;
      return bad;
    };
    await d.run('resolveDefaultReplayWindow(request)');
    assert.equal(d.run('JSON.stringify(REPLAY_CONFIG)'),original);
  }
});

test('explicit replay bounds and non-replay modes never perform default-window reads', async () => {
  for(const [search,path] of [
    ['?replay=1&replayStart=2026-10-01T00:00:00Z','/dashboard/'],
    ['?replay=1&replayEnd=2026-10-01T00:00:00Z','/dashboard/'],
    ['', '/dashboard/'], ['?replay=1','/dashboard-experimental/']]) {
    const d=dashboard(undefined,search,path);
    const original=d.run('JSON.stringify(REPLAY_CONFIG)');
    d.context.request=()=>{throw new Error('Unexpected latest read');};
    await d.run('resolveDefaultReplayWindow(request)');
    assert.equal(d.run('JSON.stringify(REPLAY_CONFIG)'),original);
  }
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

test('incident transitions stay at their historical timestamps without piling up at the replay cursor', () => {
  const d = dashboard();
  d.context.start = Date.parse('2026-09-15T20:00:00Z');
  d.context.end = Date.parse('2026-09-15T22:00:00Z');
  assert.equal(d.run("incidentChartTimestamp({firstSeenAt:'2026-09-15T20:10:00Z',lastSeenAt:'2026-09-15T21:55:00Z'},start,end)"), Date.parse('2026-09-15T20:10:00Z'));
  assert.equal(d.run("incidentChartTimestamp({firstSeenAt:'2026-09-01T12:00:00Z',lastSeenAt:'2026-09-15T21:24:00Z',ongoing:false},start,end)"), Date.parse('2026-09-15T21:24:00Z'));
  assert.equal(d.run("incidentChartTimestamp({firstSeenAt:'2026-09-01T12:00:00Z',lastSeenAt:'2026-09-15T22:00:00Z',ongoing:true},start,end)"), 0);
});

test('travel time and worst segment use the current combined snapshot', () => {
  const d = dashboard();
  const current = new Date().toISOString();
  d.context.current = current;
  d.context.flowCells = { observedAt: current, totalCellCount: 3, supportedCellCount: 3,
    cells: [
      { cellId: 'fast', startMileMarker: 220, endMileMarker: 220.5, direction: 'COMBINED', speedMph: 60 },
      { cellId: 'slow', startMileMarker: 220.5, endMileMarker: 221, direction: 'COMBINED', speedMph: 30 },
      { cellId: 'directional', startMileMarker: 220.5, endMileMarker: 221, direction: 'SOUTHBOUND', speedMph: 5 }
    ] };
  assert.equal(d.run('estimateCorridorTravelMinutes(flowCells, 1, 42)'), 1.5);
  assert.equal(d.run('slowestCurrentCell(flowCells).cellId'), 'slow');
  assert.equal(d.run('estimateCorridorTravelMinutes(flowCells, 63, 42)'), 90);
  d.context.zones = [
    { bucketStart: current, avgCurrentSpeed: 40, zoneLabel: 'latest' },
    { bucketStart: new Date(Date.now() - 60_000).toISOString(), avgCurrentSpeed: 10, zoneLabel: 'older' }
  ];
  assert.equal(d.run('slowestCurrentZone(zones, current).zoneLabel'), 'latest');
  d.run(`renderCorridorSummary('I25', {
    summary: {latest: {avgCurrentSpeed: 42, polledAt: current}}, currentFlowCells: flowCells,
    zones: [], incidentThreads: [], incidentsAvailable: true })`);
  assert.equal(d.nodes.get('i25TravelTime').textContent, '90');
  assert.equal(d.nodes.get('i25FastestTravelTime').textContent, '90');
  assert.equal(d.nodes.get('i25SlowestTravelTime').textContent, '90');
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

test('thirty-day travel labels describe actual three-hour zone buckets', () => {
  const d = dashboard();
  d.run("state.selectedHours=720; renderCorridorSummaryLabels('i70',true)");
  assert.equal(d.nodes.get('i70FastestTravelTimeLabel').textContent,'Fastest 3-hour');
  assert.equal(d.nodes.get('i70SlowestTravelTimeLabel').textContent,'Slowest 3-hour');
  assert.match(d.nodes.get('i70TravelTimeRange').title,/complete 3-hour/);
  assert.equal(d.nodes.get('i70AverageSpeedLabel').textContent,'30-Day Average Speed');
});

test('missing complete period coverage does not substitute current travel into period metrics', () => {
  const d = dashboard();
  d.run("state.selectedHours=720; renderCorridorSummary('I70',{summary:{latest:{avgCurrentSpeed:60}},trend:{buckets:[]},zones:[],incidentThreads:[],incidentsAvailable:false})");
  assert.equal(d.nodes.get('i70TravelTime').textContent,'—');
  assert.equal(d.nodes.get('i70FastestTravelTime').textContent,'—');
  assert.equal(d.nodes.get('i70ActiveIncidents').textContent,'—');
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

test('Denver day ranges reject incomplete stopped and overlapping intervals', () => {
  const d = dashboard(undefined, '?historical=1');
  d.context.zones = [
    {zoneKey:'a',startMileMarker:0,endMileMarker:30,avgCurrentSpeed:60},
    {zoneKey:'b',startMileMarker:30,endMileMarker:60,avgCurrentSpeed:30}
  ];
  assert.equal(d.run('estimateSpeedZoneTravelMinutes(zones,60)'), 90);
  d.context.zones[1].avgCurrentSpeed = 0;
  assert.equal(d.run('Number.isNaN(estimateSpeedZoneTravelMinutes(zones,60))'), true);
  d.context.zones[1].avgCurrentSpeed = 30;
  d.context.zones[1].startMileMarker = 29;
  assert.equal(d.run('Number.isNaN(estimateSpeedZoneTravelMinutes(zones,60))'), true);
  assert.equal(d.run("denverCalendarDay('2026-11-01T07:30:00Z')"), '2026-11-01');
  assert.equal(d.run("denverCalendarDay('2026-11-01T08:30:00Z')"), '2026-11-01');
  const range = d.run('dailyTravelTimeRange({},60,NaN)');
  assert.equal(Number.isNaN(range.fastest), true);
  assert.equal(Number.isNaN(range.slowest), true);
});

test('daily zone requests share the selected24h read and retain the historical anchor', async () => {
  const requests = [];
  const anchor = '2026-09-28T12:00:00Z';
  const d = dashboard(async url => {
    requests.push(url);
    return {ok:true,json:async()=>({status:'UP',latest:{polledAt:anchor},points:[],features:[],buckets:[]})};
  }, '?historical=1');
  await d.run('loadLiveDashboardData(24)');
  assert.equal(requests.filter(url=>url.includes('/zones/trends?')).length,2);
  assert.ok(requests.filter(url=>url.includes('/zones/trends?'))
    .every(url=>url.includes('windowHours=24')&&url.includes(encodeURIComponent(anchor))));
  requests.length = 0;
  await d.run('loadLiveDashboardData(2)');
  assert.equal(requests.filter(url=>url.includes('/zones/trends?')&&url.includes('windowHours=24')).length,2);
  assert.equal(requests.filter(url=>url.includes('/zones/trends?')&&new URL(url,'http://fixture').searchParams.get('windowHours')==='2').length,2);
});

test('complete combined geometry is not rejected by directional companion counters', () => {
  const d = dashboard();
  d.context.snapshot = { observedAt: new Date().toISOString(), totalCellCount: 149, supportedCellCount: 149,
    cells: Array.from({length:136}, (_, i) => ({cellId:`combined-${i}`, direction:'COMBINED',
      startMileMarker:206 + i/2, endMileMarker:206 + (i+1)/2, speedMph:60})) };
  d.context.snapshot.cells.push(...Array.from({length:13}, (_, i) => ({cellId:`east-${i}`,
    direction:'EASTBOUND',startMileMarker:206+i/2,endMileMarker:206+(i+1)/2,speedMph:2})));
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 68, 30)'), 68);
  d.context.snapshot.cells.splice(20,1);
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 68, 30)'), 136);
});

test('travel estimates deduplicate geometry, reject gaps and retain zero-speed evidence', () => {
  const d = dashboard();
  d.context.snapshot = { observedAt:new Date().toISOString(), cells:[
    {cellId:'a',startMileMarker:0,endMileMarker:0.5,speedMph:60},
    {cellId:'duplicate',startMileMarker:0,endMileMarker:0.5,speedMph:60},
    {cellId:'b',startMileMarker:0.5,endMileMarker:1,speedMph:30}] };
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 1, 10)'), 1.5);
  d.context.snapshot.cells[2].startMileMarker = 0.6;
  d.context.snapshot.cells[2].endMileMarker = 1.1;
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 1, 10)'), 6);
  d.context.snapshot.cells[2].speedMph = 0;
  assert.equal(d.run('Number.isNaN(estimateCorridorTravelMinutes(snapshot, 1, 10))'), true);
  assert.equal(d.run('slowestCurrentCell(snapshot).speedMph'), 0);
});

test('hourly travel estimates use hourly speed and actual observation time', () => {
  const d = dashboard(undefined, '?historical=1');
  d.context.snapshot = { resolution:'HOURLY',hourEnd:'2026-01-01T11:00:00Z', cells:[
    {startMileMarker:0,endMileMarker:0.5,avgSpeedMph:60,lastObservedAt:'2026-01-01T10:45:00Z'},
    {startMileMarker:0.5,endMileMarker:1,avgSpeedMph:30,lastObservedAt:'2026-01-01T10:46:00Z'}] };
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 1, 10)'), 1.5);
  assert.equal(d.run('slowestCurrentCell(snapshot).speedMph'), 30);
  assert.equal(d.run('window.TrafficEstimates.currentFlowCells(snapshot).length'), 0);
  d.context.snapshot.cells.forEach(cell => delete cell.lastObservedAt);
  assert.equal(d.run('currentFlowCells(snapshot).length'), 0);
  assert.equal(d.run('estimateCorridorTravelMinutes(snapshot, 1, 10)'), 6);
  assert.equal(d.run('currentFlowCells({resolution:"HOURLY",cells:{}}).length'), 0);
  assert.equal(d.run('currentFlowCells({resolution:"SLOWDOWN_FREQUENCY",cells:[]}).length'), 0);
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
});

test('speed-zone descriptors label retained and long-range speeds as observed', () => {
  const labels = [];
  const d = dashboard(undefined, '?historical=1');
  d.context.labels = labels;
  d.context.ctx = new Proxy({fillText(text){labels.push(text);}}, {get(target,key){return key in target ? target[key] : ()=>{};}});
  d.run("drawSpeedZoneDescriptor(ctx,{marker:'MM208–221',latestSpeed:42,postedSpeedMph:55},[{speed:53}],8,108,{ink:'#111',muted:'#333'},92)");
  assert.ok(labels.includes('Observed:'));
  assert.equal(labels.includes('Live:'),false);
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
  assert.equal(d.run("new Set(demoRoute.zones.map(zone => zone.zoneKey)).size"), 6);
  assert.equal(d.run('demoRoute.zoneBaseline.zones.length'), 6);
  assert.ok(d.run('demoRoute.zoneBaseline.zones.every(zone => zone.profiles.length === 168)'));
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

test('unscrollable and invalid incident panels leave native wheel handling intact', () => {
  const d = dashboard();
  d.context.scroller = { scrollTop: 0, scrollHeight: 100, clientHeight: 100 };
  assert.equal(d.run('nestedScrollRemainder(scroller, 20)'), 0);
  assert.equal(d.context.scroller.scrollTop, 0);
  assert.equal(d.run('nestedScrollRemainder(null, NaN)'), 0);
  assert.equal(d.run('nestedScrollRemainder(scroller, 0)'), 0);
});

test('changing corridor focus rerenders compact and complete incident rows', () => {
  const d = dashboard();
  d.context.features = Array.from({ length: 5 }, (_, i) => event({ providerEventId: String(i) }));
  d.run("state.routeData.set('I25', buildRouteData('I25', {}, {}, {features})); applyCorridorFocus('I25', false)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 5);
  d.run("applyCorridorFocus('ALL', false)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 3);
});

test('short-range combined incident tables keep ongoing reports ahead of cleared reports', () => {
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

  d.run("state.expandedIncidents.add('I25'); renderIncidentTable('I25', state.routeData.get('I25').incidentThreads)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 3);
});

test('short incident views show ended reports without implying an empty feed', () => {
  const d = dashboard();
  d.context.features = [event({active:false, providerEventId:'ended'})];
  d.run("state.selectedHours = 6; state.routeData.set('I25', buildRouteData('I25', {}, {}, {features})); renderIncidentTable('I25', state.routeData.get('I25').incidentThreads)");
  assert.equal(d.nodes.get('i25IncidentRows').children.length, 1);
  assert.equal(d.nodes.get('i25IncidentRows').children[0].children.length, 4);
  assert.equal(d.nodes.get('i25IncidentCount').textContent, '0 ongoing · 1 total');
  d.run("state.expandedIncidents.add('I25'); renderIncidentTable('I25', state.routeData.get('I25').incidentThreads)");
  assert.equal(d.nodes.get('i25IncidentRows').children[0].children.length, 4);
});

test('incident rows use specific CDOT details and distinguish a reported duration', () => {
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
  assert.equal(lastSeenCell.children[2].textContent, 'Reported 1 hr 30 min');
});

test('incident duration never mixes a provider boundary with an observed boundary', () => {
  const d = dashboard();
  d.context.incident = { firstSeenAt: new Date('2026-09-15T11:00:00Z'),
    lastSeenAt: new Date('2026-09-15T11:10:00Z'), sourceStartedAt: new Date('2026-09-15T10:00:00Z') };
  assert.equal(d.run('incidentObservedDuration(incident)'), 'Observed 10 min');
  d.context.incident.sourceEndedAt = new Date('2026-09-15T11:30:00Z');
  assert.equal(d.run('incidentObservedDuration(incident)'), 'Reported 1 hr 30 min');
  d.context.incident.sourceEndedAt = new Date('2026-09-15T09:30:00Z');
  assert.equal(d.run('incidentObservedDuration(incident)'), '');
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
  assert.equal(requests.filter(url => url.includes('/map/flow-cells/frequency?') && url.includes('windowHours=720')).length, 2);
});

test('unavailable optional flow keeps corridor charts and incident data usable', async () => {
  const d = dashboard(async url => {
    if (url.includes('/map/flow-cells/')) throw new Error('Flow unavailable');
    return { ok: true, json: async () => ({ status:'UP', latest:{avgCurrentSpeed:61},
      buckets:[], features:[], points:[], zones:[], profiles:[] }) };
  });
  const data = await d.run('loadLiveDashboardData(24)');
  assert.equal(data.routeData.get('I25').summary.latest.avgCurrentSpeed, 61);
  assert.equal(data.routeData.get('I25').flowCells, null);
  assert.equal(data.routeData.get('I25').incidentsAvailable, true);
  assert.equal(data.health.failures.some(reason => reason.includes('undefined')), false);
});

test('missing zone baselines preserve current zone points and report partial data', async () => {
  const requests = [];
  const d = dashboard(async url => {
    requests.push(url);
    if (url.includes('/zones/baselines?')) throw new Error('Baseline unavailable');
    return { ok: true, json: async () => url.includes('/zones/trends?')
      ? { points: [{zoneKey:'south', bucketStart:'2026-09-26T00:00:00Z', avgCurrentSpeed:52}] }
      : { status:'UP', latest:{avgCurrentSpeed:61}, buckets:[], features:[] } };
  });
  const data = await d.run('loadLiveDashboardData(24)');
  assert.equal(data.routeData.get('I25').zones.length, 1);
  assert.equal(data.routeData.get('I25').zoneBaseline.zones.length, 0);
  assert.equal(data.routeData.get('I25').summary.latest.avgCurrentSpeed, 61);
  assert.equal(data.health.partial, true);
  assert.equal(requests.filter(url => url.includes('/zones/baselines?')).length, 2);
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

test('overlapping sync requests coalesce without depending on the selected range', async () => {
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

test('an explicit queued view change gets one follow-up sync', async () => {
  const d=dashboard();
  let release,count=0;
  const pending=new Promise(resolve=>{release=resolve;});
  d.context.loader=async()=>{if(++count===1)await pending;return d.run('buildDemoDashboardSnapshots()');};
  d.run('loadLiveDashboardSnapshots=loader');
  const first=d.run('refreshDashboard()');
  await d.run('refreshDashboard({queueIfBusy:true})');
  await d.run('refreshDashboard({queueIfBusy:true})');
  release();await first;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(count,2);
  assert.equal(d.run('state.refreshing'),false);
});

test('manual sync ignores click spam until its cooldown expires', async () => {
  const d=dashboard();
  let release,count=0,expire;
  const pending=new Promise(resolve=>{release=resolve;});
  d.context.window.setTimeout=(callback,delay)=>{assert.equal(delay,15000);expire=callback;return 1;};
  d.context.loader=async()=>{count++;await pending;return d.run('buildDemoDashboardSnapshots()');};
  d.run('loadLiveDashboardSnapshots=loader;requestManualRefresh()');
  for(let i=0;i<20;i++)d.run('requestManualRefresh()');
  assert.equal(count,1);
  assert.equal(d.nodes.get('refreshButton').disabled,true);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(d.nodes.get('refreshButton').disabled,true);
  expire();assert.equal(d.nodes.get('refreshButton').disabled,false);
});

test('offline preload placeholders cannot make a failed sync appear successful', async () => {
  const d=dashboard();
  await assert.rejects(d.run('loadLiveDashboardSnapshots()'),/Select Sync now to retry/);
  await d.run('refreshDashboard()');
  assert.doesNotMatch(d.nodes.get('statusText').textContent,/previously synced|Showing data synced/);
});

test('partial sync retains failed slices, missing corridors and missing geometry', () => {
  const d=dashboard();
  d.run(`previous=buildDemoDashboardSnapshots();next=buildDemoDashboardSnapshots();
    previous.get(24).corridorFeatures.set('I70',{geometry:{type:'LineString',coordinates:[[1,2],[3,4]]}});
    next.get(24).routeData.delete('I70');
    next.get(24).routeData.get('I25').zones=[];
    next.get(24).routeData.get('I25').syncAvailability={zones:false};
    merged=mergeDashboardSnapshots(previous,next);`);
  assert.equal(d.run('merged.get(24).routeData.has("I70")'),true);
  assert.equal(d.run('merged.get(24).corridorFeatures.has("I70")'),true);
  assert.ok(d.run('merged.get(24).routeData.get("I25").zones.length')>0);
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

test('incident day groups include the first instant of the selected window', () => {
  const d=dashboard();
  d.context.start=Date.parse('2026-09-01T18:00:00Z');
  d.context.incidents=[{type:'Crash',firstSeenAt:new Date(d.context.start)}];
  assert.equal(d.run('buildIncidentDayGroups(incidents,start,start+1000,5)[0].count'),1);
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

test('incident callout text remains inside narrow plots, not only its background', () => {
  for (const clientWidth of [180,130]) {
    const d = dashboard();
    const labels = [];
    d.run('state.selectedHours=168');
    d.context.ctx = new Proxy({canvas:{clientWidth}, measureText:text=>({width:text.length*5}),
      fillText(text,x){if(Number.isNaN(Number(text)))labels.push({text,x,align:this.textAlign});}},
      {get(target,key){return key in target ? target[key] : ()=>{};}});
    d.context.incidents=[{type:'Crash',firstSeenAt:new Date(10000)}];
    d.context.points=[{timestamp:10000,verticalPosition:100,horizontalPosition:70}];
    d.run("drawIncidentFlags(ctx,'I25',incidents,points,0,20000,{left:43,right:18},{panel:'#fff','--rose':'red'})");
    assert.equal(labels.length,1);
    const label=labels[0],width=label.text.length*5;
    const left=label.align==='right'?label.x-width:label.x;
    assert.ok(left>=43,`Text starts at ${left} outside plot`);
    assert.ok(left+width<=clientWidth-18,'Text extends past right plot edge');
  }
});
