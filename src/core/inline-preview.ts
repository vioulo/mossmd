import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
  Annotation,
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type ChangeSpec,
  type Extension,
  type Range,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { Check, Copy } from 'lucide-react';
import { treeGrowthEffect, treeProgressPlugin } from './tree-progress';
import { readOnlyFacet } from './read-only';
import { lucideSvg } from './icons';
import { deleteEmptyOrderedListMarkerBackward } from './edit-helpers';

// Inline preview — the Obsidian "Live Preview" model.
//
// Goals:
//   1. No layout shifts between active/inactive state. The raw markdown
//      source is always the DOM text; we only apply line-level CSS
//      classes (setting font-size / weight unconditionally) and hide
//      syntax tokens on inactive lines via empty Decoration.replace.
//      Line heights are driven by CSS class, not by token visibility.
//
//   2. No reveal during mouse interaction. Clicking a heading places the
//      cursor on its line, which would normally "reveal" the `# ` prefix
//      — and that reveal shifts the heading text rightward under the
//      user's cursor, sometimes turning a click into a micro-drag.
//      Obsidian sidesteps this by delaying the reveal until the mouse
//      has been released for a moment; we do the same via a freeze flag.

export interface InlinePreviewConfig {
  /**
   * Called when the user plain-clicks a rendered link. Defaults to
   * `window.open(url, '_blank', 'noopener,noreferrer')`. Consumers in
   * platform-specific shells (Tauri, Electron, Capacitor) should pass
   * their own opener so links route through the host's external-URL
   * mechanism.
   */
  onLinkClick?: (url: string) => void;
}

export type MossInlinePreviewConfig = InlinePreviewConfig;

export function defaultOnLinkClick(url: string): void {
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    // window.open can throw in sandboxed iframes etc. — silent failure
    // is fine; the caller can supply an opener that handles this.
  }
}

const FREEZE_TAIL_MS = 100;

// freeze plumbing

export const setFrozen = StateEffect.define<boolean>();
const refreshInlinePreview = StateEffect.define<void>();

const previewFrozenField = StateField.define<boolean>({
  create: () => false,
  update(prev, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFrozen)) return effect.value;
    }
    return prev;
  },
});

function linkIconHitTarget(event: MouseEvent, root?: HTMLElement): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const linkEl = target.closest<HTMLElement>('.cm-moss-link');
  if (!linkEl || (root && !root.contains(linkEl))) return null;

  // The icon is a `::after` pseudo-element, so it doesn't have its own
  // event target. Compute the same trailing hit-zone used by the click
  // opener and treat pointerdown in that zone as "on the icon", not
  // "inside editable link text".
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

// Whole-link hit test, used in read-only mode where the entire link
// (text + icon) is the open affordance. Mirrors `linkIconHitTarget`'s
// containment check but without the trailing-icon zone restriction.
function linkElementFromEvent(event: MouseEvent, root?: HTMLElement): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const linkEl = target.closest<HTMLElement>('.cm-moss-link');
  if (!linkEl || (root && !root.contains(linkEl))) return null;
  return linkEl;
}

// Tracks mouse state on the editor and drives the freeze flag. We listen
// on the content DOM for pointerdown and on the window for pointerup —
// users can release outside the editor after a drag, and we'd miss the
// up event if we listened on the content DOM only.
const freezeMousePlugin = ViewPlugin.fromClass(
  class {
    private down = false;
    private releaseTimer: number | null = null;
    private readonly onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Read-only never reveals, so there's nothing to freeze. Bail
      // before any of the selection/icon plumbing runs.
      if (this.view.state.facet(readOnlyFacet)) return;
      // Only freeze when the pointerdown lands inside the content. The
      // scrollbar (on the outer .cm-scroller) would otherwise engage the
      // freeze too — which keeps decorations stale for the whole drag
      // and the syntax only "pops in" on release. Gesture/wheel scroll
      // doesn't have this issue because it never fires a pointerdown on
      // the scrollbar chrome.
      const target = event.target;
      if (!(target instanceof Node) || !this.view.contentDOM.contains(target)) {
        return;
      }
      if (linkIconHitTarget(event, this.view.contentDOM)) {
        // Let the follow-up click open the link, but stop CM6 from
        // interpreting the icon press as a text-editing click. Without
        // this, pointerdown moves the selection into the Link node and
        // reveals `[label](url)` before the click handler opens it.
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
          // view destroyed while timer was pending.
        }
      }, FREEZE_TAIL_MS);
    };

    constructor(readonly view: EditorView) {
      // Capture-phase listener on view.dom so we dispatch setFrozen(true)
      // BEFORE CM6's own pointerdown handler runs its selection logic.
      // Without capture, CM6's listener can win the order race and
      // rebuild decorations (revealing `# `/`**`) before we freeze.
      view.dom.addEventListener('pointerdown', this.onDown, true);
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onUp);
    }

    update(_: ViewUpdate) {
      // No-op — we don't drive freeze off doc changes.
    }

    destroy() {
      this.view.dom.removeEventListener('pointerdown', this.onDown, true);
      window.removeEventListener('pointerup', this.onUp);
      window.removeEventListener('pointercancel', this.onUp);
      if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer);
    }
  },
);

// decoration building

const LINE_CLASS_BY_BLOCK: Record<string, string> = {
  ATXHeading1: 'cm-moss-h1',
  ATXHeading2: 'cm-moss-h2',
  ATXHeading3: 'cm-moss-h3',
  ATXHeading4: 'cm-moss-h4',
  ATXHeading5: 'cm-moss-h5',
  ATXHeading6: 'cm-moss-h6',
  SetextHeading1: 'cm-moss-h1',
  SetextHeading2: 'cm-moss-h2',
  Blockquote: 'cm-moss-blockquote',
  FencedCode: 'cm-moss-fenced-code',
};

const CODE_COPY_ICON = lucideSvg(Copy, { size: 16 });
const CODE_COPY_SUCCESS_ICON = lucideSvg(Check, { size: 16 });

const HIDEABLE_SYNTAX = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
  'LinkTitle',
  'StrikethroughMark',
  'HighlightMark',
  'QuoteMark',
]);

// Children of a Link node whose visibility follows the link-scoped
// rule (cursor-inside-link) instead of the default line-based rule.
// The same token names can appear under an Image node — those stay
// on the line-based rule because images are a different UX surface.
const LINK_CHILD_SYNTAX = new Set(['LinkMark', 'URL', 'LinkTitle']);

const INLINE_MARK_CLASS: Record<string, string> = {
  StrongEmphasis: 'cm-moss-strong',
  Emphasis: 'cm-moss-em',
  InlineCode: 'cm-moss-inline-code',
  Strikethrough: 'cm-moss-strike',
  Highlight: 'cm-moss-highlight',
  Link: 'cm-moss-link',
};

