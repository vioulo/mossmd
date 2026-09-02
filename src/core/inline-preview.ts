import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
  type Extension,
  type Range,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { treeGrowthEffect, treeProgressPlugin } from './tree-progress';
import { readOnlyFacet } from './read-only';
import { pushReplace } from './decoration-utils';
import {
  defaultOnLinkClick,
  getPreviewActivity,
  linkElementFromEvent,
  linkIconHitTarget,
  previewActivityExtension,
  previewFrozenField,
  refreshInlinePreview,
  shouldRevealTaskSource,
} from './preview-activity';
import {
  BULLET_WIDGET,
  CodeCopyWidget,
  fencedCodeSource,
  parseListTaskMarker,
  taskCheckboxConfigFacet,
  TaskCheckboxWidget,
  shouldUseNativeTaskCheckbox,
  type MossTaskCheckboxStatus,
} from './preview-widgets';
import { listEditingExtension } from './list-editing';
import { listNavigationExtension } from './list-navigation';
import { isLineInsideMarkdownCode } from './markdown-context';

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
  /**
   * Maps the status inside a task marker to its rendered icon and label.
   * The built-in statuses can be overridden, and additional statuses can be
   * added by consumers.
   */
  taskCheckboxes?: Partial<Record<string, MossTaskCheckboxStatus>>;
}

export type MossInlinePreviewConfig = InlinePreviewConfig;

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

