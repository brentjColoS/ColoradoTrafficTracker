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
      { zoneKey: 'I25-221.5-225.552', zoneOrder: 1, startMileMarker: 221.5, endMileMarker: 225.552, postedSpeedMph: 65, meanSpeed: 64 },
      { zoneKey: 'I25-225.552-271', zoneOrder: 2, startMileMarker: 225.552, endMileMarker: 271, postedSpeedMph: 75, meanSpeed: 69 }
    ]
  : [
      { zoneKey: 'I70-206-213.1', zoneOrder: 0, startMileMarker: 206, endMileMarker: 213.1, postedSpeedMph: 60, meanSpeed: 57 },
      { zoneKey: 'I70-213.1-216', zoneOrder: 1, startMileMarker: 213.1, endMileMarker: 216, postedSpeedMph: 50, meanSpeed: 48 },
      { zoneKey: 'I70-216-236.918', zoneOrder: 2, startMileMarker: 216, endMileMarker: 236.918, postedSpeedMph: 65, meanSpeed: 61 },
      { zoneKey: 'I70-236.918-241.907', zoneOrder: 3, startMileMarker: 236.918, endMileMarker: 241.907, postedSpeedMph: 60, meanSpeed: 57 },
      { zoneKey: 'I70-241.907-244.857', zoneOrder: 4, startMileMarker: 241.907, endMileMarker: 244.857, postedSpeedMph: 55, meanSpeed: 48 },
      { zoneKey: 'I70-244.857-259', zoneOrder: 5, startMileMarker: 244.857, endMileMarker: 259, postedSpeedMph: 65, meanSpeed: 61 },
      { zoneKey: 'I70-259-270.274', zoneOrder: 6, startMileMarker: 259, endMileMarker: 270.274, postedSpeedMph: 65, meanSpeed: 60 },
      { zoneKey: 'I70-270.274-274', zoneOrder: 7, startMileMarker: 270.274, endMileMarker: 274, postedSpeedMph: 55, meanSpeed: 52 }
    ];

const corridorAnchors = {
  I25: [
    [270,-105.001174195225,40.590171980614], [260,-104.991997127422,40.445981035731],
    [250,-104.98000646745,40.303072617259], [240,-104.978713561276,40.157685016179],
    [230,-104.980473524688,40.013270186075], [220,-104.987450492723,39.870285163849],
    [208,-104.99920320449,39.711720826613]
  ],
  I70: [
    [206,-106.058025563177,39.632205846749], [220,-105.828582388241,39.696194852106],
    [230,-105.683025039394,39.742841574291], [240,-105.513813345934,39.741309065372],
    [250,-105.350078159378,39.710105229473], [259,-105.202015720029,39.701852940097],
    [260,-105.192415373837,39.714331682376], [270,-105.06261665597,39.783313123815],
    [274,-104.990514722445,39.78026018504]
  ]
};

const batchFixtures = new Map();
function fixtureBatch(scenario) {
  if (!batchFixtures.has(scenario)) batchFixtures.set(scenario, require('./dashboard-batch-fixture.cjs').batchFetch(
    async path => new Promise((resolve,reject) => {
      const resource = new URL(path, 'http://127.0.0.1');
      resource.searchParams.set('fixture',scenario);
      const reply = {statusCode:200, setHeader(){}, writeHead(status){this.statusCode=status;}, once(){},
        end(body){
          let value;try {value=JSON.parse(String(body));}catch(error){reject(error);return;}
          resolve({ok:this.statusCode===200,status:this.statusCode,json:async()=>value});
        }};
      handleRequest({url:resource.pathname+resource.search,headers:{}},reply).catch(reject);
    })
  ));
  return batchFixtures.get(scenario);
}

