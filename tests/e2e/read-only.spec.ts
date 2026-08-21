import { test, expect } from '@playwright/test';

test.describe('Read-only mode', () => {
  test('disables editing when readOnly=true', async ({ page }) => {
    await page.goto('/harness.html');
    await page.waitForFunction(() => window.mossHarness !== undefined);
    await page.evaluate(() => window.mossHarness!.load('# Title\n\nContent', { readOnly: true }));
    await page.waitForTimeout(100);

    await page.locator('.cm-content').click();
    await page.keyboard.type('test');
    await page.waitForTimeout(50);

    const md = await page.evaluate(() => window.mossHarness!.getMarkdown());
    expect(md).not.toContain('test');
  });

  test('allows checkbox toggle in read-only', async ({ page }) => {
    await page.goto('/harness.html');
    await page.waitForFunction(() => window.mossHarness !== undefined);
    await page.evaluate(() => window.mossHarness!.load('- [ ] Task', { readOnly: true }));
    await page.waitForTimeout(100);

    const checkbox = page.locator('.cm-moss-checkbox');
    await checkbox.click();
    await page.waitForTimeout(50);

    const md = await page.evaluate(() => window.mossHarness!.getMarkdown());
    expect(md).toContain('[x]');
  });
});