import {test, expect} from '../fixtures/dashboard';

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
