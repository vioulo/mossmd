import { describe, expect, it, afterEach, vi } from 'vitest';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  MossEditor,
  type MossEditorHandle,
  type MossEditorProps,
} from '../editor';

const hosts: { host: HTMLElement; root: Root }[] = [];

function mount(props: MossEditorProps) {
  const host = document.createElement('div');
  host.style.width = '600px';
  host.style.height = '400px';
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<MossEditor {...props} />);
  });
  hosts.push({ host, root });
  const rerender = (next: MossEditorProps) => {
    act(() => {
      root.render(<MossEditor {...next} />);
    });
  };
  return { host, rerender };
}

afterEach(() => {
  for (const { host, root } of hosts.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  document.querySelectorAll('.cm-moss-table-menu').forEach((menu) => menu.remove());
  vi.restoreAllMocks();
});

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |';

function contentEditableValue(element: HTMLElement | null): string | null {
  return element?.getAttribute('contenteditable') ?? null;
}

describe('read-only mode', () => {
  it('renders table cells non-editable when read-only', () => {
    const { host } = mount({ markdownSource: TABLE, readOnly: true });
    const sources = host.querySelectorAll<HTMLElement>(
      '.cm-moss-table-cell-source',
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(contentEditableValue(source)).toBe('false');
    }
  });

  it('keeps table cells editable in the default (editable) mode', () => {
    const { host } = mount({ markdownSource: TABLE });
    const source = host.querySelector<HTMLElement>(
      '.cm-moss-table-cell-source',
    );
    expect(source).not.toBeNull();
    expect(contentEditableValue(source)).toBe('true');
  });

  it('toggles table cell editability in place when the prop flips', () => {
    const { host, rerender } = mount({ markdownSource: TABLE, readOnly: false });
    expect(
      contentEditableValue(
        host.querySelector<HTMLElement>('.cm-moss-table-cell-source'),
      ),
    ).toBe('true');

    rerender({ markdownSource: TABLE, readOnly: true });
    const cells = host.querySelectorAll<HTMLElement>(
      '.cm-moss-table-cell-source',
    );
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(contentEditableValue(cell)).toBe('false');

    // ...and back.
    rerender({ markdownSource: TABLE, readOnly: false });
    expect(
      contentEditableValue(
        host.querySelector<HTMLElement>('.cm-moss-table-cell-source'),
      ),
    ).toBe('true');
  });

  it('toggles read-only through the imperative handle', () => {
    const handleRef = createRef<MossEditorHandle | null>() as {
      current: MossEditorHandle | null;
    };
    const { host } = mount({ markdownSource: TABLE, editorHandleRef: handleRef });
    const content = host.querySelector<HTMLElement>('.cm-content');
    expect(contentEditableValue(content)).toBe('true');
    expect(
      contentEditableValue(
        host.querySelector<HTMLElement>('.cm-moss-table-cell-source'),
      ),
    ).toBe('true');

    act(() => handleRef.current?.setReadOnly(true));
    expect(contentEditableValue(content)).toBe('false');
    expect(host.querySelector('.cm-editor')?.classList).toContain(
      'cm-moss-readonly',
    );
    for (const cell of host.querySelectorAll<HTMLElement>(
      '.cm-moss-table-cell-source',
    )) {
      expect(contentEditableValue(cell)).toBe('false');
    }

    act(() => handleRef.current?.setReadOnly(false));
    expect(contentEditableValue(content)).toBe('true');
    expect(host.querySelector('.cm-editor')?.classList).not.toContain(
      'cm-moss-readonly',
    );
  });

  it('preserves an open search panel while toggling read-only', () => {
    const handleRef = createRef<MossEditorHandle | null>() as {
      current: MossEditorHandle | null;
    };
    mount({ markdownSource: 'find the needle', editorHandleRef: handleRef });

    act(() => handleRef.current?.openSearch('needle'));
    expect(handleRef.current?.isSearchOpen()).toBe(true);

    act(() => handleRef.current?.setReadOnly(true));
    expect(handleRef.current?.isSearchOpen()).toBe(true);
  });

  it('opens a link when its text (not just the icon) is clicked in read-only', () => {
    const onLinkClick = vi.fn();
    const { host } = mount({
      markdownSource: 'See [the docs](https://example.com/docs).',
      readOnly: true,
      onLinkClick,
    });

    const link = host.querySelector<HTMLElement>('.cm-moss-link');
    expect(link).not.toBeNull();
    act(() => {
      link?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(onLinkClick).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('uses window.open when no link callback is supplied', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { host } = mount({
      markdownSource: 'See [the docs](https://example.com/docs).',
      readOnly: true,
    });

    act(() => {
      host.querySelector<HTMLElement>('.cm-moss-link')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    expect(open).toHaveBeenCalledWith(
      'https://example.com/docs',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('opens a table-cell link from its text (not just the icon) in read-only', () => {
    const onLinkClick = vi.fn();
    const { host } = mount({
      markdownSource:
        '| Site | Note |\n| --- | --- |\n| [docs](https://example.com/docs) | ok |',
      readOnly: true,
      onLinkClick,
    });

    const wrap = host.querySelector<HTMLElement>('.cm-moss-link-wrap');
    expect(wrap).not.toBeNull();
    expect(wrap?.dataset.url).toBe('https://example.com/docs');
    // Click the link text, not the trailing icon.
    const textTarget =
      wrap?.querySelector<HTMLElement>(':not(.cm-moss-link-icon)') ?? wrap;
    act(() => {
      textTarget?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(onLinkClick).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('keeps task checkboxes toggleable in read-only', () => {
    const onMarkdownChange = vi.fn();
    const { host } = mount({
      markdownSource: '- [ ] buy milk',
      readOnly: true,
      onMarkdownChange,
    });

    const checkbox = host.querySelector<HTMLInputElement>(
      'input.cm-moss-task-checkbox',
    );
    expect(checkbox).not.toBeNull();
    act(() => {
      checkbox?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(onMarkdownChange).toHaveBeenCalledWith('- [x] buy milk');
  });

  it('blocks a stale table menu action after switching to read-only', () => {
    const onMarkdownChange = vi.fn();
    const handleRef = createRef<MossEditorHandle | null>() as {
      current: MossEditorHandle | null;
    };
    const { host, rerender } = mount({
      markdownSource: TABLE,
      onMarkdownChange,
      editorHandleRef: handleRef,
    });

    act(() => {
      host.querySelector<HTMLElement>('tbody td')?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    const menuAction = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.cm-moss-table-menu-item'),
    ).find((button) => button.textContent === 'Insert row above');
    expect(menuAction).toBeDefined();

    rerender({
      markdownSource: TABLE,
      readOnly: true,
      onMarkdownChange,
      editorHandleRef: handleRef,
    });
    act(() => menuAction?.click());

    expect(handleRef.current?.getMarkdown()).toBe(TABLE);
    expect(onMarkdownChange).not.toHaveBeenCalled();
  });
});
