import {test,expect} from '../fixtures/dashboard';

test('either incident link expands and collapses both overview panels',async({page,dashboard})=>{
  await page.goto(dashboard.url+'/dashboard/');
  const links=page.locator('[data-incident-toggle]');
  await expect(page.locator('#i25IncidentRows tr')).toHaveCount(3);
  await expect(page.locator('#i70IncidentRows tr')).toHaveCount(3);
  await links.first().click();
  await expect(links).toHaveText(['Show fewer ↑','Show fewer ↑']);
  await expect(page.locator('#i25IncidentRows tr')).toHaveCount(8);
  await expect(page.locator('#i70IncidentRows tr')).toHaveCount(8);
  await links.last().click();
  await expect(page.locator('#i25IncidentRows tr')).toHaveCount(3);
  await expect(page.locator('#i70IncidentRows tr')).toHaveCount(3);
  await expect(links.first()).toHaveAttribute('aria-expanded','false');
  await expect(links.last()).toHaveAttribute('aria-expanded','false');
});
