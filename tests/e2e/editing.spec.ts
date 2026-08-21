import { test, expect } from '@playwright/test';

test.describe('Editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/harness.html');
    await page.waitForFunction(() => window.mossHarness !== undefined);
    await page.evaluate(() => window.mossHarness!.load('# Title\n\nParagraph'));
    await page.waitForTimeout(100);
  });

  test('types and updates markdown', async ({ page }) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type('\n\nNew paragraph');
    await page.waitForTimeout(50);
    const md = await page.evaluate(() => window.mossHarness!.getMarkdown());
    expect(md).toContain('New paragraph');
  });

  test('undo/redo works', async ({ page }) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' test');
    await page.waitForTimeout(50);
    let md = await page.evaluate(() => window.mossHarness!.getMarkdown());
    expect(md).toContain('test');

    await page.evaluate(() => window.mossHarness!.undo());
    await page.waitForTimeout(50);
    md = await page.evaluate(() => window.mossHarness!.getMarkdown());
    expect(md).not.toContain('test');

    await page.evaluate(() => window.mossHarness!.redo());
    await page.waitForTimeout(50);
    md = await page.evaluate(() => window.mossHarness!.getMarkdown());
    expect(md).toContain('test');
  });
});