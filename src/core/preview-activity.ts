import {
  EditorView,
  ViewPlugin,
} from '@codemirror/view';
import {
  StateEffect,
  StateField,
  type Extension,
  type EditorState,
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

export interface PreviewSourceRange {
  from: number;
  to: number;
}

export function isPreviewRangeActive(
  state: EditorState,
  range: PreviewSourceRange,
  editorFocused: boolean,
): boolean {
  if (!editorFocused || state.facet(readOnlyFacet)) return false;
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  return state.selection.ranges.some((selection) => {
    if (selection.empty) return selection.head >= from && selection.head <= to;
    return selection.from <= to && selection.to >= from;
  });
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
  const emSize = parseFloat(window.getComputedStyle(linkEl).fontSize) || 16;
  const isCoarse =
    (event instanceof PointerEvent && event.pointerType === 'touch') ||
    (typeof window !== 'undefined' &&
      window.matchMedia?.('(pointer: coarse)').matches);

  const iconWidth = emSize * 1.25;
  const iconHeight = lastRect.bottom - lastRect.top;

  let hitLeft: number;
  let hitRight: number;
  let hitTop: number;
  let hitBottom: number;

  if (isCoarse) {
    // Apple iOS HIG & Android Material: minimum 44px touch target
    const minTouchSize = 44;
    const padX = Math.max(0, (minTouchSize - iconWidth) / 2);
    const padY = Math.max(0, (minTouchSize - iconHeight) / 2);
    hitLeft = lastRect.right - iconWidth - padX;
    hitRight = lastRect.right + padX;
    hitTop = lastRect.top - padY;
    hitBottom = lastRect.bottom + padY;
  } else {
    hitLeft = lastRect.right - iconWidth;
    hitRight = lastRect.right;
    hitTop = lastRect.top;
    hitBottom = lastRect.bottom;
  }

  const onIcon =
    event.clientX >= hitLeft &&
    event.clientX <= hitRight &&
    event.clientY >= hitTop &&
    event.clientY <= hitBottom;

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
    private pendingTouch: {
      startX: number;
      startY: number;
      clientX: number;
      clientY: number;
      startTime: number;
    } | null = null;

    private freezeDuringPointer() {
      this.down = true;
      if (this.releaseTimer != null) {
        window.clearTimeout(this.releaseTimer);
        this.releaseTimer = null;
      }
      if (!this.view.state.field(previewFrozenField)) {
        this.view.dispatch({ effects: setFrozen.of(true) });
      }
    }

    private applyScrollerSelection(clientX: number, clientY: number) {
      const contentRect = this.view.contentDOM.getBoundingClientRect();
      if (contentRect.width <= 0 || contentRect.height <= 0) return;

      const x = Math.min(
        Math.max(clientX, contentRect.left + 1),
        contentRect.right - 1,
      );
      const pos = this.view.posAtCoords({ x, y: clientY });
      if (pos == null) return;

      this.freezeDuringPointer();
      this.view.focus();
      this.view.dispatch({
        selection: { anchor: pos },
        userEvent: 'select.pointer',
      });
    }

    private selectFromScrollerSpace(event: PointerEvent) {
      event.preventDefault();
      this.applyScrollerSelection(event.clientX, event.clientY);
    }

    private readonly onPointerMove = (event: PointerEvent) => {
      if (!this.pendingTouch) return;
      const dx = event.clientX - this.pendingTouch.startX;
      const dy = event.clientY - this.pendingTouch.startY;
      if (Math.hypot(dx, dy) > 10) {
        // Exceeded touch slop -> user is scrolling, cancel tap selection
        this.clearPendingTouch();
      } else {
        this.pendingTouch.clientX = event.clientX;
        this.pendingTouch.clientY = event.clientY;
      }
    };

    private clearPendingTouch() {
      this.pendingTouch = null;
      window.removeEventListener('pointermove', this.onPointerMove);
    }

    private readonly onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (this.view.state.facet(readOnlyFacet)) return;

      const target = event.target;
      if (!(target instanceof Node) || !this.view.dom.contains(target)) {
        return;
      }
      if (!this.view.contentDOM.contains(target)) {
        if (this.view.scrollDOM.contains(target)) {
          if (event.pointerType === 'touch') {
            // Touch device: do NOT call preventDefault(), allowing native kinetic scrolling.
            // Record initial touch coordinates to distinguish a tap from a scroll/pan.
            this.pendingTouch = {
              startX: event.clientX,
              startY: event.clientY,
              clientX: event.clientX,
              clientY: event.clientY,
              startTime: Date.now(),
            };
            window.addEventListener('pointermove', this.onPointerMove, { passive: true });
          } else {
            this.selectFromScrollerSpace(event);
          }
        }
        return;
      }

      if (linkIconHitTarget(event, this.view.contentDOM)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      this.freezeDuringPointer();
    };

    private readonly onUp = (event?: PointerEvent) => {
      if (this.pendingTouch) {
        const touch = this.pendingTouch;
        this.clearPendingTouch();
        const duration = Date.now() - touch.startTime;
        // Confirmed tap on empty scroller space (short duration, within slop)
        if (duration < 400) {
          const clientX = event?.clientX ?? touch.clientX;
          const clientY = event?.clientY ?? touch.clientY;
          this.applyScrollerSelection(clientX, clientY);
        }
      }

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

    private readonly onCancel = () => {
      this.clearPendingTouch();
      this.onUp();
    };

    constructor(readonly view: EditorView) {
      view.dom.addEventListener('pointerdown', this.onDown, true);
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onCancel);
    }

    destroy() {
      this.view.dom.removeEventListener('pointerdown', this.onDown, true);
      window.removeEventListener('pointerup', this.onUp);
      window.removeEventListener('pointercancel', this.onCancel);
      this.clearPendingTouch();
      if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer);
    }
  },
);

export function previewActivityExtension(): Extension {
  return [previewFrozenField, freezeMousePlugin];
}
