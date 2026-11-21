import {test,expect} from '../fixtures/dashboard';

for(const width of [2560,1440,805,390,320]) test(`local preview note stays in the green header without an extra band at ${width}px`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width,height:width===2560?1440:900});
  await page.goto(dashboard.url+'/dashboard/');
  const badge=page.locator('.fixture-data-note');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('title',/synthetic data, not live traffic/);
  await expect(page.getByText('TEST FIXTURES',{exact:false})).toHaveCount(0);
  const bounds=(await badge.boundingBox())!,header=(await page.locator('.site-header').boundingBox())!;
  expect(header.y).toBe(0);
  expect(bounds.y).toBeGreaterThanOrEqual(header.y);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(header.y+header.height);
  const toggle=(await page.locator('#themeToggle').boundingBox())!;
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(toggle.x);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload();
  await expect(page.locator('[data-motion-toggle]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.locator('.site-header').screenshot({path:testInfo.outputPath(`preview-header-${width}.png`),animations:'disabled'});
});