// A Link can contain two URL nodes when its visible label is itself a
// URL: `[https://label](https://destination)`. Only the node after the
// closing `]` is the destination syntax that should collapse. Treating
// every URL under Link as a destination makes the visible label vanish.
function linkDestinationUrl(link: SyntaxNode, doc: Text): SyntaxNode | null {
  const labelClose = link
    .getChildren('LinkMark')
    .find((mark) => doc.sliceString(mark.from, mark.to) === ']');
  if (!labelClose) return null;
  return (
    link
      .getChildren('URL')
      .find((url) => url.from >= labelClose.to) ?? null
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back to the legacy path below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (document.execCommand('copy')) {
      return;
    }
  } finally {
    textarea.remove();
  }

  throw new Error('Copy failed');
}

function fencedCodeSource(doc: Text, from: number, to: number): string {
  const raw = doc.sliceString(from, to);
  const lines = raw.split('\n');
  if (lines.length < 2) return raw;
  if (!/^ {0,3}(`{3,}|~{3,})/.test(lines[0])) return raw;
  if (!/^ {0,3}(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1])) return raw;
  return lines.slice(1, -1).join('\n');
}

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    // The `.cm-moss-list-marker` class is what forces the
    // uniform 1.2em inline-block alcove shared by bullets, task
    // checkboxes, and ordered-list numbers. `.cm-moss-bullet`
    // layers on bullet-specific color / weight.
    const span = document.createElement('span');
    span.className =
      'cm-moss-list-marker cm-moss-unordered-marker cm-moss-bullet';
    span.textContent = '•';
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const BULLET_WIDGET = new BulletWidget();

class CodeCopyWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }

  private button: HTMLButtonElement | null = null;
  private copiedTimer: number | null = null;

  eq(other: CodeCopyWidget): boolean {
    return other.code === this.code;
  }

  private setCopied(copied: boolean): void {
    if (!this.button) return;
    this.button.classList.toggle('is-copied', copied);
    this.button.innerHTML = copied ? CODE_COPY_SUCCESS_ICON : CODE_COPY_ICON;
    this.button.setAttribute('aria-label', copied ? 'Copied' : 'Copy code');
    this.button.title = copied ? 'Copied' : 'Copy code';
  }

  private clearTimer(): void {
    if (this.copiedTimer != null) {
      window.clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
  }

  private flashCopied(): void {
    this.clearTimer();
    this.setCopied(true);
    this.copiedTimer = window.setTimeout(() => {
      this.copiedTimer = null;
      this.setCopied(false);
    }, 1200);
  }

  toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-moss-code-copy';
    button.innerHTML = CODE_COPY_ICON;
    button.setAttribute('aria-label', 'Copy code');
    button.title = 'Copy code';
    this.button = button;
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const copied = await copyTextToClipboard(this.code)
        .then(() => true)
        .catch(() => false);
      if (copied) {
        this.flashCopied();
      }
    });
    return button;
  }

  destroy(): void {
    this.clearTimer();
    this.button = null;
  }

  ignoreEvent(event: Event): boolean {
    return event.type === 'mousedown' || event.type === 'click';
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    // The `.cm-moss-list-marker` class provides the uniform
    // inline-block alcove shared by bullets, checkboxes, and
    // ordered numbers. We apply it directly to the `<input>` so
    // selectors like `input.cm-moss-task-checkbox` still work
    // (a wrapper span broke a Playwright probe that targets the
    // input by its class).
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.className =
      'cm-moss-list-marker cm-moss-unordered-marker cm-moss-task-checkbox';
    input.setAttribute('contenteditable', 'false');
    input.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    input.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = view.posAtDOM(input);
      if (pos < 0) return;
      const current = view.state.doc.sliceString(pos, pos + 3);
      const next = /\[x\]/i.test(current) ? '[ ]' : '[x]';
      if (current === next) return;
      view.dispatch({ changes: { from: pos, to: pos + 3, insert: next } });
    });
    return input;
  }

  ignoreEvent(event: Event): boolean {
    return event.type === 'mousedown' || event.type === 'click';
  }
}

// ViewPlugin-sourced Decoration.replace ranges are forbidden from
// crossing a line break — CM6 throws "Decorations that replace line
// breaks may not be specified via plugins" at build time. Lezer
// happily emits tokens that do cross line breaks (a LinkTitle /
// Image title "wrapping across\ntwo lines", for instance), so every
// Decoration.replace we push has to be split into per-line segments
// first. The newline between segments stays visible — acceptable
// compromise, and it matches how other markdown editors render these
// uncommon multi-line forms.
function pushReplace(
  ranges: Range<Decoration>[],
  doc: Text,
  from: number,
  to: number,
  spec: Parameters<typeof Decoration.replace>[0] = {},
): void {
  if (from >= to) return;
  const startLine = doc.lineAt(from);
  if (to <= startLine.to) {
    ranges.push(Decoration.replace(spec).range(from, to));
    return;
  }
  // Multi-line: first segment carries the widget (if any) so it
  // renders in place of the opening token; subsequent segments are
  // plain hides. Emitting the widget on every segment would stack
  // duplicates (e.g. a BulletWidget on line 2+ of a wrapped item).
  let cursor = from;
  let firstSegment = true;
  while (cursor < to) {
    const line = doc.lineAt(cursor);
    const segEnd = Math.min(to, line.to);
    if (segEnd > cursor) {
      ranges.push(
        Decoration.replace(firstSegment ? spec : {}).range(cursor, segEnd),
      );
      firstSegment = false;
    }
    cursor = line.to + 1;
  }
}

const LIST_BASE_EM = 0.8;
const LIST_ALCOVE_EM = 1.2;
// Keep the visual step aligned with the existing list indentation contract.
const LIST_LEVEL_EM = 1;

function nearestListItem(node: SyntaxNode | null): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.name === 'ListItem') return current;
  }
  return null;
}

function listItemDepth(item: SyntaxNode): number {
  let depth = 0;
  for (let parent = item.parent; parent; parent = parent.parent) {
    if (parent.name === 'ListItem') depth++;
  }
  return depth;
}

function sameListItem(a: SyntaxNode | null, b: SyntaxNode): boolean {
  return a?.name === 'ListItem' && a.from === b.from && a.to === b.to;
}

function buildInlineDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const ranges: Range<Decoration>[] = [];

  // In read-only mode no line is ever "active" — the whole doc stays
  // rendered (no reveal). We skip the selection walk entirely rather
  // than relying on `hasFocus` staying false, so a programmatic
  // `.focus()` can't accidentally reveal source under reading mode.
  const readOnly = state.facet(readOnlyFacet);
  const activeLines = new Set<number>();
  if (view.hasFocus && !readOnly) {
    for (const r of state.selection.ranges) {
      const firstLine = doc.lineAt(r.from).number;
      const lastLine = doc.lineAt(r.to).number;
      for (let n = firstLine; n <= lastLine; n++) activeLines.add(n);
    }
  }

  // Decorate the whole parsed tree — not the current viewport — so
  // that scrolling never needs to rebuild the decoration set. Prior
  // design walked viewport-only and rebuilt on every scroll, which
  // on iOS caused scroll-up momentum halts whenever new decorations
  // were applied to lines at the top of the viewport (anchor
  // conflict with the scroll animation). Cost: a one-shot whole-doc
  // walk on every doc / selection / focus change instead of a
  // smaller walk on every scroll.
  //
  // `ensureSyntaxTree(..., doc.length, ...)` guarantees the tree
  // actually covers the whole doc before we walk it. Without this,
  // for moderately long atoms the incremental parser's initial
  // pass falls short of the end, we'd walk only a prefix, and
  // content past that point renders as raw `##`/`**` forever —
  // decorations don't rebuild on scroll anymore. Subsequent calls
  // are near-free because ensureSyntaxTree short-circuits once the
  // tree reaches the target.
  const tree =
    ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);

  // `from` positions of Link nodes whose range overlaps a selection.
  // Link children (LinkMark/URL/LinkTitle) hide unless their parent
  // Link's `from` is in this set — i.e. the cursor has entered the
  // link specifically, not merely landed on the same line. Images
  // aren't included because their widget owns the source visibility.
  const activeLinkStarts = new Set<number>();

  // Single pre-order walk. A tree walk visits a parent before its
  // children, which lets us compute two pieces of look-ahead state on
  // the way in — right before the children that depend on them:
  //   - Fenced-code active expansion: clicking any line of a fence
  //     activates the whole block. FencedCode is entered before its
  //     CodeMark/CodeInfo children, so expanding activeLines here means
  //     those children hide/reveal consistently with the block.
  //   - activeLinkStarts: a Link is entered before its LinkMark/URL/
  //     LinkTitle children, so recording it here makes the link-scoped
  //     reveal rule ready when those children are processed.
  // (A previous version ran a separate pre-pass plus a taskMarkerByLine
  // map. Folding both into this one walk halves the per-rebuild tree
  // traversal — meaningful because this runs on every cursor move and
  // its cost scales with document size.)
  tree.iterate({
    enter: (node) => {
      if (node.name === 'FencedCode') {
        const firstLine = doc.lineAt(node.from).number;
        const lastLine = doc.lineAt(node.to).number;
        let anyActive = false;
        for (let n = firstLine; n <= lastLine; n++) {
          if (activeLines.has(n)) {
            anyActive = true;
            break;
          }
        }
        if (anyActive) {
          for (let n = firstLine; n <= lastLine; n++) activeLines.add(n);
        }
        ranges.push(
          Decoration.widget({
            widget: new CodeCopyWidget(fencedCodeSource(doc, node.from, node.to)),
          }).range(doc.line(firstLine).from),
        );
      }
      if (node.name === 'Link' && view.hasFocus) {
        for (const range of state.selection.ranges) {
          // Inclusive overlap: cursor sitting exactly on either
          // boundary counts as inside, matching the UX where the
          // next keystroke affects the link.
          if (range.from <= node.to && range.to >= node.from) {
            activeLinkStarts.add(node.from);
            break;
          }
        }
      }
      if (node.name === 'FencedCode') {
        const firstLine = doc.lineAt(node.from);
        const lastLine = doc.lineAt(node.to);
        for (let n = firstLine.number; n <= lastLine.number; n++) {
          const line = doc.line(n);
          const classes = ['cm-moss-fenced-code'];
          if (n === firstLine.number) classes.push('cm-moss-fenced-code-start');
          if (n === lastLine.number) classes.push('cm-moss-fenced-code-end');
          ranges.push(
            Decoration.line({ class: classes.join(' ') }).range(line.from),
          );
        }
      } else {
        const lineClass = LINE_CLASS_BY_BLOCK[node.name];
        if (lineClass) {
          const firstLine = doc.lineAt(node.from);
          const lastLine = doc.lineAt(node.to);
          for (let n = firstLine.number; n <= lastLine.number; n++) {
            const line = doc.line(n);
            ranges.push(Decoration.line({ class: lineClass }).range(line.from));
          }
        }
      }

      const markClass = INLINE_MARK_CLASS[node.name];
      if (markClass && node.from < node.to) {
        ranges.push(Decoration.mark({ class: markClass }).range(node.from, node.to));
      }

      if (HIDEABLE_SYNTAX.has(node.name) && node.from < node.to) {
        const lineNum = doc.lineAt(node.from).number;

        // Link children use a link-scoped rule (cursor-inside-link)
        // rather than the line-based rule. A LinkMark under an
        // Image node falls through to line-based — images have
        // their own widget UX that the line-based reveal fits.
        let shouldHide: boolean;
        if (LINK_CHILD_SYNTAX.has(node.name)) {
          let parent = node.node.parent;
          while (parent && parent.name !== 'Link' && parent.name !== 'Image') {
            parent = parent.parent;
          }
          if (parent && parent.name === 'Link') {
            shouldHide = !activeLinkStarts.has(parent.from) && !activeLines.has(lineNum);
          } else {
            shouldHide = !activeLines.has(lineNum);
          }
        } else {
          shouldHide = !activeLines.has(lineNum);
        }

        if (shouldHide) {
          let hideTo = node.to;
          if (node.name === 'HeaderMark' || node.name === 'QuoteMark') {
            while (hideTo < doc.length && doc.sliceString(hideTo, hideTo + 1) === ' ') {
              hideTo++;
            }
          }
          pushReplace(ranges, doc, node.from, hideTo);
        }
      }

      if (node.name === 'URL' && node.from < node.to) {
        const parent = node.node.parent;
        if (parent?.name === 'Link') {
          // A URL in the label is visible content. A URL after the
          // closing `]` is destination syntax and follows the existing
          // cursor-inside-this-link reveal rule—not whole-line activity.
          const destination = linkDestinationUrl(parent, doc);
          if (
            destination?.from === node.from &&
            !activeLinkStarts.has(parent.from)
          ) {
            pushReplace(ranges, doc, node.from, node.to);
          }
        } else {
          // Bare GFM URLs and `<https://...>` autolinks are visible
          // content, not syntax. Give them the same styling and icon
          // hit target as explicit links while leaving their text in
          // the document flow on inactive lines.
          ranges.push(
            Decoration.mark({ class: 'cm-moss-link' }).range(
              node.from,
              node.to,
            ),
          );
        }
      }

      // Backslash escapes: `\.`, `\*`, `\(`, etc. RSS-to-markdown
      // converters escape a lot of punctuation defensively, and the
      // backslashes show through as literal chars without preview.
      // Hide just the leading backslash on inactive lines so the
      // escaped character remains visible — mirrors how Obsidian
      // renders escapes. The Escape node spans both characters
      // (`\` + escaped char), so we only replace the first position.
      if (node.name === 'Escape' && node.to - node.from >= 2) {
        const lineNum = doc.lineAt(node.from).number;
        if (!activeLines.has(lineNum)) {
          pushReplace(ranges, doc, node.from, node.from + 1);
        }
      }

      if (node.name === 'ListMark' && node.from < node.to) {
        const line = doc.lineAt(node.from);
        const lineActive = activeLines.has(line.number);
        const markText = doc.sliceString(node.from, node.to);
        const orderedMarker = /^\d{1,9}[.)]$/.test(markText);
        const markEndInLine = node.to - line.from;
        const hasListSeparator =
          markEndInLine < line.text.length &&
          /\s/.test(line.text[markEndInLine] ?? '');

        // Lezer accepts an empty `1.` as an OrderedList so it can parse
        // CommonMark's optional empty item. In the editor, keep that raw
        // punctuation as prose until the user types the separator space.
        if (orderedMarker && !hasListSeparator) return;

        // Detect a task item from the line text. ListMark is visited
        // before the TaskMarker on its line, so a forward single-pass
        // walk can't look the marker position up from a map; the
        // capture group is the `- ` lead-in and its length lands
        // taskFrom exactly on the `[` (matching TaskMarker.from).
        const taskLead = line.text.match(/^(\s*[-*+]\s+)\[[ xX]\]/);
        const taskFrom =
          taskLead != null ? line.from + taskLead[1].length : undefined;

        // Hanging-indent every physical line owned by this list item.
        // Ownership and depth come from the parsed tree, not raw source
        // indentation: CommonMark allows up to three leading spaces on a
        // top-level item, and ordered-list children commonly use a
        // marker-width indent rather than two spaces.
        //
        // Layout:
        //
        //   <--BASE--><--ALCOVE--> first-line text
        //             •            wrapped lines land at the
        //                          same column as the first-line
        //                          text, not back under the marker
        //
        // LIST_ALCOVE_EM is fixed regardless of list kind.
        // Every marker (bullet widget, checkbox widget, ordered
        // number via mark decoration) is forced into an
        // inline-block of exactly that width via CSS — so the
        // alignment math doesn't depend on per-font marker
        // widths. `padding-left` sets the content column;
        // negative `text-indent` of the same magnitude pulls the
        // first line back so the marker lands in the alcove. Structural
        // leading spaces are replaced visually on every owned line;
        // otherwise they would be added on top of the tree-derived
        // padding and ordered/odd indentation would still drift.
        const listItem = nearestListItem(node.node);
        if (listItem) {
          const depth = listItemDepth(listItem);
          const padding =
            LIST_BASE_EM + LIST_ALCOVE_EM + depth * LIST_LEVEL_EM;
          const firstLine = doc.lineAt(listItem.from);
          const lastLine = doc.lineAt(listItem.to);

          for (
            let number = firstLine.number;
            number <= lastLine.number;
            number++
          ) {
            const ownedLine = doc.line(number);
            const contentOffset = ownedLine.text.search(/\S/);
            if (contentOffset < 0) continue;
            const contentFrom = ownedLine.from + contentOffset;
            const owner = nearestListItem(tree.resolve(contentFrom, 1));
            if (!sameListItem(owner, listItem)) continue;

            const markerLine = ownedLine.number === line.number;
            if (!markerLine && contentFrom === ownedLine.from) continue;
            ranges.push(
              Decoration.line({
                attributes: {
                  style: `padding-left: ${padding}em; text-indent: ${
                    markerLine ? `-${LIST_ALCOVE_EM}` : '0'
                  }em`,
                },
              }).range(ownedLine.from),
            );
            if (contentFrom > ownedLine.from) {
              pushReplace(ranges, doc, ownedLine.from, contentFrom);
            }
          }
        }

        if (
          lineActive &&
          (taskFrom !== undefined ||
            markText === '-' ||
            markText === '*' ||
            markText === '+' ||
            orderedMarker)
        ) {
          ranges.push(
            Decoration.mark({
              class: `cm-moss-list-marker ${
                lineActive ? 'cm-moss-list-marker-active ' : ''
              }${
                orderedMarker
                  ? 'cm-moss-ordered-marker'
                  : 'cm-moss-unordered-marker'
              }`,
            }).range(node.from, node.to),
          );
          return;
        }

        // Figure out how far past node.to the mark's trailing
        // space lives. For tasks, CM6 pre-computed taskFrom as
        // the start of the `[ ]`; the `- ` span runs from
        // node.from to taskFrom, which already covers the space.
        // For bullets / ordered, include a single trailing space
        // if present so text flows from padding-left without a
        // spurious leading space.
        const hasTrailingSpace =
          doc.sliceString(node.to, node.to + 1) === ' ';
        const markEnd = hasTrailingSpace ? node.to + 1 : node.to;

        if (taskFrom !== undefined) {
          // Hide `- ` (ListMark through the space before `[`).
          pushReplace(ranges, doc, node.from, taskFrom);
        } else {
          if (markText === '-' || markText === '*' || markText === '+') {
            // Bullet: substitute with the fixed-width marker
            // widget, swallowing the trailing space so content
            // starts precisely at padding-left.
            pushReplace(ranges, doc, node.from, markEnd, { widget: BULLET_WIDGET });
          } else {
            // Ordered list (or anything else with a non-standard
            // mark text like `1.`, `42.`): keep the text visible
            // but mark it so CSS gives it the same fixed-width
            // alcove. On inactive lines, hide the trailing space so
            // the total marker-plus-space footprint matches ALCOVE.
            ranges.push(
              Decoration.mark({
                class: `cm-moss-list-marker ${
                  lineActive ? 'cm-moss-list-marker-active ' : ''
                }${
                  orderedMarker
                    ? 'cm-moss-ordered-marker'
                    : 'cm-moss-unordered-marker'
                }`,
              }).range(
                node.from,
                node.to,
              ),
            );
            if (hasTrailingSpace) {
              pushReplace(ranges, doc, node.to, markEnd);
            }
          }
        }
      }

      // Tables are rendered by the separate `mossTables()` block-widget
      // table feature (./features/table) — the whole Table range is
      // replaced with an interactive HTML `<table>`. Any inline
      // decorations on TableHeader/TableRow/TableDelimiter would
      // target ranges that are already hidden behind the replace
      // widget, so they're intentionally absent from this builder.

      if (node.name === 'HorizontalRule') {
        // CommonMark HR: a line of `***`, `---`, or `___` (3+, any
        // spacing between). On inactive lines we hide the characters
        // and render a horizontal rule via CSS `::after`. On active
        // lines we leave the raw characters visible so the user can
        // edit the marker without it vanishing.
        const line = doc.lineAt(node.from);
        if (!activeLines.has(line.number)) {
          ranges.push(Decoration.line({ class: 'cm-moss-hr' }).range(line.from));
          pushReplace(ranges, doc, line.from, line.to);
        }
      }

      if (node.name === 'Image' && node.from < node.to) {
        // Images stay widget-first even when the editor has focus. Their
        // edit button and widget selection provide the editing affordance,
        // while keeping the raw link hidden avoids a source row appearing
        // above the rendered image.
        //
        // Keep the now-empty source `.cm-line` at its default line-height
        // rather than collapsing it via `display: none`: on iOS Safari,
        // toggling a line from its text-measured height to zero mid-scroll
        // shifts every subsequent line and can halt kinetic momentum.
        pushReplace(ranges, doc, node.from, node.to);
      }

      if (node.name === 'TaskMarker' && node.from < node.to) {
        const markText = doc.sliceString(node.from, node.to);
        const checked = /\[x\]/i.test(markText);
        const lineNum = doc.lineAt(node.from).number;
        if (activeLines.has(lineNum)) return;
        // Swallow the single trailing space after `[ ]` / `[x]` so the
        // checkbox widget owns the alcove exactly (mirrors how bullet
        // markers also swallow their trailing space). Without this the
        // space stays visible, pushing first-line content to the right
        // of where wrapped lines start — visible as a 0.3em hang.
        const hasTrailingSpace =
          node.to < doc.length &&
          doc.sliceString(node.to, node.to + 1) === ' ';
        const replaceTo = hasTrailingSpace ? node.to + 1 : node.to;
        pushReplace(ranges, doc, node.from, replaceTo, {
          widget: new TaskCheckboxWidget(checked),
        });
        if (checked) {
          const line = doc.line(lineNum);
          ranges.push(
            Decoration.line({ class: 'cm-moss-task-done' }).range(line.from),
          );
        }
      }
    },
  });

  // Supplemental inline marks for the line containing the cursor.
  // CommonMark's flanking rules say that `**foo **` is not emphasis
  // because the closing `**` is preceded by whitespace — lezer
  // agrees and doesn't emit `StrongEmphasis`, so the walk above
  // misses it. Result: while the user types a sentence inside
  // `**...**`, the bold styling flicks on and off every time they
  // hit the spacebar. We patch the UX by scanning the active line
  // for matched delimiter pairs the cursor sits between and
  // emitting the mark ourselves regardless of flanking. Once the
  // cursor leaves, lezer's opinion wins and the visual reverts to
  // what will actually persist when the line is serialized.
  if (view.hasFocus) {
    const head = state.selection.main.head;
    const line = doc.lineAt(head);
    if (activeLines.has(line.number)) {
      supplementMidTypingEmphasis(
        line.text,
        line.from,
        head - line.from,
        ranges,
      );
    }
  }

  return Decoration.set(ranges, true);
}

