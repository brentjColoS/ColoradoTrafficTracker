import {test,expect,OBSERVED_AT} from '../fixtures/dashboard';

for(const reduced of [false,true]) {
  test(`live point arrival ${reduced?'stays immediate with reduced motion':'slides and grows without changing observations'}`,async({page,dashboard})=>{
    if(reduced) await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(dashboard.url+'/dashboard/');
    await expect.poll(()=>page.evaluate(()=>(window as any).eval('!state.refreshing && state.snapshots.size===5'))).toBe(true);
    await page.locator('#i70Chart').scrollIntoViewIfNeeded();
    await expect.poll(()=>page.evaluate(()=>(window as any).eval('latestChartObservation(state.routeData.get("I70"))'))).toBeGreaterThan(0);
    await page.evaluate(()=>(window as any).eval('drawAllCharts()'));
    await page.clock.setFixedTime(new Date(Date.parse(OBSERVED_AT)+60000));
    await page.evaluate(()=>{
      const run=(code:string)=>(window as any).eval(code);
      run(`nextArrival=structuredClone(state.routeData.get('I70'));
        nextArrival.history.samples.push({polledAt:new Date().toISOString(),avgCurrentSpeed:54});
        state.routeData.set('I70',nextArrival);beforeArrival=JSON.stringify(nextArrival.history.samples);drawAllCharts();`);
    });
    const active=()=>page.evaluate(()=>(window as any).eval('liveTransition.frame("I70")?.active'));
    if(!reduced) {
      await expect.poll(active).toBe(true);
      expect(await page.evaluate(()=>(window as any).eval('liveTransition.frame("I70").incoming.scale'))).toBeLessThan(1);
    }
    await expect.poll(active).toBe(false);
    expect(await page.evaluate(()=>(window as any).eval('JSON.stringify(state.routeData.get("I70").history.samples)===beforeArrival'))).toBe(true);
  });
}
