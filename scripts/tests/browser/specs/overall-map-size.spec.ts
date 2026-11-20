import {test,expect} from '../fixtures/dashboard';

for(const corridor of ['I25','I70']) for(const width of [2560,1440]) {
  test(`${corridor} Overall map reshuffles beside its graph and incidents at ${width}px`,async({page,dashboard},testInfo)=>{
    await page.setViewportSize({width,height:width===2560?1440:900});
    await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
    const comparison=page.locator('#comparisonPanel'),map=page.locator('#corridorMapPanel');
    await expect(page.locator('#corridorMap canvas')).toBeVisible();
    const original=(await map.boundingBox())!;
    await page.evaluate(()=>{(window as any).originalMap=document.getElementById('corridorMap');});
    await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
    await expect(comparison).toHaveClass(/overall-map-expanded/);
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBe(0);
    await expect.poll(async()=>Math.abs((await comparison.boundingBox())!.y-(await page.locator('.site-header').boundingBox())!.height-8)).toBeLessThan(2);
    const expanded=(await map.boundingBox())!,graph=(await page.locator(`.chart-lane[data-corridor="${corridor}"]`).boundingBox())!;
    const incidents=(await page.locator('#recent-incidents').boundingBox())!;
    if(corridor==='I25') {
      expect(expanded.height).toBeGreaterThan(original.height*1.2);
      expect(incidents.y).toBeGreaterThan(graph.y);
      expect(Math.abs(incidents.x-graph.x)).toBeLessThan(2);
      expect(expanded.x).toBeGreaterThan(graph.x);
    } else {
      expect(Math.abs(incidents.y-graph.y)).toBeLessThan(2);
      expect(incidents.x).toBeGreaterThan(graph.x+graph.width-2);
      expect(expanded.y).toBeGreaterThan(graph.y+graph.height-2);
      expect(expanded.width).toBeGreaterThan(original.width*2);
      expect(expanded.width/expanded.height).toBeGreaterThan(3);
      expect(Math.abs(expanded.width-(await comparison.boundingBox())!.width)).toBeLessThan(3);
    }
    expect(await page.evaluate(()=>(window as any).originalMap===document.getElementById('corridorMap'))).toBe(true);
    await expect(page.locator('#corridorMap canvas')).toHaveCount(1);
    expect(await page.locator(`.route-incidents[data-corridor="${corridor}"] .incident-table-wrap`).evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThan(2);
    await expect.poll(()=>page.locator('#corridorMap').evaluate(element=>Math.abs(element.querySelector('canvas')!.getBoundingClientRect().width-element.clientWidth))).toBeLessThan(2);
    await page.screenshot({path:testInfo.outputPath(`overall-map-${corridor}-${width}.png`),animations:'disabled'});
    if(width===1440) {
      await page.setViewportSize({width:390,height:844});
      await expect(comparison).not.toHaveClass(/overall-map-expanded/);
      await expect(page.locator('#zoneMapExpand')).toBeHidden();
      expect(await page.locator('#recent-incidents').evaluate(element=>element.parentElement!.tagName)).toBe('MAIN');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
      await page.setViewportSize({width,height:900});
      await expect(comparison).toHaveClass(/overall-map-expanded/);
    }
    await page.getByRole('button',{name:'Restore map',exact:true}).click();
    await expect(comparison).not.toHaveClass(/overall-map-expanded/);
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBe(0);
    expect(await page.locator('#recent-incidents').evaluate(element=>element.parentElement!.tagName)).toBe('MAIN');
    expect(await map.evaluate(element=>element.parentElement!.id)).toBe('incidentRouteGrid');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  });
}

test('Overall enlargement reverses safely and returns moved panels when switching views or corridors',async({page,dashboard})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await expect(page.locator('#corridorMap canvas')).toBeVisible();
  const cancelled=await page.locator('#zoneMapExpand').evaluate(element=>{
    (element as HTMLButtonElement).click();
    const preparing=element.getAttribute('aria-busy')==='true';
    window.dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true}));
    return preparing;
  });
  expect(cancelled).toBe(true);
  await expect(page.locator('#zoneMapExpand')).not.toHaveAttribute('aria-busy','true');
  await page.waitForTimeout(450);
  await expect(page.locator('#comparisonPanel')).not.toHaveClass(/overall-map-expanded/);
  await page.evaluate(()=>{
    const panel=document.getElementById('comparisonPanel')!;
    scrollTo({top:panel.getBoundingClientRect().top+scrollY-document.querySelector('.site-header')!.getBoundingClientRect().height-8,behavior:'instant'});
  });
  await page.locator('#zoneMapExpand').evaluate(element=>{(element as HTMLButtonElement).click();});
  await expect(page.locator('.i25-trace-handoff')).toHaveCount(1);
  await page.locator('#zoneMapExpand').evaluate(element=>{(element as HTMLButtonElement).click();});
  await expect(page.locator('#comparisonPanel')).not.toHaveClass(/overall-map-expanded/);
  await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBe(0);
  await expect(page.locator('.i25-trace-handoff')).toHaveCount(0);
  expect(await page.locator('#zoneMapExpand').evaluate(element=>element.parentElement!.tagName)).toBe('HEADER');
  expect(await page.locator('#corridorMap').evaluate(element=>(element as HTMLElement).inert)).toBe(false);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'Enlarge map',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#comparisonPanel')).toHaveClass(/overall-map-expanded/);
  expect(await page.locator('.zone-layout-moving').count()).toBe(0);
  await expect(page.locator('.i25-trace-handoff')).toHaveCount(0);
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await expect(page.locator('#comparisonPanel')).not.toHaveClass(/overall-map-expanded/);
  await expect(page.locator('#comparisonPanel')).toHaveClass(/speed-zone-incidents/);
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Overall',exact:true}).click();
  await expect(page.locator('#comparisonPanel')).toHaveClass(/overall-map-expanded/);
  await page.getByRole('button',{name:'I-70, east–west corridor',exact:true}).click();
  await expect(page.locator('#comparisonPanel')).not.toHaveClass(/overall-map-expanded/);
  expect(await page.locator('#corridorMapPanel').evaluate(element=>element.parentElement!.id)).toBe('incidentRouteGrid');
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await page.getByRole('button',{name:'Both Corridors',exact:true}).click();
  await expect(page.locator('#comparisonPanel')).not.toHaveClass(/overall-map-expanded/);
  await expect(page.locator('#corridorMapPanel')).toBeHidden();
  await expect(page.locator('#i25IncidentRows tr')).toHaveCount(3);
  await expect(page.locator('#i70IncidentRows tr')).toHaveCount(3);
});