// Delimiters we emit supplemental marks for, longest first so `**`
// is matched before `*` and `__` before `_`. Backticks don't need
// this treatment — CommonMark inline code isn't subject to
// flanking rules. Each entry carries both the content class (what
// lezer would style via `t.strong` / `t.emphasis` / `t.strikethrough`)
// and the delimiter class (matches how the EmphasisMark token
// renders when lezer *does* parse: parent tag's weight / style /
// decoration plus `processingInstruction`'s faint color).
const MID_TYPING_DELIMITERS: readonly {
  delim: string;
  contentCls: string;
  delimCls: string;
}[] = [
  { delim: '**', contentCls: 'cm-moss-strong', delimCls: 'cm-moss-strong-mark' },
  { delim: '__', contentCls: 'cm-moss-strong', delimCls: 'cm-moss-strong-mark' },
  { delim: '~~', contentCls: 'cm-moss-strike', delimCls: 'cm-moss-strike-mark' },
  { delim: '==', contentCls: 'cm-moss-highlight', delimCls: 'cm-moss-highlight-mark' },
  { delim: '*', contentCls: 'cm-moss-em', delimCls: 'cm-moss-em-mark' },
  { delim: '_', contentCls: 'cm-moss-em', delimCls: 'cm-moss-em-mark' },
];

