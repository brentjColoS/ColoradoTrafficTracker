import {test,expect} from '../fixtures/dashboard';

test('I25 Finder reclaims the actual chart canvas when incidents leave',async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#comparisonPanel')).toHaveClass(/speed-zone-incidents/);
  await expect(page.locator('.zone-layout-moving')).toHaveCount(0);
  const before=(await page.locator('#i25Chart').boundingBox())!.height;
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  await expect(page.locator('#comparisonPanel')).not.toHaveClass(/speed-zone-incidents/);
  await expect.poll(async()=>{
    const canvas=(await page.locator('#i25Chart').boundingBox())!,lane=(await page.locator('.chart-lane[data-corridor="I25"]').boundingBox())!;
    return Math.abs(canvas.y+canvas.height-lane.y-lane.height);
  }).toBeLessThan(2);
  expect((await page.locator('#i25Chart').boundingBox())!.height).toBeGreaterThan(before*1.5);
  await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
  await expect.poll(()=>page.locator('.corridor-map-stage').evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.screenshot({path:testInfo.outputPath('finder-reclaimed-chart.png')});
});

for(const corridor of ['I25','I70']) test(`${corridor} mode-transition frames keep lower panels and map surfaces attached`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#comparisonPanel')).toHaveClass(/zone-map-expanded/);
  await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
  await expect.poll(()=>page.locator('#comparisonPanel').evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.getByRole('button',{name:'Overall',exact:true}).click();
  await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBeGreaterThan(0);
  await page.evaluate(()=>{
    const animations=[...document.querySelectorAll('.zone-layout-moving,.corridor-map-stage')].flatMap(node=>node.getAnimations());
    for(const animation of animations){animation.pause();animation.currentTime=0;}
    (window as any).modeFrameCheck=animations;
  });
  for(const progress of [0,.3,.6,.999]){
    const edges=await page.evaluate(async({progress,corridor})=>{
      for(const animation of (window as any).modeFrameCheck)animation.currentTime=Number(animation.effect.getTiming().duration)*progress;
      await new Promise(requestAnimationFrame);
      await new Promise<void>(resolve=>{const observer=new ResizeObserver(()=>{observer.disconnect();resolve();});observer.observe(document.getElementById('corridorMap')!);});
      const rect=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect();
      const lower=Math.max(...[...document.querySelectorAll(`#${corridor.toLowerCase()}Chart,#corridorMapPanel,#recent-incidents,.map-layout-ghost`)].map(node=>{
        const bounds=node.getBoundingClientRect(),clip=(getComputedStyle(node).clipPath.match(/-?[\d.]+px/g)||[]).map(parseFloat);
        return bounds.bottom-(clip.length>2?clip[2]:clip[0]||0);
      }));
      const map=rect('#corridorMap'),pixels=rect('#corridorMap canvas'),control=rect('#zoneMapExpand'),header=rect('#corridorMapPanel > header');
      return {lowerGap:rect('#system-health').top-lower,mapGaps:[pixels.width-map.width,pixels.height-map.height],
        button:[control.width,control.height],controlJoin:control.top+control.height/2-header.top-header.height/2};
    },{progress,corridor});
    expect(edges.lowerGap,JSON.stringify({progress,edges})).toBeGreaterThanOrEqual(5);
    expect(edges.lowerGap,JSON.stringify({progress,edges})).toBeLessThanOrEqual(10);
    for(const gap of edges.mapGaps)expect(Math.abs(gap)).toBeLessThan(2);
    for(const size of edges.button)expect(Math.abs(size-30)).toBeLessThan(.1);
    expect(Math.abs(edges.controlJoin)).toBeLessThan(2);
    if(progress===.3)await page.screenshot({path:testInfo.outputPath('mode-midpoint.png')});
  }
  await page.evaluate(()=>{for(const animation of (window as any).modeFrameCheck)animation.finish();});
  await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
});

