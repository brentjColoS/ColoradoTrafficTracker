import {test, expect} from '@playwright/test';
import {localNetwork} from '../support/network';

test('real API enforces keys while public dashboard reads remain available', async ({request}) => {
  const url = process.env.BROWSER_API_URL!;
  const protectedRead = await request.get(url + '/api/traffic/latest?corridor=I25');
  expect(protectedRead.status()).toBe(401);
  const authorized = await request.get(url + '/api/traffic/latest?corridor=I25', {headers: {'X-API-Key': 'browser-fixture-key'}});
  expect(authorized.ok()).toBeTruthy();
  expect((await authorized.json()).avgCurrentSpeed).toBe(61);
  const publicRead = await request.get(url + '/dashboard-api/traffic/latest?corridor=I70');
  expect(publicRead.ok()).toBeTruthy();
  expect((await publicRead.json()).avgCurrentSpeed).toBe(54);
});

test('batch response values and archive-inclusive totals match seeded PostgreSQL', async ({request}) => {
  const url = process.env.BROWSER_API_URL!;
  const snapshot = await request.get(url + '/dashboard-api/traffic/dashboard/snapshot?ranges=24&selectedHours=24');
  expect(snapshot.ok()).toBeTruthy();
  const sections = await snapshot.json();
  const summary = Object.entries(sections).find(([key]) => key.startsWith('/traffic/summary?') && key.includes('corridor=I25'))?.[1] as {status: number; data: {latest: {avgCurrentSpeed: number}}};
  expect(summary.status).toBe(200);
  expect(summary.data.latest.avgCurrentSpeed).toBe(61);
  const totals = sections['/traffic/database/observations?'];
  expect(totals.status).toBe(200);
  expect(totals.data.total).toBe(383);
});

test('invalid history inputs are rejected by the real application', async ({request}) => {
  const response = await request.get(process.env.BROWSER_API_URL + '/dashboard-api/traffic/dashboard/history?hours=1&asOf=2026-10-14T12:00:00Z');
  expect(response.status()).toBe(400);
});

test('packaged dashboard redirects, bootstraps seeded values and renders in Chromium', async ({page}) => {
  const unexpected = await localNetwork(page, process.env.BROWSER_API_URL!);
  await page.goto(process.env.BROWSER_API_URL + '/dashboard');
  await expect(page).toHaveURL(/\/dashboard\/$/);
  const bootstrap = await page.locator('#dashboardBootstrap').textContent();
  const initial = JSON.parse(bootstrap!);
  expect(Object.keys(initial)).toContain('/traffic/database/observations?');
  expect(Object.keys(initial).filter(key => key.includes('/incidents/shared?') || key.includes('windowHours=889'))).toEqual([]);
  for (const corridor of ['I25', 'I70']) {
    expect(initial[`/traffic/map/incidents/recent?corridor=${corridor}&limit=1000&windowMinutes=1440`].status).toBe(200);
    expect(initial[`/traffic/analytics/trends?corridor=${corridor}&limit=194&preferUsable=true&windowHours=193`].status).toBe(200);
  }
  await expect(page.locator('#i25Summary')).toContainText('61');
  await expect(page.locator('#i70Summary')).toContainText('54');
  await expect(page.getByRole('group', {name: 'Chart time range'})).toBeVisible();
  expect(unexpected).toEqual([]);
});

test('packaged historical navigation reads actual seeded history', async ({page}) => {
  const unexpected = await localNetwork(page, process.env.BROWSER_API_URL!);
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/traffic/dashboard/history') && url.searchParams.get('hours') === '2'
      && url.searchParams.get('zones') !== 'true';
  }).then(async response => ({ok: response.ok(), sections: await response.json()}));
  await page.goto(process.env.BROWSER_API_URL + '/dashboard/');
  // Preparation can satisfy the later pan without another read; consume it before changing scope.
  const {ok, sections} = await loaded;
  expect(ok).toBeTruthy();
  const history = Object.entries(sections).find(([key]) => key.startsWith('/traffic/history?') && key.includes('corridor=I25'))?.[1] as {status: number; data: {samples: {avgCurrentSpeed: number}[]}};
  expect(history.status).toBe(200);
  expect(history.data.samples.length).toBeGreaterThan(0);
  expect(history.data.samples[0].avgCurrentSpeed).toBe(61);
  await page.getByRole('button', {name: '2H', exact: true}).click();
  await page.getByRole('button', {name: /Historical Scroll/}).click();
  const current = await page.locator('#chartHistoryWindow').textContent();
  await page.getByRole('button', {name: /Earlier chart window/}).click();
  await expect(page.locator('#chartHistoryWindow')).not.toHaveText(current!);
  expect(unexpected).toEqual([]);
});


