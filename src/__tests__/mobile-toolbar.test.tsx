import { describe, expect, it, afterEach } from 'vitest';
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

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

describe('Mobile Action Bar & Slider', () => {
  it('renders paragraph mode toolbar when editor has focus', () => {
    const handleRef = createRef<MossMDHandle>();
    const { host } = mount(
      <MossMD
        markdownSource="Hello world"
        editorHandleRef={handleRef}
      />,
    );

    act(() => {
      const editor = host.querySelector<HTMLElement>('.cm-editor');
      const view = editor ? EditorView.findFromDOM(editor) : null;
      view?.focus();
      view?.dispatch({ selection: { anchor: 0 } });
    });

    const toolbar = host.querySelector<HTMLElement>('.cm-moss-mobile-bar');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.dataset.mode).toBe('paragraph');

    const buttons = toolbar?.querySelectorAll<HTMLButtonElement>('.cm-moss-mobile-btn');
    const labels = Array.from(buttons ?? []).map((b) => b.textContent?.trim());
    expect(labels).toContain('Block');
    expect(labels).toContain('Undo');
    expect(labels).toContain('Redo');
    expect(labels).toContain('Done');
  });

  it('switches to image toolbar and toggles horizontal slider on image selection', () => {
    const handleRef = createRef<MossMDHandle>();
    let currentDoc = '![diagram](https://example.com/flow.png)';

    const { host } = mount(
      <MossMD
        markdownSource={currentDoc}
        editorHandleRef={handleRef}
        onMarkdownChange={(doc) => {
          currentDoc = doc;
        }}
      />,
    );

    act(() => {
      handleRef.current?.focus();
    });

    const imageWidget = host.querySelector<HTMLElement>('.cm-moss-image');
    expect(imageWidget).not.toBeNull();

    // Simulate selecting the image
    act(() => {
      imageWidget?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });

    const toolbar = host.querySelector<HTMLElement>('.cm-moss-mobile-bar');
    expect(toolbar?.dataset.mode).toBe('image');

    const labels = Array.from(toolbar?.querySelectorAll('.cm-moss-mobile-btn span') ?? []).map(
      (s) => s.textContent,
    );
    expect(labels).toContain('Preview');
    expect(labels).toContain('Resize');
    expect(labels).toContain('Copy');
    expect(labels).toContain('Delete');

    // Click Resize to toggle slider drawer
    const resizeBtn = Array.from(toolbar?.querySelectorAll<HTMLButtonElement>('.cm-moss-mobile-btn') ?? []).find(
      (b) => b.textContent?.includes('Resize'),
    );
    expect(resizeBtn).toBeDefined();

    act(() => {
      resizeBtn?.click();
    });

    const sliderPanel = toolbar?.querySelector<HTMLElement>('.cm-moss-mobile-slider-panel');
    expect(sliderPanel?.style.display).toBe('flex');

    // Click 50% preset
    const preset50 = Array.from(sliderPanel?.querySelectorAll<HTMLButtonElement>('.cm-moss-mobile-preset-btn') ?? []).find(
      (b) => b.textContent === '50%',
    );
    expect(preset50).toBeDefined();

    act(() => {
      preset50?.click();
    });

    // Check markdown updated with width=50%
    expect(currentDoc).toContain('|width=50%');
  });

  it('switches to file block toolbar on file card selection', () => {
    const handleRef = createRef<MossMDHandle>();
    const doc = '[archive.zip](https://example.com/archive.zip)';

    const { host } = mount(
      <MossMD
        markdownSource={doc}
        editorHandleRef={handleRef}
      />,
    );

    act(() => {
      handleRef.current?.focus();
    });

    const fileWidget = host.querySelector<HTMLElement>('.cm-moss-file-block');
    expect(fileWidget).not.toBeNull();

    act(() => {
      fileWidget?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });

    const toolbar = host.querySelector<HTMLElement>('.cm-moss-mobile-bar');
    expect(toolbar?.dataset.mode).toBe('file');

    const labels = Array.from(toolbar?.querySelectorAll('.cm-moss-mobile-btn span') ?? []).map(
      (s) => s.textContent,
    );
    expect(labels).toContain('Download');
    expect(labels).toContain('Copy');
    expect(labels).toContain('Delete');
  });

  it('hides mobile toolbar when editor is in read-only mode', () => {
    const handleRef = createRef<MossMDHandle>();
    const { host } = mount(
      <MossMD
        markdownSource="# Read only mode"
        editorHandleRef={handleRef}
        readOnly={true}
      />,
    );

    act(() => {
      handleRef.current?.focus();
    });

    const toolbar = host.querySelector<HTMLElement>('.cm-moss-mobile-bar');
    expect(toolbar?.style.display).toBe('none');
  });

  it('triggers block insertion on non-empty line without leaving a slash character', () => {
    const handleRef = createRef<MossMDHandle>();
    let currentDoc = 'Paragraph text';
    const { host } = mount(
      <MossMD
        markdownSource={currentDoc}
        editorHandleRef={handleRef}
        onMarkdownChange={(doc) => {
          currentDoc = doc;
        }}
      />,
    );

    act(() => {
      const editor = host.querySelector<HTMLElement>('.cm-editor');
      const view = editor ? EditorView.findFromDOM(editor) : null;
      view?.focus();
      view?.dispatch({ selection: { anchor: 'Paragraph text'.length } });
    });

    const toolbar = host.querySelector<HTMLElement>('.cm-moss-mobile-bar');
    const blockBtn = Array.from(
      toolbar?.querySelectorAll<HTMLButtonElement>('.cm-moss-mobile-btn') ?? [],
    ).find((b) => b.textContent?.includes('Block'));
    expect(blockBtn).toBeDefined();

    act(() => {
      blockBtn?.click();
    });

    // Verify no literal slash '/' was inserted into the document
    expect(currentDoc).not.toContain('/');
    expect(currentDoc).toBe('Paragraph text\n');
  });

  it('toggles slash command block completion on repeat clicks of the Block button', () => {
    const handleRef = createRef<MossMDHandle>();
    const { host } = mount(
      <MossMD
        markdownSource=""
        editorHandleRef={handleRef}
        slashCommandsConfig={{
          commands: [
            {
              id: 'test',
              label: 'Test Block',
              apply: () => {},
            },
          ],
        }}
      />,
    );

    let view: EditorView | null = null;
    act(() => {
      const editor = host.querySelector<HTMLElement>('.cm-editor');
      view = editor ? EditorView.findFromDOM(editor) : null;
      view?.focus();
      view?.dispatch({ selection: { anchor: 0 } });
    });

    const toolbar = host.querySelector<HTMLElement>('.cm-moss-mobile-bar');
    const blockBtn = Array.from(
      toolbar?.querySelectorAll<HTMLButtonElement>('.cm-moss-mobile-btn') ?? [],
    ).find((b) => b.textContent?.includes('Block'));
    expect(blockBtn).toBeDefined();

    // First click: triggers startCompletion
    act(() => {
      blockBtn?.click();
    });

    // CodeMirror autocomplete shows completion or activates
    const tooltip = host.querySelector('.cm-tooltip-autocomplete');
    const completionActive = tooltip !== null || blockBtn?.classList.contains('is-active');
    expect(completionActive).toBe(true);

    // Second click: toggles it off
    act(() => {
      blockBtn?.click();
    });

    const tooltipAfter = host.querySelector('.cm-tooltip-autocomplete');
    expect(tooltipAfter).toBeNull();
    expect(blockBtn?.classList.contains('is-active')).toBe(false);
  });
});