test('I25 hands space between graph and map without hiding panels in either direction',async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await expect(page.locator('#corridorMap canvas')).toBeVisible();
  const preparing=await page.evaluate(()=>{
    const handoff=(window as any).DashboardTraceHandoff,start=handoff.start;(window as any).tracePaints=0;
    handoff.start=(options:any)=>start({...options,paint:(...args:any[])=>{(window as any).tracePaints++;return options.paint(...args);}});
    scrollTo({top:0,behavior:'instant'});
    (window as any).lowerPanelGap=document.getElementById('system-health')!.getBoundingClientRect().top-document.getElementById('corridorMapPanel')!.getBoundingClientRect().bottom;
    (window as any).underHoodGap=document.getElementById('under-the-hood')!.getBoundingClientRect().top-document.getElementById('system-health')!.getBoundingClientRect().bottom;
    document.getElementById('zoneMapExpand')!.click();
    return {busy:document.getElementById('zoneMapExpand')!.getAttribute('aria-busy'),
      moving:document.querySelectorAll('.zone-layout-moving').length,
      expanded:document.getElementById('comparisonPanel')!.classList.contains('overall-map-expanded')};
  });
  expect(preparing).toEqual({busy:'true',moving:0,expanded:false});
  await expect(page.locator('#comparisonPanel')).toHaveClass(/overall-map-expanded/);
  expect(await page.locator('#comparisonPanel').evaluate(element=>
    Math.abs(element.getBoundingClientRect().top-document.querySelector('.site-header')!.getBoundingClientRect().height-8))).toBeLessThan(2);
  for(const expanding of [true,false]) {
    if(!expanding)await page.locator('#zoneMapExpand').evaluate(element=>(element as HTMLButtonElement).click());
    const initial=await page.evaluate(async()=>{
      const animations=[...document.querySelectorAll('.zone-layout-moving, #zoneMapExpand')].flatMap(node=>node.getAnimations());
      for(const animation of animations){animation.pause();animation.currentTime=0;}
      (window as any).mapLayoutCheck=animations;
      await new Promise(requestAnimationFrame);
      return {mapTop:document.getElementById('corridorMapPanel')!.getBoundingClientRect().top,
        durations:animations.map(animation=>Number(animation.effect!.getTiming().duration)),
        graphRight:document.querySelector('.i25-trace-viewport')!.getBoundingClientRect().right,
        backdropHeight:document.querySelector('.i25-trace-grid')!.getBoundingClientRect().height,
        bufferWidth:document.querySelector('.i25-trace-viewport canvas')!.getAttribute('width')};
    });
    expect(initial.durations.every(duration=>duration===(expanding?1750:1350))).toBe(true);
    let holdSnapshot:string|undefined,settledPaints:number|undefined;
    for(const progress of expanding?[0,.25,.45,.6,.75,.95]:[0,.25,.55,.75,.95]) {
      const positions=await page.evaluate(async progress=>{
        for(const animation of (window as any).mapLayoutCheck as Animation[])animation.currentTime=progress*Number(animation.effect!.getTiming().duration);
        await new Promise(requestAnimationFrame);
        const map=document.getElementById('corridorMapPanel')!,health=document.getElementById('system-health')!;
        const box=map.getBoundingClientRect(),graph=document.querySelector('.i25-trace-viewport')!.getBoundingClientRect();
        const incidentPanel=document.getElementById('recent-incidents')!;
        const panelBottom=incidentPanel.getBoundingClientRect().bottom-parseFloat(getComputedStyle(incidentPanel).clipPath.split(' ')[2]);
        const orbit=(document.querySelector('.i25-trace-pulse path')! as SVGGraphicsElement).getBBox();
        const ridge=[...document.querySelector('.i25-mountain-ink')!.getAttribute('d')!.matchAll(/[ML]([\d.-]+)\s+([\d.-]+)/g)]
          .map(match=>({x:Number(match[1]),y:Number(match[2])}));
        const styles=getComputedStyle(document.documentElement);
        const ranges=[...document.querySelectorAll('.i25-mountain-layer')].map(layer=>{
          const ink=layer.querySelector('.i25-mountain-range')!,name=layer.getAttribute('data-range');
          const points=[...ink.getAttribute('d')!.matchAll(/[ML]([\d.-]+)\s+([\d.-]+)/g)]
            .map(match=>({x:Number(match[1]),y:Number(match[2])}));
          return {name,points,color:ink.getAttribute('stroke'),
            expectedColor:styles.getPropertyValue(name==='green'?'--forest-soft':'--rose').trim(),
            reveal:Number(ink.getAttribute('stroke-dashoffset')),dots:layer.querySelectorAll('.i25-mountain-range-dot').length};
        });
        type Point={x:number;y:number};
        const yAt=(points:Point[],x:number)=>{
          for(let index=1;index<points.length;index++)if(x<=points[index].x) {
            const span=points[index].x-points[index-1].x;
            return points[index-1].y+(points[index].y-points[index-1].y)*(span>0?(x-points[index-1].x)/span:0);
          }
          return points.at(-1)!.y;
        };
        const lowerGap=(upper:Point[],lower:Point[])=>{
          const xs=[...upper,...lower].map(point=>point.x).filter(x=>x>=Math.max(upper[0].x,lower[0].x));
          return Math.min(...xs.map(x=>yAt(lower,x)-yAt(upper,x)));
        };
        if(progress===.45) {
          (window as any).holdWrites=0;
          const observer=new MutationObserver(records=>{(window as any).holdWrites+=records.length;});
          observer.observe(document.querySelector('.i25-trace-handoff')!,{attributes:true,subtree:true});
          (window as any).holdObserver=observer;
        }
        if(progress===.6)(window as any).holdObserver.disconnect();
        return {tracePaints:(window as any).tracePaints,mapTop:box.top,graphRight:graph.right,separation:Math.max(box.left-graph.right,box.top-graph.bottom),
          holdWrites:(window as any).holdWrites,
          holdSnapshot:JSON.stringify({mapTop:box.top,graphRight:graph.right,healthTop:health.getBoundingClientRect().top,ridge,ranges,
            opacity:getComputedStyle(document.querySelector('.i25-trace-pulse')!).opacity}),
          ridgeOrigin:ridge[0],fork:ridge[1],ranges,
          layerGaps:[lowerGap(ridge,ranges[0].points),lowerGap(ranges[0].points,ranges[1].points)],
          oldWhiteTrace:document.querySelectorAll('.i25-mountain-detail,.i25-mountain-detail-etch').length,
          forkFraction:Math.hypot(ridge[1].x-ridge[0].x,ridge[1].y-ridge[0].y)/(document.querySelector('.i25-mountain-ink')! as SVGGeometryElement).getTotalLength(),
          ridgeOrdered:ridge.every((point,index)=>index===0||point.x>=ridge[index-1].x),
          ridgePeaks:ridge.filter((point,index)=>index>0&&index<ridge.length-1&&point.y<ridge[index-1].y&&point.y<ridge[index+1].y).length,
          ridgeReveal:Number(document.querySelector('.i25-mountain-ink')!.getAttribute('stroke-dashoffset')),
          backdropHeight:document.querySelector('.i25-trace-grid')!.getBoundingClientRect().height,
          backdropBottomInset:parseFloat(getComputedStyle(document.querySelector('.i25-trace-grid')!).clipPath.split(' ')[2]),
          orbit:{x:orbit.x,y:orbit.y,width:orbit.width,height:orbit.height},
          chartWidth:document.querySelector('.i25-trace-grid')!.getBoundingClientRect().width,
          dataWidth:graph.width,
          incidentGap:document.querySelector('.route-incidents[data-corridor="I25"]')!.getBoundingClientRect().top-graph.bottom,
          bufferWidth:document.querySelector('.i25-trace-viewport canvas')!.getAttribute('width'),
          pulseOpacity:Number(getComputedStyle(document.querySelector('.i25-trace-pulse')!).opacity),
          pulseOverflow:getComputedStyle(document.querySelector('.i25-trace-pulse')!).overflow,
          grid:document.querySelector('.i25-trace-grid path')!.getAttribute('d'),
          pulseDots:document.querySelectorAll('.i25-mountain-ink-dot').length,
          button:((bounds)=>[bounds.width,bounds.height])(document.getElementById('zoneMapExpand')!.getBoundingClientRect()),
          healthGap:health.getBoundingClientRect().top-box.bottom-(window as any).lowerPanelGap,
          healthIncidentGap:health.getBoundingClientRect().top-document.querySelector('.route-incidents[data-corridor="I25"]')!.getBoundingClientRect().bottom,
          healthPanelGap:health.getBoundingClientRect().top-panelBottom,
          panelEdgeGap:panelBottom-box.bottom,
          underHoodGap:document.getElementById('under-the-hood')!.getBoundingClientRect().top-health.getBoundingClientRect().bottom-(window as any).underHoodGap,
          incidentMapGap:box.left-document.querySelector('.route-incidents[data-corridor="I25"]')!.getBoundingClientRect().right,
          opacity:[map,health,document.getElementById('recent-incidents')!].map(node=>Number(getComputedStyle(node).opacity))};
      },progress);
      expect(positions.opacity).toEqual([1,1,1]);
      if(expanding&&progress===.75)settledPaints=positions.tracePaints;
      if(expanding&&progress===.95)expect(positions.tracePaints,'moving the map does not repaint an unchanged graph snapshot').toBe(settledPaints);
      expect(positions.bufferWidth).toBe(initial.bufferWidth);
      expect(positions.backdropHeight).toBe(initial.backdropHeight);
      expect(positions.backdropBottomInset).toBe(0);
      expect(positions.grid).toContain('H');
      expect(positions.pulseDots).toBe(3);
      expect(positions.oldWhiteTrace).toBe(0);
      expect(positions.ranges.map(range=>range.name)).toEqual(['green','rose']);
      expect(positions.ranges[0].points).not.toEqual(positions.ranges[1].points);
      for(const range of positions.ranges) {
        expect(range.dots).toBe(3);
        expect(range.color).toBe(range.expectedColor);
        expect(range.points[0]).toEqual(positions.fork);
        if(expanding&&progress===.25) {
          expect(range.reveal).toBeLessThan(1);
          expect(range.reveal).toBeGreaterThan(0);
        }
      }
      expect(positions.ranges[1].reveal).toBeGreaterThanOrEqual(positions.ranges[0].reveal);
      if(expanding&&(progress===.45||progress===.6)) {
        expect(positions.ridgeReveal).toBe(0);
        expect(positions.ranges.every(range=>range.reveal===0)).toBe(true);
        expect(positions.pulseOpacity).toBe(1);
        expect(Math.abs(positions.mapTop-initial.mapTop)).toBeLessThan(2);
        if(progress===.45)holdSnapshot=positions.holdSnapshot;
        else { expect(positions.holdSnapshot).toBe(holdSnapshot);expect(positions.holdWrites).toBe(0); }
      }
      if(positions.pulseOpacity>0)for(const gap of positions.layerGaps)expect(gap).toBeGreaterThanOrEqual(-.1);
      expect(Math.abs(positions.ridgeOrigin.x-(positions.dataWidth-5))).toBeLessThan(.2);
      if(expanding&&progress===.25) {
        expect(positions.forkFraction).toBeLessThan(.1);
      }
      expect(positions.ridgeOrdered).toBe(true);
      if(positions.pulseOpacity>0)expect(positions.ridgePeaks).toBeGreaterThanOrEqual(3);
      expect(positions.ridgeReveal).toBeGreaterThanOrEqual(0);
      expect(positions.ridgeReveal).toBeLessThanOrEqual(1);
      if(expanding&&progress===.25)expect(positions.ridgeReveal).toBeGreaterThan(0);
      if(expanding&&progress>=.55)expect(positions.ridgeReveal).toBe(0);
      expect(positions.pulseOverflow).toBe('hidden');
      if(expanding&&(progress===.25||progress===.75))expect(positions.pulseOpacity).toBeGreaterThan(0);
      if(expanding&&progress===.25)expect(positions.orbit.height).toBeGreaterThan(initial.backdropHeight*.5);
      if(positions.pulseOpacity>0) {
        expect(positions.orbit.x).toBeGreaterThanOrEqual(positions.dataWidth-6);
        expect(positions.orbit.x+positions.orbit.width).toBeLessThan(positions.chartWidth);
        expect(positions.orbit.y).toBeGreaterThan(0);
        expect(positions.orbit.y+positions.orbit.height).toBeLessThan(initial.backdropHeight);
      }
      for(const size of positions.button)expect(Math.abs(size-30)).toBeLessThan(.1);
      expect(positions.separation,JSON.stringify({expanding,progress,positions})).toBeGreaterThan(-2);
      expect(positions.incidentGap).toBeGreaterThan(-2);
      expect(positions.healthIncidentGap,JSON.stringify({expanding,progress,positions})).toBeGreaterThanOrEqual(0);
      expect(positions.healthPanelGap,JSON.stringify({expanding,progress,positions})).toBeGreaterThanOrEqual(0);
      expect(Math.abs(positions.panelEdgeGap)).toBeLessThan(2);
      expect(Math.abs(positions.underHoodGap)).toBeLessThan(2);
      expect(Math.abs(positions.incidentMapGap)).toBeLessThan(2);
      expect(Math.abs(positions.healthGap)).toBeLessThan(2);
      if(expanding?progress<=.65:progress<=.55)expect(Math.abs(expanding?positions.mapTop-initial.mapTop:positions.graphRight-initial.graphRight)).toBeLessThan(2);
      if(expanding&&(progress===.25||progress===.45||progress===.75))await page.screenshot({path:testInfo.outputPath(`i25-handoff-${progress}.png`)});
      if(!expanding&&(progress===.25||progress===.75))await page.screenshot({path:testInfo.outputPath(`i25-restore-${progress}.png`)});
    }
    await page.evaluate(()=>{for(const animation of (window as any).mapLayoutCheck as Animation[])animation.play();});
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBe(0);
    await expect(page.locator('.i25-trace-handoff')).toHaveCount(0);
    expect(await page.locator('#recent-incidents').evaluate(element=>getComputedStyle(element).clipPath)).toBe('none');
    expect(await page.locator('#zoneMapExpand').evaluate(element=>element.parentElement!.tagName)).toBe('HEADER');
  }
});

