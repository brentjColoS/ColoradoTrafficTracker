import {test, expect} from '../fixtures/dashboard';

test('selecting I-70 renders a real interactive map with a readable legend', async ({page, dashboard}) => {
  await page.goto(dashboard.url + '/dashboard/');
  await page.getByRole('button', {name: 'I-70, east–west corridor', exact: true}).click();
  await expect(page.locator('#corridorMapPanel')).toBeVisible();
  await expect(page.locator('#corridorMapPanel canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.getByRole('region', {name: 'Map'}).or(page.getByLabel('Interactive corridor traffic map'))).toBeVisible();
  await expect(page.locator('#corridorMapStatus')).not.toContainText(/loading|did not finish/i);
  await expect(page.locator('#corridorMapLegendNote')).toContainText(/traffic|direction|interval/i);
});

test('missing WebGL reports a recovery action while incidents remain accessible', async ({page, dashboard}) => {
  await dashboard.scenario('no-webgl');
  await page.goto(dashboard.url + '/dashboard/');
  await page.getByRole('button', {name: 'I-70, east–west corridor', exact: true}).click();
  await expect(page.locator('#corridorMapStatus')).toContainText(/renderer.*starting|retry/i);
  await expect(page.locator('#corridorMapStatus')).toContainText('incident table remains available');
  await expect(page.getByRole('button', {name: /Sync/})).toBeEnabled();
});
