// Local diagnostic only. Never served by the application or its container.
const http = require('node:http');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const revisions = Object.freeze({
  original: '91ba877e52dec27d2592828f2de1109ded9622f9',
  stripped: '32e3689c86d8aa67c58c82656e807366feb4ea1f'
});

function motionProbe() {
  const query = new URLSearchParams(location.search);
  const revision = query.get('motionRevision') || 'current';
  const controls = document.createElement('aside');
  controls.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:10000;padding:10px;background:#fffef7;color:#002500;border:1px solid #bb8700;border-radius:8px;font:12px monospace;max-width:520px';
  controls.innerHTML = '<label>Scene <select id="motionScene"><option value="border">Panel border</option><option value="grid">Grid glow</option><option value="diagram">Diagram</option><option value="map">Map pulse</option></select></label> <button id="measureMotion">Measure 8 seconds</button><output id="motionResult" style="display:block;white-space:pre-wrap;margin-top:8px">Fixture-only diagnostic. No CPU/GPU utilization claim.</output>';
  document.body.appendChild(controls);
  const sceneSelect = controls.querySelector('select');
  const button = controls.querySelector('button');
  const output = controls.querySelector('output');
  if (['border', 'grid', 'diagram', 'map'].includes(query.get('motionScene'))) sceneSelect.value = query.get('motionScene');

  const targetFor = scene => scene === 'map' ? document.querySelector('.data-hero-map-shell')
    : scene === 'grid' ? document.querySelector('.data-truth, .api-guardrails')
    : scene === 'diagram' ? document.querySelector('.architecture-stage')
    : document.getElementById('tomtomProvider') || document.querySelector('.modular-panel');
  const visual = target => ({
    runningAnimations: target.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length,
    pulses: [...target.querySelectorAll('.data-hero-map-pulse')].map(p => ({
      seconds: p.dataset.travelSeconds || null, transform: getComputedStyle(p).transform,
      running: p.getAnimations().some(a => a.playState === 'running')
    }))
  });

  button.onclick = async () => {
    if (button.disabled) return;
    const scene = sceneSelect.value;
    const target = targetFor(scene);
    if (!target) { output.textContent = 'Scene absent; use System for border/diagram and Data for grid/map.'; return; }
    if (document.hidden) { output.textContent = 'Not sampled: tab is hidden.'; return; }
    button.disabled = true;
    sceneSelect.disabled = true;
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    if (scene === 'diagram') document.getElementById('ingestService')?.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 500));
    if (document.hidden) {
      output.textContent = 'Not sampled: tab became hidden during setup.';
      button.disabled = sceneSelect.disabled = false;
      return;
    }
    if (scene === 'map' && !target.querySelector('canvas')) {
      output.textContent = 'Not sampled: map has not initialized.';
      button.disabled = sceneSelect.disabled = false;
      return;
    }
    const before = visual(target);
    const viewport = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio };
    const paintStart = window.__motionPaintCalls || 0;
    const originalRect = Element.prototype.getBoundingClientRect;
    let rectReads = 0, frameId, deadlineId, observer;
    const wrappedRect = function(...args) { rectReads++; return originalRect.apply(this, args); };
    const longTasksSupported = typeof PerformanceObserver === 'function'
      && PerformanceObserver.supportedEntryTypes.includes('longtask');
    const longTasks = [], frames = [];
    let abort;
    const lostVisibility = () => { if (document.hidden) abort?.(new Error('Tab hidden during sample')); };
    const navigated = () => abort?.(new Error('Navigation interrupted sample'));
    const startedAt = performance.now();
    let previous = startedAt, nextFocus = startedAt, focused = false;
    output.textContent = 'Sampling for 8 seconds…';
    try {
      Element.prototype.getBoundingClientRect = wrappedRect;
      if (longTasksSupported) {
        observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
        observer.observe({ type: 'longtask' });
      }
      await new Promise((resolve, reject) => {
        abort = reject;
        document.addEventListener('visibilitychange', lostVisibility);
        window.addEventListener('pagehide', navigated);
        deadlineId = setTimeout(() => reject(new Error('Frame sampling exceeded its 9-second deadline')), 9000);
        const frame = now => {
          frames.push(now - previous); previous = now;
          if (scene === 'border' && now >= nextFocus) {
            focused = !focused; nextFocus = now + 800;
            if (focused) target.focus({ preventScroll: true }); else target.blur();
          }
          if (now - startedAt < 8000) frameId = requestAnimationFrame(frame); else resolve();
        };
        frameId = requestAnimationFrame(frame);
      });
      const sorted = frames.slice(1).sort((a, b) => a - b);
      if (observer) longTasks.push(...observer.takeRecords().map(entry => entry.duration));
      const percentile = p => sorted.length ? Math.round(sorted[Math.floor((sorted.length - 1) * p)] * 100) / 100 : null;
      const result = { revision, scene, viewport, sampleMs: Math.round(previous - startedAt),
        frames: sorted.length, medianMs: percentile(.5), p95Ms: percentile(.95),
        framesOver25ms: sorted.filter(ms => ms > 25).length, framesOver50ms: sorted.filter(ms => ms > 50).length,
        longTasks: longTasksSupported ? longTasks.length : null,
        longTaskMs: longTasksSupported ? Math.round(longTasks.reduce((sum, ms) => sum + ms, 0)) : null,
        layoutRectReads: rectReads, mapPaintCalls: (window.__motionPaintCalls || 0) - paintStart, visualStart: before };
      Element.prototype.getBoundingClientRect = originalRect;
      result.visualEnd = visual(target);
      output.textContent = JSON.stringify(result);
    } catch (error) {
      output.textContent = JSON.stringify({ revision, scene, aborted: error.message });
    } finally {
      if (Element.prototype.getBoundingClientRect === wrappedRect) Element.prototype.getBoundingClientRect = originalRect;
      cancelAnimationFrame(frameId);
      clearTimeout(deadlineId);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', lostVisibility);
      window.removeEventListener('pagehide', navigated);
      if (scene === 'border') target.blur();
      button.disabled = sceneSelect.disabled = false;
    }
  };
}

