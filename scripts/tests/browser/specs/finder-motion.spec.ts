import {test,expect} from '../fixtures/dashboard';

test('profile warm I25 Finder transitions',async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width:2560,height:1440});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
  const finder=page.getByRole('button',{name:'Zone Finder',exact:true});
  const settled=async()=>{
    await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
    await expect.poll(()=>page.locator('.corridor-map-stage').evaluate(node=>node.getAnimations().length)).toBe(0);
  };
  await settled();await finder.click();await settled();await finder.click();await settled();
  await page.evaluate(()=>{
    const profile={draws:0,drawMs:0,longTasks:[] as number[]};(window as any).finderProfile=profile;
    const draw=(window as any).drawAllCharts;
    (window as any).drawAllCharts=function(...args:any[]){const start=performance.now();try{return draw(...args);}finally{profile.draws++;profile.drawMs+=performance.now()-start;}};
    new PerformanceObserver(list=>profile.longTasks.push(...list.getEntries().map(entry=>entry.duration))).observe({type:'longtask'});
  });
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  const before=await cdp.send('Performance.getMetrics');
  for(let i=0;i<2;i++){await finder.click();await settled();}
  const after=await cdp.send('Performance.getMetrics');
  const fields=['LayoutCount','RecalcStyleCount','LayoutDuration','ScriptDuration','TaskDuration'];
  const metrics=Object.fromEntries(fields.map(name=>[name,(after.metrics.find(m=>m.name===name)?.value||0)-(before.metrics.find(m=>m.name===name)?.value||0)]));
  const profile=await page.evaluate(()=>(window as any).finderProfile);
  expect(profile.draws).toBeGreaterThan(0);
  console.log(JSON.stringify({metrics,profile}));
  await testInfo.attach('motion-profile.json',{body:JSON.stringify({metrics,profile},null,2),contentType:'application/json'});
});

test('I25 Finder incident reveal never paints over the map',async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#comparisonPanel')).toHaveClass(/speed-zone-incidents/);
  await expect(page.locator('.zone-layout-moving')).toHaveCount(0);
  for(const enabled of [true,false]){
    await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBeGreaterThan(0);
    await page.evaluate(()=>{
      const motions=[...document.querySelectorAll('.zone-layout-moving,.corridor-map-stage')].flatMap(node=>node.getAnimations());
      for(const motion of motions){motion.pause();motion.currentTime=0;}(window as any).finderMotions=motions;
    });
    for(const progress of [.1,.3,.6,.9]){
      const frame=await page.evaluate(async({progress,enabled})=>{
        for(const motion of (window as any).finderMotions)motion.currentTime=Number(motion.effect.getTiming().duration)*progress;
        await new Promise(requestAnimationFrame);
        const map=document.getElementById('corridorMapPanel')!.getBoundingClientRect();
        const samples=[.15,.45,.75].flatMap(x=>[.4,.65,.85].map(y=>document.elementsFromPoint(map.left+map.width*x,map.top+map.height*y)));
        const incident=document.getElementById('recent-incidents')!;
        const ghost=document.querySelector('.map-layout-ghost')!;
        const rect=incident.getBoundingClientRect(),graph=document.getElementById('i25Chart')!.getBoundingClientRect();
        const narrow=enabled?ghost:incident,wide=enabled?incident:ghost,bounds=narrow.getBoundingClientRect();
        const clip=(getComputedStyle(narrow).clipPath.match(/[\d.]+px/g)||[]).map(parseFloat);
        const bottomInset=clip.length>2?clip[2]:clip[0]||0;
        const wrap=document.getElementById('i25Chart')!.parentElement!;
        const pointer=wrap.style.pointerEvents;wrap.style.pointerEvents='auto';
        const graphExposed=Boolean(document.elementFromPoint(graph.left+graph.width*.55,graph.bottom-8)?.closest('.chart-canvas-wrap'));
        wrap.style.pointerEvents=pointer;
        return {overlap:samples.some(stack=>stack[0]?.closest('#recent-incidents')),
          stretch:Math.max(Math.abs(rect.width-incident.offsetWidth),Math.abs(ghost.getBoundingClientRect().width-(ghost as HTMLElement).offsetWidth)),
          topJoin:bounds.top-graph.bottom,bottomJoin:bounds.bottom-bottomInset-map.bottom,wideJoin:wide.getBoundingClientRect().top-map.bottom,
          graphExposed};
      },{progress,enabled});
      if(progress===.3)await page.screenshot({path:testInfo.outputPath(`finder-${enabled?'exit':'return'}-midpoint.png`)});
      expect(frame.overlap,`incidents cover the map at ${progress} with Finder ${enabled}`).toBe(false);
      expect(frame.stretch,`report text stretches at ${progress} with Finder ${enabled}`).toBeLessThan(1);
      expect(Math.abs(frame.topJoin)).toBeLessThan(2);
      expect(Math.abs(frame.bottomJoin)).toBeLessThan(2);
      expect(frame.wideJoin).toBeGreaterThanOrEqual(-1);expect(frame.wideJoin).toBeLessThanOrEqual(9);
      expect(frame.graphExposed,JSON.stringify({progress,enabled,frame})).toBe(true);
    }
    await page.evaluate(()=>{for(const motion of (window as any).finderMotions)motion.finish();});
    await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
    expect(await page.locator('#recent-incidents').evaluate(node=>(node as HTMLElement).style.width)).toBe('');
    await expect(page.locator('.map-layout-ghost-layer')).toHaveCount(0);
  }
});

