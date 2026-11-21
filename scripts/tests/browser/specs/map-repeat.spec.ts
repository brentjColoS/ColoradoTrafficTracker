import {test,expect} from '../fixtures/dashboard';

test('repeated I70 map toggles keep the lower incident panel aligned with the map',async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I70');
  await expect(page.locator('#corridorMap canvas')).toBeVisible();
  await page.evaluate(()=>{
    const panel=document.getElementById('comparisonPanel')!;
    scrollTo({top:panel.getBoundingClientRect().top+scrollY-document.querySelector('.site-header')!.getBoundingClientRect().height-8,behavior:'instant'});
  });
  for(let index=0;index<8;index++) {
    const expanding=index%2===0;
    await page.locator('#zoneMapExpand').evaluate(element=>(element as HTMLButtonElement).click());
    const positions=await page.evaluate(expanding=>{
      const animations=[...document.querySelectorAll('.zone-layout-moving, #zoneMapExpand')].flatMap(node=>node.getAnimations());
      for(const animation of animations){animation.pause();animation.currentTime=450;}
      (window as any).repeatMotions=animations;
      const map=document.getElementById('corridorMapPanel')!.getBoundingClientRect();
      const lower=(expanding?document.querySelector('.map-layout-ghost'):document.querySelector('.route-incidents[data-corridor="I70"]'))!.getBoundingClientRect();
      return {mapTop:map.top,incidentTop:lower.top,offset:lower.top-map.top};
    },expanding);
    if(index===7)await page.screenshot({path:testInfo.outputPath('interrupted-repeat.png')});
    expect(Math.abs(positions.offset),JSON.stringify({index,...positions})).toBeLessThan(2);
    if(index<4) {
      await page.evaluate(()=>{for(const animation of (window as any).repeatMotions as Animation[])animation.play();});
      await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBe(0);
      await expect(page.locator('.map-layout-ghost-layer')).toHaveCount(0);
    }
  }
});

for(const width of [1440,2560]) test(`real repeated clicks keep the lower row together while the page scrolls at ${width}px`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width,height:width===2560?1440:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I70');
  await expect(page.locator('#corridorMap canvas')).toBeVisible();
  for(let index=0;index<6;index++) {
    await page.evaluate(expanding=>{
      const samples:any[]=[];
      (window as any).movingSamples=samples;
      let started=false,frames=0;
      const sample=()=>{
        const map=document.getElementById('corridorMapPanel')!;
        const ghost=document.querySelector('.map-layout-ghost');
        if(ghost) {
          started=true;
          const lower=(expanding?ghost:document.querySelector('.route-incidents[data-corridor="I70"]'))!.getBoundingClientRect();
          const box=map.getBoundingClientRect();
          samples.push({offset:lower.top-box.top,scroll:scrollY,lower:lower.top,map:box.top,
            titleOffset:document.getElementById('comparisonPanel')!.getBoundingClientRect().top-document.querySelector('.site-header')!.getBoundingClientRect().height-8,
            ghostState:ghost.getAnimations().map(animation=>({state:animation.playState,time:animation.currentTime}))});
          if(Math.abs(lower.top-box.top)>4) {
            for(const node of document.querySelectorAll('.zone-layout-moving'))for(const animation of node.getAnimations())animation.pause();
            return;
          }
        }
        if((!started||ghost)&&++frames<240)requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    },index%2===0);
    await page.getByRole('button',{name:index%2===0?'Enlarge map':'Restore map',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).movingSamples.length)).toBeGreaterThan(0);
    await expect.poll(()=>page.evaluate(()=>
      (window as any).movingSamples.some((sample:any)=>Math.abs(sample.offset)>4)
      || document.querySelectorAll('.zone-layout-moving').length===0)).toBe(true);
    const bad=await page.evaluate(()=>(window as any).movingSamples.find((sample:any)=>Math.abs(sample.offset)>4));
    expect(bad).toBeUndefined();
    const scroll=await page.evaluate(()=>(window as any).movingSamples.map((sample:any)=>sample.scroll) as number[]);
    expect(Math.max(...scroll)-Math.min(...scroll)).toBeLessThan(2);
    expect(await page.evaluate(()=>Math.max(...(window as any).movingSamples.map((sample:any)=>Math.abs(sample.titleOffset))))).toBeLessThan(2);
    await expect(page.locator('.map-layout-ghost-layer')).toHaveCount(0);
  }
  await page.screenshot({path:testInfo.outputPath(`repeated-toggle-settled-${width}.png`)});
});
