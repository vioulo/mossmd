import { test, expect } from '@playwright/test';

test.describe('Mobile touch & viewport', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/harness.html');
    await page.waitForFunction(() => window.mossHarness !== undefined);
  });

  test('renders markdown properly on mobile devices', async ({ page }) => {
    await page.evaluate(() => window.mossHarness!.load('# Mobile Document\n\n[Visit OpenAI](https://example.com)'));
    await expect(page.locator('.cm-moss-h1')).toContainText('Mobile Document');
    await expect(page.locator('.cm-moss-link')).toContainText('Visit OpenAI');
  });

  test('does not block native touch interaction on the scroller', async ({ page }) => {
    await page.evaluate(() => {
      const lines = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join('\n\n');
      window.mossHarness!.load(lines);
    });

    const scroller = page.locator('.cm-scroller');
    await expect(scroller).toBeVisible();

    // Verify scroller is scrollable
    const scrollHeight = await scroller.evaluate((el) => el.scrollHeight);
    const clientHeight = await scroller.evaluate((el) => el.clientHeight);
    expect(scrollHeight).toBeGreaterThan(clientHeight);
  });
});

