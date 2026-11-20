import {test, expect} from '../fixtures/dashboard';

for (const scenario of ['live','signs-normal','signs-conflicting','signs-aged']) {
  test(`corridor badge and map agree for ${scenario} sign reports`, async ({page,dashboard}) => {
    await dashboard.scenario(scenario);
    await page.goto(dashboard.url+'/dashboard/');
    await page.getByRole('button',{name:'I-70, east–west corridor',exact:true}).click();
    await expect(page.locator('#corridorMapPanel canvas.maplibregl-canvas')).toBeVisible();
    await expect(page.locator('#corridorMapStatus')).not.toContainText(/loading|starting/i);
    const badge=page.locator('#i70VariableLimitBadge');
    const markers=page.locator('.corridor-speed-area, .corridor-variable-speed-sign.is-reduced');
    if (scenario === 'live') {
      await expect(badge).toBeVisible();
      await expect(page.locator('.corridor-speed-area:visible, .corridor-variable-speed-sign.is-reduced:visible')).toHaveCount(1);
    } else {
      await expect(badge).toBeHidden();
      await expect(badge).toHaveText('');
      await expect(markers).toHaveCount(0);
    }
  });
}

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

test('changed limits keep compact sign faces and a strong static cue with reduced motion', async ({page,dashboard},testInfo) => {
  await page.setViewportSize({width:2560,height:1440});
  await dashboard.scenario('signs-directional');
  await page.goto(dashboard.url+'/dashboard/');
  await page.getByRole('button',{name:'I-70, east–west corridor',exact:true}).click();
  const map=page.locator('#corridorMap');
  await map.scrollIntoViewIfNeeded();
  const markers=page.locator('.corridor-speed-area:visible, .corridor-variable-speed-sign.is-reduced:visible');
  await expect(markers).toHaveCount(2);
  for (const marker of await markers.all()) {
    const box=(await marker.boundingBox())!;
    expect(box.width).toBe(54);
    expect(box.height).toBe(26);
    expect(await marker.evaluate(element=>getComputedStyle(element,'::after').pointerEvents)).toBe('none');
  }
  await page.locator('#corridorMapPanel').screenshot({path:testInfo.outputPath('limit-emphasis.png'),animations:'disabled'});
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(()=>markers.first().evaluate(element=>getComputedStyle(element,'::after').animationName)).toBe('none');
  expect(await markers.first().evaluate(element=>getComputedStyle(element).boxShadow)).not.toBe('none');
  await page.locator('#corridorMapPanel').screenshot({path:testInfo.outputPath('limit-emphasis-still.png'),animations:'disabled'});
});
