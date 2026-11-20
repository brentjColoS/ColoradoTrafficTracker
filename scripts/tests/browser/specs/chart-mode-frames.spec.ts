import {test,expect} from '../fixtures/dashboard';

for(const corridor of ['I25','I70']) test(`${corridor} chart-mode handoffs keep visible surfaces joined`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
  const settled=async()=>{
    await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
    await expect.poll(()=>page.locator('.corridor-map-stage').evaluate(node=>node.getAnimations().length)).toBe(0);
  };
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');await settled();
  let from='Overall';
  for(const to of ['Speed zones','Zone Finder','Speed zones','Overall','Speed zones','Zone Finder','Overall']){
    const label=to==='Speed zones'&&from==='Zone Finder'?'Zone Finder':to;
    await page.getByRole('button',{name:label,exact:true}).click();
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBeGreaterThan(0);
    await page.evaluate(()=>{
      const motions=[...document.querySelectorAll('.zone-layout-moving,.corridor-map-stage')].flatMap(node=>node.getAnimations());
      for(const motion of motions){motion.pause();motion.currentTime=0;}(window as any).modeMotions=motions;
    });
    for(const progress of [.05,.3,.65,.95]){
      const frame=await page.evaluate(async({progress,corridor})=>{
        for(const motion of (window as any).modeMotions)motion.currentTime=Number(motion.effect.getTiming().duration)*progress;
        await new Promise(requestAnimationFrame);
        await new Promise<void>(resolve=>{const observer=new ResizeObserver(()=>{observer.disconnect();resolve();});observer.observe(document.getElementById('corridorMap')!);});
        const rect=(id:string)=>document.getElementById(id)!.getBoundingClientRect();
        const incident=document.getElementById('recent-incidents')!,bounds=incident.getBoundingClientRect();
        const clip=(getComputedStyle(incident).clipPath.match(/-?[\d.]+px/g)||[]).map(parseFloat);
        const incidentBottom=bounds.bottom-(clip.length>2?clip[2]:clip[0]||0);
        const ghost=document.querySelector('.map-layout-ghost');
        const ghostBounds=ghost?.getBoundingClientRect();
        const ghostClip=ghost?(getComputedStyle(ghost).clipPath.match(/-?[\d.]+px/g)||[]).map(parseFloat):[];
        const ghostBottom=ghostBounds?ghostBounds.bottom-(ghostClip[2]||0):0;
        const lower=Math.max(rect(corridor.toLowerCase()+'Chart').bottom,rect('corridorMapPanel').bottom,incidentBottom,ghostBottom);
        const map=rect('corridorMap'),pixels=document.querySelector('#corridorMap canvas')!.getBoundingClientRect();
        return {lowerGap:rect('system-health').top-lower,mapGaps:[pixels.width-map.width,pixels.height-map.height],
          blankMap:!pixels.width||!pixels.height,overflow:document.documentElement.scrollWidth>innerWidth};
      },{progress,corridor});
      const context=JSON.stringify({from,to,progress,frame});
      if(progress===.3)await page.screenshot({path:testInfo.outputPath(`${from}-${to}-midpoint.png`)});
      expect(frame.lowerGap,context).toBeGreaterThanOrEqual(5);
      expect(frame.lowerGap,context).toBeLessThanOrEqual(10);
      expect(frame.blankMap,context).toBe(false);expect(frame.overflow,context).toBe(false);
      for(const gap of frame.mapGaps)expect(Math.abs(gap),context).toBeLessThan(2);
    }
    await page.evaluate(()=>{for(const motion of (window as any).modeMotions)motion.finish();});await settled();from=to;
  }
});
