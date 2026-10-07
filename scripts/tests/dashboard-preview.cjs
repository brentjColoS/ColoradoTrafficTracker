// Local test fixture server only. Never used by the application or container.
// node scripts/tests/dashboard-preview.cjs
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../../api-service/src/main/resources/static');
const now = new Date();
const timestamp = (hours, anchor = now) => new Date(anchor.getTime() - hours * 3_600_000).toISOString();
const speedZones = corridor => corridor === 'I25'
  ? [
      { zoneKey: 'I25-208-221.5', zoneOrder: 0, startMileMarker: 208, endMileMarker: 221.5, postedSpeedMph: 55, meanSpeed: 52 },
      { zoneKey: 'I25-221.5-225.6', zoneOrder: 1, startMileMarker: 221.5, endMileMarker: 225.6, postedSpeedMph: 65, meanSpeed: 64 },
      { zoneKey: 'I25-225.6-271', zoneOrder: 2, startMileMarker: 225.6, endMileMarker: 271, postedSpeedMph: 75, meanSpeed: 69 }
    ]
  : [
      { zoneKey: 'I70-206-213', zoneOrder: 0, startMileMarker: 206, endMileMarker: 213, postedSpeedMph: 55, meanSpeed: 48 },
      { zoneKey: 'I70-213-241', zoneOrder: 1, startMileMarker: 213, endMileMarker: 241, postedSpeedMph: 65, meanSpeed: 57 },
      { zoneKey: 'I70-241-259', zoneOrder: 2, startMileMarker: 241, endMileMarker: 259, postedSpeedMph: 65, meanSpeed: 53 }
    ];