test('packaged page uses one content-versioned script response with conditional revalidation', async ({page, request}) => {
  const origin = process.env.BROWSER_API_URL!;
  const unexpected = await localNetwork(page, origin);
  await page.goto(origin + '/dashboard/');
  await expect(page.locator('#i25AverageSpeed')).toHaveText('61');
  await expect(page.locator('#i70AverageSpeed')).toHaveText('54');
  const scripts = page.locator('script[src]');
  await expect(scripts).toHaveCount(1);
  const source = new URL((await scripts.getAttribute('src'))!, page.url());
  expect(source.pathname).toBe('/dashboard/dashboard-scripts.js');
  const response = await request.get(source.href, {headers: {'Accept-Encoding': 'identity'}});
  expect(response.ok()).toBeTruthy();
  const {createHash} = await import('node:crypto');
  const digest = createHash('sha256').update(await response.body()).digest('hex');
  expect(source.searchParams.get('v')).toBe(digest);
  expect(response.headers()['etag']).toBe('"' + digest + '"');
  expect(response.headers()['cache-control']).toBe('no-cache');
  const retained = await request.get(source.href, {headers: {'Accept-Encoding': 'identity', 'If-None-Match': response.headers()['etag']}});
  expect(retained.status()).toBe(304);
  expect((await retained.body()).length).toBe(0);
  const compressed = await request.get(source.href, {headers: {'Accept-Encoding': 'gzip'}});
  expect(compressed.headers()['content-encoding']).toBe('gzip');
  expect(compressed.headers()['vary']).toContain('Accept-Encoding');
  expect(await compressed.body()).toEqual(await response.body());
  expect(compressed.headers()['etag']).not.toBe(response.headers()['etag']);
  const retainedCompressed = await request.get(source.href, {headers: {
    'Accept-Encoding': 'gzip', 'If-None-Match': compressed.headers()['etag']}});
  expect(retainedCompressed.status()).toBe(304);
  const otherRepresentation = await request.get(source.href, {headers: {
    'Accept-Encoding': 'identity', 'If-None-Match': compressed.headers()['etag']}});
  expect(otherRepresentation.status()).toBe(200);
  expect(unexpected).toEqual([]);
});

test('packaged overview stays styled when standalone stylesheets cannot load', async ({page}) => {
  const origin=process.env.BROWSER_API_URL!;
  const unexpected=await localNetwork(page,origin);
  await page.route('**/*.css*',route=>route.abort());
  await page.goto(origin+'/dashboard/');
  await expect(page.locator('#i25AverageSpeed')).toHaveText('61');
  await expect(page.locator('#i70AverageSpeed')).toHaveText('54');
  expect(await page.locator('body').evaluate(body=>getComputedStyle(body).fontFamily)).toContain('Archivo');
  await expect(page.locator('link[rel="stylesheet"][href$=".css"]')).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('real history batches separate visible observations from optional incident markers', async ({request}) => {
  const origin=process.env.BROWSER_API_URL!;
  const end=new Date(Date.now()-86400000).toISOString();
  const query=`corridors=I25&hours=24&asOf=${encodeURIComponent(end)}`;
  const chart=await request.get(`${origin}/dashboard-api/traffic/dashboard/history?${query}&includeIncidents=false`);
  expect(chart.ok()).toBeTruthy();
  const core=await chart.json();
  expect(Object.keys(core).some(key=>key.includes('/incidents/'))).toBe(false);
  expect(Object.keys(core).some(key=>key.includes('/traffic/history?'))).toBe(true);
  const markers=await request.get(`${origin}/dashboard-api/traffic/dashboard/history/incidents?${query}`);
  expect(markers.ok()).toBeTruthy();
  const optional=await markers.json();
  expect(Object.keys(optional)).toHaveLength(1);
  const [key,section]=Object.entries(optional)[0] as [string,{status:number;data:{features:unknown[]}}];
  expect(key).toContain('/traffic/map/incidents/timeline?');
  expect(section.status).toBe(200);
  expect(section.data.features).toEqual([]);
});
