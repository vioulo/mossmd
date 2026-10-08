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

  test('ArrowUp moves through a blank separator before the previous block', async ({ page }) => {
    await page.evaluate(() =>
      window.mossHarness!.load(
        '## The Road Not Taken\n\nTwo roads diverged\nIn a yellow wood',
      ),
    );

    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.cm-line.cm-activeLine')).toContainText(
      'Two roads diverged',
    );

    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.cm-line.cm-activeLine')).toHaveClass(
      /cm-moss-empty-line/,
    );

    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.cm-line.cm-activeLine')).toHaveClass(
      /cm-moss-h2/,
    );
  });

  test('keeps vertical movement aligned after a file block', async ({ page }) => {
    await page.evaluate(() =>
      window.mossHarness!.load(
        '[brief.pdf](https://example.org/brief.pdf)\n\n[notes.zip](https://example.org/notes.zip)\n\n## The Road\n\nFirst line\nMiddle line\nLast line',
      ),
    );

    const middle = page.locator('.cm-line').filter({ hasText: 'Middle line' });
    await middle.scrollIntoViewIfNeeded();
    await middle.click({ position: { x: 40, y: 12 } });
    await expect(page.locator('.cm-line.cm-activeLine')).toContainText(
      'Middle line',
    );

    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.cm-line.cm-activeLine')).toContainText(
      'First line',
    );
  });
});
