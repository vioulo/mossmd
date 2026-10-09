import { afterEach, describe, expect, it } from 'vitest';
import { closeBrackets, insertBracket } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

const views: EditorView[] = [];
const hosts: HTMLElement[] = [];

function makeView(doc: string, from: number, to: number): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      selection: { anchor: from, head: to },
      extensions: [
        closeBrackets(),
        markdown({ base: markdownLanguage }),
        markdownLanguage.data.of({
          closeBrackets: { brackets: ['(', '[', '{', "'", '"', '*', '_', '`', '='] },
        }),
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

describe('Markdown close brackets', () => {
  it('wraps a selection in == when equals is typed twice', () => {
    const view = makeView('hello', 0, 5);

    const first = insertBracket(view.state, '=');
    expect(first).not.toBeNull();
    view.dispatch(first!);
    expect(view.state.doc.toString()).toBe('=hello=');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('hello');

    const second = insertBracket(view.state, '=');
    expect(second).not.toBeNull();
    view.dispatch(second!);

    expect(view.state.doc.toString()).toBe('==hello==');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('hello');
  });
});
