import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { inlinePreview } from '../core/inline-preview';

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
      extensions: [
        markdown({ base: markdownLanguage }),
        inlinePreview(),
        keymap.of(defaultKeymap),
      ],
    }),
  });
  view.focus();
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

describe('list atomic ranges and boundary navigation', () => {
  it('exposes list structure as atomicRanges in EditorView', () => {
    const doc = '1. parent\n    1. child';
    const view = makeView(doc, 0);

    const atomicGetters = view.state.facet(EditorView.atomicRanges);
    expect(atomicGetters.length).toBeGreaterThan(0);

    let hasListAtom = false;
    for (const getter of atomicGetters) {
      const ranges = getter(view);
      ranges.between(10, 14, (from, to) => {
        if (from === 10 && to === 14) hasListAtom = true;
      });
    }
    expect(hasListAtom).toBe(true);
  });

  it('skips hidden indentation when moving left from marker end to line 1', () => {
    const doc = '1. parent\n    2. child';
    // pos 16 = '2.' + 2
    const view = makeView(doc, 16);

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
      15, // between '2' and '.'
      14, // before '2.'
      9,  // end of '1. parent'
      8,  // 't' of parent
    ]);
  });

  it('enters nested ordered-item text without stopping in hidden indentation', () => {
    const doc = '1. parent\n    1. child';
    const view = makeView(doc, 9);

    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(view.state.selection.main.head).toBe(14);
  });

  it('supports Shift+ArrowLeft and Shift+ArrowRight across boundaries', () => {
    const doc = '1. parent\n    1. child';
    const view1 = makeView(doc, 14);

    view1.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(view1.state.selection.main.anchor).toBe(14);
    expect(view1.state.selection.main.head).toBe(9);

    const view2 = makeView(doc, 9);
    view2.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(view2.state.selection.main.anchor).toBe(9);
    expect(view2.state.selection.main.head).toBe(14);
  });
});
