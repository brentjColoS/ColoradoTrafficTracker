import {test,expect} from '../fixtures/dashboard';

for(const corridor of ['I25','I70']) for(const width of [1440,2560]) test(`${corridor} speed-zone map preserves its first frame through expansion and restore at ${width}px`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width,height:width===2560?1440:900});
  await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
  const settled=async()=>{
    await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
    await expect.poll(()=>page.locator('#comparisonPanel').evaluate(node=>node.getAnimations().length)).toBe(0);
    await expect.poll(()=>page.locator('#corridorMap').evaluate(node=>(node as HTMLElement).inert)).toBe(false);
  };
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();await settled();
  await expect(page.locator('#corridorMap canvas')).toBeVisible();
  await page.evaluate(()=>{
    const original=(window as any).resizeZoneMap;
    const rect=(node:Element)=>{const r=node.getBoundingClientRect();return [r.left,r.top,r.width,r.height];};
    (window as any).resizeZoneMap=function(...args:any[]){
      const map=document.getElementById('corridorMapPanel')!,canvas=document.querySelector('#corridorMap canvas')! as HTMLCanvasElement;
      const before=rect(map),buffer=[canvas.width,canvas.height];
      const result=original(...args);
      (window as any).sizeStart={before,after:rect(map),buffer,afterBuffer:[canvas.width,canvas.height],
        stage:rect(document.getElementById('corridorMap')!),canvas:rect(canvas)};
      return result;
    };
  });
  for(const expanding of [true,false]){
    await page.getByRole('button',{name:expanding?'Enlarge map':'Restore map',exact:true}).click();
    await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed',String(expanding));
    const start=await page.evaluate(()=>(window as any).sizeStart);
    // A map starting below the viewport retains the existing short, faded entrance.
    const entering=expanding && start.before[1]>=page.viewportSize()!.height;
    if(!entering)for(let i=0;i<4;i++)expect(Math.abs(start.before[i]-start.after[i]),JSON.stringify(start)).toBeLessThan(2);
    expect(start.afterBuffer).toEqual(start.buffer);
    for(const i of [2,3])expect(Math.abs(start.stage[i]-start.canvas[i]),'preview fills the map before the first paint').toBeLessThan(2);
    const ends=await page.evaluate(()=>{
      const motions=[...document.querySelectorAll('.zone-layout-moving')].flatMap(node=>node.getAnimations());
      (window as any).sizeMotions=motions;
      const map=document.getElementById('corridorMapPanel')!;
      const rect=()=>{const r=map.getBoundingClientRect();return [r.left,r.top,r.width,r.height];};
      for(const a of motions){a.pause();a.currentTime=0;}
      const first=rect();for(const a of motions)a.currentTime=Number(a.effect!.getTiming().duration);
      const last=rect();return {first,last};
    });
    for(const progress of [0,.1,.3,.6,.9,.999]){
      const frame=await page.evaluate(progress=>{
        for(const a of (window as any).sizeMotions as Animation[])a.currentTime=Number(a.effect!.getTiming().duration)*progress;
        const rect=(id:string)=>{const r=document.getElementById(id)!.getBoundingClientRect();return [r.left,r.top,r.width,r.height];};
        const map=document.getElementById('corridorMapPanel')!,canvas=document.querySelector('#corridorMap canvas')! as HTMLCanvasElement;
        const m=document.getElementById('corridorMap')!.getBoundingClientRect(),c=canvas.getBoundingClientRect();
        const b=document.getElementById('zoneMapExpand')!.getBoundingClientRect();
        return {map:rect('corridorMapPanel'),opacity:getComputedStyle(map).opacity,button:[b.width,b.height],
          gaps:[c.width-m.width,c.height-m.height],buffer:[canvas.width,canvas.height]};
      },progress);
      for(let i=0;i<4;i++){
        expect(frame.map[i]).toBeGreaterThanOrEqual(Math.min(ends.first[i],ends.last[i])-2);
        expect(frame.map[i]).toBeLessThanOrEqual(Math.max(ends.first[i],ends.last[i])+2);
      }
      if(!entering)expect(frame.opacity).toBe('1');
      expect(frame.buffer).toEqual(start.buffer);
      for(const value of frame.button)expect(Math.abs(value-30),JSON.stringify({expanding,progress,frame})).toBeLessThan(.1);
      for(const gap of frame.gaps)expect(Math.abs(gap)).toBeLessThan(2);
      if(progress===.3)await page.screenshot({path:testInfo.outputPath(`${expanding?'expand':'restore'}-midpoint.png`)});
    }
    await page.evaluate(()=>{for(const a of (window as any).sizeMotions as Animation[])a.finish();});await settled();
    expect(await page.locator('#zoneMapExpand').evaluate(node=>node.parentElement!.tagName)).toBe('HEADER');
  }
});

