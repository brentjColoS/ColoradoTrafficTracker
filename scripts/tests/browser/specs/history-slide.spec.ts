import {test,expect} from '../fixtures/dashboard';

for(const width of [2560,390]) {
  test(`history timing row slides and safely reverses at ${width}px`,async({page,dashboard})=>{
    await page.setViewportSize({width,height:width===390?844:1440});
    await page.goto(dashboard.url+'/dashboard/');
    const details=page.locator('#chartHistoryDetails'),toggle=page.getByRole('button',{name:/Historical Scroll/});
    await expect(details).toBeHidden();
    await toggle.click();
    await expect(details).toHaveAttribute('aria-hidden','false');
    await expect.poll(()=>page.evaluate(()=>(window as any).eval('historyDetailsMotion!==null'))).toBe(true);
    await expect.poll(()=>page.evaluate(()=>(window as any).eval('historyDetailsMotion!==null'))).toBe(false);
    await expect(details).toBeVisible();
    await toggle.click();
    await expect(details).toHaveAttribute('aria-hidden','true');
    await expect(details).toBeHidden();
    await page.evaluate(()=>{
      const button=document.getElementById('historyScrollToggle')!;
      button.click();button.click();button.click();
    });
    await expect(details).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded','true');
    await expect.poll(()=>page.evaluate(()=>(window as any).eval('historyDetailsMotion!==null'))).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  });
}

test('history timing row skips animation with reduced motion and opens for time-shift buttons',async({page,dashboard})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(dashboard.url+'/dashboard/');
  const details=page.locator('#chartHistoryDetails');
  await page.getByRole('button',{name:/Earlier chart window/}).click();
  await expect(details).toBeVisible();
  expect(await details.evaluate(element=>element.getAnimations().length)).toBe(0);
  await page.getByRole('button',{name:'Current',exact:true}).click();
  await expect(details).toBeHidden();
  expect(await details.evaluate(element=>element.getAnimations().length)).toBe(0);
});

test('status changes during opening keep the same continuous slide instead of restarting',async({page,dashboard})=>{
  await page.goto(dashboard.url+'/dashboard/');
  await page.getByRole('button',{name:/Historical Scroll/}).click();
  const same=await page.evaluate(()=>{
    const run=(code:string)=>(window as any).eval(code);
    run('slideBefore=historyDetailsMotion');
    document.getElementById('chartHistoryHelp')!.textContent='Loading another part of this time window…';
    run('setHistoryDetailsVisible(true)');
    return run('slideBefore!==null && slideBefore===historyDetailsMotion');
  });
  expect(same).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).eval('historyDetailsMotion===null'))).toBe(true);
  await expect(page.locator('#chartHistoryDetails')).toBeVisible();
});

test('closing the history row removes its last spacing without a final graph jump',async({page,dashboard})=>{
  await page.goto(dashboard.url+'/dashboard/');
  await page.getByRole('button',{name:/Historical Scroll/}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).eval('historyDetailsMotion===null'))).toBe(true);
  const samples=await page.evaluate(()=>new Promise<number[]>(resolve=>{
    const positions:number[]=[],details=document.getElementById('chartHistoryDetails')!,chart=document.getElementById('i25Chart')!;
    const record=()=>{
      positions.push(chart.getBoundingClientRect().top);
      if(details.hidden) resolve(positions);else requestAnimationFrame(record);
    };
    document.getElementById('historyScrollToggle')!.click();requestAnimationFrame(record);
  }));
  const finalStep=Math.abs(samples.at(-1)!-samples.at(-2)!);
  expect(finalStep).toBeLessThan(1);
});
