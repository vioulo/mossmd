import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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
      extensions: [markdown({ base: markdownLanguage }), extensions],
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
  it('keeps active ordered-list markers in the fixed preview alcove', async () => {
    const doc = '1. ';
    const view = makeView(doc, doc.length, [inlinePreview()]);

    view.focus();
    view.contentDOM.dispatchEvent(new FocusEvent('focus'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(view.contentDOM.querySelector('.cm-moss-list-marker')?.textContent).toBe('1.');
    expect(view.contentDOM.textContent).toBe('1.');
  });

  it('does not indent a top-level plain line after a list item', () => {
    const view = makeView('1. item\nplain', 0, [inlinePreview()]);
    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-line'));

    expect(lines[0]?.getAttribute('style')).toContain('padding-left');
    expect(lines[1]?.getAttribute('style') ?? '').not.toContain('padding-left');
  });
});
