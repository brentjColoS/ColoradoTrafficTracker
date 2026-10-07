// Local test fixture server only. Never used by the application or container.
// node scripts/tests/dashboard-preview.cjs
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../../api-service/src/main/resources/static');
const now = new Date();
let rendererRetryFailed = false;
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
  const scenario = url.searchParams.get('fixture')
    || new URL(request.headers.referer || url, url).searchParams.get('fixture') || 'live';
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
    if (applicationPath.endsWith('/latest')) {
      payload={corridor,polledAt:timestamp(corridor==='I25'?0.01:0.02),
        avgCurrentSpeed:corridor==='I25'?61:54,avgFreeflowSpeed:70};
    } else if (applicationPath.endsWith('/history') && !applicationPath.includes('/zones/')) {
      payload = { samples: scenario === 'empty' ? [] : [{ corridor,
        avgCurrentSpeed: corridor === 'I25' ? 61 : 54, avgFreeflowSpeed: 70,
        polledAt: timestamp(0.01, anchor) }] };
    } else if (applicationPath.includes('/flow-cells/')) {
      const firstMarker = corridor === 'I25' ? 208 : 206;
      const lastMarker = corridor === 'I25' ? 271 : 259;
      const cells = scenario === 'empty' ? [] : Array.from({ length: (lastMarker - firstMarker) * 2 }, (_, i) => ({
        cellId: `${corridor}:${(firstMarker + i / 2).toFixed(3)}-${(firstMarker + (i + 1) / 2).toFixed(3)}`,
        startMileMarker: firstMarker + i / 2, endMileMarker: firstMarker + (i + 1) / 2,
        direction: 'COMBINED', speedMph: i === 12 ? 2 : 49 + 17 * Math.sin(i / 9),
        quality: i % 17 === 0 ? 'PARTIAL_CELL' : 'FULL_CELL',
        closureEvidence: i === 12 ? 'FULL_REPORTED' : 'NONE',
        lengthWeightedSourceSpanMiles: 1.4, observedAt: timestamp(0.01, anchor)
      }));
      if (applicationPath.endsWith('/frequency')) {
        const requestedHourCount = Number(url.searchParams.get('windowHours'));
        const sampledHourCount = Math.min(168, requestedHourCount);
        payload = { corridor, resolution: 'SLOWDOWN_FREQUENCY', requestedHourCount,
          availableHourCount: cells.length ? sampledHourCount : 0,
          windowStart: timestamp(requestedHourCount, anchor), windowEnd: anchor.toISOString(),
          cells: cells.map(({ speedMph, quality, closureEvidence, observedAt, lengthWeightedSourceSpanMiles, ...cell }, i) => ({
            ...cell, avgSpeedMph: speedMph, postedSpeedMph: speedZones(corridor)
              .find(zone => cell.startMileMarker >= zone.startMileMarker && cell.startMileMarker < zone.endMileMarker)?.postedSpeedMph,
            sampledHourCount, observationCount: sampledHourCount * 60,
            slowdownHourCount: Math.round(sampledHourCount * (i % 20) / 20),
            heavySlowdownHourCount: Math.round(sampledHourCount * (i % 20) / 40),
            severeSlowdownHourCount: Math.round(sampledHourCount * (i % 20) / 80),
            stoppedHourCount: i >= 12 && i <= 15 ? Math.round(sampledHourCount * 0.2) : 0,
            firstObservedAt: timestamp(sampledHourCount, anchor), lastObservedAt: observedAt
          })) };
      } else if (applicationPath.endsWith('/hourly')) {
        const hourStart = new Date(Math.floor(anchor.getTime() / 3_600_000) * 3_600_000);
        payload = { corridor, resolution: 'HOURLY', hourStart: hourStart.toISOString(),
          hourEnd: new Date(hourStart.getTime() + 3_600_000).toISOString(),
          cells: cells.map(({ speedMph, quality, closureEvidence, observedAt, lengthWeightedSourceSpanMiles, ...cell }) => ({
            ...cell, avgSpeedMph: speedMph, observationCount: 60,
            fullCellObservationCount: quality === 'FULL_CELL' ? 60 : 0,
            closureObservationCount: closureEvidence === 'FULL_REPORTED' ? 60 : 0,
            avgLengthWeightedSourceSpanMiles: lengthWeightedSourceSpanMiles, lastObservedAt: observedAt
          })) };
      } else {
        const currentCells = scenario === 'mixed-flow'
          ? [...cells, ...cells.slice(0,13).map(cell => ({ ...cell, cellId:`${cell.cellId}:directional`,
            direction:corridor === 'I25' ? 'NORTHBOUND' : 'EASTBOUND', speedMph:1 }))]
          : cells;
        if (scenario === 'flow-zero' && currentCells[0]) currentCells[0].speedMph = 0;
        payload = { corridor, observedAt: timestamp(0.01, anchor), cellSizeMiles: 0.5,
          status: 'OBSERVED', supportedCellCount: currentCells.length, totalCellCount: currentCells.length,
          cells:currentCells };
      }
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
      const incidentAges = [1,6,2,5,4,3].flatMap((count,day) =>
        Array.from({length:count},(_,index) => (6-day)*24+index*0.02));
      payload = { features: scenario === 'empty' ? [] : Array.from({length:scenario === 'many-incidents' ? 96 : scenario === 'incident-days' ? incidentAges.length : 8}, (_, i) => ({
        type: 'Feature', id: String(i), geometry: { type: 'Point', coordinates: corridor === 'I25'
          ? [-104.99 - (i % 8) * 0.006, 39.76 + (i % 8) * 0.11]
          : [-106.02 + (i % 8) * 0.105, 39.69 + (i % 8) * 0.008] }, properties: {
          corridor, incidentProvider:'cdot', providerEventId: String(i), active: i < 4,
          normalizedStatus: i === 1 ? 'planned' : i < 4 ? 'active' : 'cleared',
          incidentTypeLabel: ['Two-vehicle crash','Road construction','Road closure','Disabled vehicle'][i % 4],
          incidentImpactLabel: i % 2 === 0 ? 'Right lane closed · Slower speeds advised' : null,
          incidentNote: 'Expect delays.', sourceSeverity: i % 2 === 0 ? 'major' : null,
          sourceStartedAt: timestamp(1.5 + i * 0.02, anchor),
          sourceEndedAt: i >= 4 ? timestamp(0.1 + i * 0.01, anchor) : null,
          normalizedCategory: ['CRASH','CONSTRUCTION','CLOSURE','DISABLED_VEHICLE'][i % 4],
          firstSeenAt: timestamp(1 + i * 0.02, anchor), lastSeenAt: timestamp(0.1 + i * 0.01, anchor),
          closestMileMarker: 220 + (i % 8), locationLabel: `Very long provider location near mile marker ${220+(i % 8)}, ramp and roadway description for narrow-screen testing`
        } })) };
      if (scenario === 'incident-days') payload.features.forEach((feature,index) => {
        const age=incidentAges[index];
        Object.assign(feature.properties,{active:false,normalizedStatus:'cleared',
          sourceStartedAt:timestamp(age,anchor),sourceEndedAt:timestamp(age-0.5,anchor),
          firstSeenAt:timestamp(age,anchor),lastSeenAt:timestamp(age-0.5,anchor)});
      });
    } else if (applicationPath.endsWith('/zones/history')) {
      payload = { samples: scenario === 'empty' ? [] : [{ avgCurrentSpeed: 38,
        polledAt: timestamp(0.01, anchor), zoneDescription: 'Northglenn / Thornton transition with a long description',
        startMileMarker: corridor === 'I25' ? 221 : 241, endMileMarker: corridor === 'I25' ? 225 : 248 }] };
    } else if (applicationPath.endsWith('/operational-status')) {
      payload = { status: scenario === 'empty' ? 'OUT_OF_SERVICE' : 'HEALTHY', checks: [{component:'flow:I25',status: 'HEALTHY'}] };
    } else if (applicationPath.endsWith('/map/config')) {
      payload = { provider: 'USGS_IMAGERY', tileUrl: null, overviewTileUrl: null,
        detailMinZoom: 0, maxZoom: 16, attribution: 'USGS The National Map' };
      if (scenario === 'map-config-slow') {
        setTimeout(() => response.end(JSON.stringify(payload)), 4000);
        return;
      }
    } else if (applicationPath.endsWith('/corridors')) {
      payload = { features: ['I25','I70'].map(corridor => ({
        type: 'Feature',
        properties: { corridor, mileMarkerRange: corridor === 'I25' ? 'MM 208 to 271' : 'MM 206 to 259',
          startMileMarker: corridor === 'I25' ? 208 : 206, endMileMarker: corridor === 'I25' ? 271 : 259,
          mileMarkerAnchorsJson: JSON.stringify(corridor === 'I25'
            ? [{mileMarker:208,longitude:-104.99,latitude:39.71},{mileMarker:271,longitude:-105.01,latitude:40.72}]
            : [{mileMarker:206,longitude:-106.12,latitude:39.68},{mileMarker:259,longitude:-105.24,latitude:39.70}]),
          speedLimitSegments: speedZones(corridor).map(zone => ({...zone,speedLimitMph:zone.postedSpeedMph})) },
        geometry: scenario === 'missing-geometry' ? null : { type: 'LineString', coordinates: corridor === 'I25'
          ? [[-104.99,39.71],[-104.98,40.02],[-105.08,40.48],[-105.01,40.72]]
          : [[-106.12,39.68],[-105.78,39.70],[-105.51,39.74],[-105.24,39.70]] }
      })) };
    } else payload = { status: 'UP' };
    response.end(JSON.stringify(payload)); return;
  }
  const relative = applicationPath.endsWith('/') ? `${applicationPath}index.html` : applicationPath;
  if (scenario === 'renderer-retry' && relative.endsWith('maplibre-gl.mjs') && !rendererRetryFailed) {
    rendererRetryFailed = true;
    response.writeHead(503, {'Cache-Control':'no-store'});
    response.end('Simulated transient module load failure');
    return;
  }
  const target = path.resolve(root, `.${relative}`);
  if (!target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    let body = await fs.readFile(target);
    if (target.endsWith('index.html')) body = Buffer.from(body.toString().replace('<body>',
      '<body><div style="background:#d5a021;color:#002500;text-align:center">TEST FIXTURES · Synthetic API responses, not live traffic</div>'
      + '<script>const fixtureFetch=window.fetch.bind(window);document.documentElement.dataset.fixtureReads="0";window.fetch=(...args)=>{const url=String(args[0]);if(url.includes("/dashboard-api/")||url.includes("/dashboard-experimental-api/")||url.includes("/actuator/health")||url.includes("/dashboard-experimental-health"))document.documentElement.dataset.fixtureReads=String(Number(document.documentElement.dataset.fixtureReads)+1);return fixtureFetch(...args);};</script>'
      + (scenario === 'renderer-retry'
        ? '<script>window.CORRIDOR_MAP_RENDERER_LOADER = attempt => import(`./vendor/maplibre-gl/6.10.0/maplibre-gl.mjs?fixture=renderer-retry&attempt=${attempt}`);</script>'
        : scenario === 'no-webgl'
        ? '<script>window.CORRIDOR_MAP_RENDERER_LOADER = async () => { throw new Error("Simulated WebGL unavailable"); };</script>'
        : scenario === 'basemap-offline'
          ? '<script>window.CORRIDOR_MAP_RENDERER_LOADER = async () => { const module = await import("./vendor/maplibre-gl/6.10.0/maplibre-gl.mjs"); const renderer = module.default || module; return { ...renderer, Map: class extends renderer.Map { constructor(options) { options.style.sources["base-map"].tiles = ["http://127.0.0.1:8091/fixture-missing-tile/{z}/{y}/{x}"]; super(options); } } }; };</script>'
          : '')));
    response.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(target)] || 'application/octet-stream');
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
}).listen(8091, '127.0.0.1', () => console.log('Fixture preview: http://127.0.0.1:8091/dashboard/?fixture=live (also partial, empty, offline)'));
