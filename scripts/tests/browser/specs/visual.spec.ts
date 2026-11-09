import {test, expect} from '../fixtures/dashboard';

test('chart and time-range controls retain their reviewed visual layout', async ({page, dashboard}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(dashboard.url + '/dashboard/');
  await expect(page.locator('#i25Summary')).toContainText('61');
  await expect(page.locator('#i25Chart')).toHaveScreenshot('i25-current-chart.png', {animations: 'disabled'});
  await expect(page.getByRole('group', {name: 'Chart time range'})).toHaveScreenshot('chart-range.png', {animations: 'disabled'});
});
