import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { MossEditor } from '../editor';
import { MARKDOWN_CONTRACTS } from './fixtures/markdown-contracts';

const hosts: HTMLElement[] = [];
const roots: Root[] = [];

function mount(markdown: string): HTMLElement {
  const host = document.createElement('div');
  host.style.width = '720px';
  host.style.height = '640px';
  document.body.appendChild(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<MossEditor markdownSource={markdown} />));
  return host;
}

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const host of hosts.splice(0)) host.remove();
});

describe('shared Markdown rendering contracts', () => {
  for (const contract of MARKDOWN_CONTRACTS) {
    it(contract.name, () => {
      const host = mount(contract.markdown);
      const visible = host.querySelector('.cm-content')?.textContent ?? '';

      for (const text of contract.containsText ?? []) {
        expect(visible).toContain(text);
      }
      for (const text of contract.notContainsText ?? []) {
        expect(visible).not.toContain(text);
      }
      for (const selector of contract.selectors ?? []) {
        const matches = host.querySelectorAll(selector.selector);
        expect(matches).toHaveLength(selector.count);
        if (selector.text !== undefined) {
          expect(matches[0]?.textContent).toBe(selector.text);
        }
      }
    });
  }
});
