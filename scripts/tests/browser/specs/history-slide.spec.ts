import {test,expect} from '../fixtures/dashboard';

for(const width of [2560,390]) {
  test(`history timing row slides and safely reverses at ${width}px`,async({page,dashboard})=>{
    await page.setViewportSize({width,height:width===390?844:1440});
    await page.goto(dashboard.url+'/dashboard/');
    const details=page.locator('#chartHistoryDetails'),toggle=page.getByRole('button',{name:/Historical Scroll/});
    await expect(details).toBeHidden();
    await toggle.click();
    await expect(details).toHaveAttribute('aria-hidden','false');
    await expect.poll(()=>details.evaluate(element=>element.getAnimations().length)).toBeGreaterThan(0);
    await expect.poll(()=>details.evaluate(element=>element.getAnimations().length)).toBe(0);
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
    await expect.poll(()=>details.evaluate(element=>element.getAnimations().length)).toBe(0);
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
