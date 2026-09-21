// Local test fixture server only. Never used by the application or container.
// node scripts/tests/dashboard-preview.cjs
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../../api-service/src/main/resources/static');
const now = new Date();
const timestamp = hours => new Date(now.getTime() - hours * 3_600_000).toISOString();

http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:8091');
  const scenario = new URL(request.headers.referer || url, url).searchParams.get('fixture') || 'live';
  const corridor = url.searchParams.get('corridor') || 'I25';
  if (url.pathname.startsWith('/dashboard-api/') || url.pathname === '/actuator/health') {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (scenario === 'offline' || (scenario === 'partial' && corridor === 'I70' && url.pathname.includes('/traffic/'))) {
      response.writeHead(503); response.end('{"error":"Simulated outage"}'); return;
    }
    let payload;
    if (url.pathname.endsWith('/summary')) {
      payload = { latest: scenario === 'empty' ? null : { avgCurrentSpeed: corridor === 'I25' ? 61 : 54,
        avgFreeflowSpeed: 70, polledAt: timestamp(0.01) },
        providerStatus: { halted: false, stale: false } };
    } else if (url.pathname.endsWith('/trends')) {
      const hours = Number(url.searchParams.get('windowHours'));
      payload = { buckets: scenario === 'empty' ? [] : Array.from({length:hours}, (_, i) => ({
        bucketStart: timestamp(i), avgCurrentSpeed: 50 + 10 * Math.sin(i / 5), sampleCount: 60 })) };
    } else if (url.pathname.endsWith('/incidents/recent')) {
      payload = { features: scenario === 'empty' ? [] : Array.from({length:8}, (_, i) => ({
        type: 'Feature', id: String(i), geometry: { type: 'Point', coordinates: corridor === 'I25'
          ? [-104.99 - i * 0.006, 39.76 + i * 0.11]
          : [-106.02 + i * 0.105, 39.69 + i * 0.008] }, properties: {
          corridor, incidentProvider:'cdot', providerEventId: String(i), active: i < 4,
          normalizedCategory: ['CRASH','CONSTRUCTION','CLOSURE','DISABLED_VEHICLE'][i % 4],
          firstSeenAt: timestamp(1 + i * 0.02), lastSeenAt: timestamp(0.1 + i * 0.01),
          closestMileMarker: 220 + i, locationLabel: `Very long provider location near mile marker ${220+i}, ramp and roadway description for narrow-screen testing`
        } })) };
    } else if (url.pathname.endsWith('/zones/history')) {
      payload = { samples: scenario === 'empty' ? [] : [{ avgCurrentSpeed: 38,
        polledAt: timestamp(0.01), zoneDescription: 'Northglenn / Thornton transition with a long description',
        startMileMarker: corridor === 'I25' ? 221 : 241, endMileMarker: corridor === 'I25' ? 225 : 248 }] };
    } else if (url.pathname.endsWith('/operational-status')) {
      payload = { status: scenario === 'empty' ? 'OUT_OF_SERVICE' : 'HEALTHY', checks: [{component:'flow:I25',status: 'HEALTHY'}] };
    } else if (url.pathname.endsWith('/corridors')) {
      payload = { features: ['I25','I70'].map(corridor => ({
        type: 'Feature',
        properties: { corridor, mileMarkerRange: corridor === 'I25' ? 'MM 208 to 271' : 'MM 206 to 259' },
        geometry: { type: 'LineString', coordinates: corridor === 'I25'
          ? [[-104.99,39.71],[-104.98,40.02],[-105.08,40.48],[-105.01,40.72]]
          : [[-106.12,39.68],[-105.78,39.70],[-105.51,39.74],[-105.24,39.70]] }
      })) };
    } else payload = { status: 'UP' };
    response.end(JSON.stringify(payload)); return;
  }
  const relative = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const target = path.resolve(root, `.${relative}`);
  if (!target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    let body = await fs.readFile(target);
    if (target.endsWith('index.html')) body = Buffer.from(body.toString().replace('<body>',
      '<body><div style="background:#d5a021;color:#002500;text-align:center">TEST FIXTURES · Synthetic API responses, not live traffic</div>'));
    response.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(target)] || 'application/octet-stream');
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
}).listen(8091, '127.0.0.1', () => console.log('Fixture preview: http://127.0.0.1:8091/dashboard/?fixture=live (also partial, empty, offline)'));
