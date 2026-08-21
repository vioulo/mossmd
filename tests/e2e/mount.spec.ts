import { test, expect } from '@playwright/test';

test.describe('Editor mount', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/harness.html');
    await page.waitForFunction(() => window.mossHarness !== undefined);
  });

  test('mounts and renders markdown', async ({ page }) => {
    await page.evaluate(() => window.mossHarness!.load('# Hello\n\nWorld'));
    await expect(page.locator('.cm-moss-h1')).toContainText('Hello');
    await expect(page.locator('.cm-line')).toContainText('World');
  });

  test('exposes harness API', async ({ page }) => {
    const md = await page.evaluate(() => window.mossHarness!.getMarkdown());
    expect(md).toContain('harness ready');
  });
});