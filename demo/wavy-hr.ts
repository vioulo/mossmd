// Demo: a `MossCustomSyntax` that gives existing CommonMark horizontal rules
// different visuals based on the sigil the user typed.
//
//   ---   → solid line (the editor's built-in default, untouched here)
//   ***   → wavy line
//   ___   → solid line with a centered glyph
//
// Notes on the design:
//   * `~~~` (which the discussion in chat mentioned as a candidate) is
//     already a fenced-code delimiter in CommonMark, so reusing it for
//     a wavy HR would collide with code blocks. `***` and `___` are
//     already valid HR markers per the CommonMark spec, so we don't
//     need to teach the parser anything new — we just add decoration.
//   * The editor's built-in `inlinePreview` extension already adds the
//     `cm-moss-hr` line class and hides the raw characters on inactive
//     lines. CM6 merges multiple `Decoration.line` classes on the same
//     line, so this plugin only needs to layer `cm-moss-hr-wavy` /
//     `cm-moss-hr-glyph` on top — no fight with the built-in.
//   * When the line is active (caret on it), the built-in keeps the
//     raw `***` / `___` visible so the user can edit. We mirror that
//     rule: no extra class while the line is active.
//
// Copy this pattern into your own app to ship custom HR visuals without
// forking the editor.

import { syntaxTree } from '@codemirror/language';
import { type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { defineMossSyntax, type MossCustomSyntax } from 'mossmd/syntax';
import { mossReadOnlyFacet } from 'mossmd';

const wavyHrPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      const readOnlyChanged =
        update.startState.facet(mossReadOnlyFacet) !==
        update.state.facet(mossReadOnlyFacet);
      if (
        update.docChanged ||
        update.selectionSet ||
        update.focusChanged ||
        readOnlyChanged
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const ranges: Range<Decoration>[] = [];

  const readOnly = state.facet(mossReadOnlyFacet);
  const activeLines = new Set<number>();
  if (view.hasFocus && !readOnly) {
    for (const r of state.selection.ranges) {
      const firstLine = doc.lineAt(r.from).number;
      const lastLine = doc.lineAt(r.to).number;
      for (let n = firstLine; n <= lastLine; n++) activeLines.add(n);
    }
  }

  // Walk HorizontalRule nodes only — cheap even on long docs.
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'HorizontalRule') return;
      const line = doc.lineAt(node.from);
      if (activeLines.has(line.number)) return;

      const firstChar = doc.sliceString(node.from, node.from + 1);
      let extraClass: string | null = null;
      if (firstChar === '*') extraClass = 'cm-moss-hr-wavy';
      else if (firstChar === '_') extraClass = 'cm-moss-hr-glyph';
      if (!extraClass) return;

      ranges.push(
        Decoration.line({ class: extraClass }).range(line.from),
      );
    },
  });

  return Decoration.set(ranges, true);
}

export function wavyHrSyntax(): MossCustomSyntax {
  return defineMossSyntax({
    name: 'wavy-hr',
    description:
      'Renders *** as a wavy line and ___ as a solid line with a centered glyph',
    extensions: wavyHrPlugin as Extension,
  });
}
