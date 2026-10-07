const http = require('node:http');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../api-service/src/main/resources/static');
const revisions = { original: '91ba877', stripped: '32e3689' };
const cache = new Map();
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const probe = `
const controls = document.createElement('aside');
controls.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:10000;padding:12px;background:#fffef7;color:#002500;border:1px solid #bb8700;border-radius:8px;font:12px monospace;max-width:520px';
controls.innerHTML = '<label>Revision <select id="motionRevision"><option>current</option><option>original</option><option>stripped</option></select></label> <label>Scene <select id="motionScene"><option value="border">Panel border</option><option value="grid">Grid glow</option><option value="map">Map pulse</option></select></label> <button id="measureMotion">Measure 8 seconds</button> <button id="freezeMotion">Freeze visual</button> <button id="hideMotion">Hide tools</button><output id="motionResult" style="display:block;white-space:pre-wrap;margin-top:8px">Local diagnostic. No provider requests.</output>';
document.body.appendChild(controls);
const revision = document.getElementById('motionRevision');
revision.value = new URLSearchParams(location.search).get('motionRevision') || 'current';
revision.onchange = () => { const url = new URL(location.href); url.searchParams.set('motionRevision', revision.value); location.href = url; };
document.getElementById('hideMotion').onclick = () => { controls.hidden = true; };
document.getElementById('freezeMotion').onclick = async () => {
  const scene = document.getElementById('motionScene').value;
  const target = scene === 'map' ? document.querySelector('.data-hero-map-shell')
    : scene === 'grid' ? document.querySelector('.data-truth, .api-guardrails, .architecture-stage')
    : document.getElementById('tomtomProvider') || document.querySelector('.modular-panel');
  if (!target) { document.getElementById('motionResult').textContent = 'This scene is not on this page.'; return; }
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
  if (scene === 'border') target.focus({ preventScroll: true });
  await new Promise(resolve => setTimeout(resolve, 100));
  target.getAnimations({ subtree: true }).filter(animation => scene === 'border'
    ? animation.transitionProperty === 'stroke-dashoffset' || animation.transitionProperty === '--architecture-trace-angle'
    : /grid.*(sweep|descent|glow)|guardrail-grid|corridor-geometry-glow/.test(animation.animationName)).forEach(animation => {
      animation.pause(); animation.currentTime = animation.effect.getTiming().duration * (scene === 'grid' ? .45 : .15);
    });
  controls.hidden = true;
};
document.getElementById('measureMotion').onclick = async () => {
  const button = document.getElementById('measureMotion');
  const output = document.getElementById('motionResult');
  const border = document.getElementById('tomtomProvider') || document.querySelector('.modular-panel');
  const grid = document.querySelector('.data-truth, .api-guardrails, .architecture-stage');
  const scene = document.getElementById('motionScene').value;
  const target = scene === 'map' ? document.querySelector('.data-hero-map-shell') : scene === 'grid' ? grid : border;
  if (!target) { output.textContent = 'This scene is not on this page.'; return; }
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
  await new Promise(resolve => setTimeout(resolve, 500));
  button.disabled = true;
  output.textContent = 'Sampling for 8 seconds…';
  const originalRect = Element.prototype.getBoundingClientRect;
  let rectReads = 0;
  Element.prototype.getBoundingClientRect = function(...args) { rectReads++; return originalRect.apply(this, args); };
  let longTasks = [];
  const observer = typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration))) : null;
  observer?.observe({ type: 'longtask' });
  const frames = [];
  let previous = performance.now();
  const start = previous;
  let nextFocus = start;
  let active = false;
  await new Promise(resolve => {
    const frame = now => {
      frames.push(now - previous); previous = now;
      if (scene === 'border' && now >= nextFocus) {
        active = !active; nextFocus = now + 800;
        if (active) target.focus({ preventScroll: true }); else target.blur();
      }
      if (now - start < 8000) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
  target.blur();
  Element.prototype.getBoundingClientRect = originalRect;
  observer?.disconnect();
  const sorted = frames.slice(1).sort((a, b) => a - b);
  const percentile = p => Math.round(sorted[Math.floor((sorted.length - 1) * p)] * 100) / 100;
  const result = { revision: revision.value, scene, frames: sorted.length, medianMs: percentile(.5), p95Ms: percentile(.95),
    framesOver25ms: sorted.filter(ms => ms > 25).length, longTasks: longTasks.length,
    longTaskMs: Math.round(longTasks.reduce((sum, ms) => sum + ms, 0)), layoutRectReads: rectReads };
  output.textContent = JSON.stringify(result);
  button.disabled = false;
};
`;

http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:8092');
  if (url.pathname.startsWith('/dashboard-api/') || url.pathname.startsWith('/actuator/')) {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    const upstream = http.get({ hostname: '127.0.0.1', port: 8080, path: url.pathname + url.search }, source => {
      response.writeHead(source.statusCode, { 'Content-Type': source.headers['content-type'] || 'application/json' });
      source.pipe(response);
    });
    upstream.on('error', () => response.writeHead(502).end());
    return;
  }
  if (url.pathname === '/_motion/probe.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }).end(probe);
    return;
  }
  const target = path.resolve(root, `.${url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname}`);
  if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const variant = request.headers.cookie?.match(/(?:^|; )motionRevision=(original|stripped)/)?.[1];
    const ref = revisions[variant];
    const relative = path.relative(root, target).split(path.sep).join('/');
    const comparable = /dashboard\/(information\.(css)|information-pages\.js|data-hero-map\.js|road-sign-display\.js)$/.test(relative);
    let data;
    if (ref && comparable) {
      const key = ref + relative;
      if (!cache.has(key)) cache.set(key, execFileSync('git', ['show', ref + ':api-service/src/main/resources/static/' + relative],
        { cwd: path.resolve(__dirname, '../..'), maxBuffer: 2 * 1024 * 1024 }));
      data = cache.get(key);
    } else data = readFileSync(target);
    const headers = { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (path.extname(target) === '.html') {
      const requested = Object.hasOwn(revisions, url.searchParams.get('motionRevision')) ? url.searchParams.get('motionRevision') : 'current';
      headers['Set-Cookie'] = 'motionRevision=' + requested + '; Path=/; SameSite=Strict';
      data = data.toString().replace('</body>', '<script src="/_motion/probe.js"></script></body>');
    }
    response.writeHead(200, headers).end(data);
  } catch { response.writeHead(404).end(); }
}).listen(8092, '127.0.0.1', () => console.log('Motion comparison: http://127.0.0.1:8092/dashboard/system.html?motionRevision=current'));