function supplementMidTypingEmphasis(
  text: string,
  lineFrom: number,
  localCursor: number,
  out: Range<Decoration>[],
): void {
  // Track which characters of the line are already "owned" by a
  // matched delimiter pair so a single-char delimiter doesn't
  // accidentally pair halves of two different double-delimiter
  // spans.
  const consumed = new Uint8Array(text.length);

  for (const { delim, contentCls, delimCls } of MID_TYPING_DELIMITERS) {
    const dLen = delim.length;
    // Underscore emphasis (`_`, `__`) doesn't open intra-word under
    // CommonMark's flanking rules — `snake_case_var` is not italic.
    // Without this guard the supplement would flash false italic while
    // the cursor sits between two intra-word underscores (exactly the
    // flicker this feature exists to prevent, inverted). Asterisk
    // delimiters have no such restriction, so only gate underscores.
    const isUnderscore = delim === '_' || delim === '__';
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const open = indexOfUnconsumed(text, delim, searchFrom, consumed);
      if (open < 0) break;
      if (isUnderscore && open > 0 && /\w/.test(text[open - 1])) {
        searchFrom = open + dLen;
        continue;
      }
      const close = indexOfUnconsumed(text, delim, open + dLen, consumed);
      if (close < 0) break;

      for (let i = open; i < close + dLen; i++) consumed[i] = 1;

      const contentFrom = open + dLen;
      const contentTo = close;
      if (
        contentFrom < contentTo &&
        localCursor > open &&
        localCursor < close + dLen
      ) {
        out.push(
          Decoration.mark({ class: contentCls }).range(
            lineFrom + contentFrom,
            lineFrom + contentTo,
          ),
        );
        // Style the delimiter characters to match how lezer's
        // `EmphasisMark` tokens render when the pattern parses
        // cleanly. Lezer tags `EmphasisMark` with both its parent
        // (`strong` / `emphasis` / `strikethrough`) and
        // `processingInstruction`, so the `**` characters get
        // faint color AND the parent's weight / style / decoration
        // — we mirror all of that here so the delimiters don't
        // flip style / size / color when the cursor moves or a
        // trailing space triggers / untriggers lezer's parse.
        out.push(
          Decoration.mark({ class: delimCls }).range(
            lineFrom + open,
            lineFrom + contentFrom,
          ),
        );
        out.push(
          Decoration.mark({ class: delimCls }).range(
            lineFrom + contentTo,
            lineFrom + close + dLen,
          ),
        );
      }

      searchFrom = close + dLen;
    }
  }
}

