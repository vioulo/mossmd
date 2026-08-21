import { test, expect } from '@playwright/test';

test.describe('@smoke Browser compatibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/harness.html');
    await page.waitForFunction(() => window.mossHarness !== undefined);
  });

  test('mounts in all browsers', async ({ page }) => {
    await page.evaluate(() => window.mossHarness!.load('# Test'));
    await expect(page.locator('.cm-moss-h1')).toBeVisible();
  });

  test('renders basic markdown', async ({ page }) => {
    await page.evaluate(() => window.mossHarness!.load('**Bold** *Italic* `Code`'));
    await page.waitForTimeout(100);
    const content = await page.locator('.cm-content').textContent();
    expect(content).toContain('Bold');
    expect(content).toContain('Italic');
    expect(content).toContain('Code');
  });

  test('search panel opens', async ({ page }) => {
    await page.evaluate(() => window.mossHarness!.openSearch('Bold'));
    await expect(page.locator('.cm-panel.cm-search')).toBeVisible();
  });
});