test('interrupted Finder folds release temporary widths and preserve map state',async({page,dashboard})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.zone-layout-moving')).toHaveCount(0);
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBeGreaterThan(0);
  await page.evaluate(()=>{(window as any).setZoneFinder(false);(window as any).setChartView('overall');});
  await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
  expect(await page.locator('#recent-incidents').evaluate(node=>(node as HTMLElement).style.width)).toBe('');
  expect(await page.locator('#recent-incidents').evaluate(node=>getComputedStyle(node).clipPath)).toBe('none');
  await expect(page.locator('.map-layout-ghost-layer')).toHaveCount(0);
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
  await page.evaluate(()=>{(window as any).setChartView('zones');(window as any).setZoneFinder(true);});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
  expect(await page.locator('#recent-incidents').evaluate(node=>(node as HTMLElement).style.width)).toBe('');
  await page.setViewportSize({width:1440,height:900});
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
  expect(await page.locator('#zoneMapExpand').evaluate(node=>node.parentElement!.tagName)).toBe('HEADER');
});

test('enlarging during a Finder handoff has one resize owner and releases the map',async({page,dashboard})=>{
  await page.setViewportSize({width:2560,height:1440});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  await page.locator('#zoneMapExpand').evaluate(node=>(node as HTMLButtonElement).click());
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
  await expect.poll(()=>page.locator('#comparisonPanel').evaluate(node=>node.getAnimations().length)).toBe(0);
  await expect.poll(()=>page.locator('#corridorMap').evaluate(node=>(node as HTMLElement).inert)).toBe(false);
  await expect(page.locator('#corridorMap .maplibregl-canvas-container')).toHaveCSS('transform','none');
});

for(const corridor of ['I25','I70'])for(const width of [1440,2560])test(`${corridor} Finder reversal preserves the visible incident slice at ${width}px`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width,height:width===2560?1440:900});
  await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
  const settled=async()=>{await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);};
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();await settled();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');await settled();
  for(const target of [false,true]){
    if(await page.locator('#zoneFinderToggle').getAttribute('aria-pressed')!==String(!target)){
      await page.getByRole('button',{name:'Zone Finder',exact:true}).click();await settled();
    }
    await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBeGreaterThan(0);
    const slice=await page.evaluate(async target=>{
      const surface=(node:Element)=>{
        const bounds=node.getBoundingClientRect(),values=(getComputedStyle(node).clipPath.match(/[-+\d.e]+px/gi)||[]).map(parseFloat);
        const top=values[0]||0,bottom=values.length>2?values[2]:top;
        return {left:bounds.left,top:bounds.top+top,width:bounds.width,height:Math.max(0,bounds.height-top-bottom)};
      };
      let motions=[...document.querySelectorAll('.zone-layout-moving')].flatMap(node=>node.getAnimations());
      for(const a of motions){a.pause();a.currentTime=Number(a.effect!.getTiming().duration)*.15;}
      const before=surface(document.getElementById('recent-incidents')!);
      (window as any).setZoneFinder(!target);await new Promise(requestAnimationFrame);
      motions=[...document.querySelectorAll('.zone-layout-moving')].flatMap(node=>node.getAnimations());
      for(const a of motions){a.pause();a.currentTime=0;}
      (window as any).reversalMotions=motions;
      return {before,after:surface(document.querySelector('.map-layout-ghost')!)};
    },target);
    for(const part of ['left','top','width','height'] as const)expect(Math.abs(slice.after[part]-slice.before[part]),JSON.stringify({corridor,width,target,slice})).toBeLessThan(1);
    await page.screenshot({path:testInfo.outputPath(`reversal-${target?'to-finder':'from-finder'}.png`)});
    await page.evaluate(()=>{for(const a of (window as any).reversalMotions as Animation[])a.finish();});await settled();
    await expect(page.locator('.map-layout-ghost-layer')).toHaveCount(0);
    await expect.poll(()=>page.locator('#corridorMap').evaluate(node=>(node as HTMLElement).inert)).toBe(false);
  }
});
