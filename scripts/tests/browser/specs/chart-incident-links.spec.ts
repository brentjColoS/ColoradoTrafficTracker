import {test,expect} from '../fixtures/dashboard';

test('graph clusters reveal their reports beyond the overview preview without discarding type filters',async({page,dashboard},testInfo)=>{
  await page.goto(dashboard.url+'/dashboard/');
  await page.getByRole('button',{name:'Construction',exact:true}).click();
  const marker=page.locator('#i25Chart').locator('..').locator('.chart-incident-links button').first();
  await expect(marker).toBeVisible();
  const count=await marker.evaluate(button=>(button as any).chartIncidents.length);
  expect(count).toBeGreaterThan(1);
  await marker.click();
  await expect(page.locator('[data-incident-toggle][aria-expanded="true"]')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Construction',exact:true})).toHaveAttribute('aria-pressed','true');
  const rows=page.locator('#i25IncidentRows > tr[data-chart-match="true"]');
  await expect(rows).toHaveCount(count);
  await expect(rows.locator('details.incident-details[open]')).toHaveCount(count);
  await expect(rows.first().locator('summary').first()).toBeFocused();
  await expect.poll(()=>rows.first().evaluate(row=>{
    const bounds=row.getBoundingClientRect();return bounds.bottom>0&&bounds.top<innerHeight;
  })).toBe(true);
  await page.screenshot({path:testInfo.outputPath('revealed-cluster.png')});
});

test('speed-zone markers open incident details and grouped reports stay grouped',async({page,dashboard})=>{
  await dashboard.scenario('incident-directions');
  await page.goto(dashboard.url+'/dashboard/?corridor=I70');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  const marker=page.locator('#i70Chart').locator('..').locator('.chart-incident-links button').first();
  await expect(marker).toBeVisible();await marker.click();
  await expect(page.locator('#i70IncidentRows > tr[data-chart-match="true"]')).not.toHaveCount(0);
  await expect(page.locator('#i70IncidentRows > tr[data-chart-match="true"] .incident-details[open]')).not.toHaveCount(0);
  await expect(page.locator('#i70IncidentRows .incident-direction-split')).not.toHaveCount(0);
});

test('historical markers keep their loaded reports identifiable when absent from the current feed',async({page,dashboard})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await dashboard.scenario('incident-days');
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await page.getByRole('button',{name:'7D',exact:true}).click();
  await page.getByRole('button',{name:/Earlier chart window/}).click();
  await expect(page.getByRole('button',{name:'Current',exact:true})).toBeEnabled();
  await expect.poll(()=>page.evaluate(()=>!(window as any).ContinuousHistory.moving)).toBe(true);
  const marker=page.locator('#i25Chart').locator('..').locator('.chart-incident-links button').first();
  await expect(marker).toBeVisible();
  // Simulate old reports no longer returned by the current feed, without changing the loaded chart.
  await page.evaluate(()=>window.eval("state.routeData.get('I25').incidentThreads=[];renderIncidentTable('I25',[])"));
  await marker.click();
  await expect(page.locator('#i25IncidentRows > tr[data-chart-match="true"] .incident-details[open]')).not.toHaveCount(0);
  await expect(page.locator('#i25IncidentRows .incident-chart-source')).not.toHaveCount(0);
  await page.getByRole('button',{name:'Current',exact:true}).click();
  await expect(page.locator('#i25IncidentRows .incident-chart-source')).toHaveCount(0);
});

test('phone graph markers support keyboard activation with reduced motion',async({page,dashboard})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  const marker=page.locator('#i25Chart').locator('..').locator('.chart-incident-links button').first();
  await expect(marker).toBeVisible();await marker.focus();await page.keyboard.press('Enter');
  const summary=page.locator('#i25IncidentRows > tr[data-chart-match="true"] .incident-details > summary').first();
  await expect(summary).toBeFocused();
  await expect(page.locator('#i25IncidentRows > tr[data-chart-match="true"] .incident-details[open]')).not.toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
