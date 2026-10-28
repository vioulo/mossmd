import { describe, expect, it, afterEach } from 'vitest';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import katex from 'katex';
import {
  MossMD,
  type MossMDHandle,
} from '../editor';
import { EditorView } from '@codemirror/view';
import {
  mossMathSyntax,
  createKatexRenderer,
  mossMathMarkdown,
} from '../features/math';
import { parser } from '@lezer/markdown';

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

describe('Math (LaTeX) Feature', () => {
  describe('AST & Markdown Parser', () => {
    const mathParser = parser.configure(mossMathMarkdown);

    it('parses inline math correctly', () => {
      const doc = 'Inline $E = mc^2$ formula.';
      const tree = mathParser.parse(doc);
      let foundInline = false;
      tree.iterate({
        enter(node) {
          if (node.name === 'InlineMath') {
            foundInline = true;
            expect(doc.slice(node.from, node.to)).toBe('$E = mc^2$');
          }
        },
      });
      expect(foundInline).toBe(true);
    });

    it('parses multiline block math correctly', () => {
      const doc = '$$\n\\int_0^1 x^2 dx\n$$';
      const tree = mathParser.parse(doc);
      let foundBlock = false;
      tree.iterate({
        enter(node) {
          if (node.name === 'BlockMath') {
            foundBlock = true;
            expect(doc.slice(node.from, node.to)).toBe('$$\n\\int_0^1 x^2 dx\n$$');
          }
        },
      });
      expect(foundBlock).toBe(true);
    });

    it('parses single line block math correctly', () => {
      const doc = '$$x = 1$$';
      const tree = mathParser.parse(doc);
      let foundBlock = false;
      tree.iterate({
        enter(node) {
          if (node.name === 'BlockMath') {
            foundBlock = true;
            expect(doc.slice(node.from, node.to)).toBe('$$x = 1$$');
          }
        },
      });
      expect(foundBlock).toBe(true);
    });

    it('does not parse currency as math', () => {
      const doc = 'I have $20 and he has $30.';
      const tree = mathParser.parse(doc);
      let foundMath = false;
      tree.iterate({
        enter(node) {
          if (node.name.includes('Math')) foundMath = true;
        },
      });
      expect(foundMath).toBe(false);
    });

    it('respects escaped dollar signs', () => {
      const doc = 'Escaped \\$E = mc^2\\$ is plain text.';
      const tree = mathParser.parse(doc);
      let foundMath = false;
      tree.iterate({
        enter(node) {
          if (node.name.includes('Math')) foundMath = true;
        },
      });
      expect(foundMath).toBe(false);
    });

    it('does not parse math inside inline code', () => {
      const doc = 'Code `$E = mc^2$` remains code.';
      const tree = mathParser.parse(doc);
      let foundMath = false;
      tree.iterate({
        enter(node) {
          if (node.name.includes('Math')) foundMath = true;
        },
      });
      expect(foundMath).toBe(false);
    });
  });

  describe('Editor Integration & Live Preview', () => {
    it('renders math using KaTeX renderer', () => {
      const handleRef = createRef<MossMDHandle | null>() as {
        current: MossMDHandle | null;
      };
      const markdown = 'Formula: $a^2 + b^2 = c^2$\n\n$$\n\\sum_{i=1}^n i\n$$';

      const { host } = mount(
        <MossMD
          editorHandleRef={handleRef}
          markdownSource={markdown}
          customSyntax={[
            mossMathSyntax({
              renderer: createKatexRenderer(katex),
            }),
          ]}
        />,
      );

      // Inactive selection: both inline and block math are rendered as widgets
      const inlineWidget = host.querySelector('.cm-moss-math-inline');
      expect(inlineWidget).not.toBeNull();
      // KaTeX renders .katex or .katex-html elements
      expect(inlineWidget?.querySelector('.katex')).not.toBeNull();

      const blockWidget = host.querySelector('.cm-moss-math-block');
      expect(blockWidget).not.toBeNull();
      expect(blockWidget?.querySelector('.katex-display')).not.toBeNull();
    });

    it('handles inline math: mouse click selects source, arrow keys enter without selecting, leaving restores preview', async () => {
      const markdown = 'Text $x = y$ more';

      const { host } = mount(
        <MossMD
          markdownSource={markdown}
          customSyntax={[mossMathSyntax()]}
        />,
      );

      const editor = host.querySelector<HTMLElement>('.cm-editor');
      const view = editor ? EditorView.findFromDOM(editor) : null;
      expect(view).not.toBeNull();

      const from = markdown.indexOf('$x = y$');
      const to = from + '$x = y$'.length;

      // 1. Initial: cursor at 0. Widget is rendered.
      act(() => {
        view!.focus();
        view!.dispatch({ selection: { anchor: 0 } });
      });
      const inlineWidget = host.querySelector<HTMLElement>('.cm-moss-math-inline');
      expect(inlineWidget).not.toBeNull();

      // 2. Mouse click on widget: triggers selection of full source [from, to]
      act(() => {
        inlineWidget!.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
        window.dispatchEvent(
          new MouseEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
      });
      // Source is revealed (widget removed), and selection covers formula content without '$'
      expect(host.querySelector('.cm-moss-math-inline')).toBeNull();
      expect(view!.state.selection.main.from).toBe(from + 1);
      expect(view!.state.selection.main.to).toBe(to - 1);
      expect(
        view!.state.sliceDoc(
          view!.state.selection.main.from,
          view!.state.selection.main.to,
        ),
      ).toBe('x = y');

      // 3. Arrow key moves outside (before '$'): restores preview
      act(() => {
        view!.dispatch({ selection: { anchor: from } });
      });
      expect(host.querySelector('.cm-moss-math-inline')).not.toBeNull();

      // 4. Arrow key enters inside formula (between '$'): reveals source without selecting (empty selection)
      act(() => {
        view!.dispatch({ selection: { anchor: from + 2 } });
      });
      expect(host.querySelector('.cm-moss-math-inline')).toBeNull();
      expect(view!.state.selection.main.empty).toBe(true);

      // 5. Arrow key moves past formula: restores preview
      act(() => {
        view!.dispatch({ selection: { anchor: to } });
      });
      expect(host.querySelector('.cm-moss-math-inline')).not.toBeNull();
    });

    it('handles block math: keeps rendered card below while source is shown above, selects on click, does not select on arrow key', () => {
      const markdown = 'Before\n$$\nx = 1\n$$\nAfter';

      const { host } = mount(
        <MossMD
          markdownSource={markdown}
          customSyntax={[mossMathSyntax()]}
        />,
      );

      const editor = host.querySelector<HTMLElement>('.cm-editor');
      const view = editor ? EditorView.findFromDOM(editor) : null;
      expect(view).not.toBeNull();

      // 1. Initial: cursor at 0 ("Before"). Inactive card is rendered.
      act(() => {
        view!.focus();
        view!.dispatch({ selection: { anchor: 0 } });
      });
      const blockWidget = host.querySelector<HTMLElement>('.cm-moss-math-block');
      expect(blockWidget).not.toBeNull();
      expect(blockWidget?.classList.contains('cm-moss-math-block-preview')).toBe(false);

      // 2. Mouse click on block widget: selects full block source [from, to]
      act(() => {
        blockWidget!.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
        window.dispatchEvent(
          new MouseEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
      });
      // Source is shown above (selection covers formula content, excluding '$$' md syntax),
      // and preview card is retained below!
      const contentFrom = markdown.indexOf('x = 1');
      const contentTo = contentFrom + 'x = 1'.length;
      expect(view!.state.selection.main.from).toBe(contentFrom);
      expect(view!.state.selection.main.to).toBe(contentTo);
      expect(
        view!.state.sliceDoc(
          view!.state.selection.main.from,
          view!.state.selection.main.to,
        ),
      ).toBe('x = 1');
      const activeCard = host.querySelector<HTMLElement>('.cm-moss-math-block-preview');
      expect(activeCard).not.toBeNull();

      // 3. Arrow key navigation into formula line (line 3, "x = 1"):
      // Source is shown above, caret is not selecting (empty selection), preview card retained below
      const line3 = view!.state.doc.line(3);
      act(() => {
        view!.dispatch({ selection: { anchor: line3.from } });
      });
      expect(view!.state.selection.main.empty).toBe(true);
      expect(host.querySelector('.cm-moss-math-block-preview')).not.toBeNull();

      // 4. Arrow key moves outside ("After" line):
      // Source is folded again, card returns to regular folded block
      const lastLine = view!.state.doc.line(5);
      act(() => {
        view!.dispatch({ selection: { anchor: lastLine.from } });
      });
      expect(host.querySelector('.cm-moss-math-block-preview')).toBeNull();
      expect(host.querySelector('.cm-moss-math-block')).not.toBeNull();
    });

    it('selects formula content cleanly on click excluding delimiters', () => {
      const formulaInner =
        '\\frac{1}{1 + \\frac{e^{-2\\pi}}{1 + \\frac{e^{-4\\pi}}{1 + \\frac{e^{-6\\pi}}{\\ddots}}}} = \\left( \\sqrt{\\frac{5+\\sqrt{5}}{2}} - \\frac{\\sqrt{5}+1}{2} \\right) e^{2\\pi/5}';
      const markdown = `$$\n${formulaInner}$$`;

      const { host } = mount(
        <MossMD
          markdownSource={markdown}
          customSyntax={[mossMathSyntax()]}
        />,
      );

      const editor = host.querySelector<HTMLElement>('.cm-editor');
      const view = editor ? EditorView.findFromDOM(editor) : null;
      expect(view).not.toBeNull();

      const blockWidget = host.querySelector<HTMLElement>(
        '.cm-moss-math.cm-moss-math-block',
      );
      expect(blockWidget).not.toBeNull();

      act(() => {
        blockWidget!.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
      });

      const selFrom = view!.state.selection.main.from;
      const selTo = view!.state.selection.main.to;
      const selected = view!.state.sliceDoc(selFrom, selTo);
      expect(selected).toBe(formulaInner);
      expect(selected.includes('$$')).toBe(false);
    });

    it('re-resolves fresh math node range after earlier edits prevent stale offsets', () => {
      const markdown = '# Header\n\n$$\nx = 1\n$$\n';

      const { host } = mount(
        <MossMD
          markdownSource={markdown}
          customSyntax={[mossMathSyntax()]}
        />,
      );

      const editor = host.querySelector<HTMLElement>('.cm-editor');
      const view = editor ? EditorView.findFromDOM(editor) : null;
      expect(view).not.toBeNull();

      // Insert new lines before the formula to shift document offsets
      act(() => {
        view!.dispatch({
          changes: { from: 0, insert: 'Paragraph before\n\n' },
        });
      });

      const blockWidget = host.querySelector<HTMLElement>(
        '.cm-moss-math.cm-moss-math-block',
      );
      expect(blockWidget).not.toBeNull();

      act(() => {
        blockWidget!.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
      });

      const selFrom = view!.state.selection.main.from;
      const selTo = view!.state.selection.main.to;
      const selected = view!.state.sliceDoc(selFrom, selTo);
      expect(selected).toBe('x = 1');
      expect(selected.includes('$$')).toBe(false);
    });

    it('never reveals source in read-only mode', () => {
      const markdown = 'Read $x = 1$ only';

      const { host } = mount(
        <MossMD
          markdownSource={markdown}
          readOnly={true}
          customSyntax={[mossMathSyntax()]}
        />,
      );

      const editor = host.querySelector<HTMLElement>('.cm-editor');
      const view = editor ? EditorView.findFromDOM(editor) : null;
      expect(view).not.toBeNull();

      // Even if selection is inside formula:
      act(() => {
        view!.dispatch({ selection: { anchor: 7 } });
      });
      // In read-only mode, widget remains visible!
      expect(host.querySelector('.cm-moss-math-inline')).not.toBeNull();
    });

    it('gracefully handles renderer errors without crashing editor', () => {
      const handleRef = createRef<MossMDHandle | null>() as {
        current: MossMDHandle | null;
      };
      const brokenMarkdown = 'Invalid: $\\invalidMacro{foo}$ formula';

      const throwingRenderer = {
        render() {
          throw new Error('LaTeX syntax error');
        },
      };

      const { host } = mount(
        <MossMD
          editorHandleRef={handleRef}
          markdownSource={brokenMarkdown}
          customSyntax={[
            mossMathSyntax({
              renderer: throwingRenderer,
            }),
          ]}
        />,
      );

      const errorWidget = host.querySelector('.cm-moss-math-error');
      expect(errorWidget).not.toBeNull();
      expect(errorWidget?.textContent).toContain('\\invalidMacro{foo}');
    });

    it('preserves plain markdown in handle.getMarkdown()', () => {
      const handleRef = createRef<MossMDHandle | null>() as {
        current: MossMDHandle | null;
      };
      const original = '# Title\n\nInline $E = mc^2$ and block:\n\n$$\nx^2 + y^2 = r^2\n$$';

      mount(
        <MossMD
          editorHandleRef={handleRef}
          markdownSource={original}
          customSyntax={[mossMathSyntax()]}
        />,
      );

      expect(handleRef.current!.getMarkdown()).toBe(original);
    });
  });
});
