import {test, expect} from '../fixtures/dashboard';

test('mobile controls stay within the viewport and select corridors', async ({page, dashboard}) => {
  await page.goto(dashboard.url + '/dashboard/');
  const corridor = page.getByRole('button', {name: 'I-70, east–west corridor', exact: true});
  await corridor.click();
  await expect(corridor).toHaveAttribute('aria-pressed', 'true');
  const box = await page.getByRole('group', {name: 'Chart time range'}).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
