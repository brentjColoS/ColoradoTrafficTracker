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

test('traction notices use compact row titles without losing vehicle scope or requirements', async ({page,dashboard},testInfo) => {
  await page.setViewportSize({width:2560,height:1440});
  await dashboard.scenario('chain-laws');
  await page.goto(dashboard.url+'/dashboard/');
  await page.getByRole('button',{name:'I-70, east–west corridor',exact:true}).click();
  const rows=page.locator('#i70IncidentRows tr');
  await expect(rows).toHaveCount(4);
  const names=rows.locator('.incident-name > span');
  await expect(names).toHaveText(['Traction law','Chain law','Traction law','Chain law']);
  for (const name of await names.all()) {
    await expect(name).toHaveAttribute('title',/Passenger vehicle|Commercial vehicle/);
    const fits=await name.evaluate(element=>element.getBoundingClientRect().height<=parseFloat(getComputedStyle(element).fontSize)*1.6);
    expect(fits).toBe(true);
  }
  await expect(rows.nth(2)).toContainText('Cleared');
  await rows.first().locator('details.incident-details > summary').click();
  await expect(rows.first()).toContainText('AWD/4WD');
  await expect(rows.first()).toContainText('3/16-inch');
  await page.locator('#incidentRouteGrid').screenshot({path:testInfo.outputPath('compact-traction-rows.png')});
});
