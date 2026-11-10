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
  await page.goto(process.env.BROWSER_API_URL + '/dashboard/');
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/traffic/dashboard/history') && new URL(response.url()).searchParams.get('hours') === '2');
  await page.getByRole('button', {name: '2H', exact: true}).click();
  await page.getByRole('button', {name: /Historical Scroll/}).click();
  const current = await page.locator('#chartHistoryWindow').textContent();
  await page.getByRole('button', {name: /Earlier chart window/}).click();
  const response = await loaded;
  expect(response.ok()).toBeTruthy();
  const sections = await response.json();
  const history = Object.entries(sections).find(([key]) => key.startsWith('/traffic/history?') && key.includes('corridor=I25'))?.[1] as {status: number; data: {samples: {avgCurrentSpeed: number}[]}};
  expect(history.status).toBe(200);
  expect(history.data.samples.length).toBeGreaterThan(0);
  expect(history.data.samples[0].avgCurrentSpeed).toBe(61);
  await expect(page.locator('#chartHistoryWindow')).not.toHaveText(current!);
  expect(unexpected).toEqual([]);
});