http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:8091');
  const applicationPath = url.pathname
    .replace(/^\/dashboard-experimental-api(?=\/|$)/, '/dashboard-api')
    .replace(/^\/dashboard-experimental-health$/, '/actuator/health')
    .replace(/^\/dashboard-experimental(?=\/|$)/, '/dashboard');
  const scenario = new URL(request.headers.referer || url, url).searchParams.get('fixture') || 'live';
  const corridor = url.searchParams.get('corridor') || 'I25';
  const requestedAnchor = new Date(url.searchParams.get('asOf') || now);
  const anchor = Number.isFinite(requestedAnchor.getTime()) ? requestedAnchor : now;
  if (applicationPath.startsWith('/dashboard-api/') || applicationPath === '/actuator/health') {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (scenario === 'offline' || (scenario === 'partial' && corridor === 'I70' && applicationPath.includes('/traffic/'))) {
      response.writeHead(503); response.end('{"error":"Simulated outage"}'); return;
    }
    let payload;
    if (applicationPath.endsWith('/history') && !applicationPath.includes('/zones/')) {
      payload = { samples: scenario === 'empty' ? [] : [{ corridor,
        avgCurrentSpeed: corridor === 'I25' ? 61 : 54, avgFreeflowSpeed: 70,
        polledAt: timestamp(0.01, anchor) }] };
    } else if (applicationPath.endsWith('/summary')) {
      payload = { latest: scenario === 'empty' ? null : { avgCurrentSpeed: corridor === 'I25' ? 61 : 54,
        avgFreeflowSpeed: 70, polledAt: timestamp(0.01) },
        providerStatus: { halted: false, stale: false } };
    } else if (applicationPath.endsWith('/zones/trends')) {
      const hours = Number(url.searchParams.get('windowHours'));
      const pointsPerHour = hours <= 24 ? 4 : hours <= 168 ? 1 : 1 / 3;
      const pointCount = Math.ceil(hours * pointsPerHour);
      payload = { points: scenario === 'empty' ? [] : speedZones(corridor).flatMap(zone =>
        Array.from({length:pointCount}, (_, i) => ({
          ...zone,
          bucketStart: timestamp(i / pointsPerHour, anchor),
          avgCurrentSpeed: zone.meanSpeed + 3 * Math.sin(i / 8 + zone.zoneOrder),
          observationCount: 15
        }))) };
    } else if (applicationPath.endsWith('/zones/baselines')) {
      payload = { zones: scenario === 'empty' ? [] : speedZones(corridor).map(zone => ({
        ...zone,
        profiles: Array.from({length:7 * 24}, (_, i) => ({
          dayOfWeek: Math.floor(i / 24) + 1,
          hourOfDay: i % 24,
          sampleCount: 13,
          effectiveSampleSize: 9.5,
          meanSpeed: zone.meanSpeed + 2 * Math.cos((i % 24) / 3),
          standardDeviation: 2.8,
          coverageOneSigma: 69.2,
          coverageTwoSigma: 94.1,
          coverageThreeSigma: 99.1
        }))
      })) };
    } else if (applicationPath.endsWith('/trends')) {
      const hours = Number(url.searchParams.get('windowHours'));
      payload = { buckets: scenario === 'empty' ? [] : Array.from({length:hours}, (_, i) => ({
        bucketStart: timestamp(i, anchor), avgCurrentSpeed: 50 + 10 * Math.sin(i / 5), sampleCount: 60 })) };
    } else if (applicationPath.endsWith('/baselines')) {
      payload = { corridor, lookbackWeeks: 13, recencyHalfLifeWeeks: 8,
        profiles: scenario === 'empty' ? [] : Array.from({length:168}, (_, i) => ({
          dayOfWeek: Math.floor(i / 24) + 1, hourOfDay: i % 24,
          sourceProfile: 'EXACT_DAY', sampleCount: 13, effectiveSampleSize: 10.5,
          meanSpeed: 62 + 4 * Math.sin((i % 24) / 4), standardDeviation: 3,
          coverageOneSigma: 70, coverageTwoSigma: 95, coverageThreeSigma: 99 })) };
    } else if (applicationPath.endsWith('/incidents/recent') || applicationPath.endsWith('/incidents/timeline')) {
      payload = { features: scenario === 'empty' ? [] : Array.from({length:8}, (_, i) => ({
        type: 'Feature', id: String(i), geometry: { type: 'Point', coordinates: corridor === 'I25'
          ? [-104.99 - i * 0.006, 39.76 + i * 0.11]
          : [-106.02 + i * 0.105, 39.69 + i * 0.008] }, properties: {
          corridor, incidentProvider:'cdot', providerEventId: String(i), active: i < 4,
          normalizedCategory: ['CRASH','CONSTRUCTION','CLOSURE','DISABLED_VEHICLE'][i % 4],
          firstSeenAt: timestamp(1 + i * 0.02, anchor), lastSeenAt: timestamp(0.1 + i * 0.01, anchor),
          closestMileMarker: 220 + i, locationLabel: `Very long provider location near mile marker ${220+i}, ramp and roadway description for narrow-screen testing`
        } })) };
    } else if (applicationPath.endsWith('/zones/history')) {
      payload = { samples: scenario === 'empty' ? [] : [{ avgCurrentSpeed: 38,
        polledAt: timestamp(0.01, anchor), zoneDescription: 'Northglenn / Thornton transition with a long description',
        startMileMarker: corridor === 'I25' ? 221 : 241, endMileMarker: corridor === 'I25' ? 225 : 248 }] };
    } else if (applicationPath.endsWith('/operational-status')) {
      payload = { status: scenario === 'empty' ? 'OUT_OF_SERVICE' : 'HEALTHY', checks: [{component:'flow:I25',status: 'HEALTHY'}] };
    } else if (applicationPath.endsWith('/corridors')) {
      payload = { features: ['I25','I70'].map(corridor => ({
        type: 'Feature',
        properties: { corridor, mileMarkerRange: corridor === 'I25' ? 'MM 208 to 271' : 'MM 206 to 259' },
        geometry: scenario === 'missing-geometry' ? null : { type: 'LineString', coordinates: corridor === 'I25'
          ? [[-104.99,39.71],[-104.98,40.02],[-105.08,40.48],[-105.01,40.72]]
          : [[-106.12,39.68],[-105.78,39.70],[-105.51,39.74],[-105.24,39.70]] }
      })) };
    } else payload = { status: 'UP' };
    response.end(JSON.stringify(payload)); return;
  }
  const relative = applicationPath.endsWith('/') ? `${applicationPath}index.html` : applicationPath;
  const target = path.resolve(root, `.${relative}`);
  if (!target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    let body = await fs.readFile(target);
    if (target.endsWith('index.html')) body = Buffer.from(body.toString().replace('<body>',
      '<body><div style="background:#d5a021;color:#002500;text-align:center">TEST FIXTURES · Synthetic API responses, not live traffic</div>'
      + (scenario === 'no-webgl'
        ? '<script>window.CORRIDOR_MAP_RENDERER_LOADER = async () => { throw new Error("Simulated WebGL unavailable"); };</script>'
        : scenario === 'basemap-offline'
          ? '<script>window.CORRIDOR_MAP_RENDERER_LOADER = async () => { const module = await import("./vendor/maplibre-gl/6.10.0/maplibre-gl.mjs"); const renderer = module.default || module; return { ...renderer, Map: class extends renderer.Map { constructor(options) { options.style.sources["usgs-imagery"].tiles = ["http://127.0.0.1:8091/fixture-missing-tile/{z}/{y}/{x}"]; super(options); } } }; };</script>'
          : '')));
    response.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(target)] || 'application/octet-stream');
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
}).listen(8091, '127.0.0.1', () => console.log('Fixture preview: http://127.0.0.1:8091/dashboard/?fixture=live (also partial, empty, offline)'));
