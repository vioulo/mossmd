import { describe, expect, it } from 'vitest';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
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

describe('preview narrow invalidation on selection navigation', () => {
  it('hides previous heading mark and reveals current heading mark on cursor move', () => {
    const markdown = '# Heading 1\n\n# Heading 2\n\nParagraph with **bold**';
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD markdownSource={markdown} editorHandleRef={handleRef} />,
    );

    const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!);
    expect(view).not.toBeNull();

    // Focus editor and place cursor on line 1 (# Heading 1)
    act(() => {
      view!.focus();
      view!.dispatch({ selection: { anchor: 2 } });
    });

    const lines = host.querySelectorAll<HTMLElement>('.cm-line');
    // Line 1 is active: raw '# Heading 1' is visible
    expect(lines[0]?.textContent).toContain('# Heading 1');
    // Line 3 is inactive: '# ' is hidden, only 'Heading 2' is displayed
    expect(lines[2]?.textContent).toBe('Heading 2');

    // Move cursor to line 3 (# Heading 2)
    const line3Pos = markdown.indexOf('# Heading 2') + 4;
    act(() => {
      view!.dispatch({ selection: { anchor: line3Pos } });
    });

    // Now line 1 should have folded '# ' (displaying 'Heading 1')
    expect(lines[0]?.textContent).toBe('Heading 1');
    // And line 3 should reveal raw '# Heading 2'
    expect(lines[2]?.textContent).toContain('# Heading 2');
    // Line 5 paragraph should still have bold text
    expect(host.querySelector('.cm-moss-strong')?.textContent).toBe('bold');
  });

  it('swaps bullet widgets and raw markers when navigating list items', () => {
    const markdown = '- Item 1\n- Item 2\n- Item 3';
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD markdownSource={markdown} editorHandleRef={handleRef} />,
    );

    const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!);
    expect(view).not.toBeNull();

    // Place cursor on Item 1
    act(() => {
      view!.focus();
      view!.dispatch({ selection: { anchor: 2 } });
    });

    let lines = host.querySelectorAll<HTMLElement>('.cm-line');
    // Item 1 has raw marker '-'
    expect(lines[0]?.querySelector('.cm-moss-list-marker-active')).not.toBeNull();
    // Item 2 and 3 have bullet widget
    expect(lines[1]?.querySelector('.cm-moss-bullet')).not.toBeNull();
    expect(lines[2]?.querySelector('.cm-moss-bullet')).not.toBeNull();

    // Move cursor to Item 2
    const item2Pos = markdown.indexOf('- Item 2') + 2;
    act(() => {
      view!.dispatch({ selection: { anchor: item2Pos } });
    });

    lines = host.querySelectorAll<HTMLElement>('.cm-line');
    // Item 1 now has bullet widget
    expect(lines[0]?.querySelector('.cm-moss-bullet')).not.toBeNull();
    // Item 2 has active marker
    expect(lines[1]?.querySelector('.cm-moss-list-marker-active')).not.toBeNull();
    // Item 3 still has bullet widget
    expect(lines[2]?.querySelector('.cm-moss-bullet')).not.toBeNull();
  });

  it('reveals link destination only when cursor is inside that link', () => {
    const markdown = '[Link 1](https://a.com) and [Link 2](https://b.com)';
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD markdownSource={markdown} editorHandleRef={handleRef} />,
    );

    const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!);
    expect(view).not.toBeNull();

    // Place cursor inside Link 1
    act(() => {
      view!.focus();
      view!.dispatch({ selection: { anchor: 4 } });
    });

    const line = host.querySelector<HTMLElement>('.cm-line');
    // Link 1 destination is revealed
    expect(line?.textContent).toContain('https://a.com');
    // Link 2 destination is folded
    expect(line?.textContent).not.toContain('https://b.com');

    // Move cursor into Link 2
    const link2Pos = markdown.indexOf('Link 2') + 2;
    act(() => {
      view!.dispatch({ selection: { anchor: link2Pos } });
    });

    // Link 1 destination is now folded, Link 2 destination is revealed
    expect(line?.textContent).not.toContain('https://a.com');
    expect(line?.textContent).toContain('https://b.com');
  });

  it('reveals and restores horizontal rules and fenced code on navigation', () => {
    const markdown = '---\n\n```ts\nconst x = 1;\n```\n\nTail paragraph';
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD markdownSource={markdown} editorHandleRef={handleRef} />,
    );

    const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!);
    expect(view).not.toBeNull();

    // Place cursor on HR (line 1)
    act(() => {
      view!.focus();
      view!.dispatch({ selection: { anchor: 1 } });
    });

    let hrLine = host.querySelector<HTMLElement>('.cm-line');
    expect(hrLine?.textContent).toContain('---');
    expect(hrLine?.querySelector('.cm-moss-hr-source')).not.toBeNull();

    // Move cursor into FencedCode (line 4)
    const codePos = markdown.indexOf('const x');
    act(() => {
      view!.dispatch({ selection: { anchor: codePos } });
    });

    // HR is now rendered as widget, not source text
    expect(host.querySelector('.cm-moss-hr')).not.toBeNull();
    expect(host.querySelector('.cm-moss-hr-source')).toBeNull();

    // Fenced code start line reveals code info 'ts'
    const codeStartLine = host.querySelectorAll<HTMLElement>('.cm-line')[2];
    expect(codeStartLine?.textContent).toContain('ts');
  });
});