for(const theme of ['light','dark'] as const) test(`I25 incident surface stays above System Health throughout expansion and restore at 2560px in ${theme}`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width:2560,height:1440});
  await page.emulateMedia({colorScheme:theme});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await expect(page.locator('#corridorMap canvas')).toBeVisible();
  await page.evaluate(()=>{
    const panel=document.getElementById('comparisonPanel')!;
    scrollTo({top:panel.getBoundingClientRect().top+scrollY-document.querySelector('.site-header')!.getBoundingClientRect().height-8,behavior:'instant'});
  });
  for(const expanding of [true,false]) {
    const initial=await page.evaluate(()=>{
      const map=document.getElementById('corridorMapPanel')!.getBoundingClientRect();
      return {mapTop:map.top,mapBottom:map.bottom,keyTop:document.querySelector('#recent-incidents > .incident-key')!.getBoundingClientRect().top};
    });
    await page.locator('#zoneMapExpand').evaluate(element=>(element as HTMLButtonElement).click());
    if(expanding)await expect(page.locator('#comparisonPanel')).toHaveClass(/overall-map-expanded/);
    else await expect(page.locator('#comparisonPanel')).not.toHaveClass(/overall-map-expanded/);
    await page.evaluate(()=>{
      const animations=[...document.querySelectorAll('.zone-layout-moving, #zoneMapExpand')].flatMap(node=>node.getAnimations());
      for(const animation of animations){animation.pause();animation.currentTime=0;}
      (window as any).edgeAnimations=animations;
    });
    let endControl:number[]=[];
    for(const progress of [0,.1,.25,.4,.425,.55,.65,.675,.75,.85,.95,.999]) {
      const edges=await page.evaluate(async progress=>{
        for(const animation of (window as any).edgeAnimations as Animation[])animation.currentTime=progress*Number(animation.effect!.getTiming().duration);
        document.getElementById('corridorMapPanel')!.getBoundingClientRect();
        await new Promise(requestAnimationFrame);
        await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
        const panel=document.getElementById('recent-incidents')!,health=document.getElementById('system-health')!;
        const bottom=panel.getBoundingClientRect().bottom-parseFloat(getComputedStyle(panel).clipPath.split(' ')[2]);
        const healthBox=health.getBoundingClientRect(),sampleY=healthBox.top+12;
        const visible=sampleY<innerHeight;
        const style=(health as HTMLElement).style,pointerEvents=style.pointerEvents;
        // Moving panels suppress input; opt into hit testing only for this paint-order check.
        style.pointerEvents='auto';
        const healthExposed=!visible||health.contains(document.elementFromPoint(healthBox.left+24,sampleY));
        style.pointerEvents=pointerEvents;
        const map=document.getElementById('corridorMapPanel')!.getBoundingClientRect();
        const incidents=document.querySelector('.route-incidents[data-corridor="I25"]')!.getBoundingClientRect();
        const key=document.querySelector('#recent-incidents > .incident-key')!.getBoundingClientRect();
        const graph=document.querySelector('.i25-trace-viewport')!.getBoundingClientRect();
        const header=document.querySelector('#corridorMapPanel > header')!.getBoundingClientRect();
        const control=document.getElementById('zoneMapExpand')!.getBoundingClientRect();
        return {shellGap:bottom-map.bottom,healthGap:healthBox.top-bottom,healthExposed,
          controlCenterGap:control.top+control.height/2-(header.top+header.height/2),
          controlRightGap:map.right-control.right,
          controlBox:[control.left,control.top,control.width,control.height],
          incidentBottomGap:incidents.bottom-map.bottom,incidentKeyGap:incidents.top-key.bottom,
          incidentMapGap:map.left-incidents.right,
          keyMapGap:key.bottom>map.top+2&&key.top<map.bottom ? Math.max(0,map.left-key.right) : 0,
          dividerSurface:getComputedStyle(document.getElementById('incidentRouteGrid')!).backgroundColor,
          panelSurface:getComputedStyle(panel).backgroundColor,
          mapTop:map.top,mapBottom:map.bottom,keyTop:key.top,graphKeyGap:key.top-graph.bottom};
      },progress);
      expect(Math.abs(edges.shellGap)).toBeLessThan(2);
      expect(edges.healthGap).toBeGreaterThanOrEqual(6);
      expect(edges.healthGap).toBeLessThanOrEqual(10);
      expect(edges.healthExposed).toBe(true);
      expect(Math.abs(edges.incidentBottomGap),JSON.stringify({expanding,progress,edges})).toBeLessThan(2);
      expect(Math.abs(edges.incidentKeyGap),JSON.stringify({expanding,progress,edges})).toBeLessThan(2);
      expect(Math.abs(edges.incidentMapGap),JSON.stringify({expanding,progress,edges})).toBeLessThan(2);
      expect(edges.keyMapGap,JSON.stringify({expanding,progress,edges})).toBeLessThan(2);
      expect(edges.dividerSurface).toBe(edges.panelSurface);
      expect(Math.abs(edges.controlCenterGap),JSON.stringify({expanding,progress,edges})).toBeLessThan(2);
      expect(Math.abs(edges.controlRightGap-14)).toBeLessThan(2);
      if(progress===.999)endControl=edges.controlBox;
      expect(edges.graphKeyGap,JSON.stringify({expanding,progress,edges})).toBeGreaterThanOrEqual(-1);
      expect(edges.graphKeyGap,JSON.stringify({expanding,progress,edges})).toBeLessThanOrEqual(10);
      if(progress<=.55) {
        if(expanding) {
          expect(Math.abs(edges.mapTop-initial.mapTop)).toBeLessThan(2);
          expect(Math.abs(edges.mapBottom-initial.mapBottom)).toBeLessThan(2);
        } else expect(Math.abs(edges.keyTop-initial.keyTop)).toBeLessThan(2);
      }
      if(expanding&&(progress===.25||progress===.55||progress===.75))await page.screenshot({path:testInfo.outputPath(`i25-expand-linked-${progress}-2560.png`)});
      if(!expanding&&progress===.25)await page.screenshot({path:testInfo.outputPath('i25-restore-health-2560.png')});
    }
    await page.evaluate(()=>{for(const animation of (window as any).edgeAnimations as Animation[])animation.play();});
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBe(0);
    expect(await page.locator('#recent-incidents').evaluate(element=>getComputedStyle(element).clipPath)).toBe('none');
    const restoredControl=await page.locator('#zoneMapExpand').boundingBox();
    expect(Math.abs(restoredControl!.x-endControl[0])).toBeLessThan(1);
    expect(Math.abs(restoredControl!.y-endControl[1])).toBeLessThan(1);
    expect(await page.locator('#incidentRouteGrid').evaluate(element=>getComputedStyle(element).backgroundColor))
      .not.toBe(await page.locator('#recent-incidents').evaluate(element=>getComputedStyle(element).backgroundColor));
  }
});

