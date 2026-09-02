import {
  Annotation,
  EditorSelection,
  Prec,
  type ChangeSpec,
  type Extension,
} from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { deleteEmptyOrderedListMarkerBackward } from './edit-helpers';
import { isLineInsideMarkdownCode } from './markdown-context';
import {
  continuationFor,
  indentedOrderedNumber,
  listItemLineRange,
  nearestOuterListPrefix,
  nextOuterListNumber,
  orderedMarker,
  parseListLine,
  previousListPrefix,
} from './list-model';

const LIST_INDENT_COLUMNS = 4;
const renumberOrderedListsAnnotation = Annotation.define<boolean>();

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
      if (
        update.transactions.some((tr) =>
          tr.annotation(renumberOrderedListsAnnotation),
        )
      ) {
        return;
      }
      if (
        update.transactions.some((tr) => tr.isUserEvent('input.type.compose'))
      ) {
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
  const prefix = parseListLine(line.text, line.from);
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
  // prefix is authoritative here, so a valid list line still continues.
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
      selectionDelta =
        addedIndent.length + nextMarker.length - prefix.marker.length;
      changes.push({
        from: itemLine.from,
        to: prefix.markerTo,
        insert: prefix.indent + addedIndent + nextMarker,
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
        nextOuterListNumber(state.doc, line.number - 1, targetIndentLength),
        prefix.delimiter,
      ),
    });
  }

  view.dispatch({
    changes,
    selection: EditorSelection.cursor(
      Math.max(line.from, sel.from - removeLength),
    ),
  });
  return true;
}

export function listEditingExtension(): Extension {
  return [
    orderedListRenumberPlugin,
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

export type { ListLineInfo } from './list-model';