async function handleRequest(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1:8091');
  const applicationPath = url.pathname
    .replace(/^\/dashboard-experimental-api(?=\/|$)/, '/dashboard-api')
    .replace(/^\/dashboard-experimental-health$/, '/actuator/health')
    .replace(/^\/dashboard-experimental(?=\/|$)/, '/dashboard');
  const scenario = url.searchParams.get('fixture')
    || new URL(request.headers.referer || url, url).searchParams.get('fixture') || 'live';
  if ((scenario === 'data-slow' && applicationPath.endsWith('/summary'))
      || (scenario === 'hero-geometry-slow' && applicationPath.endsWith('/corridors'))
      || (scenario === 'api-slow' && applicationPath.startsWith('/dashboard-api/'))) {
    const timer = setTimeout(() => {
      response.writeHead(503, {'Content-Type':'application/json'});
      response.end('{"error":"Simulated delayed retained read"}');
    }, 10_000);
    response.once('close', () => clearTimeout(timer));
    return;
  }
  if (/\/traffic\/dashboard\/(snapshot|history)$/.test(applicationPath)) {
    const payload = await fixtureBatch(scenario)(url.pathname + url.search);
    response.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});
    response.end(JSON.stringify(await payload.json()));
    return;
  }
  const corridor = url.searchParams.get('corridor') || 'I25';
  const requestedAnchor = new Date(url.searchParams.get('asOf') || new Date());
  const anchor = Number.isFinite(requestedAnchor.getTime()) ? requestedAnchor : now;
  if (applicationPath.startsWith('/dashboard-api/') || applicationPath === '/actuator/health') {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-RateLimit-Limit', '120');
    response.setHeader('X-RateLimit-Remaining', '0');
    if (scenario === 'api-rate-limited') {
      response.setHeader('Retry-After', '60');
      response.writeHead(429); response.end('{"error":"rate_limited","message":"Per-minute request limit exceeded"}'); return;
    }
    if (scenario === 'offline' || (scenario === 'partial' && corridor === 'I70' && applicationPath.includes('/traffic/'))) {
      response.writeHead(503); response.end('{"error":"Simulated outage"}'); return;
    }
    let payload;
    if (url.searchParams.has('asOf') && (scenario === 'history-read-failure'
        || (scenario === 'history-read-partial' && corridor === 'I70')
        || scenario === 'history-rate-limited')) {
      response.setHeader('Retry-After','60');
      response.writeHead(scenario === 'history-rate-limited' ? 429 : 503);
      response.end('{"error":"Simulated historical read failure"}'); return;
    }
    if (applicationPath.endsWith('/analytics/coverage')) {
      if (scenario === 'history-coverage-partial' && corridor === 'I70') {
        response.writeHead(503); response.end('{"error":"Simulated missing I70 history bounds"}'); return;
      }
      payload = {corridor,firstObservedAt:scenario === 'empty' ? null : timestamp(180 * 24),
        lastObservedAt:scenario === 'empty' ? null : timestamp(0.01),
        firstZoneObservedAt:scenario === 'empty' ? null : timestamp(45 * 24),
        lastZoneObservedAt:scenario === 'empty' ? null : timestamp(0.01)};
    } else if (applicationPath.endsWith('/latest')) {
      payload={corridor,polledAt:timestamp(corridor==='I25'?0.01:0.02),
        avgCurrentSpeed:corridor==='I25'?61:54,avgFreeflowSpeed:70};
    } else if (applicationPath.endsWith('/history') && !applicationPath.includes('/zones/')) {
      payload = { samples: scenario === 'empty' ? [] : [{ corridor,
        avgCurrentSpeed: corridor === 'I25' ? 61 : 54, avgFreeflowSpeed: 70,
        polledAt: timestamp(0.01, anchor) }] };
    } else if (applicationPath.includes('/flow-cells/')) {
      const firstMarker = corridor === 'I25' ? 208 : 206;
      const lastMarker = corridor === 'I25' ? 271 : 274;
      const cells = scenario === 'empty' ? [] : Array.from({ length: (lastMarker - firstMarker) * 2 }, (_, i) => ({
        cellId: `${corridor}:${(firstMarker + i / 2).toFixed(3)}-${(firstMarker + (i + 1) / 2).toFixed(3)}`,
        startMileMarker: firstMarker + i / 2, endMileMarker: firstMarker + (i + 1) / 2,
        direction: 'COMBINED', speedMph: i === 12 ? 2 : 49 + 17 * Math.sin(i / 9),
        quality: i % 17 === 0 ? 'PARTIAL_CELL' : 'FULL_CELL',
        closureEvidence: i === 12 ? 'FULL_REPORTED' : 'NONE',
        lengthWeightedSourceSpanMiles: 1.4, observedAt: timestamp(scenario === 'pace-retained' && corridor === 'I70' ? 24.01 : 0.01, anchor)
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
        payload = { corridor, observedAt: timestamp(scenario === 'pace-retained' && corridor === 'I70' ? 24.01 : 0.01, anchor), cellSizeMiles: 0.5,
          status: 'OBSERVED', supportedCellCount: currentCells.length, totalCellCount: currentCells.length,
          cells:currentCells };
      }
    } else if (applicationPath.endsWith('/summary')) {
      payload = { latest: scenario === 'empty' ? null : { avgCurrentSpeed: corridor === 'I25' ? 61 : 54,
        avgFreeflowSpeed: 70, polledAt: timestamp(['retained-days','pace-retained'].includes(scenario) && corridor === 'I70' ? 24.01 : 0.01, anchor) },
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
    } else if (applicationPath.endsWith('/incidents/recent') || applicationPath.endsWith('/incidents/timeline') || applicationPath.endsWith('/incidents/shared')) {
      const incidentAges = [1,6,2,5,4,3].flatMap((count,day) =>
        Array.from({length:count},(_,index) => (6-day)*24+index*0.02));
      payload = { features: scenario === 'empty' ? [] : Array.from({length:scenario === 'many-incidents' ? 96 : scenario === 'incident-days' ? incidentAges.length : 8}, (_, i) => ({
        type: 'Feature', id: String(i), geometry: { type: 'Point', coordinates: corridor === 'I25'
          ? [-104.99 - (i % 8) * 0.006, 39.76 + (i % 8) * 0.11]
          : corridorAnchors.I70[i % corridorAnchors.I70.length].slice(1) }, properties: {
          corridor, incidentProvider:'cdot', providerEventId: String(i), active: i < 4,
          eventActive:i < 4,corridorActive:i < 4,lastMatchedAt:timestamp(0.1+i*0.01,anchor),
          normalizedStatus: i === 1 ? 'planned' : i < 4 ? 'active' : 'cleared',
          incidentTypeLabel: ['Two-vehicle crash','Road construction','Road closure','Disabled vehicle'][i % 4],
          incidentImpactLabel: i % 2 === 0 ? 'Right lane closed · Slower speeds advised' : null,
          incidentNote: 'Expect delays.', sourceSeverity: i % 2 === 0 ? 'major' : null,
          sourceStartedAt: timestamp(1.5 + i * 0.02, anchor),
          sourceEndedAt: i >= 4 ? timestamp(0.1 + i * 0.01, anchor) : null,
          normalizedCategory: ['CRASH','CONSTRUCTION','CLOSURE','DISABLED_VEHICLE'][i % 4],
          firstSeenAt: timestamp(1 + i * 0.02, anchor), lastSeenAt: timestamp(0.1 + i * 0.01, anchor),
          closestMileMarker: corridor === 'I25' ? 220 + (i % 8) : corridorAnchors.I70[i % corridorAnchors.I70.length][0],
          locationLabel: `Very long provider location near mile marker ${corridor === 'I25' ? 220 + (i % 8) : corridorAnchors.I70[i % corridorAnchors.I70.length][0]}, ramp and roadway description for narrow-screen testing`
        } })) };
      if (scenario === 'incident-days') payload.features.forEach((feature,index) => {
        const age=incidentAges[index];
        Object.assign(feature.properties,{active:false,eventActive:false,corridorActive:false,lastMatchedAt:timestamp(age-0.5,anchor),normalizedStatus:'cleared',
          sourceStartedAt:timestamp(age,anchor),sourceEndedAt:timestamp(age-0.5,anchor),
          firstSeenAt:timestamp(age,anchor),lastSeenAt:timestamp(age-0.5,anchor)});
      });
    } else if (applicationPath.endsWith('/zones/history')) {
      payload = { samples: scenario === 'empty' ? [] : [{ avgCurrentSpeed: 38,
        polledAt: timestamp(0.01, anchor), zoneDescription: 'Northglenn / Thornton transition with a long description',
        startMileMarker: corridor === 'I25' ? 221 : 241, endMileMarker: corridor === 'I25' ? 225 : 248 }] };
    } else if (applicationPath.endsWith('/operational-status')) {
      const outOfService = scenario === 'empty' || scenario === 'health-outage';
      const degraded = scenario === 'health-degraded';
      const checkedAt = new Date().toISOString();
      payload = {
        status: outOfService ? 'OUT_OF_SERVICE' : degraded ? 'DEGRADED' : 'HEALTHY',
        checkedAt,
        summary: outOfService ? 'No monitored corridor has recent usable flow.'
          : degraded ? 'One traffic source needs attention; both corridors still have usable flow.'
            : 'Traffic flow and incident feeds are within their freshness thresholds.',
        checks: ['I25', 'I70'].map(corridor => ({
          component: `flow:${corridor}`, status: outOfService ? 'OUT_OF_SERVICE' : 'HEALTHY',
          code: outOfService ? 'FLOW_SAMPLE_STALE' : 'FLOW_SAMPLE_FRESH',
          message: outOfService ? 'The latest usable corridor sample is outside the live window.'
            : 'The latest usable corridor sample is within the expected live window.',
          observedAt: new Date(Date.parse(checkedAt) - (outOfService ? 140 : 0) * 60_000).toISOString(),
          ageMinutes: outOfService ? 140 : 0, thresholdMinutes: 60,
          suggestedAction: outOfService ? 'Check the ingest scheduler and its most recent collection result.' : null
        })).concat([
          { component: 'incidents:cdot', status: 'HEALTHY', code: 'CDOT_SNAPSHOT_FRESH',
            message: 'The latest complete CDOT snapshot is within the expected live window.',
            observedAt: new Date(Date.parse(checkedAt) - 9 * 60_000).toISOString(),
            ageMinutes: 9, thresholdMinutes: 60, suggestedAction: null },
          { component: 'provider:tomtom', status: degraded || outOfService ? 'DEGRADED' : 'HEALTHY',
            code: degraded || outOfService ? 'TOMTOM_PROVIDER_ATTENTION' : 'TOMTOM_PROVIDER_AVAILABLE',
            message: degraded || outOfService ? 'The simulated source reports reduced capacity.'
              : 'Provider traffic data is returning usable corridor speeds.',
            observedAt: checkedAt, ageMinutes: 0, thresholdMinutes: 60,
            suggestedAction: degraded || outOfService ? 'Review provider capacity and the last successful collection.' : null }
        ])
      };
      if (scenario === 'health-no-checks') payload.checks = [];
      if (scenario === 'health-slow') {
        const timer = setTimeout(() => response.end(JSON.stringify(payload)), 10_000);
        response.once('close', () => clearTimeout(timer));
        return;
      }
    } else if (applicationPath.endsWith('/map/config')) {
      payload = { provider: 'USGS_IMAGERY', tileUrl: null, overviewTileUrl: null,
        detailMinZoom: 0, maxZoom: 16, attribution: 'USGS The National Map' };
      if (scenario === 'map-config-slow') {
        setTimeout(() => response.end(JSON.stringify(payload)), 4000);
        return;
      }
    } else if (applicationPath.endsWith('/corridors')) {
      payload = { features: await Promise.all(['I25','I70'].map(async corridor => ({
        type: 'Feature',
        properties: { corridor, mileMarkerRange: corridor === 'I25' ? 'MM 208 to 271' : 'MM 206 to 274',
          startMileMarker: corridor === 'I25' ? 208 : 206, endMileMarker: corridor === 'I25' ? 271 : 274,
          mileMarkerAnchorsJson: JSON.stringify(corridorAnchors[corridor]
            .map(([mileMarker,longitude,latitude])=>({mileMarker,longitude,latitude}))),
          speedLimitSegments: speedZones(corridor).map(zone => ({...zone,speedLimitMph:zone.postedSpeedMph})) },
        geometry: scenario === 'missing-geometry' ? null : scenario === 'malformed-geometry'
          ? {type:'LineString',coordinates:[[181,40],[-105,40]]}
          : JSON.parse(await fs.readFile(path.resolve(__dirname,
            `../../routes-service/src/main/resources/routes/${corridor.toLowerCase()}.geojson`),'utf8'))
      }))) };
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
    if (target.endsWith('/data.html')) body = Buffer.from(body.toString().replace('<body class="data-page">',
      '<body class="data-page"><script>const fixtureFetch=window.fetch.bind(window);document.documentElement.dataset.fixtureReads="0";window.fetch=(...args)=>{const url=String(args[0]);if(url.includes("/dashboard-api/")||url.includes("/dashboard-experimental-api/"))document.documentElement.dataset.fixtureReads=String(Number(document.documentElement.dataset.fixtureReads)+1);return fixtureFetch(...args);};</script>'
      + (scenario === 'no-webgl'
        ? '<script>window.DATA_HERO_RENDERER_LOADER = async () => { throw new Error("Simulated WebGL unavailable"); };</script>'
        : scenario === 'basemap-offline'
          ? '<script>window.DATA_HERO_RENDERER_LOADER = async () => { const module = await import("./vendor/maplibre-gl/6.10.0/maplibre-gl.mjs"); const renderer = module.default || module; return { ...renderer, Map: class extends renderer.Map { constructor(options) { for (const id of ["base-map","base-map-overview"]) if(options.style.sources[id]) options.style.sources[id].tiles = ["http://127.0.0.1:8091/fixture-missing-tile/{z}/{y}/{x}"]; super(options); } } }; };</script>'
          : '')));
    if (target.endsWith('/api.html')) body = Buffer.from(body.toString().replace('<body class="api-page">',
      '<body class="api-page"><script>const fixtureFetch=window.fetch.bind(window);document.documentElement.dataset.fixtureReads="0";window.fetch=(...args)=>{const url=String(args[0]);if(url.includes("/dashboard-api/")||url.includes("/dashboard-experimental-api/"))document.documentElement.dataset.fixtureReads=String(Number(document.documentElement.dataset.fixtureReads)+1);return fixtureFetch(...args);};</script>'));
    if (target.endsWith('index.html') && !url.searchParams.has('demo') && !url.searchParams.has('historical') && !url.searchParams.has('replay')) {
      const initial = await fixtureBatch(scenario)('/dashboard-api/traffic/dashboard/snapshot?ranges=24&selectedHours=24&historical=false');
      const json = JSON.stringify(await initial.json()).replace(/</g,'\\u003c');
      body = Buffer.from(body.toString().replace('</head>',`<script id="dashboardBootstrap" type="application/json">${json}</script></head>`));
    }
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
}

http.createServer(handleRequest).listen(Number(process.env.DASHBOARD_FIXTURE_PORT || 8091), '127.0.0.1', () => console.log(`Fixture preview: http://127.0.0.1:${process.env.DASHBOARD_FIXTURE_PORT || 8091}/dashboard/?fixture=live (also partial, empty, offline)`));