function indexOfUnconsumed(
  text: string,
  needle: string,
  from: number,
  consumed: Uint8Array,
): number {
  let i = from;
  while (i <= text.length - needle.length) {
    const found = text.indexOf(needle, i);
    if (found < 0) return -1;
    let isConsumed = false;
    for (let k = found; k < found + needle.length; k++) {
      if (consumed[k]) {
        isConsumed = true;
        break;
      }
    }
    if (!isConsumed) return found;
    i = found + 1;
  }
  return -1;
}

const inlinePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildInlineDecorations(view);
    }

    update(update: ViewUpdate) {
      const prevFrozen = update.startState.field(previewFrozenField);
      const nextFrozen = update.state.field(previewFrozenField);
      const justUnfroze = prevFrozen && !nextFrozen;
      const composingTransaction = update.transactions.some((tr) =>
        tr.isUserEvent('input.type.compose'),
      );

      if (
        update.docChanged &&
        (composingTransaction ||
          update.view.composing)
      ) {
        this.decorations = this.decorations.map(update.changes);
        return;
      }

      // A doc change is unambiguous edit intent, so rebuild even while
      // frozen. Returning the stale (pre-edit) decoration set here would
      // hand CM6 ranges whose positions no longer match the document: a
      // hidden `## ` replace can end up spanning the newly-typed text's
      // line break ("Decorations that replace line breaks may not be
      // specified via plugins"), and the stale positions corrupt the
      // heightmap ("No tile at position …" → broken scrollIntoView). The
      // freeze only needs to suppress the *selection*-driven reveal that
      // makes a click jitter; typing should reveal syntax as normal.
      if (nextFrozen && !justUnfroze && !update.docChanged) return;

      // Tree-growth effect: background parser advanced past where
      // we last walked. For docs large enough that the initial
      // parse didn't reach the end, later blocks (headings, lists,
      // etc.) render as raw `##`/`**` until this fires.
      let treeGrew = false;
      let forceRefresh = false;
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(refreshInlinePreview)) {
            forceRefresh = true;
            break;
          }
          if (effect.is(treeGrowthEffect)) {
            treeGrew = true;
            break;
          }
        }
        if (treeGrew) break;
      }

      // Note: `update.viewportChanged` is intentionally NOT in this
      // list. Scrolling alone must not rebuild decorations — doing
      // so on iOS halts momentum whenever the rebuild produces new
      // decorations for lines at the top of a scroll-up viewport
      // (CM6 anchor conflict with the scroll animation). Walking
      // the whole parsed tree on the remaining triggers means
      // scroll-time cost is zero; the tree walk itself is
      // single-digit ms for typical atoms.
      // A read-only toggle (compartment reconfigure) changes neither
      // doc nor selection nor focus, so detect the facet flip directly
      // — otherwise reading mode wouldn't repaint into / out of the
      // fully-rendered state.
      const readOnlyChanged =
        update.startState.facet(readOnlyFacet) !==
        update.state.facet(readOnlyFacet);

      if (
        forceRefresh ||
        justUnfroze ||
        update.docChanged ||
        update.selectionSet ||
        update.focusChanged ||
        treeGrew ||
        readOnlyChanged
      ) {
        this.decorations = buildInlineDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      compositionstart(_event, view) {
        view.dispatch({ effects: refreshInlinePreview.of() });
        return false;
      },
      compositionend(_event, view) {
        setTimeout(() => {
          view.dispatch({ effects: refreshInlinePreview.of() });
        }, 0);
      },
    },
  },
);