function isWikiLinkNode(
  node: { name: string; from: number; to: number },
  doc: Text,
): boolean {
  // Wiki links are parsed by the Markdown grammar as ordinary Link nodes
  // whose range starts at the second `[` and ends at the first `]`. Their
  // feature decoration owns both brackets and the cursor-scoped reveal.
  // Letting this generic link pass also makes hidden wiki syntax participate
  // in the DOM position mapping twice, which can map a click in following
  // prose to the previous link's `]|]` boundary.
  return (
    node.name === 'Link' &&
    node.from > 0 &&
    node.to < doc.length &&
    doc.sliceString(node.from - 1, node.from + 1) === '[[' &&
    doc.sliceString(node.to - 1, node.to + 1) === ']]'
  );
}

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
  const { activeLines: initialActiveLines } = getPreviewActivity(view);
  const activeLines = new Set(initialActiveLines);

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
  const taskConfig = state.facet(taskCheckboxConfigFacet);

  // `from` positions of Link nodes whose range overlaps a selection.
  // Link children (LinkMark/URL/LinkTitle) hide unless their parent
  // Link's `from` is in this set — i.e. the cursor has entered or is
  // immediately beside the link, not merely landed on the same line.
  // Images aren't included because their widget owns the source visibility.
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
      // GFM parses custom task markers such as `[!]` and `[/]` as
      // shortcut links. They are task UI, not links: skip the synthetic
      // Link node so it cannot add a link icon or hide its source using
      // link-scoped reveal rules.
      if (node.name === 'Link') {
        if (isWikiLinkNode(node, doc)) return false;
        const line = doc.lineAt(node.from);
        const taskInfo = parseListTaskMarker(line.text, taskConfig);
        if (
          taskInfo &&
          !isLineInsideMarkdownCode(state, line.number) &&
          node.from === line.from + taskInfo.markerFrom &&
          node.to === line.from + taskInfo.markerTo
        ) {
          return false;
        }
      }
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

        // Link children use a link-scoped rule rather than the
        // line-based rule. A LinkMark under an Image node falls
        // through to line-based — images have their own widget UX.
        let shouldHide: boolean;
        if (LINK_CHILD_SYNTAX.has(node.name)) {
          let parent = node.node.parent;
          while (parent && parent.name !== 'Link' && parent.name !== 'Image') {
            parent = parent.parent;
          }
          if (parent && parent.name === 'Link') {
            shouldHide = !activeLinkStarts.has(parent.from);
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
          // closing `]` is destination syntax and follows the same
          // cursor-inside-or-beside-this-link reveal rule.
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

        // Detect task status from the raw line because the Markdown parser
        // only knows the standard `[ ]` / `[x]` pair. This also lets the
        // widget replace custom statuses before their source reaches the
        // normal inline decoration pass.
        const taskInfo = parseListTaskMarker(line.text, taskConfig);
        const standardTask =
          taskInfo != null && (taskInfo.key === ' ' || taskInfo.key === 'x');
        const revealTaskSource =
          taskInfo != null && shouldRevealTaskSource(view, line.from, taskInfo);

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
          (markText === '-' ||
            markText === '*' ||
            markText === '+' ||
            orderedMarker) &&
          // Task markers are rendered by the task-specific branches below.
          // Only keep the raw list marker when the task source is actually
          // being revealed; otherwise replacing just TaskMarker would leave
          // the default `- ` visible while custom statuses replace the full
          // list prefix and marker together.
          (taskInfo == null || revealTaskSource)
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
        // space lives. For standard tasks, the `- ` span runs from
        // node.from to the task marker, which is handled by the
        // TaskMarker node below. Custom statuses are handled here
        // because they are not represented by a parser TaskMarker.
        // For bullets / ordered, include a single trailing space
        // if present so text flows from padding-left without a
        // spurious leading space.
        const hasTrailingSpace =
          doc.sliceString(node.to, node.to + 1) === ' ';
        const markEnd = hasTrailingSpace ? node.to + 1 : node.to;

        if (taskInfo != null && !standardTask) {
          pushReplace(ranges, doc, node.from, line.from + taskInfo.markerTo, {
            widget: new TaskCheckboxWidget(
              taskInfo.key,
              taskInfo.raw,
              taskInfo.status,
              line.from + taskInfo.markerFrom,
              false,
            ),
          });
          if (taskInfo.separator.length > 0) {
            pushReplace(
              ranges,
              doc,
              line.from + taskInfo.markerTo,
              line.from + taskInfo.markerTo + taskInfo.separator.length,
            );
          }
          if (taskInfo.status.completed) {
            ranges.push(
              Decoration.line({ class: 'cm-moss-task-done' }).range(line.from),
            );
          }
        } else if (taskInfo != null) {
          // Hide `- ` (ListMark through the space before `[`).
          pushReplace(ranges, doc, node.from, line.from + taskInfo.markerFrom);
        } else {
          if (markText === '-' || markText === '*' || markText === '+') {
            // Bullet: substitute with the fixed-width marker
            // widget, swallowing the trailing space so content
            // starts precisely at padding-left.
            pushReplace(ranges, doc, node.from, markEnd, { widget: BULLET_WIDGET });
          } else {
            // Ordered list (or anything else with a non-standard
            // mark text like `1.`, `42.`): keep both the marker and
            // its source separator visible. The separator is part of
            // the editable Markdown geometry and must not be replaced
            // on inactive lines, otherwise activating the line changes
            // the content column by a sub-pixel amount.
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
        const lineNum = doc.lineAt(node.from).number;
        const line = doc.line(lineNum);
        const taskInfo = parseListTaskMarker(line.text, taskConfig);
        if (!taskInfo) return;
        if (shouldRevealTaskSource(view, line.from, taskInfo)) return;
        // Keep the marker and its separator as separate atomic ranges. If
        // they are combined, ArrowLeft from the first body character skips
        // to the start of the whole widget; after the source is revealed the
        // caret then appears before `[x]` instead of after it. A separate
        // hidden separator lets the caret stop at markerTo, which is the
        // `- [x]| text` editing position, while preserving the fixed alcove
        // width in preview mode.
        const hasTrailingSpace =
          node.to < doc.length &&
          doc.sliceString(node.to, node.to + 1) === ' ';
        pushReplace(ranges, doc, node.from, node.to, {
          widget: new TaskCheckboxWidget(
            taskInfo.key,
            taskInfo.raw,
            taskInfo.status,
            node.from,
            shouldUseNativeTaskCheckbox(taskInfo.key, taskConfig),
          ),
        });
        if (hasTrailingSpace) {
          pushReplace(ranges, doc, node.to, node.to + 1);
        }
        if (taskInfo.status.completed) {
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
    taskCheckboxConfigFacet.of(config.taskCheckboxes ?? {}),
    previewActivityExtension(),
    inlinePreviewPlugin,
    fencedCodeSelectionPlugin,
    listEditingExtension(),
    listNavigationExtension(),
    treeProgressPlugin,
    makeLinkClickHandler(onLinkClick),
  ];
}

export const mossInlinePreview = inlinePreview;

export {
  dedentListItem,
  indentListItem,
  insertTightListItem,
  orderedListRenumberChanges,
  renumberOrderedLists,
} from './list-editing';
export type { MossTaskCheckboxStatus } from './preview-widgets';
export { defaultOnLinkClick, setFrozen } from './preview-activity';
