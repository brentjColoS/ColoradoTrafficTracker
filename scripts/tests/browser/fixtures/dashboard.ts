import {test as base, expect} from '@playwright/test';
import {fork} from 'node:child_process';
import path from 'node:path';
import {localNetwork} from '../support/network';

export const OBSERVED_AT = '2026-10-14T12:00:00Z';
type Fixture = {url: string; scenario(name: string): Promise<void>};
export const test = base.extend<{dashboard: Fixture; nativeAnimationClock:boolean}>({
  nativeAnimationClock:[false,{option:true}],
  dashboard: async ({page, request, nativeAnimationClock}, use, testInfo) => {
    const child = fork(path.join(__dirname, '../support/fixture-server.cjs'), [], {
      env: {...process.env, DASHBOARD_FIXTURE_NOW: OBSERVED_AT, DASHBOARD_FIXTURE_CONFIGURED_BASEMAP: '0'},
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let logs = '';
    child.stdout?.on('data', chunk => logs += chunk.toString());
    child.stderr?.on('data', chunk => logs += chunk.toString());
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 10_000);
        child.once('message', message => {clearTimeout(timer); resolve((message as {port: number}).port);});
        child.once('exit', code => {clearTimeout(timer); reject(new Error(`Fixture exited during startup: ${code}`));});
        child.once('error', error => {clearTimeout(timer); reject(error);});
      });
      const url = `http://127.0.0.1:${port}`;
      const unexpected = await localNetwork(page, url);
      if(nativeAnimationClock)await page.addInitScript(fixed=>{
        const NativeDate=Date;
        function FixedDate(...args:any[]){
          if(!new.target)return new NativeDate(fixed).toString();
          return args.length?new (NativeDate as any)(...args):new NativeDate(fixed);
        }
        FixedDate.prototype=NativeDate.prototype;Object.setPrototypeOf(FixedDate,NativeDate);
        Object.assign(FixedDate,{now:()=>fixed});window.Date=FixedDate as unknown as DateConstructor;
      },Date.parse(OBSERVED_AT));
      else await page.clock.setFixedTime(new Date(OBSERVED_AT));
      await use({url, async scenario(name) {
        const response = await request.get(`${url}/__test/scenario`, {params: {name}});
        expect(response.ok()).toBeTruthy();
      }});
      expect(unexpected, 'Unexpected browser errors or external requests').toEqual([]);
    } finally {
      child.kill('SIGTERM');
      if (logs) await testInfo.attach('fixture-server.log', {body: logs, contentType: 'text/plain'});
    }
  },
});
export {expect};