// CM6's drawSelection layer intentionally sits behind `.cm-content`. That is
// normally ideal—the rectangle is behind the glyphs—but an opaque fenced-code
// line background also sits between the layer and the glyphs, hiding the
// selection completely. Mirror only the selected portions of FencedCode as
// inline marks so their background paints above the block and below its text.
// This plugin stays separate from inlinePreviewPlugin because mouse selection
// must repaint live even while preview decorations are frozen for click-jitter
// prevention.
function fencedCodeSelectionDecorations(view: EditorView): DecorationSet {
  const selections = view.state.selection.ranges.filter((range) => !range.empty);
  if (selections.length === 0) return Decoration.none;

  const ranges: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  for (const selection of selections) {
    // Selection updates can arrive for every pointermove. Restrict the walk to
    // the selected range so dragging within a short code sample stays O(range)
    // instead of walking an entire long document on every event.
    tree.iterate({
      from: selection.from,
      to: selection.to,
      enter(node) {
        if (node.name !== 'FencedCode') return;
        const from = Math.max(node.from, selection.from);
        const to = Math.min(node.to, selection.to);
        if (from < to) {
          ranges.push(
            Decoration.mark({ class: 'cm-moss-fenced-selection' }).range(from, to),
          );
        }
        return false;
      },
    });
  }
  return Decoration.set(ranges, true);
}

const fencedCodeSelectionPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = fencedCodeSelectionDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = fencedCodeSelectionDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

// Tight-continuation Enter for markdown lists.
//
// Why we override the default: @codemirror/lang-markdown's
// `insertNewlineContinueMarkup` uses the syntax tree to decide whether a
// list is "loose" (blank lines between items) and, if so, inserts a
// blank line as part of the continuation. That inference bleeds in when
// you start a new list adjacent to an existing one — lezer sees both as
// siblings in a loose list, and the new item sprouts a blank line the
// user didn't intend. In our inline-preview mode loose vs tight lists
// look identical anyway, so we always continue tight.
interface ListLinePrefix {
  indent: string;
  marker: string;
  markerFrom: number;
  markerTo: number;
  ordered: boolean;
  number: number | null;
  delimiter: '.' | ')' | null;
  taskPrefix: string | null;
  content: string;
}

const LIST_INDENT_COLUMNS = 4;
const renumberOrderedListsAnnotation = Annotation.define<boolean>();

function parseListLine(lineText: string, lineFrom: number): ListLinePrefix | null {
  const match = lineText.match(/^(\s*)([-*+]|\d{1,9}[.)])(\s+)/);
  if (!match) return null;

  const [, indent, marker] = match;
  const orderedMatch = marker.match(/^(\d{1,9})([.)])$/);
  const rest = lineText.slice(match[0].length);
  const taskMatch = rest.match(/^(\[[ xX]\]\s*)/);

  return {
    indent,
    marker,
    markerFrom: lineFrom + indent.length,
    markerTo: lineFrom + indent.length + marker.length,
    ordered: orderedMatch != null,
    number: orderedMatch ? Number.parseInt(orderedMatch[1], 10) : null,
    delimiter: orderedMatch ? (orderedMatch[2] as '.' | ')') : null,
    taskPrefix: taskMatch?.[0] ?? null,
    content: rest.slice(taskMatch?.[0].length ?? 0),
  };
}

