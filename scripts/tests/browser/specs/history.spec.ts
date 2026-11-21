import {test, expect} from '../fixtures/dashboard';

for (const range of ['2H', '24H', '7D', '30D']) {
  test(`chart range ${range} keeps its selected state`, async ({page, dashboard}) => {
    await page.goto(dashboard.url + '/dashboard/');
    const button = page.getByRole('group', {name: 'Chart time range'}).getByRole('button', {name: range, exact: true});
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#i25Chart')).toBeVisible();
  });
}

test('historical navigation moves backward and returns to current observations', async ({page, dashboard}) => {
  await page.goto(dashboard.url + '/dashboard/');
  await page.getByRole('button', {name: /Historical Scroll/}).click();
  const older = page.getByRole('button', {name: /Earlier chart window by up to 12 hours/});
  await expect(older).toBeEnabled();
  const window = page.locator('#chartHistoryWindow');
  const current = await window.textContent();
  await older.click();
  await expect(window).not.toHaveText(current!);
  await expect(page.getByRole('button', {name: 'Current', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: 'Current', exact: true}).click();
  await expect(window).toHaveText(current!);
});

test('history read failures preserve a retry action and recover', async ({page, dashboard}) => {
  await dashboard.scenario('history-read-failure');
  await page.goto(dashboard.url + '/dashboard/');
  await page.getByRole('button', {name: /Historical Scroll/}).click();
  await page.getByRole('button', {name: /Earlier chart window by up to 12 hours/}).click();
  const retry = page.getByRole('button', {name: 'Retry', exact: true});
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
  await dashboard.scenario('live');
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(page.locator('#chartHistoryHelp')).not.toContainText(/failed|could not/i);
});

test('returning to current observations ignores an older delayed history response', async ({page, dashboard}) => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => {release = resolve;});
  let requested!: () => void;
  const started = new Promise<void>(resolve => {requested = resolve;});
  await page.route('**/traffic/dashboard/history?**', async route => {
    requested();
    await waiting;
    if (!route.request().isNavigationRequest()) await route.continue().catch(() => {});
  });
  try {
    await page.goto(dashboard.url + '/dashboard/');
    await page.getByRole('button', {name: /Historical Scroll/}).click();
    const window = page.locator('#chartHistoryWindow');
    const current = await window.textContent();
    await page.getByRole('button', {name: /Earlier chart window by up to 12 hours/}).click();
    await started;
    const cancelled = page.waitForEvent('requestfailed', {predicate: request => request.url().includes('/traffic/dashboard/history?')});
    await page.getByRole('button', {name: 'Current', exact: true}).click();
    expect((await cancelled).failure()?.errorText).toContain('ERR_ABORTED');
    release();
    await expect(window).toHaveText(current!);
    await expect(page.getByRole('button', {name: 'Current', exact: true})).toBeDisabled();
  } finally { release(); }
});
