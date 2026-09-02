import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  Prec,
  RangeSet,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  Direction,
  EditorView,
  ViewPlugin,
  keymap,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { treeGrowthEffect } from './tree-progress';
import { listContentStart } from './list-model';

const LIST_STRUCTURE_DECORATION = Decoration.replace({});

function nearestListItem(node: SyntaxNode | null): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.name === 'ListItem') return current;
  }
  return null;
}

function sameListItem(a: SyntaxNode | null, b: SyntaxNode): boolean {
  return a?.name === 'ListItem' && a.from === b.from && a.to === b.to;
}

function buildListStructureAtoms(view: EditorView) {
  const { state } = view;
  const { doc } = state;
  const tree =
    ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const ranges: Range<typeof LIST_STRUCTURE_DECORATION>[] = [];

  tree.iterate({
    enter: (node) => {
      if (node.name !== 'ListMark' || node.from >= node.to) return;

      const listItem = nearestListItem(node.node);
      if (!listItem) return;

      const firstLine = doc.lineAt(listItem.from);
      const lastLine = doc.lineAt(listItem.to);
      for (
        let number = firstLine.number;
        number <= lastLine.number;
        number++
      ) {
        const line = doc.line(number);
        const contentOffset = line.text.search(/\S/);
        if (contentOffset <= 0) continue;

        const contentFrom = line.from + contentOffset;
        const owner = nearestListItem(tree.resolve(contentFrom, 1));
        if (!sameListItem(owner, listItem)) continue;

        ranges.push(LIST_STRUCTURE_DECORATION.range(line.from, contentFrom));
      }
    },
  });

  return RangeSet.of(ranges, true);
}

const listStructurePlugin = ViewPlugin.fromClass(
  class {
    ranges: ReturnType<typeof buildListStructureAtoms>;

    constructor(view: EditorView) {
      this.ranges = buildListStructureAtoms(view);
    }

    update(update: ViewUpdate) {
      let treeGrew = false;
      for (const tr of update.transactions) {
        if (tr.effects.some((effect) => effect.is(treeGrowthEffect))) {
          treeGrew = true;
          break;
        }
      }
      if (update.docChanged || treeGrew) {
        this.ranges = buildListStructureAtoms(update.view);
      }
    }
  },
);

function skipListStructure(
  view: EditorView,
  position: number,
  forward: boolean,
): number {
  const plugin = view.plugin(listStructurePlugin);
  if (!plugin) return position;

  let result = position;
  plugin.ranges.between(
    Math.max(0, position - 1),
    Math.min(view.state.doc.length, position + 1),
    (from, to) => {
      // A replace decoration collapses the entire structural indent to one
      // visual point. Treat entering it from the preceding line as entering
      // the atom, otherwise rightward movement still visits invisible indent
      // positions one keypress at a time.
      if (
        (forward && result >= from && result < to) ||
        (!forward && result > from && result < to)
      ) {
        // Keep the marker's left boundary editable. When moving left from
        // that boundary, cross the hidden indent and its line break so the
        // caret lands on the previous line rather than over the marker.
        result = forward ? to : Math.max(0, from - 1);
      }
    },
  );
  return result;
}

function moveListLineBoundary(
  view: EditorView,
  toStart: boolean,
  extend: boolean,
): boolean {
  const { state } = view;
  let handled = false;
  const ranges = state.selection.ranges.map((range) => {
    if (!extend && !range.empty) {
      return EditorSelection.cursor(toStart ? range.from : range.to);
    }

    const line = state.doc.lineAt(range.head);
    const content = listContentStart(line);
    if (!content) return range;
    handled = true;

    // Match CodeMirror's normal indentation behavior: Home first reaches
    // editable content, then a second press reaches the list marker.
    const target = toStart
      ? range.head === content.contentFrom
        ? content.markerFrom
        : content.contentFrom
      : line.to;
    return extend
      ? EditorSelection.range(range.anchor, target)
      : EditorSelection.cursor(target, toStart ? 1 : -1);
  });

  if (!handled) return false;
  const selection = EditorSelection.create(ranges, state.selection.mainIndex);
  if (!selection.eq(state.selection)) {
    view.dispatch({ selection, userEvent: 'select' });
  }
  return true;
}

