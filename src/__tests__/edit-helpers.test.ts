import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  autoCloseCodeFenceInput,
  startAsteriskListInput,
} from '../core/edit-helpers';

const views: EditorView[] = [];
const hosts: HTMLElement[] = [];

function makeView(doc: string, cursor: number): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown({ base: markdownLanguage })],
    }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

describe('startAsteriskListInput', () => {
  it('consumes the auto-inserted closer when a star becomes a list marker', () => {
    const view = makeView('**', 1);

    expect(startAsteriskListInput(view, 1, 1, ' ')).toBe(true);
    expect(view.state.doc.toString()).toBe('* ');
    expect(view.state.selection.main.head).toBe(2);
  });

  it('works for an indented nested-list marker', () => {
    const view = makeView('  **', 3);

    expect(startAsteriskListInput(view, 3, 3, ' ')).toBe(true);
    expect(view.state.doc.toString()).toBe('  * ');
  });

  it('works for a list marker inside a blockquote', () => {
    const view = makeView('> **', 3);

    expect(startAsteriskListInput(view, 3, 3, ' ')).toBe(true);
    expect(view.state.doc.toString()).toBe('> * ');
  });

  it('does not reinterpret emphasis after prose', () => {
    const view = makeView('word **', 6);

    expect(startAsteriskListInput(view, 6, 6, ' ')).toBe(false);
    expect(view.state.doc.toString()).toBe('word **');
  });

  it('does not reinterpret a star pair inside an indented code block', () => {
    const view = makeView('    **', 5);

    expect(startAsteriskListInput(view, 5, 5, ' ')).toBe(false);
    expect(view.state.doc.toString()).toBe('    **');
  });

  it('does not reinterpret a star pair inside a fenced code block', () => {
    const view = makeView('```\n**\n```', 5);

    expect(startAsteriskListInput(view, 5, 5, ' ')).toBe(false);
    expect(view.state.doc.toString()).toBe('```\n**\n```');
  });

  it('falls through when there is no auto-inserted closer', () => {
    const view = makeView('*', 1);

    expect(startAsteriskListInput(view, 1, 1, ' ')).toBe(false);
    expect(view.state.doc.toString()).toBe('*');
  });
});

describe('autoCloseCodeFenceInput', () => {
  it('inserts a matching closing fence when the third backtick opens a fence', () => {
    const doc = 'Before\n``\nAfter';
    const cursor = 'Before\n``'.length;
    const view = makeView(doc, cursor);

    expect(autoCloseCodeFenceInput(view, cursor, cursor, '`')).toBe(true);
    expect(view.state.doc.toString()).toBe('Before\n```\n```\nAfter');
    expect(view.state.selection.main.head).toBe('Before\n```'.length);
  });

  it('consumes a paired closing backtick inserted by closeBrackets', () => {
    const doc = 'Before\n```\nAfter';
    const cursor = 'Before\n``'.length;
    const view = makeView(doc, cursor);

    expect(autoCloseCodeFenceInput(view, cursor, cursor, '`')).toBe(true);
    expect(view.state.doc.toString()).toBe('Before\n```\n```\nAfter');
    expect(view.state.selection.main.head).toBe('Before\n```'.length);
  });

  it('does not auto-close when typing a manual closing fence inside a code block', () => {
    const doc = '```ts\nconst x = 1;\n``';
    const cursor = doc.length;
    const view = makeView(doc, cursor);

    expect(autoCloseCodeFenceInput(view, cursor, cursor, '`')).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });
});
