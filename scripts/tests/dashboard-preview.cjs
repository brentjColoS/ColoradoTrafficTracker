// Local test fixture server only. Never used by the application or container.
// node scripts/tests/dashboard-preview.cjs
// Set DASHBOARD_FIXTURE_CONFIGURED_BASEMAP=1 to preview the existing experimental
// basemap. Traffic remains synthetic; the restricted browser key stays in memory.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFileSync}=require('node:child_process');
const root = path.resolve(__dirname, '../../api-service/src/main/resources/static');
const imageryBasemap = { provider: 'USGS_IMAGERY', tileUrl: null, overviewTileUrl: null,
  detailMinZoom: 0, maxZoom: 16, attribution: 'USGS The National Map' };
function createPreviewBasemapLoader(configured, fetchConfig = fetch) {
  let pending;
  return async () => {
    if (!configured) return imageryBasemap;
    pending ||= (async () => {
      try {
        const response = await fetchConfig('https://coloradotraffictracker.net/dashboard-experimental-api/map/config',
          { signal: AbortSignal.timeout(3000), redirect: 'error' });
        if (!response.ok) return imageryBasemap;
        const config = await response.json();
        if (config?.provider !== 'TRACESTRACK_TOPO') return imageryBasemap;
        return config;
      } catch { return imageryBasemap; }
    })();
    return pending;
  };
}
const previewBasemap = createPreviewBasemapLoader(process.env.DASHBOARD_FIXTURE_CONFIGURED_BASEMAP === '1');
const now = new Date();
let rendererRetryFailed = false;
const timestamp = (hours, anchor = now) => new Date(anchor.getTime() - hours * 3_600_000).toISOString();
const reportTimeFormatter = new Intl.DateTimeFormat('en-US', {timeZone:'America/Denver', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'});
const reportTime = (hours, anchor) => reportTimeFormatter.format(new Date(timestamp(hours, anchor)));
const continuousSpeed = (time, corridor) => {
  const hour = time / 3_600_000, phase = corridor === 'I25' ? 0 : 0.7;
  return 60 + 8 * Math.sin(hour / 5 + phase) - 28 * Math.pow(Math.max(0, Math.cos(hour / 4 + phase)), 4);
};
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
function storedObservationFixture(minute, startedAt = now) {
  return {synthetic: true, observedAt: new Date(startedAt.getTime() + minute * 60_000).toISOString(),
    firstObservedAt: new Date(startedAt.getTime() - 185 * 86_400_000).toISOString(),
    total: 500_000 + minute * 4, corridors: {I25: 280_000 + minute * 2, I70: 220_000 + minute * 2}};
}
const fixtureScenarios = ['live','signs-aged','api-rate-limited','api-slow','basemap-offline','data-slow',
  'empty','flow-zero','health-degraded','health-no-checks','health-outage','health-slow',
  'hero-geometry-slow','history-coverage-partial','history-rate-limited','history-read-failure',
  'history-read-partial','incident-types','chain-laws','incident-continuing','incident-days','malformed-geometry','many-incidents','map-config-slow',
  'missing-geometry','mixed-flow','no-webgl','offline','pace-retained','partial','renderer-retry','retained-days',
  'summary-slow','summary-failure','summary-partial','summary-mismatch'];
async function readFixtureBatch(scenario, path, continuous = false) {
  const key = `${scenario}|${continuous}`;
  if (!batchFixtures.has(key)) batchFixtures.set(key, {read: require('./dashboard-batch-fixture.cjs').batchFetch(
    async path => new Promise((resolve,reject) => {
      const resource = new URL(path, 'http://127.0.0.1');
      resource.searchParams.set('fixture',scenario);
      if (continuous) resource.searchParams.set('continuous','1');
      const reply = {statusCode:200, setHeader(){}, writeHead(status){this.statusCode=status;}, once(){},
        end(body){
          let value;try {value=JSON.parse(String(body));}catch(error){reject(error);return;}
          resolve({ok:this.statusCode===200,status:this.statusCode,json:async()=>value});
        }};
      handleRequest({url:resource.pathname+resource.search,headers:{}},reply).catch(reject);
    })
  )});
  const response = await batchFixtures.get(key).read(path);
  if (!path.split('?')[0].endsWith('/snapshot')) return response;
  const sections = await response.json();
  const minute = Math.max(0, Math.floor((Date.now() - now.getTime()) / 60_000));
  const version = `fixture-stored-${minute}`;
  const known = new Set((new URL(path, 'http://fixture.invalid').searchParams.get('known') || '').split(','));
  const unavailable = ['offline', 'empty'].includes(scenario);
  sections['/traffic/database/observations?'] = {
    status: unavailable ? 503 : 200, version: unavailable ? null : version,
    fetchedAt: new Date(now.getTime() + minute * 60_000).toISOString(),
    data: unavailable || known.has(version) ? undefined : storedObservationFixture(minute)
  };
  return {...response, json: async () => sections};
}

async function handleRequest(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1:8091');
  if(url.pathname==='/_summary/probe.js'){response.setHeader('Content-Type','text/javascript');response.end(require('./dashboard-summary-probe.cjs').source);return;}
  const applicationPath = url.pathname
    .replace(/^\/dashboard-experimental-api(?=\/|$)/, '/dashboard-api')
    .replace(/^\/dashboard-experimental-health$/, '/actuator/health')
    .replace(/^\/dashboard-experimental(?=\/|$)/, '/dashboard');
  const requestedScenario = url.searchParams.get('fixture')
    || new URL(request.headers.referer || url, url).searchParams.get('fixture');
  const scenario = fixtureScenarios.find(name => name === requestedScenario) || 'live';
  const continuous = url.searchParams.get('continuous') === '1'
    || new URL(request.headers.referer || url, url).searchParams.get('continuous') === '1';
  if (applicationPath.endsWith('/traffic/dashboard/window-summary')) {
    if (scenario === 'summary-failure') { response.writeHead(503); response.end('{}'); return; }
    const hours = Number(url.searchParams.get('hours'));
    const end = Math.floor(Date.parse(url.searchParams.get('asOf')) / 60_000) * 60_000;
    const corridors = (url.searchParams.get('corridors') || 'I25,I70').split(',');
    if (![2,6,24,168,720].includes(hours) || !Number.isFinite(end) || corridors.some(c => !['I25','I70'].includes(c))) {
      response.writeHead(400); response.end('{}'); return;
    }
    const bucketMinutes = hours === 2 ? 1 : hours === 6 ? 5 : hours === 24 ? 15 : hours === 168 ? 60 : 180;
    const result = Object.fromEntries(corridors.map(corridor => {
      const zoneMeans = new Map(), travel = [], speeds = [];
      for (let i = 0; i < hours * 60 / bucketMinutes; i++) {
        const time = end-i*bucketMinutes*60_000;
        speeds.push(continuousSpeed(time,corridor));
        let minutes=0;
        for(const zone of speedZones(corridor)) {
          const speed=zone.meanSpeed+3*Math.sin(time/3_600_000/2+zone.zoneOrder);
          const group=zoneMeans.get(zone.zoneKey)||{zone,total:0,count:0};
          group.total+=speed;group.count++;zoneMeans.set(zone.zoneKey,group);
          minutes+=Math.abs(zone.endMileMarker-zone.startMileMarker)/speed*60;
        }
        travel.push(minutes);
      }
      const worst=[...zoneMeans.values()].sort((a,b)=>a.total/a.count-b.total/b.count)[0];
      const unavailable=scenario==='summary-partial'&&corridor==='I70';
      return [corridor,{corridor,hours,start:new Date(end-hours*3_600_000).toISOString(),
        end:new Date(end+(scenario==='summary-mismatch'?60_000:0)).toISOString(),bucketMinutes,
        averageSpeed:unavailable?null:speeds.reduce((a,b)=>a+b,0)/speeds.length,
        averageTravelMinutes:unavailable?null:travel.reduce((a,b)=>a+b,0)/travel.length,
        fastestTravelMinutes:unavailable?null:Math.min(...travel),slowestTravelMinutes:unavailable?null:Math.max(...travel),
        observedIncidents:unavailable?null:Math.floor(hours/12)+Math.abs(Math.floor(end/3_600_000)%4),
        worstZone:unavailable?null:{startMileMarker:worst.zone.startMileMarker,endMileMarker:worst.zone.endMileMarker,speedMph:worst.total/worst.count},
        speedAvailable:!unavailable,zonesAvailable:!unavailable,incidentsAvailable:!unavailable}];
    }));
    const send=()=>{response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(result));};
    if(scenario==='summary-slow'){const timer=setTimeout(send,2000);response.once('close',()=>clearTimeout(timer));}
    else send();
    return;
  }
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
    const payload = await readFixtureBatch(scenario, url.pathname + url.search, continuous);
    response.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});
    response.end(JSON.stringify(await payload.json()));
    return;
  }
  if (applicationPath.endsWith('/traffic/map/variable-speed-limits/current')) {
    const instant = new Date().toISOString();
    const signs = [
      {id:'fixture-east',mileMarker:234.5,direction:'EAST',longitude:-105.61,latitude:39.754,location:'I-70 eastbound near Dumont',reportedLimitMph:45,regularLimitMph:65,status:'AVAILABLE',displayStatus:'on',communicationStatus:'operational'},
      {id:'fixture-west-paired',mileMarker:234.55,direction:'WEST',longitude:-105.609,latitude:39.754,location:'I-70 westbound near Dumont',reportedLimitMph:65,regularLimitMph:65,status:'AVAILABLE',displayStatus:'on',communicationStatus:'operational'},
      {id:'fixture-west',mileMarker:238.4,direction:'WEST',longitude:-105.54,latitude:39.748,location:'I-70 westbound near Idaho Springs',reportedLimitMph:60,regularLimitMph:60,status:'COMMUNICATION_ERROR',displayStatus:'on',communicationStatus:'error'},
      {id:'fixture-off',mileMarker:260.45,direction:'WEST',longitude:-105.188,latitude:39.72,location:'I-70 westbound near Golden',reportedLimitMph:null,regularLimitMph:65,status:'UNAVAILABLE',displayStatus:'off',communicationStatus:'operational'}
    ].map(sign => ({...sign,
      ...(scenario === 'signs-aged' && sign.status === 'AVAILABLE' ? {status:'STALE'} : {}),
      fetchedAt:scenario === 'signs-aged' ? new Date(Date.now()-5*3600000).toISOString() : instant,sourceUpdatedAt:instant}));
    response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    response.end(JSON.stringify({corridor:'I70',provider:'CDOT',status:'PARTIAL',generatedAt:instant,fetchedAt:instant,signs}));
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
      if (continuous && scenario !== 'empty') {
        const end = Math.floor(anchor.getTime() / 60_000) * 60_000;
        const count = Math.min(2000, Number(url.searchParams.get('limit')) || 120,
          Number(url.searchParams.get('windowMinutes')) || 120);
        payload.samples = Array.from({length:count}, (_,i)=>({corridor,
          polledAt:new Date(end-i*60_000).toISOString(), avgCurrentSpeed:continuousSpeed(end-i*60_000,corridor), avgFreeflowSpeed:70}));
      }
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
        Array.from({length:pointCount}, (_, i) => {
          const time = continuous
            ? Math.floor(anchor.getTime() / (3_600_000 / pointsPerHour)) * (3_600_000 / pointsPerHour) - i * (3_600_000 / pointsPerHour)
            : anchor.getTime() - i / pointsPerHour * 3_600_000;
          return {...zone, bucketStart: new Date(time).toISOString(),
            avgCurrentSpeed: zone.meanSpeed + 3 * Math.sin(continuous ? time / 3_600_000 / 2 + zone.zoneOrder : i / 8 + zone.zoneOrder),
            observationCount: 15};
        })) };
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
      if (continuous) payload.buckets.forEach((bucket,i)=>{
        const time = Math.floor(anchor.getTime() / 3_600_000) * 3_600_000 - i * 3_600_000;
        bucket.bucketStart = new Date(time).toISOString();
        bucket.avgCurrentSpeed = continuousSpeed(time,corridor);
      });
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
          incidentDescription: i === 1
            ? (corridor === 'I25' ? 'Between Exit 221: 104th Avenue and Exit 225: 136th Avenue from Mile Point 222.8 to Mile Point 223.1.' : 'Between Exit 263: Colorado Mills Parkway and Exit 253: Chief Hosa from Mile Point 262 to Mile Point 253.')
              + ` Left shoulder closed due to roadwork. Scheduled overnight work. Full schedule below: • ${reportTime(-24, anchor)} to ${reportTime(-32, anchor)}. • ${reportTime(-48, anchor)} to ${reportTime(-56, anchor)}.`
            : 'Between two interchanges at Mile Point 220. Right lane closed. Expect delays. Emergency crews on scene.',
          sourceStartMarker: i === 1 ? corridor === 'I25' ? 222.8 : 262 : null,
          sourceEndMarker: i === 1 ? corridor === 'I25' ? 223.1 : 253 : null,
          sourceUpdatedAt: timestamp(0.25 + i * 0.01, anchor),
          sourceStartedAt: timestamp(i === 1 ? -24 : 1.5 + i * 0.02, anchor),
          sourceEndedAt: i === 1 ? timestamp(-32, anchor) : i >= 4 ? timestamp(0.1 + i * 0.01, anchor) : null,
          normalizedCategory: ['CRASH','CONSTRUCTION','CLOSURE','DISABLED_VEHICLE'][i % 4],
          firstSeenAt: timestamp(1 + i * 0.02, anchor), lastSeenAt: timestamp(0.1 + i * 0.01, anchor),
          closestMileMarker: i === 1 ? corridor === 'I25' ? 223 : 257.5 : corridor === 'I25' ? 220 + (i % 8) : corridorAnchors.I70[i % corridorAnchors.I70.length][0],
          locationLabel: i === 1 ? `${corridor.replace('I','I-')} near MM ${corridor === 'I25' ? 223 : 257.5}` : `Very long provider location near mile marker ${corridor === 'I25' ? 220 + (i % 8) : corridorAnchors.I70[i % corridorAnchors.I70.length][0]}, ramp and roadway description for narrow-screen testing`
        } })) };
      if (scenario === 'chain-laws') payload.features = payload.features.slice(0, 4).map((feature, index) => {
        const label = ['Traction Law Code 15', 'Chain Law Code 18',
          'Traction Law Code 15 Lifted', 'Chain Law Code 18 Lifted'][index];
        Object.assign(feature.properties, {incidentTypeLabel:label,sourceType:label,incidentNote:label,
          incidentImpactLabel:null,sourceSeverity:'minor',
          normalizedCategory:'weather',normalizedStatus:index < 2 ? 'active' : 'cleared',
          active:index < 2,eventActive:index < 2,corridorActive:index < 2,
          sourceEndedAt:index < 2 ? null : timestamp(0.2,anchor)});
        return feature;
      });
      if (scenario === 'incident-types') payload.features.forEach((feature, index) => {
        const [category, label, note] = [
          ['CLOSURE', 'Road closed', 'Sun glare across the roadway.'],
          ['WEATHER', 'Weather', 'Heavy snow on the roadway.'],
          ['WEATHER', 'Icy conditions', 'Ice on bridge decks.'],
          ['TRAFFIC', 'Rockfall', 'Rocks on the roadway.'],
          ['TRAFFIC', 'Debris on roadway', 'Spilled load in the right lane.'],
          ['WEATHER', 'High winds', 'Strong crosswinds.'],
          ['TRAFFIC', 'Maintenance operations', 'Snow removal operations.'],
          ['WEATHER', 'Flooding', 'High water across the roadway.']
        ][index % 8];
        const age = 1 + index * 2.5;
        Object.assign(feature.properties, { normalizedCategory: category, incidentTypeLabel: label,
          incidentNote: note, sourceType: label, firstSeenAt: timestamp(age, anchor),
          sourceStartedAt: timestamp(age + 0.5, anchor),
          sourceEndedAt: index >= 4 ? timestamp(age - 0.5, anchor) : null });
      });
      if (scenario === 'incident-continuing') payload.features.forEach((feature,index) => {
        const examples = [
          {label:'Bridge maintenance',category:'MAINTENANCE',first:288,last:0.1,start:-2,end:-10,status:'planned',
            note:'Bridge maintenance resumes this evening. Lane restrictions apply only during the reported work period.'},
          {label:'Two-vehicle crash',category:'CRASH',first:0.5,last:0.05,start:0.5,
            note:'Right lane blocked. Emergency crews on scene.'},
          {label:'Road construction',category:'CONSTRUCTION',first:192,last:0.12,start:-26,end:-34,status:'planned',
            note:'Recurring overnight paving. Lanes reopen between work periods.'},
          {label:'Road closed',category:'CLOSURE',first:2,last:0.15,start:2,end:-336,
            note:'Ramp closed for a multi-week repair. Follow the signed detour.'},
          {label:'Road maintenance',category:'MAINTENANCE',first:72,last:0.2,start:-24,end:-32,status:'planned',
            note:'A single overnight shoulder repair is scheduled for tomorrow.'},
          {label:'Bridge repairs',category:'CONSTRUCTION',first:240,last:4,start:240,end:4,status:'cleared',
            note:'The multi-day work has finished. All lanes reopened.'},
          {label:'Disabled vehicle',category:'DISABLED_VEHICLE',first:1,last:0.22,start:1,
            note:'Vehicle on the right shoulder. Assistance requested.'},
          {label:'Fog',category:'WEATHER',first:5,last:2,start:5,end:2,status:'cleared',
            note:'Visibility has improved.'}
        ];
        const example=examples[index], status=example.status || 'active';
        const marker=corridor==='I25'?220+index*2:[244.5,251.2,257.5,262,242.9,238,232.5,220][index];
        Object.assign(feature.properties,{normalizedCategory:example.category,incidentTypeLabel:example.label,
          sourceType:example.label,normalizedStatus:status,active:status!=='cleared',
          eventActive:status!=='cleared',corridorActive:status!=='cleared',
          incidentDescription:example.note,incidentNote:example.note,sourceSeverity:null,
          incidentImpactLabel:index===3?'Ramp closed':index===1?'Right lane blocked':'Right shoulder restricted',
          closestMileMarker:marker,sourceStartMarker:marker,sourceEndMarker:marker+0.5,
          locationLabel:`${corridor.replace('I','I-')} ${corridor==='I25'?'northbound':'eastbound'} near MM ${marker}`,
          firstSeenAt:timestamp(example.first,anchor),lastSeenAt:timestamp(example.last,anchor),
          lastMatchedAt:timestamp(example.last,anchor),sourceStartedAt:timestamp(example.start,anchor),
          sourceEndedAt:example.end==null?null:timestamp(example.end,anchor)});
      });
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
      payload = await previewBasemap();
      if (scenario === 'map-config-slow') {
        setTimeout(() => response.end(JSON.stringify(payload)), 4000);
        return;
      }
    } else if (applicationPath.endsWith('/corridors')) {
      payload = { features: await Promise.all(['I25','I70'].map(async corridor => ({
        type: 'Feature',
        properties: { corridor, mileMarkerRange: corridor === 'I25' ? 'MM 271 to 208' : 'MM 206 to 274',
          primaryDirection: corridor === 'I25' ? 'S' : 'E',
          startMileMarker: corridor === 'I25' ? 271 : 206, endMileMarker: corridor === 'I25' ? 208 : 274,
          mileMarkerAnchorsJson: JSON.stringify(corridorAnchors[corridor]
            .map(([mileMarker,longitude,latitude])=>({mileMarker,longitude,latitude}))),
          speedLimitSegments: speedZones(corridor).map((zone, index) => ({...zone,speedLimitMph:zone.postedSpeedMph,
            description: (corridor === 'I25' ? ['Denver / Northglenn urban section', 'Northglenn / Thornton transition',
              'Northern Front Range mainline'] : ['Summit County west approach', 'Eisenhower-Johnson Memorial Tunnel',
              'Silver Plume / Georgetown corridor', 'Idaho Springs area', 'East Idaho Springs constrained section',
              'Floyd Hill / Jefferson County approach', 'Golden / west Denver transition', 'Denver approach to I-25'])[index]})) },
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
    const baseline=url.searchParams.has('summaryBaseline')||new URL(request.headers.referer||url,url).searchParams.has('summaryBaseline');
    let body = baseline ? execFileSync('git',['show','710bd912184b0df7757a7f27e71c59a56bf5cf6b:api-service/src/main/resources/static/'+path.relative(root,target)],{cwd:path.resolve(__dirname,'../..'),maxBuffer:8*1024*1024}) : await fs.readFile(target);
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
      const initial = await readFixtureBatch(scenario, '/dashboard-api/traffic/dashboard/snapshot?ranges=24&selectedHours=24&historical=false', continuous);
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
    if(target.endsWith('index.html')&&url.searchParams.has('summaryProbe'))body=Buffer.from(body.toString().replace('</body>','<script src="/_summary/probe.js"></script></body>'));
    response.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(target)] || 'application/octet-stream');
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
}

module.exports = {handleRequest, speedZones, corridorAnchors, createPreviewBasemapLoader, storedObservationFixture};
if (require.main === module) http.createServer(handleRequest).listen(Number(process.env.DASHBOARD_FIXTURE_PORT || 8091), '127.0.0.1', () => console.log(`Fixture preview: http://127.0.0.1:${process.env.DASHBOARD_FIXTURE_PORT || 8091}/dashboard/?fixture=live (also partial, empty, offline)`));
