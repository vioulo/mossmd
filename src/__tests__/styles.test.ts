import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contentStyles = readFileSync(
  resolve(process.cwd(), 'src/styles/content.css'),
  'utf8',
);

describe('content styles', () => {
  it('themes ordered-list markers with the shared list token', () => {
    expect(contentStyles).toContain('.moss-markdown ol > li::marker');
    expect(contentStyles).toContain(
      'color: var(--moss-list-marker, var(--moss-list-ordered, var(--moss-accent-bright, #a78bfa)));',
    );
  });

  it('gives editor ordered markers enough specificity to beat syntax tinting', () => {
    const editorStyles = readFileSync(
      resolve(process.cwd(), 'src/styles/inline-preview.css'),
      'utf8',
    );

    expect(editorStyles).toContain(
      '.cm-line .cm-moss-ordered-marker,\n.cm-line .cm-moss-ordered-marker *',
    );
  });

  it('keeps list content on the normal foreground color', () => {
    const themeSource = readFileSync(
      resolve(process.cwd(), 'src/theme/index.ts'),
      'utf8',
    );

    expect(themeSource).toContain(
      "{ tag: t.list, color: 'var(--moss-fg, #dcddde)' }",
    );
  });
});
