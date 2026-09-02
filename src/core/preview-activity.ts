import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import { readOnlyFacet } from './read-only';
import type { ParsedTaskMarker } from './preview-widgets';

const FREEZE_TAIL_MS = 100;

export const setFrozen = StateEffect.define<boolean>();
export const refreshInlinePreview = StateEffect.define<void>();

export const previewFrozenField = StateField.define<boolean>({
  create: () => false,
  update(prev, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFrozen)) return effect.value;
    }
    return prev;
  },
});

export interface PreviewActivity {
  editorFocused: boolean;
  activeLines: ReadonlySet<number>;
  frozen: boolean;
}

export function getPreviewActivity(view: EditorView): PreviewActivity {
  const editorFocused =
    view.hasFocus && !view.state.facet(readOnlyFacet);
  const activeLines = new Set<number>();
  if (editorFocused) {
    for (const range of view.state.selection.ranges) {
      const firstLine = view.state.doc.lineAt(range.from).number;
      const lastLine = view.state.doc.lineAt(range.to).number;
      for (let number = firstLine; number <= lastLine; number++) {
        activeLines.add(number);
      }
    }
  }
  return {
    editorFocused,
    activeLines,
    frozen: view.state.field(previewFrozenField),
  };
}

export function shouldRevealTaskSource(
  view: EditorView,
  lineFrom: number,
  taskInfo: ParsedTaskMarker,
): boolean {
  if (!getPreviewActivity(view).editorFocused) return false;
  const from = lineFrom + taskInfo.listFrom;
  const to = lineFrom + taskInfo.markerTo;
  for (const range of view.state.selection.ranges) {
    if (range.empty) {
      if (range.head >= from && range.head <= to) return true;
    } else if (range.from <= to && range.to >= from) {
      return true;
    }
  }
  return false;
}

export function defaultOnLinkClick(url: string): void {
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    // window.open can throw in sandboxed iframes; consumers can provide an opener.
  }
}

export function linkIconHitTarget(
  event: MouseEvent,
  root?: HTMLElement,
): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const linkEl = target.closest<HTMLElement>('.cm-moss-link');
  if (!linkEl || (root && !root.contains(linkEl))) return null;

  const rects = Array.from(linkEl.getClientRects());
  if (rects.length === 0) return null;
  const lastRect = rects[rects.length - 1];
  const emSize = parseFloat(window.getComputedStyle(linkEl).fontSize);
  const iconZone = emSize * 1.25;
  const onIcon =
    event.clientX >= lastRect.right - iconZone &&
    event.clientX <= lastRect.right &&
    event.clientY >= lastRect.top &&
    event.clientY <= lastRect.bottom;

  return onIcon ? linkEl : null;
}

export function linkElementFromEvent(
  event: MouseEvent,
  root?: HTMLElement,
): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const linkEl = target.closest<HTMLElement>('.cm-moss-link');
  if (!linkEl || (root && !root.contains(linkEl))) return null;
  return linkEl;
}

const freezeMousePlugin = ViewPlugin.fromClass(
  class {
    private down = false;
    private releaseTimer: number | null = null;
    private readonly onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (this.view.state.facet(readOnlyFacet)) return;

      const target = event.target;
      if (!(target instanceof Node) || !this.view.contentDOM.contains(target)) {
        return;
      }
      if (linkIconHitTarget(event, this.view.contentDOM)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      this.down = true;
      if (this.releaseTimer != null) {
        window.clearTimeout(this.releaseTimer);
        this.releaseTimer = null;
      }
      if (!this.view.state.field(previewFrozenField)) {
        this.view.dispatch({ effects: setFrozen.of(true) });
      }
    };
    private readonly onUp = () => {
      if (!this.down) return;
      this.down = false;
      if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer);
      this.releaseTimer = window.setTimeout(() => {
        this.releaseTimer = null;
        if (!this.view.state.field(previewFrozenField)) return;
        try {
          this.view.dispatch({ effects: setFrozen.of(false) });
        } catch {
          // view destroyed while the release timer was pending.
        }
      }, FREEZE_TAIL_MS);
    };

    constructor(readonly view: EditorView) {
      view.dom.addEventListener('pointerdown', this.onDown, true);
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onUp);
    }

    update(_: ViewUpdate) {}

    destroy() {
      this.view.dom.removeEventListener('pointerdown', this.onDown, true);
      window.removeEventListener('pointerup', this.onUp);
      window.removeEventListener('pointercancel', this.onUp);
      if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer);
    }
  },
);

export function previewActivityExtension(): Extension {
  return [previewFrozenField, freezeMousePlugin];
}
