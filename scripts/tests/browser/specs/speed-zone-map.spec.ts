import {test,expect} from '../fixtures/dashboard';

for(const corridor of ['I25','I70']) for(const width of [1440,2560]) test(`${corridor} traffic map expands in speed zones and keeps its preference across finder modes at ${width}px`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width,height:width===2560?1440:900});
  await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  const finder=page.getByRole('button',{name:'Zone Finder',exact:true}),map=page.locator('#corridorMapPanel');
  const comparison=page.locator('#comparisonPanel'),control=page.locator('#zoneMapExpand');
  const settled=async()=>{
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBe(0);
    await expect.poll(()=>comparison.evaluate(element=>element.getAnimations().length)).toBe(0);
    await expect.poll(()=>page.locator('.corridor-map-stage').evaluate(element=>element.getAnimations().length)).toBe(0);
  };
  await expect(finder).toHaveAttribute('aria-pressed','false');
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  await expect(page.locator('#corridorMap canvas')).toBeVisible();
  await control.click();
  await expect(control).toHaveAttribute('aria-pressed','true');await settled();
  await expect(comparison).toHaveClass(/zone-map-expanded/);
  expect(await map.evaluate(element=>element.parentElement!.id)).toBe('comparisonPanel');
  await expect(finder).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#corridorZoneReference')).toBeHidden();
  await expect(page.locator('#corridorMapTitle')).toContainText('Corridor Traffic');
  await page.screenshot({path:testInfo.outputPath('expanded-traffic.png')});
  for(const enabled of [true,false]) {
    await page.evaluate(()=>{(window as any).speedZoneMapCanvas=document.querySelector('#corridorMap canvas');});
    await finder.click();
    await expect.poll(()=>page.locator('.corridor-map-stage').evaluate(element=>element.getAnimations().length)).toBeGreaterThan(0);
    const properties=await page.locator('.corridor-map-stage').evaluate(node=>node.getAnimations().flatMap(animation=>
      (animation.effect as KeyframeEffect).getKeyframes().flatMap(frame=>Object.keys(frame))));
    expect(properties.some(property=>/height|width/i.test(property)),'map morph must not animate layout dimensions').toBe(false);
    await page.evaluate(async()=>{
      const motions=[...document.querySelectorAll('.zone-layout-moving')].flatMap(node=>node.getAnimations());
      (window as any).zoneMapModeMotions=motions;
      for(const animation of motions){animation.pause();animation.currentTime=Number(animation.effect!.getTiming().duration)/2;}
      await new Promise<void>(resolve=>{
        const observer=new ResizeObserver(()=>{observer.disconnect();resolve();});
        observer.observe(document.getElementById('corridorMap')!);
      });
    });
    const preview=await page.locator('#corridorMap').evaluate(element=>{
      const canvas=element.querySelector('canvas')!,bounds=element.getBoundingClientRect(),pixels=canvas.getBoundingClientRect();
      const button=document.getElementById('zoneMapExpand')!.getBoundingClientRect();
      return {same:canvas===(window as any).speedZoneMapCanvas,
        gaps:[pixels.width-bounds.width,pixels.height-bounds.height],button:[button.width,button.height]};
    });
    expect(preview.same).toBe(true);
    for(const gap of preview.gaps)expect(Math.abs(gap)).toBeLessThan(2);
    for(const size of preview.button)expect(Math.abs(size-30)).toBeLessThan(.1);
    await page.evaluate(()=>{for(const animation of (window as any).zoneMapModeMotions)animation.play();});
    await settled();
    await expect(finder).toHaveAttribute('aria-pressed',String(enabled));
    await expect(control).toHaveAttribute('aria-pressed','true');
    await expect(comparison).toHaveClass(/zone-map-expanded/);
    if(enabled)await expect(page.locator('#corridorZoneReference')).toBeVisible();
    else await expect(page.locator('#corridorZoneReference')).toBeHidden();
    expect(await control.evaluate(element=>element.parentElement!.tagName)).toBe('HEADER');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:testInfo.outputPath(`expanded-${enabled?'finder':'traffic-return'}.png`)});
  }
  await control.click();await expect(control).toHaveAttribute('aria-pressed','false');await settled();
  expect(await map.evaluate(element=>element.parentElement!.id)).toBe('incidentRouteGrid');
  await expect(control).toBeVisible();
  await finder.click();await settled();await control.click();
  await expect(control).toHaveAttribute('aria-pressed','true');await settled();
  await finder.click();await settled();await expect(control).toHaveAttribute('aria-pressed','true');
  await finder.click();await settled();await control.click();
  await expect(control).toHaveAttribute('aria-pressed','false');await settled();
  await finder.click();await settled();await expect(control).toHaveAttribute('aria-pressed','false');
  expect(await map.evaluate(element=>element.parentElement!.id)).toBe('incidentRouteGrid');
});

test('reduced-motion speed-zone expansion is immediate and clears when changing corridors',async({page,dashboard})=>{
  await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#comparisonPanel')).toHaveClass(/zone-map-expanded/);
  await expect(page.locator('.zone-layout-moving')).toHaveCount(0);
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'I-70, east–west corridor',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#comparisonPanel')).not.toHaveClass(/zone-map-expanded/);
});

for(const corridor of ['I25','I70'])test(`${corridor} reduced-motion view changes create no animated surfaces or visual copies`,async({page,dashboard})=>{
  await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await expect(page.locator('#corridorMap canvas')).toBeVisible();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  for(const name of ['Zone Finder','Zone Finder','Overall','Speed zones','Zone Finder']){
    await page.getByRole('button',{name,exact:true}).click();
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    await expect(page.locator('.zone-layout-moving,.map-layout-ghost-layer,.map-view-changing')).toHaveCount(0);
    expect(await page.locator('#comparisonPanel,.corridor-map-stage').evaluateAll(nodes=>nodes.reduce((n,node)=>n+node.getAnimations().length,0))).toBe(0);
    expect(await page.locator('#corridorMap').evaluate(node=>(node as HTMLElement).inert)).toBe(false);
  }
});
