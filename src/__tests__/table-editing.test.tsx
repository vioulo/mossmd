import { describe, expect, it } from 'vitest';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MossMD, type MossMDHandle } from '../editor';

const hosts: HTMLElement[] = [];

function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  return { host, root };
}

describe('Table cell editing batching & space preservation', () => {
  it('preserves trailing whitespace during active cell typing', () => {
    const markdown = '| Col 1 | Col 2 |\n| --- | --- |\n| A | B |';
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD markdownSource={markdown} editorHandleRef={handleRef} />,
    );

    const source = host.querySelector<HTMLElement>('tbody td .cm-moss-table-cell-source');
    expect(source).not.toBeNull();

    // User types "hello " with a trailing space
    act(() => {
      source!.focus();
      source!.textContent = 'hello ';
      source!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // The cell content and dataset.raw should preserve the trailing space during typing!
    const cell = source!.closest<HTMLElement>('td');
    expect(cell?.dataset.raw).toBe('hello ');
    expect(source!.textContent).toBe('hello ');

    // User continues typing the second word "world"
    act(() => {
      source!.textContent = 'hello world';
      source!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(cell?.dataset.raw).toBe('hello world');
    expect(handleRef.current?.getMarkdown()).toContain('| hello world | B |');

    // On blur, trailing spaces are cleaned up
    act(() => {
      source!.textContent = 'foo   ';
      source!.dispatchEvent(new Event('input', { bubbles: true }));
      source!.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    expect(cell?.dataset.raw).toBe('foo');
    expect(handleRef.current?.getMarkdown()).toContain('| foo | B |');
  });

  it('batches rapid keystroke input events into a single microtask transaction', async () => {
    const markdown = '| Col 1 | Col 2 |\n| --- | --- |\n| A | B |';
    const changeEvents: string[] = [];
    const { host } = mount(
      <MossMD
        markdownSource={markdown}
        onMarkdownChange={(doc) => changeEvents.push(doc)}
      />,
    );

    const source = host.querySelector<HTMLElement>(
      'tbody td .cm-moss-table-cell-source',
    );
    expect(source).not.toBeNull();

    // Rapidly dispatch 4 input keystrokes synchronously
    source!.focus();
    source!.textContent = 'c';
    source!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changeEvents.length).toBe(0); // Not dispatched synchronously!

    source!.textContent = 'ca';
    source!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changeEvents.length).toBe(0);

    source!.textContent = 'cat';
    source!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changeEvents.length).toBe(0);

    source!.textContent = 'cats';
    source!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changeEvents.length).toBe(0);

    // Drain microtasks
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

    // After microtask, exactly 1 batch transaction was dispatched instead of 4
    expect(changeEvents.length).toBe(1);
    expect(changeEvents[0]).toContain('| cats | B |');
  });
});