function moveListHorizontally(
  view: EditorView,
  right: boolean,
  extend: boolean,
): boolean {
  const { state } = view;
  let needsCustomMovement = false;
  const nextRanges = state.selection.ranges.map((range) => {
    const forward =
      right === (view.textDirectionAt(range.head) === Direction.LTR);

    if (!extend && !range.empty) {
      return EditorSelection.cursor(forward ? range.to : range.from);
    }

    const moved = view.moveByChar(
      EditorSelection.cursor(range.head, range.assoc),
      forward,
    );
    const head = skipListStructure(view, moved.head, forward);
    if (head !== moved.head) needsCustomMovement = true;
    const movedRange = EditorSelection.cursor(
      head,
      head < range.head ? 1 : -1,
    );
    return extend
      ? EditorSelection.range(range.anchor, movedRange.head)
      : movedRange;
  });
  if (!needsCustomMovement) return false;

  const next = EditorSelection.create(nextRanges, state.selection.mainIndex);
  if (next.eq(state.selection)) return false;

  view.dispatch({ selection: next, userEvent: 'select' });
  return true;
}

function moveListVertically(view: EditorView, forward: boolean): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const line = view.state.doc.lineAt(selection.head);
  const source = listContentStart(line);
  if (!source || selection.head < source.contentFrom) return false;

  const moved = view.moveVertically(selection, forward);
  const movedLine = view.state.doc.lineAt(moved.head);
  if (movedLine.number === line.number) return false;

  const adjacentLineNumber = line.number + (forward ? 1 : -1);
  if (adjacentLineNumber < 1 || adjacentLineNumber > view.state.doc.lines) {
    return false;
  }

  const adjacentLine = view.state.doc.line(adjacentLineNumber);
  const target = listContentStart(adjacentLine);
  if (!target) return false;

  // Source indentation and marker widths are hidden/relaid out by live
  // preview, so document columns no longer represent visual content columns.
  // Preserve the offset within the item body when crossing to an adjacent
  // list item instead of letting position mapping settle on its number.
  const offset = selection.head - source.contentFrom;
  view.dispatch({
    selection: EditorSelection.cursor(
      Math.min(adjacentLine.to, target.contentFrom + offset),
    ),
    userEvent: 'select',
  });
  return true;
}

function listMarkerMouseDown(event: MouseEvent, view: EditorView): boolean {
  if (
    event.button !== 0 ||
    event.detail !== 1 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof Element)) return false;
  const marker = target.closest<HTMLElement>('.cm-moss-list-marker');
  if (!marker || !view.contentDOM.contains(marker)) return false;

  const markerFrom = view.posAtDOM(marker, 0);
  if (markerFrom < 0) return false;
  const markerLength = marker.textContent?.length ?? 0;
  if (markerLength === 0) return false;

  view.focus();
  view.dispatch({
    selection: EditorSelection.cursor(markerFrom + markerLength),
    userEvent: 'select.pointer',
  });
  return true;
}

export function listNavigationExtension(): Extension {
  return [
    listStructurePlugin,
    EditorView.domEventHandlers({ mousedown: listMarkerMouseDown }),
    Prec.highest(
      keymap.of([
        { key: 'ArrowUp', run: (view) => moveListVertically(view, false) },
        { key: 'ArrowDown', run: (view) => moveListVertically(view, true) },
        {
          key: 'Home',
          run: (view) => moveListLineBoundary(view, true, false),
          shift: (view) => moveListLineBoundary(view, true, true),
        },
        {
          key: 'End',
          run: (view) => moveListLineBoundary(view, false, false),
          shift: (view) => moveListLineBoundary(view, false, true),
        },
        {
          key: 'ArrowLeft',
          run: (view) => moveListHorizontally(view, false, false),
          shift: (view) => moveListHorizontally(view, false, true),
        },
        {
          key: 'ArrowRight',
          run: (view) => moveListHorizontally(view, true, false),
          shift: (view) => moveListHorizontally(view, true, true),
        },
      ]),
    ),
  ];
}
