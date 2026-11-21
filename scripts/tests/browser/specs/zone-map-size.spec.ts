import {test,expect} from '../fixtures/dashboard';

for(const corridor of ['I25','I70']) for(const width of [2560,1440]) {
  test(`${corridor} zone map fills the available desktop viewport at ${width}px`,async({page,dashboard},testInfo)=>{
    await page.setViewportSize({width,height:width===2560?1440:900});
    await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
    await page.getByRole('button',{name:'Speed zones',exact:true}).click();
    await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
    await expect(page.getByRole('button',{name:'Zone Finder',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    const panel=page.locator('#corridorMapPanel'), map=page.locator('#corridorMap'),comparison=page.locator('#comparisonPanel');
    await expect(page.locator('#corridorMap canvas')).toBeVisible();
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBe(0);
    await expect.poll(()=>comparison.evaluate(element=>element.getAnimations().length)).toBe(0);
    await expect.poll(()=>panel.evaluate(element=>element.getAnimations().length)).toBe(0);
    const before=(await panel.boundingBox())!;
    const originalHeight=(await comparison.boundingBox())!.height;
    const toggle=page.getByRole('button',{name:'Enlarge map',exact:true});
    const inspectMotion=async(expanding:boolean)=>{
      await expect.poll(()=>comparison.evaluate(element=>element.getAnimations().length)).toBeGreaterThan(0);
      await comparison.evaluate((element,corridor)=>{
        const animations=element.getAnimations();
        for(const animation of animations){animation.pause();animation.currentTime=0;}
        (window as any).zoneSizeCheck=animations;
        const canvas=element.querySelector(`.chart-lane[data-corridor="${corridor}"] canvas`)! as HTMLCanvasElement;
        (window as any).zoneChartBuffer=[canvas.width,canvas.height];
      },corridor);
      for(const progress of [0,.001,.25,.5,.75,.99]) {
        const edges=await page.evaluate(async({progress,corridor})=>{
          for(const animation of (window as any).zoneSizeCheck as Animation[])animation.currentTime=progress*Number(animation.effect!.getTiming().duration);
          document.getElementById('comparisonPanel')!.getBoundingClientRect();
          // The fixture clock's RAF is not a paint boundary; wait for actual resize delivery.
          await new Promise<void>(resolve=>{
            const observer=new ResizeObserver(()=>{observer.disconnect();resolve();});
            observer.observe(document.getElementById('corridorMap')!);
          });
          const map=document.getElementById('corridorMapPanel')!,graph=document.querySelector(`.chart-lane[data-corridor="${corridor}"]`)!;
          const box=map.getBoundingClientRect(),lane=graph.getBoundingClientRect();
          const panel=document.getElementById('comparisonPanel')!.getBoundingClientRect();
          const visibleBottom=Math.min(panel.bottom-1,innerHeight-8);
          const canvas=document.querySelector('#corridorMap canvas')! as HTMLCanvasElement;
          const pixels=canvas.getBoundingClientRect(),stage=document.getElementById('corridorMap')!.getBoundingClientRect();
          const button=document.getElementById('zoneMapExpand')!.getBoundingClientRect();
          const header=document.querySelector('#corridorMapPanel > header')!.getBoundingClientRect();
          const chart=graph.querySelector('canvas')! as HTMLCanvasElement;
          return {sideGap:box.left-lane.right,topGap:box.top-lane.top,
            chartBuffer:[chart.width,chart.height],initialChartBuffer:(window as any).zoneChartBuffer,
            visibleBottomGap:Math.min(box.bottom,visibleBottom)-Math.min(lane.bottom,visibleBottom),
            lowerGap:document.getElementById('recent-incidents')!.getBoundingClientRect().top-panel.bottom,
            button:[button.width,button.height],
            controlGap:button.top+button.height/2-(header.top+header.height/2),
            canvasGap:[pixels.width-stage.width,pixels.height-stage.height],buffer:[canvas.width,canvas.height],
            canvasBase:[canvas.clientWidth,canvas.clientHeight],stage:[stage.width,stage.height],
            previewTransform:getComputedStyle(canvas.parentElement!).transform,
            opacity:[map,graph,canvas].map(node=>getComputedStyle(node).opacity)};
        },{progress,corridor});
        expect(Math.abs(edges.sideGap),JSON.stringify({expanding,progress,edges})).toBeLessThan(2);
        expect(edges.chartBuffer,'zone chart is not reallocated on every resize frame').toEqual(edges.initialChartBuffer);
        expect(Math.abs(edges.topGap),JSON.stringify({expanding,progress,edges})).toBeLessThan(2);
        expect(Math.abs(edges.visibleBottomGap),JSON.stringify({expanding,progress,edges})).toBeLessThan(2);
        expect(edges.lowerGap).toBeGreaterThanOrEqual(6);expect(edges.lowerGap).toBeLessThanOrEqual(8);
        for(const size of edges.button)expect(Math.abs(size-30)).toBeLessThan(.1);
        expect(Math.abs(edges.controlGap)).toBeLessThan(2);
        for(const gap of edges.canvasGap)expect(Math.abs(gap),JSON.stringify({expanding,progress,edges})).toBeLessThan(2);
        expect(edges.buffer.every(size=>size>0)).toBe(true);
        expect(edges.opacity).toEqual(['1','1','1']);
        if(progress===.5)await page.screenshot({path:testInfo.outputPath(`zone-${expanding?'expand':'restore'}-midpoint.png`)});
      }
      await page.evaluate(()=>{for(const animation of (window as any).zoneSizeCheck as Animation[])animation.play();});
    };
    await expect(toggle).toHaveText('');
    await expect.poll(async()=>(await toggle.boundingBox())!.width).toBe(30);
    await expect.poll(async()=>(await toggle.boundingBox())!.height).toBe(30);
    await expect(toggle.locator('.zone-expand-icon')).toBeVisible();
    await map.evaluate(element=>{
      const canvas=element.querySelector('canvas')!;
      const sizes=new Set([`${canvas.width}x${canvas.height}`]);
      const observer=new MutationObserver(()=>sizes.add(`${canvas.width}x${canvas.height}`));
      observer.observe(canvas,{attributes:true,attributeFilter:['width','height']});
      (window as any).mapResizeCheck={sizes,observer};
    });
    await toggle.click();
    await expect(comparison).toHaveClass(/zone-map-expanded/);
    await inspectMotion(true);
    await expect(page.getByRole('button',{name:'Restore map',exact:true}).locator('.zone-restore-icon')).toBeVisible();
    await expect.poll(async()=> (await panel.boundingBox())!.width).toBeGreaterThan(before.width*1.5);
    await expect.poll(()=>comparison.evaluate(element=>element.getAnimations().length)).toBe(0);
    expect(await page.evaluate(()=>(window as any).mapResizeCheck.sizes.size)).toBeLessThanOrEqual(3);
    await expect.poll(()=>map.evaluate(element=>(element as HTMLElement).inert)).toBe(false);
    expect(await map.locator('.maplibregl-canvas-container').evaluate(element=>element.style.transform)).toBe('');
    await expect.poll(async()=>{
      const bounds=(await comparison.boundingBox())!;
      const navigation=(await page.locator('.site-header').boundingBox())!.height;
      return Math.abs(bounds.y-navigation-8);
    }).toBeLessThan(2);
    const bounds=(await comparison.boundingBox())!,navigation=(await page.locator('.site-header').boundingBox())!.height;
    expect(Math.abs(bounds.height-(page.viewportSize()!.height-navigation-16))).toBeLessThan(2);
    expect(Math.abs(bounds.y+bounds.height-page.viewportSize()!.height+8)).toBeLessThan(2);
    const expanded=(await panel.boundingBox())!,lane=(await page.locator(`.chart-lane[data-corridor="${corridor}"]`).boundingBox())!;
    expect(Math.abs(expanded.height-lane.height)).toBeLessThan(2);
    expect(expanded.x).toBeGreaterThan(lane.x);
    await expect.poll(()=>map.evaluate(element=>{
      const canvas=element.querySelector('canvas')!;return Math.abs(canvas.getBoundingClientRect().width-element.clientWidth);
    })).toBeLessThan(2);
    await page.screenshot({path:testInfo.outputPath(`viewport-zone-map-${corridor}-${width}.png`),animations:'disabled'});
    if(width===1440) {
      expect(await page.locator(`.chart-lane[data-corridor="${corridor}"]`).evaluate(element=>element.scrollHeight-element.clientHeight)).toBeLessThan(2);
      const start=await page.evaluate(()=>scrollY);
      const graph=(await page.locator(`.chart-lane[data-corridor="${corridor}"]`).boundingBox())!;
      await page.mouse.move(graph.x+graph.width/2,graph.y+graph.height/2);
      await page.mouse.wheel(0,300);
      await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(start+150);
    }
    if(corridor==='I70' && width===1440) {
      await page.setViewportSize({width:390,height:844});
      await expect(page.locator('#zoneMapExpand')).toBeHidden();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
      await page.setViewportSize({width,height:900});
    }
    await page.getByRole('button',{name:'Restore map',exact:true}).click();
    await expect(comparison).not.toHaveClass(/zone-map-expanded/);
    await inspectMotion(false);
    await expect.poll(async()=>Math.abs((await panel.boundingBox())!.width-before.width)).toBeLessThan(2);
    await expect.poll(async()=>Math.abs((await comparison.boundingBox())!.height-originalHeight)).toBeLessThan(2);
    expect(await page.evaluate(()=>{
      const check=(window as any).mapResizeCheck;check.observer.disconnect();return check.sizes.size;
    })).toBeLessThanOrEqual(5);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  });
}

test('narrow Zone Finder remains stacked without an unusable side-by-side enlargement',async({page,dashboard})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(dashboard.url+'/dashboard/?corridor=I70');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('reduced motion expands the zone panel immediately without a size animation',async({page,dashboard})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  const panel=page.locator('#comparisonPanel');
  await expect(page.locator('#corridorMap canvas')).toBeVisible();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  expect(await panel.evaluate(element=>element.getAnimations().length)).toBe(0);
  const navigation=(await page.locator('.site-header').boundingBox())!.height;
  expect(Math.abs((await panel.boundingBox())!.height-(900-navigation-16))).toBeLessThan(2);
});

test('very short desktops use a scrollable graph fallback that still hands scrolling back to the page',async({page,dashboard})=>{
  await page.setViewportSize({width:1440,height:650});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(dashboard.url+'/dashboard/?corridor=I70');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  const lane=page.locator('.chart-lane[data-corridor="I70"]');
  expect(await lane.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
  await lane.evaluate(element=>{element.scrollTop=element.scrollHeight;});
  const start=await page.evaluate(()=>scrollY),box=(await lane.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.wheel(0,300);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(start+100);
});

for(const interruption of ['view','resize','hidden','pagehide']) test(`Finder size motion releases frozen charts after ${interruption}`,async({page,dashboard})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I25');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  await expect(page.locator('.zone-layout-moving')).toHaveCount(0);
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#comparisonPanel')).toHaveClass(/zone-map-sizing/);
  await page.locator('#comparisonPanel').evaluate(node=>{
    // Pause only the owned height animation, not the browser's independent grid transition.
    for(const animation of node.getAnimations()){
      if((animation.effect as KeyframeEffect).getKeyframes().some(frame=>'height' in frame))animation.pause();
    }
  });
  if(interruption==='resize')await page.setViewportSize({width:390,height:844});
  else await page.evaluate(interruption=>{
    if(interruption==='view')(window as any).setChartView('overall');
    else if(interruption==='hidden'){
      Object.defineProperty(document,'hidden',{configurable:true,value:true});
      document.dispatchEvent(new Event('visibilitychange'));
    }else window.dispatchEvent(new PageTransitionEvent('pagehide'));
  },interruption);
  await expect(page.locator('.zone-map-sizing,.map-view-changing,.zone-layout-moving')).toHaveCount(0);
  await expect.poll(()=>page.locator('#comparisonPanel').evaluate(node=>node.getAnimations().length)).toBe(0);
  await expect.poll(()=>page.locator('#corridorMap').evaluate(node=>(node as HTMLElement).inert)).toBe(false);
  await expect(page.locator('.map-layout-ghost-layer')).toHaveCount(0);
});
