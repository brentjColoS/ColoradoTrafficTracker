import {test, expect} from '../fixtures/dashboard';

for (const width of [2560,390]) {
  test(`observed reductions load only on I70 zones and render at ${width}px`, async ({page,dashboard},testInfo) => {
    await page.setViewportSize({width,height:width===390?844:1440});
    const reads:string[]=[];
    page.on('request',request=>{if(request.url().includes('/variable-speed-limits/history')) reads.push(request.url());});
    await page.addInitScript(() => {
      const original=CanvasRenderingContext2D.prototype.stroke;
      (window as any).limitStrokes=[];
      CanvasRenderingContext2D.prototype.stroke=function(...args:any[]) {
        if(this.getLineDash().join(',')==='7,5') (window as any).limitStrokes.push({canvas:this.canvas.id,color:this.strokeStyle});
        return Reflect.apply(original,this,args);
      };
    });
    await page.goto(dashboard.url+'/dashboard/?corridor=I70');
    await expect(page.locator('#i70Summary')).toContainText('54');
    await expect(page.locator('#zoneLimitLegend')).toBeHidden();
    expect(reads).toEqual([]);
    await page.getByRole('button',{name:'Speed zones',exact:true}).click();
    await expect(page.locator('#zoneLimitLegend')).toHaveAttribute('data-status','ready');
    await expect(page.locator('#zoneLimitLegend')).toHaveText('Reduced Limit');
    await expect.poll(()=>page.evaluate(()=>(window as any).limitStrokes.length)).toBeGreaterThan(0);
    expect(reads.length).toBe(1);
    const result=await page.evaluate(()=>({periods:(window as any).eval('signHistory.periods'),
      strokes:(window as any).limitStrokes, overflow:document.documentElement.scrollWidth>innerWidth}));
    expect(result.periods).toHaveLength(8);
    expect(result.periods.every((period:any)=>period.end-period.start<=3600000)).toBe(true);
    expect(result.strokes.every((stroke:any)=>stroke.canvas==='i70Chart')).toBe(true);
    expect(result.overflow).toBe(false);
    await page.locator('#i70Chart').screenshot({path:testInfo.outputPath(`sign-history-${width}.png`)});
    await page.getByRole('button',{name:'Overall',exact:true}).click();
    await expect(page.locator('#zoneLimitLegend')).toBeHidden();
    expect(await page.evaluate(()=>(window as any).eval('signHistory.periods.length'))).toBe(0);
  });
}

test('history failure cannot erase zone traffic or leave a stale reduction from another window',async({page,dashboard})=>{
  await page.route('**/variable-speed-limits/history?**',route=>route.fulfill({status:503,body:'{}',contentType:'application/json'}));
  await page.goto(dashboard.url+'/dashboard/?corridor=I70');
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await expect(page.locator('#zoneLimitLegend')).toHaveAttribute('data-status','unavailable');
  await expect(page.locator('#i70Chart')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).eval('signHistory.periods.length'))).toBe(0);
});

test('historical scrolling refreshes reduction history without carrying a different window forward',async({page,dashboard})=>{
  await page.goto(dashboard.url+'/dashboard/?corridor=I70');
  await page.getByRole('button',{name:'6H',exact:true}).click();
  await page.getByRole('button',{name:'Speed zones',exact:true}).click();
  await expect(page.locator('#zoneLimitLegend')).toHaveAttribute('data-status','ready');
  const oldEnd=await page.evaluate(()=>(window as any).eval('chartEndTime(chartRouteData("I70"))'));
  await page.getByRole('button',{name:/Historical Scroll/}).click();
  await page.getByRole('button',{name:/Earlier chart window/}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).eval('chartEndTime(chartRouteData("I70"))'))).toBeLessThan(oldEnd);
  await expect(page.locator('#zoneLimitLegend')).toHaveAttribute('data-status','ready');
  expect(await page.evaluate(()=>(window as any).eval('signHistory.periods.every(period=>period.end<=chartEndTime(chartRouteData("I70")))'))).toBe(true);
});
