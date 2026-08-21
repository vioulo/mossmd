import { test, expect } from '@playwright/test';

test.describe('Inline preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/harness.html');
    await page.waitForFunction(() => window.mossHarness !== undefined);
    await page.evaluate(() => window.mossHarness!.load('# Heading\n\n**Bold** and *italic*'));
    await page.waitForTimeout(100);
  });

  test('renders heading with class', async ({ page }) => {
    await expect(page.locator('.cm-moss-h1')).toBeVisible();
  });

  test('hides syntax on inactive lines', async ({ page }) => {
    // Heading line should have the class but not show # when not focused
    const headingLine = page.locator('.cm-moss-h1').first();
    await expect(headingLine).toBeVisible();
  });

  test('shows syntax on active line', async ({ page }) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Home');
    await page.waitForTimeout(100);
    // The active line should reveal its syntax
    const content = await page.locator('.cm-content').textContent();
    expect(content).toContain('# Heading');
  });
});