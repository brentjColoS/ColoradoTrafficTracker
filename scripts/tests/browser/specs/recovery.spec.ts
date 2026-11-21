import {test, expect} from '../fixtures/dashboard';

test('overview stays usable without loading the hidden map renderer', async ({page, dashboard}) => {
  const rendererReads: string[]=[];
  page.on('request',request=>{
    if (/\/maplibre-gl[^/]*\.mjs/.test(new URL(request.url()).pathname)) rendererReads.push(request.url());
  });
  await page.goto(dashboard.url+'/dashboard/');
  await expect(page.locator('#i25AverageSpeed')).toHaveText('61');
  await expect(page.locator('#i70AverageSpeed')).toHaveText('54');
  await expect(page.locator('#chartSummary')).toContainText('61 miles per hour');
  await expect(page.locator('#corridorMapPanel')).toBeHidden();
  expect(rendererReads).toEqual([]);
  await page.getByRole('button',{name:'I-25, north–south corridor',exact:true}).click();
  await expect.poll(()=>rendererReads.length).toBeGreaterThan(0);
  await expect(page.locator('#corridorMapPanel')).toBeVisible();
  await expect(page.locator('#corridorMapStatus')).not.toContainText('Loading map');
  await expect(page.locator('#corridorMapStatus')).not.toContainText('unavailable');
});

test('background refresh keeps observed values visible and automatically accepts the new sections', async ({page, dashboard}) => {
  let requests=0;
  let release!: () => void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/traffic/dashboard/snapshot?**',async route=>{
    const number=++requests;
    const response=await route.fetch();
    const sections=await response.json();
    if(number<=2) {
      for(const section of Object.values(sections) as Array<{status:number;refreshing?:boolean;fetchedAt?:string}>) {
        if(section.status===200) {section.refreshing=true;section.fetchedAt='2026-10-14T11:59:00Z';}
      }
    } else await waiting;
    await route.fulfill({response,json:sections});
  });
  try {
    await page.goto(dashboard.url+'/dashboard/');
    await expect(page.locator('#statusText')).toContainText('Refreshing in the background');
    await expect(page.locator('#i25Summary')).toContainText('61');
    await expect(page.locator('#i70Summary')).toContainText('54');
    await expect.poll(()=>requests).toBeGreaterThanOrEqual(3);
    release();
    await expect(page.locator('#statusText')).toContainText('Data synced at');
    await expect(page.locator('#statusText')).not.toContainText('Refreshing in the background');
    expect(requests).toBeLessThanOrEqual(4);
  } finally {release();}
});

for (const scenario of ['empty', 'partial', 'health-degraded']) {
  test(`${scenario} data keeps dashboard navigation usable`, async ({page, dashboard}) => {
    await dashboard.scenario(scenario);
    await page.goto(dashboard.url + '/dashboard/');
    await expect(page.getByRole('group', {name: 'Chart time range'})).toBeVisible();
    await page.getByRole('button', {name: 'I-25, north–south corridor', exact: true}).click();
    await expect(page.getByRole('button', {name: 'I-25, north–south corridor', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#i25Summary')).toBeVisible();
  });
}

test('rate-limited data is not presented as a successful zero reading', async ({page, dashboard}) => {
  await dashboard.scenario('api-rate-limited');
  await page.goto(dashboard.url + '/dashboard/');
  await expect(page.locator('#i25Summary')).toContainText(/unavailable|—|retry|limited/i);
  await expect(page.getByRole('button', {name: /Sync/})).toBeEnabled();
});

test('healthy fixture observations render a fresh ingestion status', async ({page, dashboard}) => {
  await page.goto(dashboard.url + '/dashboard/');
  await expect(page.locator('#ingestServiceStatus')).not.toContainText(/out.of.service|stale|unavailable/i);
  await expect(page.locator('#i25Summary')).toContainText('61');
});

test('one failing corridor does not turn the usable corridor into an outage', async ({page, dashboard}) => {
  await dashboard.scenario('partial');
  await page.goto(dashboard.url + '/dashboard/');
  await expect(page.locator('#i25Summary')).toContainText('61');
  await expect(page.locator('#i70Summary')).toContainText(/—|unavailable/i);
  await expect(page.locator('#i25Summary')).not.toContainText('OUT_OF_SERVICE');
});

test('rate-limited history retains a disabled retry until the indicated delay', async ({page, dashboard}) => {
  await dashboard.scenario('history-rate-limited');
  await page.goto(dashboard.url + '/dashboard/');
  await page.getByRole('button', {name: /Historical Scroll/}).click();
  await page.getByRole('button', {name: /Earlier chart window by up to 12 hours/}).click();
  await expect(page.getByRole('button', {name: 'Retry', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Retry', exact: true})).toBeDisabled();
});
