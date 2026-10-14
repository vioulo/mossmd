import { WidgetType, type EditorView } from '@codemirror/view';
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
    if (raw.startsWith('$')) anchor += 1;
    if (raw.endsWith('$') && head > anchor) head -= 1;
    return { anchor, head };
  }

  // Block math: exclude leading and trailing '$$' delimiters (and optional surrounding newlines)
  let anchor = from;
  let head = to;
  if (raw.startsWith('$$')) {
    anchor += 2;
    if (raw.slice(2).startsWith('\r\n')) {
      anchor += 2;
    } else if (raw.slice(2).startsWith('\n')) {
      anchor += 1;
    }
  }
  if (raw.endsWith('$$') && head >= anchor + 2) {
    head -= 2;
    const beforeClose = raw.slice(0, head - from);
    if (beforeClose.endsWith('\r\n')) {
      head -= 2;
    } else if (beforeClose.endsWith('\n')) {
      head -= 1;
    }
  }
  if (anchor > head) {
    anchor = head = Math.min(from + 2, to);
  }
  return { anchor, head };
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
    return this.source === other.source;
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
      // Click on inline math: select formula content inside '$' delimiters
      const raw = view.state.doc.sliceString(this.from, this.to);
      const sel = getMathContentSelection(raw, this.from, this.to, 'inline');
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
      // Click on block math: select formula content inside '$$' delimiters
      const raw = view.state.doc.sliceString(this.from, this.to);
      const sel = getMathContentSelection(raw, this.from, this.to, 'block');
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
