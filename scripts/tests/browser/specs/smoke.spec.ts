import {test, expect} from '../fixtures/dashboard';

test('dashboard shows both corridor summaries and selectable time ranges', async ({page, dashboard}) => {
  await page.goto(dashboard.url + '/dashboard/');
  await expect(page.getByRole('region', {name: 'Corridor summaries'})).toBeVisible();
  await expect(page.locator('#i25Summary')).toContainText('I-25');
  await expect(page.locator('#i70Summary')).toContainText('I-70');
  await page.getByRole('button', {name: '2H', exact: true}).click();
  await expect(page.getByRole('button', {name: '2H', exact: true})).toHaveAttribute('aria-pressed', 'true');
});

test('navigation reaches the information pages and returns to the dashboard', async ({page, dashboard}) => {
  await page.goto(dashboard.url + '/dashboard/');
  await page.getByRole('navigation', {name: 'Primary navigation'}).getByRole('link', {name: 'About the Data'}).click();
  await expect(page).toHaveURL(/data\.html/);
  await page.goBack();
  await expect(page.getByRole('group', {name: 'Chart time range'})).toBeVisible();
});

test('theme selection persists after reload', async ({page, dashboard}) => {
  await page.goto(dashboard.url + '/dashboard/');
  const toggle = page.getByRole('button', {name: /Switch to .* mode/});
  const before = await toggle.getAttribute('aria-pressed');
  await toggle.click();
  await expect(toggle).not.toHaveAttribute('aria-pressed', before!);
  await page.reload();
  await expect(toggle).not.toHaveAttribute('aria-pressed', before!);
});
