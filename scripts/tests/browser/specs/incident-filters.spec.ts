import {test,expect} from '../fixtures/dashboard';

for(const width of [2560,390]) test(`incident type buttons filter both lists and toggle back at ${width}px`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width,height:width===2560?1440:844});
  await page.goto(dashboard.url+'/dashboard/');
  const group=page.getByRole('group',{name:'Filter incidents by type'});
  const crash=group.getByRole('button',{name:'Crash',exact:true});
  const construction=group.getByRole('button',{name:'Construction',exact:true});
  await expect(page.locator('#i25IncidentRows tr')).toHaveCount(3);
  await crash.click();
  await expect(crash).toHaveAttribute('aria-pressed','true');
  for(const corridor of ['i25','i70']) {
    const names=page.locator(`#${corridor}IncidentRows .incident-name`);
    await expect(names.first()).toBeVisible();
    for(const name of await names.allTextContents()) expect(name).toMatch(/crash/i);
  }
  await construction.click();
  await expect(construction).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>construction.evaluate(element=>getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 1)');
  expect(await construction.evaluate(element=>getComputedStyle(element).boxShadow)).toContain('inset');
  await page.locator('#recent-incidents').screenshot({path:testInfo.outputPath(`incident-filters-${width}.png`),animations:'disabled'});
  await crash.click();await construction.focus();await page.keyboard.press('Space');
  await expect(construction).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#i25IncidentRows tr')).toHaveCount(3);
  await group.getByRole('button',{name:'Snow',exact:true}).click();
  await expect(page.locator('#i25IncidentRows')).toContainText('No incidents match the selected types.');
  await expect(page.locator('#i70IncidentRows')).toContainText('No incidents match the selected types.');
  await group.getByRole('button',{name:'Snow',exact:true}).click();
  await expect(page.locator('#i70IncidentRows tr')).toHaveCount(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
