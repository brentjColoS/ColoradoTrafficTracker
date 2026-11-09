import AxeBuilder from '@axe-core/playwright';
import {test, expect} from '../fixtures/dashboard';

for (const mode of ['light', 'dark']) {
  test(`${mode} dashboard has no automatically detectable WCAG A/AA issues`, async ({page, dashboard}) => {
    await page.emulateMedia({colorScheme: mode as 'light' | 'dark', reducedMotion: 'reduce'});
    await page.goto(dashboard.url + '/dashboard/');
    await expect(page.locator('#i25Summary')).toContainText('61');
    const result = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
  });
}

test('theme toggle is keyboard operable and announces its pressed state', async ({page, dashboard}) => {
  await page.goto(dashboard.url + '/dashboard/');
  const toggle = page.getByRole('button', {name: /Switch to .* mode/});
  await toggle.focus();
  await expect(toggle).toBeFocused();
  const before = await toggle.getAttribute('aria-pressed');
  await page.keyboard.press('Enter');
  await expect(toggle).not.toHaveAttribute('aria-pressed', before!);
});
