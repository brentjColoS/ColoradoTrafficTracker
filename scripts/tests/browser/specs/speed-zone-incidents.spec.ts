import {test,expect} from '../fixtures/dashboard';

for(const corridor of ['I25','I70']) for(const width of [1440,2560]) test(`${corridor} expanded speed zones keep incidents in the viewport at ${width}px`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width,height:width===2560?1440:900});
  await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  const comparison=page.locator('#comparisonPanel'),control=page.locator('#zoneMapExpand');
  const finder=page.getByRole('button',{name:'Zone Finder',exact:true});
  await control.click();await expect(comparison).toHaveClass(/speed-zone-incidents/);
  const settled=async()=>{
    await expect(page.locator('.zone-layout-moving')).toHaveCount(0);
    await expect.poll(()=>page.locator('.corridor-map-stage').evaluate(node=>node.getAnimations().length)).toBe(0);
  };
  await settled();
  const check=async()=>{
    const edges=await page.evaluate(corridor=>{
      const rect=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect();
      const panel=rect('#comparisonPanel'),graph=rect(`.chart-lane[data-corridor="${corridor}"]`),map=rect('#corridorMapPanel'),incidents=rect('#recent-incidents');
      return {top:panel.top,bottom:panel.bottom,incidentBottom:incidents.bottom,incidentHeight:incidents.height,
        side:map.left-graph.right,join:corridor==='I25'?incidents.top-graph.bottom:incidents.top-map.bottom,
        graphOverflow:document.querySelector(`.chart-lane[data-corridor="${corridor}"]`)!.scrollHeight-graph.height,
        lower:rect('#system-health').top-panel.bottom,header:rect('.site-header').height,
        parent:document.getElementById('recent-incidents')!.parentElement!.id,overflow:document.documentElement.scrollWidth>innerWidth};
    },corridor);
    expect(edges.parent).toBe('comparisonPanel');expect(edges.overflow).toBe(false);
    expect(Math.abs(edges.top-edges.header-8)).toBeLessThan(2);
    expect(Math.abs(edges.bottom-page.viewportSize()!.height+8)).toBeLessThan(2);
    expect(edges.incidentBottom).toBeLessThanOrEqual(edges.bottom+1);expect(edges.incidentHeight).toBeGreaterThan(200);
    expect(Math.abs(edges.side)).toBeLessThan(2);expect(Math.abs(edges.join)).toBeLessThan(2);
    expect(edges.graphOverflow).toBeLessThan(2);expect(edges.lower).toBeGreaterThanOrEqual(6);expect(edges.lower).toBeLessThanOrEqual(8);
  };
  await check();await page.screenshot({path:testInfo.outputPath('speed-zones-with-incidents.png')});
  await page.locator(`#${corridor.toLowerCase()}Chart`).locator('..').locator('.chart-incident-links button').first().click();
  await expect(page.locator(`#${corridor.toLowerCase()}IncidentRows > tr[data-chart-match="true"] .incident-details[open]`)).not.toHaveCount(0);
  await check();
  await finder.click();await settled();await expect(comparison).not.toHaveClass(/speed-zone-incidents/);
  expect(await page.locator('#recent-incidents').evaluate(node=>node.parentElement!.tagName)).toBe('MAIN');
  const map=(await page.locator('#corridorMapPanel').boundingBox())!,graph=(await page.locator(`.chart-lane[data-corridor="${corridor}"]`).boundingBox())!;
  expect(Math.abs(map.height-graph.height)).toBeLessThan(2);
  await finder.click();await settled();await check();
  if(width===1440){
    await page.setViewportSize({width:390,height:844});await expect(comparison).not.toHaveClass(/speed-zone-incidents/);
    expect(await page.locator('#recent-incidents').evaluate(node=>node.parentElement!.tagName)).toBe('MAIN');
    await page.setViewportSize({width,height:900});await expect(comparison).toHaveClass(/speed-zone-incidents/);
    await expect(control).toHaveAttribute('aria-pressed','true');
  }
  await control.click();await expect(control).toHaveAttribute('aria-pressed','false');await settled();
  expect(await page.locator('#recent-incidents').evaluate(node=>node.parentElement!.tagName)).toBe('MAIN');
});
