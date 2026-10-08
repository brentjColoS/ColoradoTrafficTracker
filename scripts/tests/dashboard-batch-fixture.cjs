const {createHash} = require('node:crypto');

function readKey(path, base = '/dashboard-api') {
  if (path.endsWith('/health') || path.endsWith('-health')) return 'health';
  const url = new URL(path, 'http://fixture.invalid');
  if (url.searchParams.has('asOf')) url.searchParams.set('asOf', String(Date.parse(url.searchParams.get('asOf'))));
  url.searchParams.sort();
  return url.pathname.replace(base, '') + '?' + [...url.searchParams].map(([k,v])=>`${k}=${v}`).join('&');
}

function batchFetch(fetch) {
  const cache = new Map(), network = [];
  const run = async (path, options) => {
    const url = new URL(path, 'http://fixture.invalid');
    if (!/\/traffic\/dashboard\/(snapshot|history)$/.test(url.pathname)) return fetch(path, options);
    network.push(path);
    const base = url.pathname.startsWith('/dashboard-experimental-api/') ? '/dashboard-experimental-api' : '/dashboard-api';
    const health = base.includes('experimental') ? '/dashboard-experimental-health' : '/actuator/health';
    const known = new Set((url.searchParams.get('known') || '').split(','));
    const sections = {}, reads = new Map();
    const add = (resource, retain = false) => {
      if (reads.has(resource)) return reads.get(resource);
      const promise = (async () => {
        const key = readKey(resource, base);
        let entry = retain ? cache.get(key) : null;
        if (entry && Date.now() - Date.parse(entry.fetchedAt) >= 60_000) entry = null;
        if (!entry) {
          try {
            const response = await fetch(resource, options);
            const body = response.ok ? await response.json() : undefined;
            entry = {status: response.ok ? 200 : response.status || 503,
              version: response.ok ? createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0,32) : undefined,
              fetchedAt: new Date().toISOString(), data: body};
            if (response.ok) cache.set(key, entry);
          } catch(error) { entry = {status:error.status || 503}; }
        }
        sections[key] = known.has(entry.version) ? {...entry,data:undefined} : entry;
        return entry.data;
      })();
      reads.set(resource, promise); return promise;
    };
    const history = url.pathname.endsWith('/history');
    const ranges = history ? [Number(url.searchParams.get('hours'))] : (url.searchParams.get('ranges') || '24').split(',').map(Number);
    if (!history) await Promise.all([add(health, true), add(base+'/traffic/map/corridors', true), add(base+'/system/operational-status', true)]);
    const corridors = history ? (url.searchParams.get('corridors') || 'I25,I70').split(',') : ['I25','I70'];
    await Promise.all(corridors.map(async corridor => {
      const query = '?corridor='+corridor, tasks = [];
      let anchor = history ? url.searchParams.get('asOf') : null;
      if (!history) {
        const summary = await add(base+'/traffic/summary'+query+'&windowHours=168&recentIncidentWindowMinutes=1440&preferUsable=true',true);
        if (url.searchParams.get('historical') === 'true') anchor = summary?.latest?.polledAt;
      }
      const asOf = anchor ? '&asOf='+encodeURIComponent(anchor) : '';
      const zoneView = history && url.searchParams.get('zones') === 'true';
      for (const hours of ranges) {
        if (zoneView || !history) tasks.push(add(base+'/traffic/zones/trends'+query+'&windowHours='+hours+asOf,!history));
        if (!zoneView) {
          const window = history ? hours+169 : 889;
          tasks.push(add(base+'/traffic/analytics/trends'+query+'&windowHours='+window+'&limit='+(window+1)+'&preferUsable=true'+asOf,!history));
          if (!history || hours <= 24) {
            const minutes = history ? hours*60 : 1440;
            tasks.push(add(base+'/traffic/history'+query+'&windowMinutes='+minutes+'&limit='+Math.min(2000,minutes+60)+'&preferUsable=true&includeIncidents=false'+asOf,!history));
          }
        }
        tasks.push(add(base+'/traffic/'+(zoneView ? 'zones' : 'analytics')+'/baselines'+query+asOf,true));
        if (history || anchor) tasks.push(add(base+'/traffic/map/incidents/timeline'+query+'&windowMinutes='+hours*60+'&limit=1000'+asOf));
        if (!history && hours > 24) tasks.push(add(base+'/traffic/map/flow-cells/frequency'+query+'&windowHours='+hours+asOf,true));
      }
      if (!history) {
        tasks.push(add(base+'/traffic/zones/baselines'+query+asOf,true));
        tasks.push(add(base+'/traffic/zones/trends'+query+'&windowHours=24'+asOf,true));
        tasks.push(add(base+'/traffic/map/flow-cells/'+(anchor?'hourly':'current')+query+asOf,true));
        if (!anchor) tasks.push(add(base+'/traffic/map/incidents/shared'+query,true));
      }
      await Promise.all(tasks);
    }));
    return {ok:true,status:200,json:async()=>sections};
  };
  run.network = network;
  return run;
}
module.exports = {batchFetch,readKey};
