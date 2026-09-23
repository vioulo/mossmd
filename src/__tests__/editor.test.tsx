import { describe, expect, it, afterEach, vi } from 'vitest';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { acceptCompletion, setSelectedCompletion } from '@codemirror/autocomplete';
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Star } from 'lucide-react';
import {
  MossMD,
  type MossMDHandle,
} from '../editor';
import { mossLucideIcon } from '../core/icons';

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

function testIcon(name: string) {
  return ({ document, size = 16 }: { document: Document; size?: number }) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-moss-test-icon', name);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    return svg;
  };
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

  it('reports IME composition start, end, and cancellation', () => {
    const onCompositionChange = vi.fn();
    const { host } = mount(
      <MossMD
        markdownSource="中文"
        onCompositionChange={onCompositionChange}
      />,
    );
    const content = host.querySelector<HTMLElement>('.cm-content');
    expect(content).not.toBeNull();

    act(() => {
      content!.dispatchEvent(new Event('compositionstart', { bubbles: true }));
      content!.dispatchEvent(new Event('compositionend', { bubbles: true }));
      content!.dispatchEvent(new Event('compositioncancel', { bubbles: true }));
    });

    expect(onCompositionChange.mock.calls).toEqual([[true], [false], [false]]);
  });

  it('uses the latest IME composition callback without rebuilding the editor', () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <MossMD
          markdownSource="中文"
          onCompositionChange={firstCallback}
        />,
      );
    });

    const editor = host.querySelector<HTMLElement>('.cm-editor');
    const content = host.querySelector<HTMLElement>('.cm-content');
    expect(editor).not.toBeNull();
    expect(content).not.toBeNull();

    act(() => {
      root.render(
        <MossMD
          markdownSource="中文"
          onCompositionChange={secondCallback}
        />,
      );
    });

    expect(host.querySelector('.cm-editor')).toBe(editor);

    act(() => {
      content!.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    });

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledWith(true);
  });

  it('marks blank source lines with the body-height empty-line class', () => {
    const { host } = mount(<MossMD markdownSource={'First\n\nSecond'} />);

    const lines = Array.from(host.querySelectorAll<HTMLElement>('.cm-line'));
    expect(lines).toHaveLength(3);
    expect(lines[1]?.classList.contains('cm-moss-empty-line')).toBe(true);
    expect(lines[0]?.classList.contains('cm-moss-empty-line')).toBe(false);
    expect(lines[2]?.classList.contains('cm-moss-empty-line')).toBe(false);
  });

  it('can render the search panel at the bottom of the editor', () => {
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD
        markdownSource="find me"
        editorHandleRef={handleRef}
        searchPanelPosition="bottom"
      />,
    );

    act(() => handleRef.current?.openSearch('find'));

    const panel = host.querySelector<HTMLElement>('.moss-search-panel');
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains('moss-search-panel-bottom')).toBe(true);
    expect(panel?.querySelector('.cm-moss-search-input-pill')).not.toBeNull();
    expect(panel?.querySelector('.cm-moss-search-actions-pill')).not.toBeNull();
    expect(panel?.querySelectorAll('.cm-moss-search-btn svg')).toHaveLength(3);
  });

  it('can render the search panel at the center of the editor', () => {
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD
        markdownSource="find me"
        editorHandleRef={handleRef}
        searchPanelPosition="center"
      />,
    );

    act(() => handleRef.current?.openSearch('find'));

    const panel = host.querySelector<HTMLElement>('.moss-search-panel');
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains('moss-search-panel-center')).toBe(true);
  });

  it('closes the search panel and returns focus to the editor on Escape', () => {
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD
        markdownSource="find me"
        editorHandleRef={handleRef}
      />,
    );

    act(() => handleRef.current?.openSearch('find'));

    const input = host.querySelector<HTMLInputElement>('.cm-moss-search-input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);

    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(host.querySelector('.moss-search-panel')).toBeNull();
    expect(host.querySelector('.cm-content')).toBe(document.activeElement);
    expect(handleRef.current?.getMarkdown()).toBe('find me');
  });

  it('renders built-in horizontal-rule variants without default glyphs', () => {
    const { host } = mount(
      <MossMD markdownSource={'***\n___\n---'} />,
    );

    const lines = Array.from(host.querySelectorAll<HTMLElement>('.cm-line'));
    expect(lines).toHaveLength(3);
    expect(lines[0]?.classList.contains('cm-moss-hr-wavy')).toBe(true);
    expect(lines[1]?.classList.contains('cm-moss-hr-glyph')).toBe(false);
    expect(lines[1]?.querySelector('.cm-moss-hr-symbol')).toBeNull();
    expect(lines[2]?.classList.contains('cm-moss-hr-wavy')).toBe(false);
    expect(lines[2]?.classList.contains('cm-moss-hr-glyph')).toBe(false);
    expect(lines[2]?.querySelector('.cm-moss-hr-symbol')).toBeNull();
  });

  it('renders glyphs from symmetric horizontal-rule syntax', () => {
    const { host } = mount(
      <MossMD markdownSource={'---⭐---\n***🌿***\n___'} />,
    );

    const lines = Array.from(host.querySelectorAll<HTMLElement>('.cm-line'));
    expect(lines).toHaveLength(3);
    expect(lines[0]?.classList.contains('cm-moss-hr')).toBe(true);
    expect(lines[0]?.classList.contains('cm-moss-hr-wavy')).toBe(false);
    expect(lines[0]?.classList.contains('cm-moss-hr-glyph')).toBe(true);
    expect(lines[0]?.querySelector('.cm-moss-hr-widget')).not.toBeNull();
    expect(lines[0]?.querySelector('.cm-moss-hr-segment-left')).not.toBeNull();
    expect(lines[0]?.querySelector('.cm-moss-hr-segment-right')).not.toBeNull();
    expect(lines[0]?.querySelector('.cm-moss-hr-symbol')?.textContent).toBe('⭐');
    expect(lines[1]?.classList.contains('cm-moss-hr-wavy')).toBe(true);
    expect(lines[1]?.classList.contains('cm-moss-hr-glyph')).toBe(true);
    expect(
      lines[1]?.querySelector('.cm-moss-hr-widget-wavy'),
    ).not.toBeNull();
    expect(lines[1]?.querySelector('.cm-moss-hr-symbol')?.textContent).toBe('🌿');
    expect(lines[2]?.classList.contains('cm-moss-hr-glyph')).toBe(false);
  });

  it('keeps active symmetric horizontal-rule source plain and editable', () => {
    const markdown = '***🌿***\n___⭐___';
    const { host } = mount(
      <MossMD markdownSource={markdown} />,
    );
    const editor = host.querySelector<HTMLElement>('.cm-editor');
    const view = editor ? EditorView.findFromDOM(editor) : null;
    expect(view).not.toBeNull();

    act(() => {
      view!.focus();
      view!.dispatch({ selection: { anchor: 0 } });
    });

    const lines = Array.from(host.querySelectorAll<HTMLElement>('.cm-line'));
    expect(lines[0]?.classList.contains('cm-moss-hr')).toBe(false);
    expect(lines[0]?.textContent).toBe('***🌿***');
    expect(lines[0]?.querySelector('.cm-moss-hr-source')).not.toBeNull();
    expect(lines[0]?.querySelector('.cm-moss-strong')).toBeNull();
    expect(lines[0]?.querySelector('.cm-moss-em')).toBeNull();

    act(() => {
      view!.dispatch({
        selection: { anchor: markdown.indexOf('___') },
      });
    });

    expect(lines[1]?.classList.contains('cm-moss-hr')).toBe(false);
    expect(lines[1]?.textContent).toBe('___⭐___');
    expect(lines[1]?.querySelector('.cm-moss-hr-source')).not.toBeNull();
    expect(lines[1]?.querySelector('.cm-moss-strong')).toBeNull();
    expect(lines[1]?.querySelector('.cm-moss-em')).toBeNull();
  });

  it('does not treat extended horizontal-rule syntax inside code as a divider', () => {
    const { host } = mount(
      <MossMD markdownSource={'```md\n---⭐---\n***🌿***\n```'} />,
    );

    expect(host.querySelector('.cm-moss-hr')).toBeNull();
    expect(host.querySelector('.cm-moss-fenced-code')).not.toBeNull();
  });

  it('renders custom task statuses as icons and toggles configured pairs', () => {
    const markdown = [
      '- [ ] To Do',
      '- [/] In Progress',
      '- [!] Important',
      '- [*] Star',
      '- [x] Done',
      '- [A] Active',
      '- [-A] Active (empty)',
      '```md',
      '- [!] Code content',
      '```',
    ].join('\n');
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD
        markdownSource={markdown}
        editorHandleRef={handleRef}
        inlinePreviewConfig={{
          taskCheckboxes: {
            '!': { icon: mossLucideIcon(Star), label: 'Priority' },
            A: { icon: mossLucideIcon(Star), label: 'Active', filled: true },
          },
        }}
      />,
    );

    const statuses = host.querySelectorAll<HTMLButtonElement>(
      '.cm-moss-task-status',
    );
    expect(statuses).toHaveLength(5);
    expect(statuses[0]?.dataset.status).toBe('/');
    expect(statuses[0]?.querySelector('svg')).not.toBeNull();
    expect(statuses[0]?.querySelector('svg')?.getAttribute('viewBox')).toBe(
      '0 0 24 24',
    );
    expect(statuses[1]?.getAttribute('aria-label')).toBe('Priority');
    expect(statuses[2]?.dataset.status).toBe('*');
    expect(statuses[2]?.querySelector('svg')?.getAttribute('fill')).toBe(
      'currentColor',
    );
    expect(statuses[3]?.dataset.status).toBe('A');
    expect(statuses[4]?.dataset.status).toBe('-A');
    expect(statuses[3]?.querySelector('svg')?.getAttribute('fill')).toBe(
      'currentColor',
    );
    expect(statuses[4]?.classList.contains('cm-moss-task-status-empty')).toBe(
      true,
    );
    expect(statuses[4]?.querySelector('svg')).toBeNull();
    expect(host.querySelectorAll('.cm-moss-link')).toHaveLength(0);
    expect(host.querySelectorAll('input.cm-moss-task-checkbox')).toHaveLength(2);

    const editor = host.querySelector<HTMLElement>('.cm-editor');
    const view = editor ? EditorView.findFromDOM(editor) : null;
    expect(view).not.toBeNull();
    act(() => {
      view!.focus();
      view!.dispatch({ selection: { anchor: markdown.indexOf('Important') } });
    });
    expect(host.querySelectorAll('.cm-moss-task-status')).toHaveLength(5);
    const importantLine = Array.from(
      host.querySelectorAll<HTMLElement>('.cm-line'),
    ).find((line) => line.textContent?.includes('Important'));
    expect(importantLine?.textContent).not.toContain('[!]');

    act(() => {
      const markerFrom = markdown.indexOf('[!]');
      view!.dispatch({ selection: { anchor: markerFrom + 3 } });
    });
    expect(host.querySelectorAll('.cm-moss-task-status')).toHaveLength(4);
    expect(host.querySelector('.cm-content')?.textContent).toContain(
      '- [!] Important',
    );

    act(() => {
      statuses[1]?.click();
    });
    expect(handleRef.current?.getMarkdown()).toContain('- [-!] Important');

    act(() => {
      Array.from(
        host.querySelectorAll<HTMLButtonElement>('.cm-moss-task-status'),
      )
        .find((button) => button.dataset.status === 'A')
        ?.click();
    });
    expect(handleRef.current?.getMarkdown()).toContain('- [-A] Active');

    act(() => {
      Array.from(
        host.querySelectorAll<HTMLButtonElement>('.cm-moss-task-status'),
      )
        .find((button) => button.dataset.status === '-A')
        ?.click();
    });
    expect(handleRef.current?.getMarkdown()).toContain('- [A] Active');
    expect(handleRef.current?.getMarkdown()).toContain('- [!] Code content');
  });

  it('reveals a task marker only when the cursor is beside its structure', () => {
    const markdown = '- [x] First task\n- [ ] Second task';
    const { host } = mount(<MossMD markdownSource={markdown} />);
    const editor = host.querySelector<HTMLElement>('.cm-editor');
    const view = editor ? EditorView.findFromDOM(editor) : null;
    expect(view).not.toBeNull();
    expect(host.querySelectorAll('input.cm-moss-task-checkbox')).toHaveLength(2);
    expect(host.querySelector('.cm-content')?.textContent).not.toContain('[x]');

    act(() => {
      view!.focus();
      view!.dispatch({ selection: { anchor: markdown.indexOf('First') } });
    });
    expect(host.querySelectorAll('input.cm-moss-task-checkbox')).toHaveLength(2);
    expect(host.querySelector('.cm-content')?.textContent).not.toContain('[x]');
    const firstTaskLine = Array.from(
      host.querySelectorAll<HTMLElement>('.cm-line'),
    ).find((line) => line.textContent?.includes('First task'));
    expect(firstTaskLine?.textContent).not.toContain('- ');

    act(() => {
      view!.dispatch({
        selection: view!.moveByChar(view!.state.selection.main, false),
      });
    });
    expect(host.querySelector('.cm-content')?.textContent).toContain(
      '- [x] First task',
    );
    expect(host.querySelectorAll('input.cm-moss-task-checkbox')).toHaveLength(1);

    act(() => {
      view!.dispatch({
        selection: view!.moveByChar(view!.state.selection.main, true),
      });
    });
    expect(host.querySelectorAll('input.cm-moss-task-checkbox')).toHaveLength(2);
    expect(host.querySelector('.cm-content')?.textContent).not.toContain('[x]');
    expect(firstTaskLine?.textContent).not.toContain('- ');
  });

  it('edits image metadata from the floating image editor', () => {
    const markdown = '![Old alt|Old caption](https://example.com/old.png)\n\nAfter.';
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD markdownSource={markdown} editorHandleRef={handleRef} />,
    );

    const edit = host.querySelector<HTMLButtonElement>('.cm-moss-image-edit');
    expect(edit).not.toBeNull();

    act(() => {
      edit?.click();
    });

    const editor = host.querySelector<HTMLFormElement>('.cm-moss-image-editor');
    expect(editor).not.toBeNull();
    expect(editor?.querySelector<HTMLInputElement>('[data-image-field="alt"]')?.value).toBe(
      'Old alt',
    );
    expect(
      editor?.querySelector<HTMLInputElement>('[data-image-field="caption"]')?.value,
    ).toBe('Old caption');
    expect(editor?.querySelector<HTMLInputElement>('[data-image-field="width"]')?.value).toBe('');

    const alt = editor?.querySelector<HTMLInputElement>('[data-image-field="alt"]');
    const caption = editor?.querySelector<HTMLInputElement>('[data-image-field="caption"]');
    const src = editor?.querySelector<HTMLInputElement>('[data-image-field="src"]');
    const save = editor?.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(alt).not.toBeNull();
    expect(caption).not.toBeNull();
    expect(src).not.toBeNull();
    expect(save).not.toBeNull();

    act(() => {
      alt!.value = 'New alt';
      caption!.value = 'MossMD';
      src!.value = 'https://example.com/new.png';
      editor!.querySelector<HTMLInputElement>('[data-image-field="width"]')!.value = '72%';
      save!.click();
    });

    expect(handleRef.current?.getMarkdown()).toBe(
      '![New alt|MossMD|width=72%](https://example.com/new.png)\n\nAfter.',
    );
    expect(host.querySelector('.cm-moss-image-editor')).toBeNull();
    expect(host.querySelector('.cm-moss-image-caption')?.textContent).toBe('MossMD');
    expect(host.querySelector('.cm-moss-image-resize')).not.toBeNull();
  });

  it('opens an image preview without changing the markdown', () => {
    const markdown = '![MossMD|Banner](https://example.com/banner.png)';
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD markdownSource={markdown} editorHandleRef={handleRef} />,
    );
    const previewButton = host.querySelector<HTMLButtonElement>('.cm-moss-image-preview');
    expect(previewButton).not.toBeNull();

    act(() => {
      previewButton?.click();
    });

    const backdrop = document.querySelector<HTMLElement>('.cm-moss-image-preview-backdrop');
    const preview = backdrop?.querySelector<HTMLImageElement>('.cm-moss-image-preview-dialog > img');
    expect(backdrop).not.toBeNull();
    expect(preview?.src).toBe('https://example.com/banner.png');
    expect(preview?.alt).toBe('MossMD');
    expect(handleRef.current?.getMarkdown()).toBe(markdown);

    act(() => {
      backdrop?.querySelector<HTMLButtonElement>('.cm-moss-image-preview-close')?.click();
    });
    expect(document.querySelector('.cm-moss-image-preview-backdrop')).toBeNull();
  });

  it('keeps a remote image block visible while the image is loading', () => {
    const { host } = mount(
      <MossMD markdownSource={'![Remote](https://example.com/remote.png)'} />,
    );
    const frame = host.querySelector<HTMLElement>('.cm-moss-image-frame');
    const placeholder = host.querySelector<HTMLElement>('.cm-moss-image-placeholder');
    const image = host.querySelector<HTMLImageElement>('.cm-moss-image img');

    expect(frame?.classList.contains('cm-moss-image-frame-placeholder')).toBe(true);
    expect(placeholder?.querySelector('svg')).not.toBeNull();

    act(() => {
      image?.dispatchEvent(new Event('load'));
    });

    expect(frame?.classList.contains('cm-moss-image-frame-placeholder')).toBe(false);
    expect(host.querySelector('.cm-moss-image-placeholder')).toBeNull();
  });

  it('persists a dragged image width as a responsive percentage', () => {
    const markdown = '![Alt|Caption](https://example.com/image.png)';
    const { host } = mount(<MossMD markdownSource={markdown} />);
    const wrap = host.querySelector<HTMLElement>('.cm-moss-image');
    const frame = host.querySelector<HTMLElement>('.cm-moss-image-frame');
    const image = host.querySelector<HTMLImageElement>('.cm-moss-image img');
    const resize = host.querySelector<HTMLButtonElement>('.cm-moss-image-resize');
    expect(wrap).not.toBeNull();
    expect(frame).not.toBeNull();
    expect(image).not.toBeNull();
    expect(resize).not.toBeNull();

    const wrapRect = vi.spyOn(wrap!, 'getBoundingClientRect').mockReturnValue({
      width: 600,
    } as DOMRect);
    const frameRect = vi.spyOn(frame!, 'getBoundingClientRect').mockReturnValue({
      width: 300,
    } as DOMRect);

    try {
      act(() => {
        resize!.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 100,
          }),
        );
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 160 }));
        window.dispatchEvent(new MouseEvent('pointerup'));
      });
    } finally {
      wrapRect.mockRestore();
      frameRect.mockRestore();
    }

    const editor = host.querySelector<HTMLElement>('.cm-editor');
    expect(editor).not.toBeNull();
    expect(EditorView.findFromDOM(editor!)?.state.doc.toString()).toBe(
      '![Alt|Caption|width=60%](https://example.com/image.png)',
    );
  });

  it('does not render image edit controls when image editing is disabled', () => {
    const { host } = mount(
      <MossMD
        markdownSource={'![Alt](https://example.com/image.png)'}
        imagesConfig={{ editable: false }}
      />,
    );

    expect(host.querySelector('.cm-moss-image')).not.toBeNull();
    expect(host.querySelector('.cm-moss-image-edit')).toBeNull();
  });

  it('selects the hidden image source when the image is clicked', () => {
    const markdown = '![Alt](https://example.com/image.png)';
    const { host } = mount(<MossMD markdownSource={markdown} />);
    const editor = host.querySelector<HTMLElement>('.cm-editor');
    const image = host.querySelector<HTMLImageElement>('.cm-moss-image img');
    expect(editor).not.toBeNull();
    expect(image).not.toBeNull();
    const view = EditorView.findFromDOM(editor!);
    expect(view).not.toBeNull();
    expect(host.querySelector('.cm-line')?.textContent).not.toContain(markdown);
    expect(
      host.querySelector('.cm-line')?.classList.contains('cm-moss-image-source-line'),
    ).toBe(true);

    act(() => {
      view!.focus();
      view!.dispatch({ selection: { anchor: 0 } });
    });
    expect(host.querySelector('.cm-line')?.textContent).not.toContain(markdown);

    act(() => {
      image?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    expect(view!.state.selection.main.from).toBe(0);
    expect(view!.state.selection.main.to).toBe(markdown.length);
    expect(host.querySelector('.cm-moss-image')?.classList.contains('cm-moss-image-selected')).toBe(
      true,
    );
    expect(host.querySelector('.moss-cm-editor')?.classList.contains('moss-cm-image-selection-active')).toBe(
      true,
    );
    expect(host.querySelector('.cm-line')?.textContent).not.toContain(markdown);
    expect(view!.state.sliceDoc(0, markdown.length)).toBe(markdown);

    act(() => {
      view!.dispatch({
        changes: { from: view!.state.selection.main.from, to: view!.state.selection.main.to },
      });
    });

    expect(view!.state.doc.toString()).toBe('');
    expect(host.querySelector('.cm-moss-image')).toBeNull();
    expect(host.querySelector('.moss-cm-editor')?.classList.contains('moss-cm-image-selection-active')).toBe(
      false,
    );
  });

  it('renders only file block actions and deletes the raw link', () => {
    const markdown = '[old-report.pdf](https://example.com/old-report.pdf)\n\nAfter.';
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD markdownSource={markdown} editorHandleRef={handleRef} />,
    );

    const sourceLine = host.querySelector<HTMLElement>('.cm-line');
    const download = host.querySelector<HTMLButtonElement>('.cm-moss-file-block-download');
    const remove = host.querySelector<HTMLButtonElement>('.cm-moss-file-block-delete');
    expect(download).not.toBeNull();
    expect(remove).not.toBeNull();
    expect(host.querySelector('.cm-moss-file-block-edit')).toBeNull();
    expect(host.querySelector('.cm-moss-file-block-editor')).toBeNull();
    expect(sourceLine?.textContent).not.toContain('old-report.pdf');

    act(() => {
      EditorView.findFromDOM(host.querySelector('.cm-editor')!)?.dispatch({
        selection: { anchor: markdown.indexOf('old-report') },
      });
    });

    expect(host.querySelector('.cm-line.cm-moss-file-block-source-line')).not.toBeNull();
    expect(host.querySelector('.cm-line')?.textContent).not.toContain('old-report.pdf');

    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    act(() => download?.click());
    expect(anchorClick).toHaveBeenCalledTimes(1);
    anchorClick.mockRestore();

    act(() => remove?.click());

    expect(handleRef.current?.getMarkdown()).toBe('After.');
    expect(host.querySelector('.cm-moss-file-block')).toBeNull();
  });

  it('renders consumer-provided icon renderers on user-facing surfaces', async () => {
    const { host } = mount(
      <MossMD
        markdownSource={[
          '![Alt](https://example.com/pending.png)',
          '',
          '[report.pdf](https://example.com/report.pdf)',
        ].join('\n')}
        imagesConfig={{
          icons: {
            placeholder: testIcon('image-placeholder'),
          },
        }}
        fileBlocksConfig={{
          icons: {
            file: testIcon('file-block-file'),
            download: testIcon('file-block-download'),
            delete: testIcon('file-block-delete'),
          },
        }}
      />,
    );

    expect(
      host.querySelector('[data-moss-test-icon="image-placeholder"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-moss-test-icon="file-block-file"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-moss-test-icon="file-block-download"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-moss-test-icon="file-block-delete"]'),
    ).not.toBeNull();

    const slash = mount(
      <MossMD
        markdownSource=""
        slashCommandsConfig={{
          commands: [
            {
              id: 'custom',
              label: 'Custom',
              icon: testIcon('slash-custom'),
              apply: () => undefined,
            },
          ],
          sideButton: true,
        }}
      />,
    );
    const view = EditorView.findFromDOM(slash.host.querySelector('.cm-editor')!);
    expect(view).not.toBeNull();
    act(() => {
      view!.focus();
      view!.dispatch({ selection: { anchor: view!.state.doc.length } });
    });
    const plus = slash.host.querySelector<HTMLButtonElement>('.cm-moss-side-plus');
    expect(plus).not.toBeNull();
    act(() =>
      plus!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(slash.host.querySelector('.cm-completionIcon-moss-custom')).not.toBeNull();
    expect(
      slash.host.querySelector('[data-moss-test-icon="slash-custom"]'),
    ).not.toBeNull();
  });

  it('merges top-level icon overrides into feature configs', () => {
    const { host } = mount(
      <MossMD
        markdownSource={[
          '![Alt](https://example.com/pending.png)',
          '',
          '[report.pdf](https://example.com/report.pdf)',
        ].join('\n')}
        icons={{
          image: {
            placeholder: testIcon('top-image-placeholder'),
          },
          file: {
            file: testIcon('top-file-block-file'),
            download: testIcon('top-file-block-download'),
            delete: testIcon('top-file-block-delete'),
          },
        }}
      />,
    );

    expect(
      host.querySelector('[data-moss-test-icon="top-image-placeholder"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-moss-test-icon="top-file-block-file"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-moss-test-icon="top-file-block-download"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-moss-test-icon="top-file-block-delete"]'),
    ).not.toBeNull();
  });

  it('lets feature-level icon overrides win over top-level icons', () => {
    const { host } = mount(
      <MossMD
        markdownSource={[
          '![Alt](https://example.com/pending.png)',
          '',
          '[report.pdf](https://example.com/report.pdf)',
        ].join('\n')}
        icons={{
          image: {
            placeholder: testIcon('top-image-placeholder'),
          },
          file: {
            file: testIcon('top-file-block-file'),
          },
        }}
        imagesConfig={{
          icons: {
            placeholder: testIcon('feature-image-placeholder'),
          },
        }}
        fileBlocksConfig={{
          icons: {
            file: testIcon('feature-file-block-file'),
          },
        }}
      />,
    );

    expect(
      host.querySelector('[data-moss-test-icon="feature-image-placeholder"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-moss-test-icon="feature-file-block-file"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-moss-test-icon="top-image-placeholder"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-moss-test-icon="top-file-block-file"]'),
    ).toBeNull();
  });

  it('opens slash commands after an indented slash and shows command icons', async () => {
    const { host } = mount(
      <MossMD
        markdownSource="  /upl"
        slashCommandsConfig={{
          commands: [
            {
              id: 'upload-file',
              label: 'Upload file',
              icon: 'file',
              apply: (editorView, from, to) =>
                editorView.dispatch({
                  changes: { from, to, insert: '# ' },
                }),
            },
          ],
        }}
        wikiLinksConfig={{
          suggest: () => Promise.resolve([]),
        }}
      />,
    );
    const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!);
    expect(view).not.toBeNull();

    act(() =>
      view!.dispatch({
        annotations: Transaction.userEvent.of('input.type'),
        selection: { anchor: 6 },
      }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(host.querySelector('.cm-tooltip-autocomplete')).not.toBeNull();
    expect(host.querySelector('.cm-completionIcon-moss-file')).not.toBeNull();
    expect(host.querySelector('.cm-completionIcon-moss-file svg')).not.toBeNull();

    act(() => {
      view!.dispatch({ effects: setSelectedCompletion(0) });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(acceptCompletion(view!)).toBe(true);
    expect(view!.state.doc.toString()).toBe('  # ');
  });

  it('renders icons in the popup opened from the side plus button', async () => {
    const { host } = mount(
      <MossMD
        markdownSource=""
        slashCommandsConfig={{
          commands: [
            {
              id: 'heading',
              label: 'Heading',
              icon: 'snippet',
              apply: () => undefined,
            },
          ],
          sideButton: true,
        }}
        wikiLinksConfig={{
          suggest: () => Promise.resolve([]),
        }}
      />,
    );
    const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!);
    expect(view).not.toBeNull();

    act(() => {
      view!.focus();
      view!.dispatch({ selection: { anchor: 0 } });
    });
    const plus = host.querySelector<HTMLButtonElement>('.cm-moss-side-plus');
    expect(plus).not.toBeNull();
    expect(plus!.closest('.cm-content')).not.toBeNull();
    act(() => plus!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(host.querySelector('.cm-tooltip-autocomplete')).not.toBeNull();
    expect(host.querySelector('.cm-completionIcon-moss-snippet')).not.toBeNull();
    expect(host.querySelector('.cm-completionIcon-moss-snippet svg')).not.toBeNull();

    act(() => plus!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    expect(view!.state.selection.main.head).toBe(0);
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

  it('keeps markdown link syntax hidden when only its line is focused', () => {
    const markdown =
      '[Render semantic vector](https://example.org/1620e) for more.';
    const { host } = mount(<MossMD markdownSource={markdown} />);
    const editor = host.querySelector<HTMLElement>('.cm-editor');
    const view = editor ? EditorView.findFromDOM(editor) : null;
    expect(view).not.toBeNull();

    act(() => {
      view!.focus();
      view!.dispatch({ selection: { anchor: markdown.indexOf('for') } });
    });

    const focusedLineLink = host.querySelector('.cm-moss-link');
    expect(focusedLineLink?.textContent).toBe('Render semantic vector');

    act(() => {
      view!.dispatch({
        selection: { anchor: markdown.indexOf('semantic') },
      });
    });

    expect(host.querySelector('.cm-moss-link')?.textContent).toContain(
      '[Render semantic vector](https://example.org/1620e)',
    );
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

  it('opens table actions from the focused cell corner button', () => {
    const markdown = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const handleRef = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount(
      <MossMD markdownSource={markdown} editorHandleRef={handleRef} />,
    );
    const cell = host.querySelector<HTMLElement>('tbody td');
    const source = cell?.querySelector<HTMLElement>('.cm-moss-table-cell-source');
    const trigger = cell?.querySelector<HTMLButtonElement>('.cm-moss-table-menu-trigger');
    expect(cell).not.toBeNull();
    expect(source).not.toBeNull();
    expect(trigger).not.toBeNull();

    act(() => source?.focus());
    expect(cell?.matches(':focus-within')).toBe(true);

    act(() => trigger?.click());
    expect(document.querySelector('.cm-moss-table-menu')).not.toBeNull();

    const insertAbove = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.cm-moss-table-menu-item'),
    ).find((button) => button.textContent === 'Insert row above');
    expect(insertAbove).not.toBeNull();
    expect(insertAbove?.querySelector('svg')).not.toBeNull();
    act(() => insertAbove?.click());

    expect(handleRef.current?.getMarkdown()).toBe(
      '| A | B |\n| --- | --- |\n|  |  |\n| 1 | 2 |',
    );
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

  it('reveals table-cell highlight delimiters when the caret enters the mark', () => {
    const { host } = mount(
      <MossMD
        markdownSource={[
          '| Plain | Highlight |',
          '| --- | --- |',
          '| text | ==glow== |',
        ].join('\n')}
      />,
    );

    const wrap = host.querySelector<HTMLElement>('.cm-moss-highlight-wrap');
    const source = wrap?.closest<HTMLElement>('.cm-moss-table-cell-source');
    const highlight = wrap?.querySelector<HTMLElement>('.cm-moss-highlight');
    const text = highlight?.firstChild;
    expect(source).not.toBeNull();
    expect(wrap).not.toBeNull();
    expect(text?.nodeType).toBe(Node.TEXT_NODE);

    act(() => {
      source!.focus();
      const range = document.createRange();
      range.setStart(text!, 1);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      source!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(wrap?.classList.contains('active')).toBe(true);
    expect(source?.textContent).toBe('==glow==');
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