const probe = `(${motionProbe.toString()})();`;
const rendererWrapper = `import * as module from './maplibre-gl.baseline.mjs';
export * from './maplibre-gl.baseline.mjs';
const renderer=module.default||module;
export default {...renderer,Map:class extends renderer.Map{
  setPaintProperty(...args){window.__motionPaintCalls=(window.__motionPaintCalls||0)+1;return super.setPaintProperty(...args);}
}};`;

function createMotionServer({ repository = path.resolve(__dirname, '../..'), fixtureGet = http.get } = {}) {
  const root = path.join(repository, 'api-service/src/main/resources/static');
  const cache = new Map();
  const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript',
    '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.json':'application/json' };
  const readAsset = (relative, revision) => {
    const ref = revisions[revision];
    if (!ref) return readFileSync(path.join(root, relative));
    const key = ref + ':' + relative;
    if (!cache.has(key)) cache.set(key, execFileSync('git', ['show', ref + ':api-service/src/main/resources/static/' + relative],
      { cwd: repository, maxBuffer: 6 * 1024 * 1024 }));
    return cache.get(key);
  };
  return http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    let url;
    try { url = new URL(request.url, 'http://127.0.0.1:8092'); }
    catch { response.writeHead(400).end(); return; }
    if (/^\/(dashboard(?:-experimental)?-api\/|actuator\/|dashboard-experimental-health$)/.test(url.pathname)) {
      const upstream = fixtureGet({ hostname:'127.0.0.1', port:8091, path:url.pathname + url.search,
        headers:{ referer:'http://127.0.0.1:8091/dashboard/?fixture=live' } }, source => {
        response.writeHead(source.statusCode, { 'Content-Type':source.headers['content-type'] || 'application/json' });
        source.pipe(response);
      });
      upstream.setTimeout(8000, () => upstream.destroy(new Error('Fixture deadline')));
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      response.once('close', () => { if (!response.writableFinished) upstream.destroy(); });
      return;
    }
    if (url.pathname === '/_motion/probe.js') { response.writeHead(200, {'Content-Type':'text/javascript'}).end(probe); return; }
    let relative;
    try { relative = decodeURIComponent(url.pathname).replace(/^\//, '').replace(/^dashboard-experimental\//, 'dashboard/'); }
    catch { response.writeHead(400).end(); return; }
    if (relative.endsWith('/')) relative += 'index.html';
    if (!relative.startsWith('dashboard/') || relative.split('/').some(part => part === '..' || part.startsWith('.'))
        || !Object.hasOwn(types, path.extname(relative))) { response.writeHead(403).end(); return; }
    const cookie = request.headers.cookie?.match(/(?:^|;\s*)motionRevision=(original|stripped)/)?.[1] || 'current';
    const requested = url.searchParams.get('motionRevision');
    const revision = relative.endsWith('.html') ? (Object.hasOwn(revisions, requested) ? requested : 'current') : cookie;
    try {
      let data;
      if (relative.endsWith('/maplibre-gl.mjs')) data = rendererWrapper;
      else if (relative.endsWith('/maplibre-gl.baseline.mjs')) data = readAsset(relative.replace('.baseline.mjs', '.mjs'), revision);
      else data = readAsset(relative, revision);
      if (relative.endsWith('.html')) {
        response.setHeader('Set-Cookie', 'motionRevision=' + revision + '; Path=/; SameSite=Strict');
        data = data.toString().replace('</body>', '<script src="/_motion/probe.js"></script></body>');
      }
      response.writeHead(200, {'Content-Type':types[path.extname(relative)]}).end(data);
    } catch { response.writeHead(404).end(); }
  });
}

if (require.main === module) createMotionServer().listen(8092, '127.0.0.1', () =>
  console.log('Fixture-only motion comparison: http://127.0.0.1:8092/dashboard/system.html?motionRevision=current'));

module.exports = { createMotionServer, motionProbe, probe, revisions };