function orderedMarker(number: number, delimiter: '.' | ')' | null): string {
  return `${number}${delimiter ?? '.'}`;
}

function continuationFor(prefix: ListLinePrefix, nextNumber?: number): string {
  const marker = prefix.ordered
    ? orderedMarker(nextNumber ?? (prefix.number ?? 0) + 1, prefix.delimiter)
    : prefix.marker;
  return `${prefix.indent}${marker} ${prefix.taskPrefix ? '[ ] ' : ''}`;
}

function indentedOrderedNumber(
  doc: Text,
  lineNumber: number,
  newIndentLength: number,
): number {
  const previous = previousListPrefixAtIndent(
    doc,
    lineNumber - 1,
    newIndentLength,
    true,
  );
  return (previous?.number ?? 0) + 1;
}

function previousListPrefixAtIndent(
  doc: Text,
  beforeLine: number,
  indentLength: number,
  ordered: boolean,
): ListLinePrefix | null {
  for (let number = beforeLine; number >= 1; number--) {
    const line = doc.line(number);
    const prefix = parseListLine(line.text, line.from);
    if (!prefix) continue;
    if (prefix.indent.length === indentLength && prefix.ordered === ordered) {
      return prefix;
    }
    if (prefix.indent.length < indentLength) break;
  }
  return null;
}

function previousListPrefix(
  doc: Text,
  beforeLine: number,
): ListLinePrefix | null {
  for (let number = beforeLine; number >= 1; number--) {
    const line = doc.line(number);
    const prefix = parseListLine(line.text, line.from);
    if (prefix) return prefix;
    if (line.text.trim() && line.text.search(/\S/) <= 0) return null;
  }
  return null;
}

function nearestOuterListPrefix(
  doc: Text,
  beforeLine: number,
  indentLength: number,
): ListLinePrefix | null {
  let best: ListLinePrefix | null = null;
  for (let number = beforeLine; number >= 1; number--) {
    const line = doc.line(number);
    const prefix = parseListLine(line.text, line.from);
    if (!prefix || prefix.indent.length >= indentLength) continue;
    if (!best || prefix.indent.length > best.indent.length) best = prefix;
    if (best.indent.length === 0) break;
  }
  return best;
}

function listItemLineRange(
  doc: Text,
  startLineNumber: number,
  indentLength: number,
): { from: number; to: number } {
  let endLineNumber = startLineNumber;
  for (let number = startLineNumber + 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    if (!line.text.trim()) {
      endLineNumber = number;
      continue;
    }

    const prefix = parseListLine(line.text, line.from);
    const leading = line.text.search(/\S/);
    if (
      (prefix && prefix.indent.length <= indentLength) ||
      (!prefix && leading >= 0 && leading <= indentLength)
    ) {
      break;
    }
    endLineNumber = number;
  }

  return {
    from: doc.line(startLineNumber).from,
    to: doc.line(endLineNumber).to,
  };
}

function nextOuterListNumber(
  doc: Text,
  beforeLine: number,
  targetIndentLength: number,
): number {
  const previous = previousListPrefixAtIndent(
    doc,
    beforeLine,
    targetIndentLength,
    true,
  );
  return (previous?.number ?? 0) + 1;
}

function isLineInsideMarkdownCode(state: EditorView['state'], lineNumber: number): boolean {
  const line = state.doc.line(lineNumber);
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, -1);
    node;
    node = node.parent
  ) {
    if (node.name === 'CodeBlock' || node.name === 'FencedCode') return true;
  }
  return false;
}

export function orderedListRenumberChanges(
  state: EditorView['state'],
): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  const expectedByIndent = new Map<number, number>();

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
    const line = state.doc.line(lineNumber);
    const prefix = parseListLine(line.text, line.from);
    const leading = line.text.search(/\S/);

    if (prefix?.ordered && !isLineInsideMarkdownCode(state, lineNumber)) {
      for (const indent of [...expectedByIndent.keys()]) {
        if (indent > prefix.indent.length) expectedByIndent.delete(indent);
      }

      const expected =
        expectedByIndent.get(prefix.indent.length) ?? prefix.number ?? 1;
      if (prefix.number !== expected) {
        changes.push({
          from: prefix.markerFrom,
          to: prefix.markerFrom + String(prefix.number ?? '').length,
          insert: String(expected),
        });
      }
      expectedByIndent.set(prefix.indent.length, expected + 1);
      continue;
    }

    if (!line.text.trim()) continue;

    const contentIndent = leading < 0 ? 0 : leading;
    for (const indent of [...expectedByIndent.keys()]) {
      if (indent >= contentIndent) expectedByIndent.delete(indent);
    }
  }

  return changes;
}

export function renumberOrderedLists(view: EditorView): boolean {
  let changed = false;
  for (let pass = 0; pass < 5; pass++) {
    const changes = orderedListRenumberChanges(view.state);
    if (changes.length === 0) return changed;
    view.dispatch({
      changes,
      annotations: renumberOrderedListsAnnotation.of(true),
    });
    changed = true;
  }
  return changed;
}

const orderedListRenumberPlugin = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;

    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      if (update.transactions.some((tr) => tr.annotation(renumberOrderedListsAnnotation))) {
        return;
      }
      if (update.transactions.some((tr) => tr.isUserEvent('input.type.compose'))) {
        return;
      }
      if (update.view.composing) return;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        if (update.view.composing) return;
        renumberOrderedLists(update.view);
      }, 0);
    }

    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
    }
  },
);

export function insertTightListItem(view: EditorView): boolean {
  if (view.composing) return false;

  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const from = sel.from;
  const line = state.doc.lineAt(from);
  const lineText = state.doc.sliceString(line.from, line.to);
  const prefix = parseListLine(lineText, line.from);
  if (!prefix || isLineInsideMarkdownCode(state, line.number)) return false;

  const tree = syntaxTree(state);
  let cursor = tree.resolveInner(from, -1).cursor();
  let inList = false;
  for (;;) {
    if (cursor.name === 'BulletList' || cursor.name === 'OrderedList') {
      inList = true;
      break;
    }
    if (!cursor.parent()) break;
  }
  // The parser can briefly lag behind a just-edited list line. The raw
  // prefix is authoritative here, so a valid `2. ` line still gets list
  // continuation behavior during that short window.
  if (!inList) inList = prefix.ordered || prefix.marker.length > 0;
  if (!inList) return false;

  if (!prefix.content.trim()) {
    if (prefix.indent.length > 0) {
      const outer = nearestOuterListPrefix(
        state.doc,
        line.number - 1,
        prefix.indent.length,
      );
      const outerIndent = outer?.indent ?? '';
      const marker = prefix.ordered
        ? orderedMarker(
            nextOuterListNumber(
              state.doc,
              line.number - 1,
              outerIndent.length,
            ),
            prefix.delimiter,
          )
        : prefix.marker;
      const replacement = `${outerIndent}${marker} ${
        prefix.taskPrefix ? '[ ] ' : ''
      }`;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: replacement },
        selection: EditorSelection.cursor(line.from + replacement.length),
      });
    } else {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: '' },
        selection: EditorSelection.cursor(line.from),
      });
    }
    return true;
  }

  const continuation = continuationFor(prefix);
  const insert = `\n${continuation}`;
  view.dispatch({
    changes: { from, to: from, insert },
    selection: EditorSelection.cursor(from + insert.length),
  });
  return true;
}

