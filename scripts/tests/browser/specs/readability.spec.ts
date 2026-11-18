import {test, expect} from '../fixtures/dashboard';

for (const [width,height] of [[2560,1440],[805,827],[390,844]]) {
  test(`standard-deviation percentage matches readable legend text at ${width}px`, async ({page,dashboard}) => {
    await page.setViewportSize({width,height});
    await page.goto(dashboard.url+'/dashboard/');
    const coverage=page.locator('#sigmaCoverage');
    await expect(coverage).toContainText('%');
    const sizes=await coverage.evaluate(element => ({
      value:parseFloat(getComputedStyle(element).fontSize),
      legend:parseFloat(getComputedStyle(element.closest('.chart-legend')!).fontSize)
    }));
    expect(sizes.value).toBe(sizes.legend);
    expect(sizes.value).toBeGreaterThanOrEqual(12);
    const overflow=await page.evaluate(() => document.documentElement.scrollWidth>innerWidth);
    expect(overflow).toBe(false);
  });
}