for(const width of [1440,2560]) test(`I70 Finder pushes compact incidents vertically with the map edge at ${width}px`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width,height:width===2560?1440:900});
  await page.goto(dashboard.url+'/dashboard/?corridor=I70');
  const settled=async()=>{await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);};
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();await settled();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');await settled();
  for(const enabled of [true,false]){
    await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
    await expect.poll(()=>page.locator('.zone-layout-moving').count()).toBeGreaterThan(0);
    const x=await page.evaluate(enabled=>{
      const motions=[...document.querySelectorAll('.zone-layout-moving')].flatMap(node=>node.getAnimations());
      for(const a of motions){a.pause();a.currentTime=enabled?0:Number(a.effect!.getTiming().duration);}
      (window as any).finderVerticalMotions=motions;
      return document.querySelector(enabled?'.map-layout-ghost':'#recent-incidents')!.getBoundingClientRect().left;
    },enabled);
    for(const progress of [0,.1,.3,.6,.9,.999]){
      const frame=await page.evaluate(({progress,enabled})=>{
        for(const a of (window as any).finderVerticalMotions as Animation[])a.currentTime=Number(a.effect!.getTiming().duration)*progress;
        const incident=document.querySelector(enabled?'.map-layout-ghost':'#recent-incidents')!,box=incident.getBoundingClientRect();
        const map=document.getElementById('corridorMapPanel')!.getBoundingClientRect();
        const panels=[...document.querySelectorAll('#i70Chart,#corridorMapPanel,#recent-incidents,.map-layout-ghost')].map(node=>{
          const bounds=node.getBoundingClientRect(),clipText=getComputedStyle(node).clipPath;
          const clip=(clipText.match(/[-+\d.e]+px/gi)||[]).map(parseFloat);
          return {id:node.id||'ghost',top:bounds.top,bottom:bounds.bottom-(clip.length>2?clip[2]:clip[0]||0),clipText};
        });
        const lower=Math.max(...panels.map(panel=>panel.bottom));
        return {x:box.left,join:box.top-map.bottom,stretch:Math.abs(box.width-(incident as HTMLElement).offsetWidth),
          healthGap:document.getElementById('system-health')!.getBoundingClientRect().top-lower,panels};
      },{progress,enabled});
      expect(Math.abs(frame.x-x),'compact reports move vertically, not sideways').toBeLessThan(1);
      expect(Math.abs(frame.join),'compact reports follow the map lower edge').toBeLessThan(2);
      expect(frame.stretch).toBeLessThan(1);
      expect(frame.healthGap,JSON.stringify({enabled,progress,frame})).toBeGreaterThanOrEqual(5);
      expect(frame.healthGap,JSON.stringify({enabled,progress,frame})).toBeLessThanOrEqual(10);
      if(progress===.3)await page.screenshot({path:testInfo.outputPath(`finder-${enabled?'enter':'exit'}-midpoint.png`)});
      if(progress===.999)await testInfo.attach(`finder-${enabled?'enter':'exit'}-last-frame.json`,{body:JSON.stringify(frame),contentType:'application/json'});
    }
    await page.evaluate(()=>{for(const a of (window as any).finderVerticalMotions as Animation[])a.finish();});await settled();
    await expect(page.locator('.map-layout-ghost-layer')).toHaveCount(0);
  }
});
