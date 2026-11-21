const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../../api-service/src/main/resources/static/dashboard');
const source = readFileSync(path.join(root, 'browser-motion.js'), 'utf8');
const key = 'ctt-motion-override';

function workshop({reduced = true, storage = new Map(), blocked = false} = {}) {
  function node() {
    return {children: [], attributes: {}, events: {}, dataset: {},
      appendChild(child) { this.children.push(child); }, before(child) { this.beforeNode = child; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.events[name] = callback; }};
  }
  const theme = node(), html = node(), events = {}, mediaEvents = {};
  const native = {matches: reduced, addEventListener(name, callback) { mediaEvents[name] = callback; }};
  const window = {matchMedia: () => native,
    localStorage: {getItem(name) { if (blocked) throw Error('Storage blocked'); return storage.get(name) ?? null; },
      setItem(name, value) { if (blocked) throw Error('Storage blocked'); storage.set(name, value); }},
    addEventListener(name, callback) { events[name] = callback; }};
  const document = {documentElement: html, getElementById: () => theme, createElement: node};
  vm.runInNewContext(source, {window, document});
  const button = theme.beforeNode.children[1];
  return {window, html, button, storage, preference: window.BrowserMotion.media(),
    click() { button.events.click(); },
    reduce(value) { native.matches = value; mediaEvents.change(); },
    storageEvent(name, value) { events.storage({key: name, newValue: value}); },
    restore() { events.pageshow(); }};
}

test('a browser reduced-motion request defaults off until an explicit choice', () => {
  const view = workshop();
  assert.equal(view.button.hidden, false);
  assert.equal(view.button.attributes['aria-pressed'], 'false');
  assert.equal(view.html.dataset.motion, 'reduced');
  assert.equal(view.preference.matches, true);
  assert.equal(view.storage.size, 0);
  const changes = [];
  const listener = event => changes.push(event.matches);
  view.preference.addEventListener('change', listener);
  view.preference.addEventListener('change', listener);
  view.click();
  assert.equal(view.html.dataset.motion, 'full');
  assert.equal(view.button.attributes['aria-pressed'], 'true');
  assert.equal(view.preference.matches, false);
  assert.equal(view.storage.get(key), 'on');
  view.click();
  assert.deepEqual(changes, [false, true]);
  assert.equal(view.storage.get(key), 'off');
  view.preference.removeEventListener('change', listener);
  view.click();
  assert.deepEqual(changes, [false, true]);
});

test('normal browsers show no extra control and keep their native motion', () => {
  const view = workshop({reduced: false});
  assert.equal(view.button.hidden, true);
  assert.equal(view.html.dataset.motion, 'full');
  view.click();
  assert.equal(view.storage.size, 0);
  view.reduce(true);
  assert.equal(view.button.hidden, false);
  assert.equal(view.preference.matches, true);
});

test('the explicit choice survives page navigation, other tabs and cached restores', () => {
  const storage = new Map(), first = workshop({storage});
  first.click();
  const second = workshop({storage});
  assert.equal(second.preference.matches, false);
  second.storageEvent('unrelated', 'off');
  assert.equal(second.preference.matches, false);
  first.click();
  second.storageEvent(key, 'off');
  assert.equal(second.preference.matches, true);
  storage.set(key, 'on');
  second.restore();
  assert.equal(second.preference.matches, false);
  second.storageEvent(null, null);
  assert.equal(second.preference.matches, true);
});

test('changing the browser setting respects an existing explicit override', () => {
  const view = workshop({storage: new Map([[key, 'on']])});
  const changes = [];
  view.preference.addEventListener('change', event => changes.push(event.matches));
  view.reduce(false); view.reduce(true);
  assert.equal(view.button.hidden, false);
  assert.equal(view.preference.matches, false);
  assert.deepEqual(changes, []);
  view.click();
  assert.deepEqual(changes, [true]);
});

test('blocked browser storage still permits a safe page-local opt-in', () => {
  const view = workshop({blocked: true});
  view.click(); view.restore();
  assert.equal(view.preference.matches, false);
  view.click();
  assert.equal(view.preference.matches, true);
});

test('all public pages load the shared policy before their controllers', () => {
  for (const page of ['index.html', 'why.html', 'system.html', 'data.html', 'api.html']) {
    const html = readFileSync(path.join(root, page), 'utf8');
    assert.match(html, /browser-motion\.css\?v=motion-choice-1/);
    assert.ok(html.indexOf('browser-motion.js?') < html.indexOf('browser-theme.js?'), page);
  }
  assert.doesNotMatch(source, /setTimeout|setInterval|fetch\(|requestAnimationFrame/);
});
