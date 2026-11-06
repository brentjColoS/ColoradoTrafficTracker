const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../../api-service/src/main/resources/static/dashboard');
const source = readFileSync(path.join(root, 'source-links.js'), 'utf8');

function landing(href, fail = false) {
  const replacements = [], state = {retained: 'history state'};
  const window = {location: {href}, history: {state, replaceState(...args) {
    if (fail) throw new Error('History access denied');
    replacements.push(args);
  }}};
  vm.runInNewContext(source, {window, URL});
  return {window, replacements, state};
}

test('source links capture allowed entry tags then clean only that parameter without navigation', () => {
  for (const tag of ['resume', 'linkedin', 'github', 'portfolio']) {
    const href = `https://traffic.example/dashboard/?src=${tag}&corridor=I70&fixture=live#comparisonPanel`;
    const result = landing(href);
    assert.equal(result.window.CTT_ENTRY_SOURCE, tag);
    assert.equal(result.window.location.href, href);
    assert.equal(result.replacements.length, 1);
    assert.equal(result.replacements[0][0], result.state);
    assert.equal(result.replacements[0][2], '/dashboard/?corridor=I70&fixture=live#comparisonPanel');
  }
});

test('clean and unknown-source links are untouched; repeated source tags follow the importer first-value rule', () => {
  for (const suffix of ['', '?corridor=I25', '?src=unknown', '?src=', '?src=Resume', '?src=unknown&src=resume']) {
    const result = landing('https://traffic.example/dashboard/' + suffix);
    assert.equal(result.window.CTT_ENTRY_SOURCE, undefined);
    assert.equal(result.replacements.length, 0);
  }
  assert.equal(landing('https://traffic.example/dashboard/?src=resume&src=github').replacements[0][2], '/dashboard/');
});

test('source cleanup preserves experimental and information paths and tolerates restricted history', () => {
  for (const pathname of ['/dashboard-experimental/', '/dashboard/system.html', '/dashboard/data.html', '/dashboard/api.html']) {
    assert.equal(landing(`https://traffic.example${pathname}?src=resume#details`).replacements[0][2], pathname + '#details');
  }
  assert.equal(landing('https://traffic.example/dashboard/?src=resume', true).window.CTT_ENTRY_SOURCE, 'resume');
  assert.doesNotThrow(() => landing('not a URL'));
});

test('all public entry pages load the same deferred source cleaner', () => {
  for (const name of ['index', 'system', 'data', 'api']) {
    const page = readFileSync(path.join(root, name + '.html'), 'utf8');
    assert.match(page, /<script src="source-links\.js\?v=source-clean-1" defer><\/script>/);
  }
});