for(const {width,theme} of [{width:1440,theme:'light'},{width:2560,theme:'dark'}] as const)
test(`I70 incidents wrap at both edges while staying attached to the map and graph at ${width}px in ${theme}`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width,height:width===2560?1440:900});
  await page.emulateMedia({colorScheme:theme});
  await page.goto(dashboard.url+'/dashboard/?corridor=I70');
  await expect(page.locator('#corridorMap canvas')).toBeVisible();
  for(const expanding of [true,false]) {
    await page.evaluate(()=>{
      const panel=document.getElementById('comparisonPanel')!;
      scrollTo({top:panel.getBoundingClientRect().top+scrollY-document.querySelector('.site-header')!.getBoundingClientRect().height-8,behavior:'instant'});
      (window as any).lowerPanelGap=document.getElementById('system-health')!.getBoundingClientRect().top-document.getElementById('corridorMapPanel')!.getBoundingClientRect().bottom;
      document.getElementById('zoneMapExpand')!.click();
    });
    const layer=page.locator('.map-layout-ghost-layer');
    await expect(layer).toHaveCount(1);
    await page.evaluate(()=>{
      const animations=[...document.querySelectorAll('.zone-layout-moving, #zoneMapExpand')].flatMap(node=>node.getAnimations());
      for(const animation of animations){animation.pause();animation.currentTime=0;}
      (window as any).mapWrapCheck=animations;
    });
    await expect(layer).toHaveAttribute('aria-hidden','true');
    expect(await layer.evaluate(element=>(element as HTMLElement).inert)).toBe(true);
    expect(await layer.locator('[id]').count()).toBe(0);
    for(const progress of [0,.001,.1,.25,.5,.75,.9,.99,.999]) {
      const gaps=await page.evaluate(async({expanding,progress})=>{
        for(const animation of (window as any).mapWrapCheck as Animation[])animation.currentTime=progress*900;
        document.getElementById('corridorMapPanel')!.getBoundingClientRect();
        await new Promise(requestAnimationFrame);
        await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
        const graph=document.querySelector('.chart-lane[data-corridor="I70"]')!.getBoundingClientRect();
        const map=document.getElementById('corridorMapPanel')!.getBoundingClientRect();
        const ghost=document.querySelector('.map-layout-ghost')!.getBoundingClientRect();
        const incoming=(expanding?document.getElementById('recent-incidents'):document.querySelector('.route-incidents[data-corridor="I70"]'))!.getBoundingClientRect();
        const control=document.getElementById('zoneMapExpand')!.getBoundingClientRect();
        const header=document.querySelector('#corridorMapPanel > header')!.getBoundingClientRect();
        return {mapEdge:expanding?map.left-ghost.right:map.left-incoming.right,
          graphEdge:expanding?incoming.left-graph.right:ghost.left-graph.right,
          controlCenterGap:control.top+control.height/2-(header.top+header.height/2),controlRightGap:header.right-control.right,
          button:((bounds)=>[bounds.width,bounds.height])(document.getElementById('zoneMapExpand')!.getBoundingClientRect()),
          healthGap:document.getElementById('system-health')!.getBoundingClientRect().top-map.bottom-(window as any).lowerPanelGap};
      },{expanding,progress});
      expect(Math.abs(gaps.mapEdge)).toBeLessThan(2);
      expect(Math.abs(gaps.graphEdge)).toBeLessThan(2);
      expect(Math.abs(gaps.controlCenterGap),JSON.stringify({expanding,progress,gaps})).toBeLessThan(2);
      expect(Math.abs(gaps.controlRightGap-14)).toBeLessThan(2);
      for(const size of gaps.button)expect(Math.abs(size-30)).toBeLessThan(.1);
      expect(Math.abs(gaps.healthGap)).toBeLessThan(2);
      if(progress===.5)await page.screenshot({path:testInfo.outputPath(`i70-wrap-${expanding?'expand':'restore'}-midpoint.png`)});
    }
    await page.evaluate(()=>{for(const animation of (window as any).mapWrapCheck as Animation[])animation.play();});
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBe(0);
    await expect(layer).toHaveCount(0);
  }
  await page.locator('#zoneMapExpand').evaluate(element=>{(element as HTMLButtonElement).click();});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.map-layout-ghost-layer')).toHaveCount(0);
  await expect(page.locator('.zone-layout-moving')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