export function indentListItem(view: EditorView): boolean {
  if (view.composing) return false;

  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;

  const line = state.doc.lineAt(sel.from);
  const prefix = parseListLine(line.text, line.from);
  if (!prefix) return false;

  const previous = previousListPrefix(state.doc, line.number - 1);
  if (!previous) return false;

  const addedIndent = ' '.repeat(LIST_INDENT_COLUMNS);
  const newIndentLength = prefix.indent.length + addedIndent.length;
  const range = listItemLineRange(state.doc, line.number, prefix.indent.length);
  const changes: { from: number; to?: number; insert?: string }[] = [];
  let selectionDelta = addedIndent.length;

  for (
    let number = state.doc.lineAt(range.from).number;
    number <= state.doc.lineAt(range.to).number;
    number++
  ) {
    const itemLine = state.doc.line(number);
    if (number === line.number && prefix.ordered) {
      const nextNumber = indentedOrderedNumber(
        state.doc,
        line.number,
        newIndentLength,
      );
      const nextMarker = orderedMarker(nextNumber, prefix.delimiter);
      selectionDelta = addedIndent.length + nextMarker.length - prefix.marker.length;
      changes.push({
        from: itemLine.from,
        to: prefix.markerTo,
        insert:
          prefix.indent +
          addedIndent +
          nextMarker,
      });
    } else {
      changes.push({ from: itemLine.from, insert: addedIndent });
    }
  }

  view.dispatch({
    changes,
    selection: EditorSelection.cursor(sel.from + selectionDelta),
  });
  return true;
}

export function dedentListItem(view: EditorView): boolean {
  if (view.composing) return false;

  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;

  const line = state.doc.lineAt(sel.from);
  const prefix = parseListLine(line.text, line.from);
  if (!prefix || prefix.indent.length === 0) return false;

  const outer = nearestOuterListPrefix(
    state.doc,
    line.number - 1,
    prefix.indent.length,
  );
  const targetIndentLength = outer?.indent.length ?? 0;
  const removeLength = prefix.indent.length - targetIndentLength;
  if (removeLength <= 0) return false;

  const range = listItemLineRange(state.doc, line.number, prefix.indent.length);
  const changes: { from: number; to?: number; insert?: string }[] = [];

  for (
    let number = state.doc.lineAt(range.from).number;
    number <= state.doc.lineAt(range.to).number;
    number++
  ) {
    const itemLine = state.doc.line(number);
    let removeTo = itemLine.from;
    while (
      removeTo < itemLine.to &&
      removeTo < itemLine.from + removeLength &&
      state.doc.sliceString(removeTo, removeTo + 1) === ' '
    ) {
      removeTo++;
    }
    if (removeTo > itemLine.from) {
      changes.push({ from: itemLine.from, to: removeTo, insert: '' });
    }
  }

  if (prefix.ordered) {
    changes.push({
      from: prefix.markerFrom,
      to: prefix.markerTo,
      insert: orderedMarker(
        nextOuterListNumber(
          state.doc,
          line.number - 1,
          targetIndentLength,
        ),
        prefix.delimiter,
      ),
    });
  }

  view.dispatch({
    changes,
    selection: EditorSelection.cursor(Math.max(line.from, sel.from - removeLength)),
  });
  return true;
}

function makeLinkClickHandler(onLinkClick: (url: string) => void): Extension {
  return EditorView.domEventHandlers({
    click: (event, view) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
      if (event.button !== 0) return false;
      // In read-only mode there's no editable link text to protect, so
      // a click anywhere on the link opens it. In edit mode the open
      // affordance stays scoped to the trailing icon hit-zone so the
      // text itself remains clickable-to-edit.
      const linkEl = view.state.facet(readOnlyFacet)
        ? linkElementFromEvent(event, view.contentDOM)
        : linkIconHitTarget(event, view.contentDOM);
      if (!linkEl) return false;

      const pos = view.posAtDOM(linkEl);
      if (pos < 0) return false;

      const tree = syntaxTree(view.state);
      let node: SyntaxNode | null = tree.resolveInner(pos, 1);
      let visibleUrl: SyntaxNode | null = null;
      while (node && node.name !== 'Link') {
        if (node.name === 'URL') visibleUrl = node;
        node = node.parent;
      }
      const urlNode = node
        ? linkDestinationUrl(node, view.state.doc)
        : visibleUrl;
      if (!urlNode) return false;

      const url = view.state.doc.sliceString(urlNode.from, urlNode.to);
      if (!url) return false;

      event.preventDefault();
      event.stopPropagation();
      onLinkClick(url);
      return true;
    },
  });
}

/**
 * Assemble the inline-preview extension set. Call once per editor and
 * include the result in your EditorState `extensions` list. Accepts an
 * `onLinkClick` callback so consumers can route link opens through
 * their platform's external-URL mechanism (Tauri IPC, Capacitor
 * browser, etc.) instead of the default `window.open`.
 */
export function inlinePreview(config: InlinePreviewConfig = {}): Extension {
  const { onLinkClick = defaultOnLinkClick } = config;
  return [
    previewFrozenField,
    inlinePreviewPlugin,
    fencedCodeSelectionPlugin,
    orderedListRenumberPlugin,
    freezeMousePlugin,
    treeProgressPlugin,
    makeLinkClickHandler(onLinkClick),
    // Prec.highest to beat @codemirror/lang-markdown's own Enter
    // handler, which is registered internally by the `markdown()`
    // extension (not just via the exported markdownKeymap) and
    // otherwise wins precedence.
    Prec.highest(
      keymap.of([
        { key: 'Enter', run: insertTightListItem },
        { key: 'Backspace', run: deleteEmptyOrderedListMarkerBackward },
        { key: 'Tab', run: indentListItem },
        { key: 'Shift-Tab', run: dedentListItem },
      ]),
    ),
  ];
}

export const mossInlinePreview = inlinePreview;
