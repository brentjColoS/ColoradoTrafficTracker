

const assert = require('node:assert/strict');

const { readFileSync } = require('node:fs');

const vm = require('node:vm');

const path = require('node:path');
const testDirectory = path.resolve(__dirname, '..');

const source = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard.js'), 'utf8');

const estimatesSource = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/traffic-estimates.js'), 'utf8');

const historySource = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard-history.js'), 'utf8');

const continuousSource = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard-continuous.js'), 'utf8');

const windowSummarySource = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard-window-summary.js'), 'utf8');

const indexSource = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/index.html'), 'utf8');

const incidentTypesSource = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/incident-types.js'), 'utf8');

const mapSource = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/corridor-map.js'), 'utf8');

const informationSource = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/information-pages.js'), 'utf8');

const informationStyles = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/information.css'), 'utf8');

const informationPages = Object.fromEntries(['system', 'data', 'api'].map(name => [
  name,
  readFileSync(path.join(testDirectory, `../../api-service/src/main/resources/static/dashboard/${name}.html`), 'utf8')
]));

function timezoneDashboard(timeZone, search = '?historical=1') {
  return dashboard(undefined, search, '/dashboard/', undefined, undefined, timeZone);
}

function corridorButtonFixture(search = '') {
  const d = dashboard(undefined, search);
  const buttons = ['ALL','I25','I70'].map(corridor => ({
    dataset: {corridorFocus:corridor}, disabled: false, attributes: {}, active: false,
    classList: {toggle(name, active) { buttons.find(button => button.dataset.corridorFocus === corridor).active = active; }},
    setAttribute(name, value) { this.attributes[name] = value; }
  }));
  const control = d.nodes.get('corridorControl');
  control.querySelectorAll = () => buttons;
  const urls = [];
  d.context.window.location.href = 'http://fixture/dashboard/' + search;
  d.context.window.history = {replaceState(_state, _title, url) { urls.push(String(url)); }};
  d.run('initializeCorridorFocus();initializeControls()');
  return {d, buttons, urls, click(corridor) {
    control.events.click({target: {closest: () => buttons.find(button => button.dataset.corridorFocus === corridor) || null}});
  }};
}

