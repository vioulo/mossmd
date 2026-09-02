import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  dedentListItem,
  indentListItem,
  inlinePreview,
  insertTightListItem,
  renumberOrderedLists,
} from '../core/inline-preview';

const views: EditorView[] = [];
const hosts: HTMLElement[] = [];

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

function makeView(
  doc: string,
  cursor: number,
  extensions: Extension = [],
): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [
        markdown({ base: markdownLanguage }),
        keymap.of(defaultKeymap),
        extensions,
      ],
    }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

describe('ordered list editing', () => {
  it('continues an ordered list with the next number', () => {
    const doc = '1. parent';
    const view = makeView(doc, doc.length);

    expect(insertTightListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. parent\n2. ');
  });

  it('recreates a real ordered marker after the next line marker was backspaced', () => {
    const original = '1. one\n2. two';
    const secondLineFrom = '1. one\n'.length;
    const view = makeView(original, secondLineFrom + 2);

    view.dispatch({
      changes: { from: secondLineFrom, to: secondLineFrom + 2, insert: '' },
      userEvent: 'delete.backward',
      selection: { anchor: '1. one'.length },
    });

    expect(insertTightListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. one\n2. \n two');
  });

  it('indents an ordered sibling as the first child item', () => {
    const doc = '1. parent\n2. child';
    const view = makeView(doc, doc.length);

    expect(indentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. parent\n    1. child');
  });

  it('continues a nested ordered list after indentation', () => {
    const doc = '1. parent\n2. child';
    const view = makeView(doc, doc.length);

    expect(indentListItem(view)).toBe(true);
    expect(insertTightListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. parent\n    1. child\n    2. ');
  });

  it('renumbers following ordered siblings after inserting in the middle', () => {
    const doc = '1. one\n2. inserted\n2. two\n3. three';
    const view = makeView(doc, doc.length);

    expect(renumberOrderedLists(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. one\n2. inserted\n3. two\n4. three');
  });

  it('renumbers the whole list after backspacing a child item to the parent level', async () => {
    const doc = '1. one\n    2. child\n2. two\n3. three';
    const childLineFrom = '1. one\n'.length;
    const view = makeView(doc, childLineFrom, [inlinePreview()]);

    view.dispatch({
      changes: { from: childLineFrom, to: childLineFrom + 4, insert: '' },
      userEvent: 'delete.backward',
    });
    await nextTick();

    expect(view.state.doc.toString()).toBe('1. one\n2. child\n3. two\n4. three');
  });

  it('renumbers the whole list after inserting an ordered item in the middle', async () => {
    const doc = '1. one\n2. two\n3. three';
    const insertAt = '1. one'.length;
    const view = makeView(doc, insertAt, [inlinePreview()]);

    view.dispatch({
      changes: { from: insertAt, insert: '\n2. inserted' },
      userEvent: 'input',
    });
    await nextTick();

    expect(view.state.doc.toString()).toBe('1. one\n2. inserted\n3. two\n4. three');
  });

  it('does not renumber during IME composition transactions', async () => {
    const doc = '1. one\n2. two\n2. three';
    const view = makeView(doc, doc.length, [inlinePreview()]);

    view.dispatch({
      changes: { from: doc.length, insert: '中' },
      userEvent: 'input.type.compose',
    });
    await nextTick();

    expect(view.state.doc.toString()).toBe('1. one\n2. two\n2. three中');
  });

  it('turns an empty nested ordered item into the next parent item', () => {
    const doc = '1. parent\n    1. ';
    const view = makeView(doc, doc.length);

    expect(insertTightListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. parent\n2. ');
  });

  it('continues nested numbering when tabbing a new parent item back in', () => {
    const doc = '1. parent\n    1. child\n2. ';
    const view = makeView(doc, doc.length);

    expect(indentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. parent\n    1. child\n    2. ');
  });

  it('continues nested numbering when indenting a non-empty parent item', () => {
    const doc = '1. parent\n    1. child\n2. sibling';
    const view = makeView(doc, doc.length);

    expect(indentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      '1. parent\n    1. child\n    2. sibling',
    );
  });

  it('allows a list item to indent into a new third level', () => {
    const doc = '1. parent\n    1. child';
    const view = makeView(doc, doc.length);

    expect(indentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. parent\n        1. child');
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it('dedents a nested ordered item with Shift-Tab semantics', () => {
    const doc = '1. parent\n    1. child';
    const view = makeView(doc, doc.length);

    expect(dedentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. parent\n2. child');
  });
});

describe('bullet list editing', () => {
  it('keeps bullet-list continuation tight', () => {
    const doc = '- parent';
    const view = makeView(doc, doc.length);

    expect(insertTightListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- parent\n- ');
  });

  it('continues task-list items unchecked', () => {
    const doc = '- [x] done';
    const view = makeView(doc, doc.length);

    expect(insertTightListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- [x] done\n- [ ] ');
  });
});

describe('active list-line preview', () => {
  it('marks ordered-list markers with the ordered marker class', () => {
    const view = makeView('1. item', 0, [inlinePreview()]);
    const marker = view.contentDOM.querySelector<HTMLElement>(
      '.cm-moss-ordered-marker',
    );

    expect(marker).not.toBeNull();
  });

  it('keeps the ordered separator visible on inactive lines', () => {
    const doc = '1. item\nparagraph';
    const view = makeView(doc, doc.length, [inlinePreview()]);
    const firstLine = view.contentDOM.querySelector<HTMLElement>('.cm-line');

    expect(firstLine?.textContent).toContain('1. item');
    expect(firstLine?.querySelector('.cm-moss-list-marker-active')).toBeNull();
  });

  it('does not preview an ordered marker before its separator space', () => {
    const view = makeView('1.', 2, [inlinePreview()]);
    const line = view.contentDOM.querySelector<HTMLElement>('.cm-line');

    expect(view.contentDOM.querySelector('.cm-moss-ordered-marker')).toBeNull();
    expect(line?.getAttribute('style') ?? '').not.toContain('padding-left');
  });

  it('keeps an ordered item after a horizontal rule when text is entered', async () => {
    const doc = '---\n1. ';
    const view = makeView(doc, doc.length, [inlinePreview()]);

    view.dispatch({
      changes: { from: doc.length, insert: 'text' },
      userEvent: 'input.type',
    });
    await nextTick();

    expect(view.state.doc.toString()).toBe('---\n1. text');
    expect(view.contentDOM.querySelector('.cm-moss-ordered-marker')).not.toBeNull();
    expect(
      view.contentDOM.querySelectorAll('.cm-line')[1]?.getAttribute('style') ?? '',
    ).toContain('padding-left');
  });

  it('keeps an ordered item after an empty line when text is entered', async () => {
    const doc = '---\n\n1. ';
    const view = makeView(doc, doc.length, [inlinePreview()]);

    view.dispatch({
      changes: { from: doc.length, insert: 'text' },
      userEvent: 'input.type',
    });
    await nextTick();

    expect(view.state.doc.toString()).toBe('---\n\n1. text');
    expect(view.contentDOM.querySelector('.cm-moss-ordered-marker')).not.toBeNull();
  });

  it('keeps the continuation space available for the next typed text', async () => {
    const view = makeView('1. text', 7, [inlinePreview()]);
    view.focus();

    expect(insertTightListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. text\n2. ');

    const cursor = view.state.selection.main.head;
    view.dispatch({
      changes: { from: cursor, insert: 'next' },
      selection: { anchor: cursor + 4 },
      userEvent: 'input.type',
    });
    await nextTick();

    expect(view.state.doc.toString()).toBe('1. text\n2. next');
    expect(view.contentDOM.querySelectorAll('.cm-moss-ordered-marker')).toHaveLength(2);
  });

  it('keeps active ordered-list markers in the fixed preview alcove', async () => {
    const doc = '1. ';
    const view = makeView(doc, doc.length, [inlinePreview()]);

    view.focus();
    view.contentDOM.dispatchEvent(new FocusEvent('focus'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(view.contentDOM.querySelector('.cm-moss-list-marker')?.textContent).toBe('1.');
    expect(
      view.contentDOM
        .querySelector('.cm-moss-list-marker')
        ?.classList.contains('cm-moss-list-marker-active'),
    ).toBe(true);
    expect(view.contentDOM.textContent).toBe('1. ');
  });

  it('focuses the editor and places the caret after a clicked ordered marker', () => {
    const view = makeView('1. one\n2. two', '1. one\n2. two'.length, [
      inlinePreview(),
    ]);
    const markers = view.contentDOM.querySelectorAll<HTMLElement>(
      '.cm-moss-ordered-marker',
    );
    const marker = markers[1];
    if (!marker) throw new Error('missing second ordered marker');

    marker.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
      }),
    );

    expect(view.hasFocus).toBe(true);
    expect(view.state.selection.main.head).toBe(9);
  });

  it('keeps upward movement inside adjacent ordered-list items', () => {
    const doc = '1. one\n2. two\n3. three\n4. four\n5. five';
    const view = makeView(doc, doc.length, [inlinePreview()]);
    view.focus();

    const pressArrowUp = (): void => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    pressArrowUp();
    expect(view.state.selection.main.head).toBe('1. one\n2. two\n3. three\n4. four'.length);
  });

  it('skips hidden nested-list indentation when moving left', () => {
    const doc = '1. parent\n    2. child';
    const childMarkerEnd = doc.indexOf('2.') + 2;
    const view = makeView(doc, childMarkerEnd, [inlinePreview()]);
    view.focus();

    const positions: number[] = [];
    for (let i = 0; i < 4; i++) {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          bubbles: true,
          cancelable: true,
        }),
      );
      positions.push(view.state.selection.main.head);
    }

    expect(positions).toEqual([
      childMarkerEnd - 1,
      childMarkerEnd - 2,
      doc.indexOf('    '),
      '1. parent'.length,
    ]);
  });

  it('deletes an empty ordered marker one character at a time from the keyboard', () => {
    const view = makeView('1. ', 3, [inlinePreview()]);
    view.focus();

    const pressBackspace = (): void => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Backspace',
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    pressBackspace();
    expect(view.state.doc.toString()).toBe('1.');
    expect(view.state.selection.main.head).toBe(2);

    pressBackspace();
    expect(view.state.doc.toString()).toBe('1');
    expect(view.state.selection.main.head).toBe(1);
  });

  it('does not indent a top-level plain line after a list item', () => {
    const view = makeView('1. item\nplain', 0, [inlinePreview()]);
    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-line'));

    expect(lines[0]?.getAttribute('style')).toContain('padding-left');
    expect(lines[1]?.getAttribute('style') ?? '').not.toContain('padding-left');
  });
});
