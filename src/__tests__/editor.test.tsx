import { describe, expect, it, afterEach, vi } from 'vitest';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import {
  MossMD,
  type MossMDHandle,
} from '../editor';

const hosts: HTMLElement[] = [];

function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  host.style.width = '600px';
  host.style.height = '400px';
  document.body.appendChild(host);
  hosts.push(host);
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  return { host, root };
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

describe('MossMD', () => {
  it('mounts and exposes the initial markdown via the imperative handle', () => {
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };

    mount(
      <MossMD
        markdownSource={'# Hello\n\nWorld.'}
        editorHandleRef={handleRef}
      />,
    );

    expect(handleRef.current).not.toBeNull();
    expect(handleRef.current?.getMarkdown()).toBe('# Hello\n\nWorld.');
  });

  it('renders `.cm-content` with the raw markdown visible in the DOM', () => {
    const { host } = mount(
      <MossMD markdownSource={'**bold** and *em*'} />,
    );
    const content = host.querySelector('.cm-content');
    expect(content).not.toBeNull();
    // Raw delimiters stay in the doc even though inline-preview may
    // hide them from view on inactive lines — they remain in the
    // `state.doc` and therefore the underlying DOM text.
    expect(content?.textContent).toContain('bold');
    expect(content?.textContent).toContain('em');
  });

  it('applies list indent only to marker lines and indented continuations', () => {
    const markdown = [
      '- [ ] Move `a/b.ts` to `a/c/b.ts` (no',
      'type changes).',
      '  - [ ] Extract the cli socket (hello/msg/ack',
      '    frames).',
    ].join('\n');
    const { host } = mount(
      <MossMD markdownSource={markdown} />,
    );
    const lines = Array.from(host.querySelectorAll<HTMLElement>('.cm-line'));
    const lineWith = (text: string) =>
      lines.find((line) => line.textContent?.includes(text));

    expect(lineWith('Move')?.style.paddingLeft).toBe('2em');
    expect(lineWith('type changes')?.style.paddingLeft).toBe('');
    expect(lineWith('type changes')?.style.textIndent).toBe('');
    expect(lineWith('Extract')?.style.paddingLeft).toBe('3em');
    expect(lineWith('frames')?.style.paddingLeft).toBe('3em');
    expect(lineWith('frames')?.style.textIndent).toBe('0em');
  });

  it('derives list depth from syntax ancestry and hides structural indentation', () => {
    const markdown = [
      '   - top-level with three leading spaces',
      '     continuation',
      '     1. ordered child',
      '        ordered continuation',
    ].join('\n');
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD
        markdownSource={markdown}
        editorHandleRef={handleRef}
      />,
    );
    const lines = Array.from(host.querySelectorAll<HTMLElement>('.cm-line'));
    const lineWith = (text: string) =>
      lines.find((line) => line.textContent?.includes(text));

    expect(lineWith('top-level')?.style.paddingLeft).toBe('2em');
    expect(lineWith('continuation')?.textContent).not.toMatch(/^\s/);
    expect(lineWith('top-level')?.textContent).not.toMatch(/^\s/);
    expect(lineWith('ordered child')?.style.paddingLeft).toBe('3em');
    expect(lineWith('ordered continuation')?.style.paddingLeft).toBe('3em');
    expect(lineWith('ordered child')?.textContent).not.toMatch(/^\s/);
    expect(lineWith('ordered continuation')?.textContent).not.toMatch(/^\s/);
    expect(handleRef.current?.getMarkdown()).toBe(markdown);
  });

  it('keeps bare URLs visible on inactive lines', () => {
    const { host } = mount(
      <MossMD markdownSource={'- https://example.com'} />,
    );

    const content = host.querySelector('.cm-content');
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain('https://example.com');
  });

  it.each([
    ['same-text markdown link', '[https://example.com](https://example.com)'],
    ['angle autolink', '<https://example.com>'],
    ['escaped URL slashes', String.raw`https:\/\/example.com`],
  ])('renders %s as clean visible URL text', (_name, markdown) => {
    const { host } = mount(
      <MossMD markdownSource={markdown} />,
    );

    expect(host.querySelector('.cm-content')?.textContent).toBe(
      'https://example.com',
    );
  });

  it.each([
    ['https://example.com', 'https://example.com'],
    [
      '[https://label.example](https://destination.example)',
      'https://destination.example',
    ],
  ])('opens the correct URL for %s', (markdown, expectedUrl) => {
    const onLinkClick = vi.fn();
    const { host } = mount(
      <MossMD
        markdownSource={markdown}
        onLinkClick={onLinkClick}
      />,
    );
    const link = host.querySelector<HTMLElement>('.cm-moss-link');
    expect(link).not.toBeNull();

    vi.spyOn(link!, 'getClientRects').mockReturnValue([
      {
        left: 0,
        right: 100,
        top: 0,
        bottom: 20,
      } as DOMRect,
    ] as unknown as DOMRectList);
    const computedStyle = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ fontSize: '16px' } as CSSStyleDeclaration);
    try {
      act(() => {
        link?.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 95,
            clientY: 10,
          }),
        );
      });
    } finally {
      computedStyle.mockRestore();
    }

    expect(onLinkClick).toHaveBeenCalledWith(expectedUrl);
  });

  it('renders highlight syntax with the expected preview class', () => {
    const { host } = mount(
      <MossMD markdownSource={'This has ==highlighted text== in it.'} />,
    );

    const highlight = host.querySelector('.cm-moss-highlight');
    expect(highlight).not.toBeNull();
    expect(highlight?.textContent).toContain('highlighted text');
  });

  it('does not partially highlight a triple-equals span', () => {
    const { host } = mount(
      <MossMD markdownSource={'This is ===not highlighted===.'} />,
    );

    expect(host.querySelector('.cm-moss-highlight')).toBeNull();
  });

  it('renders highlight syntax inside table cells', () => {
    const { host } = mount(
      <MossMD
        markdownSource={[
          '| Plain | Highlight |',
          '| --- | --- |',
          '| text | ==glow== |',
        ].join('\n')}
      />,
    );

    const highlight = host.querySelector(
      '.cm-moss-table-cell-source .cm-moss-highlight',
    );
    expect(highlight).not.toBeNull();
    expect(highlight?.textContent).toContain('glow');
  });

  it('renders a code copy button that copies the fenced body only', async () => {
    const markdown = ['```ts', 'const answer = 42;', 'console.log(answer);', '```'].join('\n');
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      const { host } = mount(<MossMD markdownSource={markdown} />);
      const button = host.querySelector<HTMLButtonElement>('.cm-moss-code-copy');
      expect(button).not.toBeNull();

      await act(async () => {
        button?.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
        );
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith(
        'const answer = 42;\nconsole.log(answer);',
      );
      expect(button?.classList.contains('is-copied')).toBe(true);
      expect(button?.getAttribute('aria-label')).toBe('Copied');

      act(() => {
        vi.advanceTimersByTime(1200);
      });

      expect(button?.classList.contains('is-copied')).toBe(false);
      expect(button?.getAttribute('aria-label')).toBe('Copy code');
    } finally {
      vi.useRealTimers();
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    }
  });

  it('paints selected fenced code above the block backdrop', () => {
    const markdown = ['```ts', 'const selected = true;', '```'].join('\n');
    const { host } = mount(
      <MossMD markdownSource={markdown} />,
    );
    const editor = host.querySelector<HTMLElement>('.cm-editor');
    expect(editor).not.toBeNull();
    const view = EditorView.findFromDOM(editor!);
    expect(view).not.toBeNull();
    const from = markdown.indexOf('selected');

    act(() => {
      view?.dispatch({ selection: { anchor: from, head: from + 'selected'.length } });
    });

    const selection = host.querySelector('.cm-moss-fenced-selection');
    expect(selection).not.toBeNull();
    expect(selection?.textContent).toBe('selected');
  });
});
