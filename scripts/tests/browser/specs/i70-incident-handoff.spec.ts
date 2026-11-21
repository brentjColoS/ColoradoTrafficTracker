import {test,expect} from '../fixtures/dashboard';

for(const width of [1440,2560]) test(`I70 incident handoffs stay in their own row rather than flying across the map at ${width}px`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width,height:width===2560?1440:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I70');
  const settled=async()=>{
    await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
    await expect.poll(()=>page.locator('.corridor-map-stage').evaluate(node=>node.getAnimations().length)).toBe(0);
  };
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');await settled();
  let from='Overall';
  for(const to of ['Speed zones','Overall','Speed zones','Overall']){
    const before=(await page.locator('#recent-incidents').boundingBox())!;
    await page.getByRole('button',{name:to==='Speed zones'&&from==='Zone Finder'?'Zone Finder':to,exact:true}).click();
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBeGreaterThan(0);
    const destination=await page.evaluate(()=>{
      const motions=[...document.querySelectorAll('.zone-layout-moving,.corridor-map-stage')].flatMap(node=>node.getAnimations());
      for(const motion of motions){motion.pause();motion.currentTime=Number(motion.effect!.getTiming().duration);}
      (window as any).incidentHandoffMotions=motions;
      return document.getElementById('recent-incidents')!.getBoundingClientRect().top;
    });
    for(const progress of [.05,.3,.65,.95]){
      const frame=await page.evaluate(async progress=>{
        for(const motion of (window as any).incidentHandoffMotions)motion.currentTime=Number(motion.effect.getTiming().duration)*progress;
        await new Promise(requestAnimationFrame);
        return [...document.querySelectorAll('#recent-incidents,.map-layout-ghost')].map(node=>{
          const rect=node.getBoundingClientRect();return {ghost:!node.id,top:rect.top,stretch:Math.abs(rect.width-(node as HTMLElement).offsetWidth)};
        });
      },progress);
      for(const panel of frame){
        expect(Math.abs(panel.top-(panel.ghost?before.y:destination)),`${from} → ${to} at ${progress}`).toBeLessThan(1);
        expect(panel.stretch,'report text must not stretch').toBeLessThan(1);
      }
      if(progress===.3)await page.screenshot({path:testInfo.outputPath(`${from}-${to}.png`)});
    }
    await page.evaluate(()=>{for(const motion of (window as any).incidentHandoffMotions)motion.finish();});await settled();
    await expect(page.locator('.map-layout-ghost-layer')).toHaveCount(0);from=to;
  }
});

test('interrupted I70 mode slides release their visual copy and leave one usable panel',async({page,dashboard})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I70');
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.zone-layout-moving')).toHaveCount(0);
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await expect(page.locator('.map-layout-ghost-layer')).toHaveCount(1);
  const visual=page.locator('.map-layout-ghost-layer');
  await expect(visual).toHaveAttribute('aria-hidden','true');expect(await visual.evaluate(node=>(node as HTMLElement).inert)).toBe(true);
  await expect(visual.locator('[id]')).toHaveCount(0);
  await page.evaluate(()=>{(window as any).setZoneFinder(true);(window as any).setChartView('overall');});
  await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
  await expect(page.locator('.map-layout-ghost-layer')).toHaveCount(0);
  await expect(page.locator('#recent-incidents')).toHaveCount(1);
  await expect.poll(()=>page.locator('#corridorMap').evaluate(node=>(node as HTMLElement).inert)).toBe(false);
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.map-view-changing,.zone-layout-moving,.map-layout-ghost-layer')).toHaveCount(0);
  expect(await page.locator('#zoneMapExpand').evaluate(node=>node.parentElement!.tagName)).toBe('HEADER');
});