function dashboard(fetch = async () => { throw new Error('Offline'); }, search = '', pathname = '/dashboard/', replayEnabled, preparedHistory, timeZone = 'America/Denver', start = false) {
  const batchedFetch = require("../dashboard-batch-fixture.cjs").batchFetch(fetch);
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
  const browserIntl = Object.create(Intl);
  browserIntl.DateTimeFormat = function(locale, options) {
    if (timeZone === null && !options) throw new Error('Timezone detection unavailable');
    return new Intl.DateTimeFormat(locale, { timeZone: timeZone || 'America/Denver', ...options });
  };
  const context = vm.createContext({ URLSearchParams, URL, AbortSignal, AbortController, console, Date, Path2D: class { constructor(path) { this.path = path; } }, Intl: browserIntl,
    window: { events: {}, addEventListener(name,handler) { this.events[name]=handler; }, location: { search, pathname }, fetch: batchedFetch, requestAnimationFrame() {},
      setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
      localStorage: { getItem() { throw new Error('Blocked'); } } },
    document: { events: {}, addEventListener(name,handler) { this.events[name]=handler; }, getElementById: get, createElement: node, createElementNS: node, querySelector: () => null,
      querySelectorAll: () => [], documentElement: node(), body: node() } });
  if (preparedHistory !== undefined) context.document.documentElement.dataset.preparedHistory = String(preparedHistory);
  if (replayEnabled !== undefined) context.document.documentElement.dataset.replayEnabled = String(replayEnabled);
  vm.runInContext(estimatesSource, context);
  vm.runInContext(historySource, context);
  vm.runInContext(continuousSource, context);
  vm.runInContext(incidentTypesSource, context);
  vm.runInContext(readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/variable-speed-signs.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard-snapshots.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard-transport.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard-series.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard-incident-model.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard-chart-axis.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/dashboard-chart-painter.js'), 'utf8'), context);
  vm.runInContext(source.replace('\ninitializeDashboard();', start ? '\nwindow.startupTest = initializeDashboard();' : ''), context);
  return { nodes, context, network: batchedFetch.network, run: code => vm.runInContext(code, context) };
}

function event(overrides = {}) {
  return { properties: { incidentProvider: 'cdot', corridor: 'I25', providerEventId: 'one',
    normalizedCategory: 'DISABLED_VEHICLE', closestMileMarker: 225,
    locationLabel: 'MP 225 · Thornton', firstSeenAt: '2026-09-13T10:00:00Z',
    lastSeenAt: '2026-09-15T10:00:00Z', active: true, ...overrides } };
}

function liveEdgeFixture(search = '') {
  const d = dashboard(undefined, search);
  const labels = [], moves = [], lines = [], dashes = [], positions = [];
  d.context.ctx = new Proxy({
    fillText(text, x, y) { labels.push(text); positions.push([text,x,y]); },
    moveTo(x, y) { moves.push([x, y]); },
    lineTo(x, y) { lines.push([x, y]); },
    setLineDash(dash) { dashes.push(Array.from(dash)); },
    measureText() { return {width: 30}; }
  }, {get: (target, key) => key in target ? target[key] : () => {}});
  d.run(`route = {summary:{latest:{polledAt:new Date().toISOString(),avgCurrentSpeed:60}},
    history:{samples:[{polledAt:new Date().toISOString(),avgCurrentSpeed:60}]},incidentThreads:[]};
    dimensions={width:300,height:190};padding={left:50,right:5,top:34,bottom:30};
    colors={forest:'#82c99c'};`);
  return {d, labels, moves, lines, dashes, positions, draw: () => d.run("chartPainter.drawLiveEdge(ctx,route,dimensions,padding,colors)")};
}

function floydHillClosure(overrides = {}) {
  return {incidentProvider:'cdot',corridor:'I70',travelDirection:'E',closestMileMarker:244,
    incidentTypeLabel:'Safety Closure',sourceType:'Safety Closure',normalizedCategory:'closure',iconCategory:8,
    sourceStartedAt:'2026-10-21T13:16:27.913Z',sourceEndedAt:'2026-10-21T14:12:17Z',
    lastSeenAt:'2026-10-21T14:13:50.946Z',
    incidentDescription:'Between Exit 243: Hidden Valley and Exit 244: US 6 (near Floyd Hill) at Mile Point 244. The roadway is reopened to traffic.',
    normalizedStatus:'cleared',active:false,...overrides};
}

const variableSpeedSigns = require("../../../api-service/src/main/resources/static/dashboard/variable-speed-signs.js");

const vslNow = Date.parse('2026-10-14T23:00:00Z');

function vslSign(overrides={}) {
  return {id:'fixture-vsl',mileMarker:234.5,direction:'EAST',longitude:-105.61,latitude:39.75,
    location:'I-70 eastbound near Dumont',reportedLimitMph:45,regularLimitMph:65,status:'AVAILABLE',
    communicationStatus:'operational',displayStatus:'on',fetchedAt:new Date(vslNow).toISOString(),
    sourceUpdatedAt:'2024-01-01T00:00:00Z',...overrides};
}

function vslSnapshot(signs) {return {corridor:'I70',status:'PARTIAL',signs};}

const popupText=node=>[node.textContent,...node.children.map(popupText)].join(' ');

module.exports = { assert, readFileSync, vm, path, source, estimatesSource, historySource, continuousSource, windowSummarySource, indexSource, incidentTypesSource, mapSource, informationSource, informationStyles, informationPages, timezoneDashboard, corridorButtonFixture, dashboard, event, liveEdgeFixture, floydHillClosure, variableSpeedSigns, vslNow, vslSign, vslSnapshot, popupText, testDirectory };
