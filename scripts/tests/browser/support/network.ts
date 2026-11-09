import {Page} from '@playwright/test';

export async function localNetwork(page: Page, origin: string): Promise<string[]> {
  const unexpected: string[] = [];
  page.on('pageerror', error => unexpected.push(error.message));
  await page.route('**/*', async route => {
    const target = new URL(route.request().url());
    if (target.origin === origin || ['data:', 'blob:'].includes(target.protocol)) return route.continue();
    if (target.hostname === 'fonts.googleapis.com') return route.fulfill({contentType: 'text/css', body: ''});
    if (target.hostname === 'basemap.nationalmap.gov' && target.pathname.includes('/tile/')) {
      return route.fulfill({contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')});
    }
    unexpected.push(`Unexpected external request: ${target.origin}${target.pathname}`);
    return route.abort();
  });
  return unexpected;
}
