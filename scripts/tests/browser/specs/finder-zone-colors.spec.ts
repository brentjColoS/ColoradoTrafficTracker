import {test,expect} from '../fixtures/dashboard';

for(const corridor of ['I25','I70']) for(const theme of ['light','dark']) test(`${corridor} Finder points and trend lines match map zone tags in ${theme}`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width:2560,height:1440});
  await page.addInitScript(theme=>localStorage.setItem('ctt-dashboard-theme',theme),theme);
  await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  await expect(page.locator('#corridorZoneReference')).toBeVisible();
  await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
  await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
  await expect.poll(()=>page.locator('#comparisonPanel').evaluate(node=>node.getAnimations().length)).toBe(0);
  await expect.poll(()=>page.locator('#corridorMap').evaluate(node=>(node as HTMLElement).inert)).toBe(false);
  const capture=()=>page.evaluate(corridor=>{
    const canvas=document.getElementById(corridor.toLowerCase()+'Chart') as HTMLCanvasElement,ctx=canvas.getContext('2d')!;
    const strokes:{color:string;width:number}[]=[],original=ctx.stroke;
    ctx.stroke=function(...args:any[]){strokes.push({color:String(this.strokeStyle),width:this.lineWidth});return (original as any).apply(this,args);};
    try{(window as any).drawAllCharts();}finally{ctx.stroke=original;}
    const tags=[...document.querySelectorAll('#corridorZoneReference button')].filter(node=>(node as HTMLElement).style.getPropertyValue('--zone-color'));
    return {strokes,colors:tags.map(node=>(node as HTMLElement).style.getPropertyValue('--zone-color')),
      legend:getComputedStyle(document.querySelector(`[data-legend-corridor="${corridor}"] .legend-line`)!).backgroundImage};
  },corridor);
  const finder=await capture();
  expect(finder.colors.length).toBeGreaterThan(1);
  expect(finder.legend).toContain('linear-gradient');
  for(const color of finder.colors){
    expect(finder.strokes.some(stroke=>stroke.color===color&&Math.abs(stroke.width-2.2)<.001),`trend matches ${color}`).toBe(true);
    expect(finder.strokes.filter(stroke=>stroke.color===color).length,`points match ${color}`).toBeGreaterThan(3);
  }
  await page.screenshot({path:testInfo.outputPath('finder-zone-colors.png')});
  await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
  await expect(page.locator('.map-view-changing,.zone-layout-moving')).toHaveCount(0);
  const regular=await capture();
  expect(regular.legend).toBe('none');
  for(const color of finder.colors)expect(regular.strokes.some(stroke=>stroke.color===color)).toBe(false);
});
