import { WidgetType, type EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { readOnlyFacet } from '../../core/read-only';

export interface MossMathRenderer {
  render(
    source: string,
    mode: 'inline' | 'block',
  ): HTMLElement | Promise<HTMLElement> | string;
}

export const defaultMathRenderer: MossMathRenderer = {
  render(source: string, mode: 'inline' | 'block') {
    const el = document.createElement(mode === 'block' ? 'div' : 'span');
    el.className = `cm-moss-math-fallback cm-moss-math-${mode}`;
    el.textContent = source;
    return el;
  },
};

function renderError(
  container: HTMLElement,
  source: string,
  err: unknown,
): void {
  container.classList.add('cm-moss-math-error');
  container.textContent = source;
  container.title = err instanceof Error ? err.message : String(err);
}

function mountRenderResult(
  container: HTMLElement,
  source: string,
  result: HTMLElement | Promise<HTMLElement> | string,
): void {
  if (typeof result === 'string') {
    container.innerHTML = result;
  } else if (result instanceof HTMLElement) {
    container.replaceChildren(result);
  } else if (
    result &&
    typeof (result as Promise<HTMLElement>).then === 'function'
  ) {
    container.textContent = source;
    (result as Promise<HTMLElement>)
      .then((node) => {
        container.replaceChildren(node);
      })
      .catch((err) => {
        renderError(container, source, err);
      });
  }
}

export function getMathContentSelection(
  raw: string,
  from: number,
  to: number,
  mode: 'inline' | 'block',
): { anchor: number; head: number } {
  if (mode === 'inline') {
    let anchor = from;
    let head = to;
    const openIdx = raw.indexOf('$');
    if (openIdx >= 0) {
      anchor = from + openIdx + 1;
    }
    const closeIdx = raw.lastIndexOf('$');
    if (closeIdx > openIdx) {
      head = from + closeIdx;
    }
    if (anchor > head) {
      anchor = head = Math.min(from + 1, to);
    }
    return { anchor, head };
  }

  // Block math: exclude leading and trailing '$$' delimiters (and optional surrounding newlines/spaces)
  let anchor = from;
  let head = to;

  // 1. Advance anchor past opening '$$'
  const openMatch = raw.match(/^\s*\$\$(\r?\n)?/);
  if (openMatch) {
    anchor += openMatch[0].length;
  } else {
    const firstDollarIdx = raw.indexOf('$$');
    if (firstDollarIdx >= 0) {
      anchor = from + firstDollarIdx + 2;
      if (raw.slice(firstDollarIdx + 2).startsWith('\r\n')) {
        anchor += 2;
      } else if (raw.slice(firstDollarIdx + 2).startsWith('\n')) {
        anchor += 1;
      }
    }
  }

  // 2. Retreat head before closing '$$'
  const closeMatch = raw.match(/(\r?\n)?\s*\$\$\s*$/);
  if (closeMatch) {
    head -= closeMatch[0].length;
  } else {
    const lastDollarIdx = raw.lastIndexOf('$$');
    if (lastDollarIdx >= 0 && from + lastDollarIdx >= anchor) {
      head = from + lastDollarIdx;
      const beforeClose = raw.slice(0, lastDollarIdx);
      if (beforeClose.endsWith('\r\n')) {
        head -= 2;
      } else if (beforeClose.endsWith('\n')) {
        head -= 1;
      }
    }
  }

  if (anchor > head) {
    anchor = head = Math.min(from + 2, to);
  }
  return { anchor, head };
}

function resolveFreshMathRange(
  view: EditorView,
  container: HTMLElement,
  nodeName: 'InlineMath' | 'BlockMath',
  fallbackFrom: number,
  fallbackTo: number,
): { from: number; to: number } {
  try {
    const pos = view.posAtDOM(container);
    if (pos >= 0) {
      const tree = syntaxTree(view.state);
      for (const p of [
        pos,
        Math.max(0, pos - 1),
        Math.min(tree.length, pos + 1),
      ]) {
        for (const bias of [-1, 1] as const) {
          let node: SyntaxNode | null = tree.resolveInner(p, bias);
          while (node) {
            if (node.name === nodeName) {
              return { from: node.from, to: node.to };
            }
            node = node.parent;
          }
        }
      }
    }
  } catch {
    // Fallback if DOM not attached or posAtDOM throws
  }
  return { from: fallbackFrom, to: fallbackTo };
}

export class InlineMathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly renderer: MossMathRenderer,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }

  override eq(other: InlineMathWidget): boolean {
    return (
      this.source === other.source &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('span');
    container.className = 'cm-moss-math cm-moss-math-inline';
    container.dataset.mathSource = this.source;

    try {
      const result = this.renderer.render(this.source, 'inline');
      mountRenderResult(container, this.source, result);
    } catch (err) {
      renderError(container, this.source, err);
    }

    container.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || view.state.facet(readOnlyFacet)) return;
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      // Click on inline math: dynamically resolve current node range and select formula inside '$'
      const { from, to } = resolveFreshMathRange(
        view,
        container,
        'InlineMath',
        this.from,
        this.to,
      );
      const raw = view.state.doc.sliceString(from, to);
      const sel = getMathContentSelection(raw, from, to, 'inline');
      view.dispatch({
        selection: sel,
        userEvent: 'select.pointer',
      });
    });

    return container;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

export class BlockMathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly renderer: MossMathRenderer,
    readonly from: number,
    readonly to: number,
    readonly isActivePreview: boolean = false,
  ) {
    super();
  }

  override eq(other: BlockMathWidget): boolean {
    return (
      this.source === other.source &&
      this.from === other.from &&
      this.to === other.to &&
      this.isActivePreview === other.isActivePreview
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className =
      'cm-moss-math cm-moss-math-block' +
      (this.isActivePreview ? ' cm-moss-math-block-preview' : '');
    container.dataset.mathSource = this.source;

    try {
      const result = this.renderer.render(this.source, 'block');
      mountRenderResult(container, this.source, result);
    } catch (err) {
      renderError(container, this.source, err);
    }

    container.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || view.state.facet(readOnlyFacet)) return;
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      // Click on block math: dynamically resolve current node range and select formula inside '$$'
      const { from, to } = resolveFreshMathRange(
        view,
        container,
        'BlockMath',
        this.from,
        this.to,
      );
      const raw = view.state.doc.sliceString(from, to);
      const sel = getMathContentSelection(raw, from, to, 'block');
      view.dispatch({
        selection: sel,
        userEvent: 'select.pointer',
      });
    });

    return container;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}