for(const corridor of ['I25','I70']) for(const width of [1440,2560]) test(`${corridor} expanded preference and graph space survive every chart-mode direction at ${width}px`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width,height:width===2560?1440:900});
  await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
  const comparison=page.locator('#comparisonPanel'),control=page.locator('#zoneMapExpand');
  const settled=async()=>{
    await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
    await expect.poll(()=>page.locator('.corridor-map-stage').evaluate(node=>node.getAnimations().length)).toBe(0);
  };
  await control.click();await expect(control).toHaveAttribute('aria-pressed','true');await settled();
  await page.evaluate(()=>{(window as any).originalModeMap=document.querySelector('#corridorMap canvas');});
  for(const mode of ['zones','finder','overall','zones','finder','zones','overall']) {
    const label=mode==='overall'?'Overall':mode==='zones'?'Speed zones':'Zone Finder';
    if(mode==='zones' && await page.locator('#zoneFinderToggle').getAttribute('aria-pressed')==='true')
      await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
    else await page.getByRole('button',{name:label,exact:true}).click();
    await expect(control).toHaveAttribute('aria-pressed','true');await settled();
    if(mode==='overall')await expect(comparison).toHaveClass(/overall-map-expanded/);
    else await expect(comparison).toHaveClass(/zone-map-expanded/);
    const state=await page.evaluate(({corridor,mode})=>{
      const rect=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect();
      const canvas=rect(`#${corridor.toLowerCase()}Chart`),lane=rect(`.chart-lane[data-corridor="${corridor}"]`);
      const control=rect('#zoneMapExpand'),map=rect('#corridorMap'),pixels=rect('#corridorMap canvas');
      return {graphBottom:canvas.bottom-lane.bottom,graphHeight:canvas.height,button:[control.width,control.height],
        mapGaps:[pixels.width-map.width,pixels.height-map.height],same:(window as any).originalModeMap===document.querySelector('#corridorMap canvas'),
        incidentParent:document.getElementById('recent-incidents')!.parentElement!.tagName,
        overflow:document.documentElement.scrollWidth>innerWidth,mode};
    },{corridor,mode});
    expect(Math.abs(state.graphBottom),JSON.stringify(state)).toBeLessThan(2);
    expect(state.graphHeight).toBeGreaterThan(200);
    expect(state.button).toEqual([30,30]);expect(state.same).toBe(true);expect(state.overflow).toBe(false);
    for(const gap of state.mapGaps)expect(Math.abs(gap),JSON.stringify(state)).toBeLessThan(2);
    expect(state.incidentParent).toBe(mode==='finder'?'MAIN':'SECTION');
    if(mode==='finder')await page.screenshot({path:testInfo.outputPath('expanded-finder.png')});
  }
  await control.click();await expect(control).toHaveAttribute('aria-pressed','false');await settled();
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();await settled();
  await expect(control).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();await settled();
  await expect(control).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Overall',exact:true}).click();await settled();
  await expect(control).toHaveAttribute('aria-pressed','false');
});

test('rapid mode changes, reduced motion and narrow layouts preserve one expansion preference safely',async({page,dashboard})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#comparisonPanel')).toHaveClass(/overall-map-expanded/);
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.evaluate(()=>{
    for(const view of ['overall','zones','overall','zones'])(window as any).setChartView(view);
    (window as any).setZoneFinder(true);
  });
  await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
  await expect(page.locator('#zoneFinderToggle')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
  expect(await page.locator('#zoneMapExpand').evaluate(node=>node.parentElement!.tagName)).toBe('HEADER');
  await page.setViewportSize({width:390,height:844});await expect(page.locator('#zoneMapExpand')).toBeHidden();
  await page.setViewportSize({width:1440,height:900});await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const label of ['Overall','Speed zones','Zone Finder','Overall']){
    await page.getByRole('button',{name:label,exact:true}).click();
    await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.zone-layout-moving')).toHaveCount(0);
  }
  await page.getByRole('button',{name:'Restore map',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','false');
});
