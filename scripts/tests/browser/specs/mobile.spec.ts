import {test, expect} from '../fixtures/dashboard';
import type {Page} from '@playwright/test';

async function swipe(page: Page, from: {x:number;y:number}, to: {x:number;y:number}) {
  const input = await page.context().newCDPSession(page);
  try {
    await input.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{...from,id:1}]});
    for (let step=1;step<=8;step++) {
      await input.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{
        x:from.x+(to.x-from.x)*step/8,y:from.y+(to.y-from.y)*step/8,id:1
      }]});
      await page.waitForTimeout(16);
    }
    await input.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  } finally { await input.detach(); }
}

for (const [corridor, direction] of [['I25','north–south'],['I70','east–west']]) {
  test(`mobile ${corridor} touch drag navigates history only when enabled`, async ({page,dashboard}) => {
    await page.goto(dashboard.url+'/dashboard/');
    await page.getByRole('button',{name:`${corridor.replace('I','I-')}, ${direction} corridor`,exact:true}).click();
    const graph=page.locator(corridor === 'I25' ? '#i25Chart' : '#i70Chart');
    const window=page.locator('#chartHistoryWindow');
    const current=await window.textContent();
    const drag=async (reverse=false) => {
      await graph.scrollIntoViewIfNeeded();
      const box=(await graph.boundingBox())!;
      const y=box.y+box.height/2;
      const from={x:box.x+box.width*(reverse ? 0.75 : 0.25),y};
      const to={x:box.x+box.width*(reverse ? 0.25 : 0.75),y};
      await swipe(page,from,to);
    };
    await drag();
    await expect(window).toHaveText(current!);
    await page.getByRole('button',{name:/Historical Scroll/}).click();
    await expect(page.getByRole('button',{name:/Earlier chart window/})).toBeEnabled();
    await drag();
    await expect(window).not.toHaveText(current!);
    await expect(page.getByRole('button',{name:'Current',exact:true})).toBeEnabled();
    await drag(true);
    await expect(window).toHaveText(current!);
  });
}

test('mobile vertical swipes still scroll the page with historical navigation enabled', async ({page,dashboard}) => {
  await page.goto(dashboard.url+'/dashboard/');
  await page.getByRole('button',{name:/Historical Scroll/}).click();
  const graph=page.locator('#i25Chart');
  await graph.scrollIntoViewIfNeeded();
  const box=(await graph.boundingBox())!;
  const current=await page.locator('#chartHistoryWindow').textContent();
  const scroll=await page.evaluate(() => window.scrollY);
  const x=box.x+box.width/2, y=box.y+box.height*0.75;
  await swipe(page,{x,y},{x,y:y-100});
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scroll+20);
  await expect(page.locator('#chartHistoryWindow')).toHaveText(current!);
});

test('mobile controls stay within the viewport and select corridors', async ({page, dashboard}) => {
  await page.goto(dashboard.url + '/dashboard/');
  const corridor = page.getByRole('button', {name: 'I-70, east–west corridor', exact: true});
  await corridor.click();
  await expect(corridor).toHaveAttribute('aria-pressed', 'true');
  const box = await page.getByRole('group', {name: 'Chart time range'}).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
