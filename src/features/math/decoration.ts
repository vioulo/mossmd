import { syntaxTree } from '@codemirror/language';
import {
  Facet,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Transaction,
} from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { readOnlyFacet } from '../../core/read-only';
import {
  setFrozen,
  refreshInlinePreview,
} from '../../core/preview-activity';
import { treeGrowthEffect, treeProgressPlugin } from '../../core/tree-progress';
import {
  defaultMathRenderer,
  InlineMathWidget,
  BlockMathWidget,
  type MossMathRenderer,
} from './widget';

export interface MossMathConfig {
  renderer?: MossMathRenderer;
}

export const mossMathConfigFacet = Facet.define<MossMathConfig, MossMathConfig>({
  combine(values) {
    return values[values.length - 1] ?? {};
  },
});

export function buildMathDecorations(
  state: EditorState,
  config: MossMathConfig,
): DecorationSet {
  const tree = syntaxTree(state);
  const doc = state.doc;
  const isReadOnly = state.facet(readOnlyFacet);
  const renderer = config.renderer ?? defaultMathRenderer;
  const selections = state.selection.ranges;

  const ranges: Range<Decoration>[] = [];

  tree.iterate({
    enter(node) {
      if (node.name === 'InlineMath') {
        const from = node.from;
        const to = node.to;
        if (from >= to) return;

        const isActive =
          !isReadOnly &&
          selections.some((sel) => {
            if (sel.empty) {
              // Arrow key navigation: cursor is inside the dollar markers
              return sel.head > from && sel.head < to;
            }
            // Mouse click or selection overlaps formula range
            return sel.from <= to && sel.to >= from;
          });

        if (!isActive) {
          const raw = doc.sliceString(from, to);
          const source =
            raw.startsWith('$') && raw.endsWith('$') && raw.length >= 2
              ? raw.slice(1, -1)
              : raw;

          ranges.push(
            Decoration.replace({
              widget: new InlineMathWidget(source, renderer, from, to),
            }).range(from, to),
          );
        }
      } else if (node.name === 'BlockMath') {
        const from = node.from;
        const to = node.to;
        if (from >= to) return;

        const startLine = doc.lineAt(from);
        const endLine = doc.lineAt(to);

        const isActive =
          !isReadOnly &&
          selections.some((sel) => {
            return sel.from <= endLine.to && sel.to >= startLine.from;
          });

        const raw = doc.sliceString(from, to);
        let source = raw;
        if (source.startsWith('$$')) source = source.slice(2);
        if (source.endsWith('$$')) source = source.slice(0, -2);
        source = source.trim();

        const beforeOnLine = startLine.text
          .slice(0, from - startLine.from)
          .trim();
        const afterOnLine = endLine.text.slice(to - endLine.from).trim();
        const isFullLines = beforeOnLine === '' && afterOnLine === '';

        if (!isActive) {
          // Inactive / read-only: fold source lines and display rendered card
          if (isFullLines) {
            ranges.push(
              Decoration.replace({
                widget: new BlockMathWidget(source, renderer, from, to, false),
                block: true,
              }).range(startLine.from, endLine.to),
            );
          } else {
            ranges.push(
              Decoration.replace({
                widget: new BlockMathWidget(source, renderer, from, to, false),
              }).range(from, to),
            );
          }
        } else {
          // Active: keep source lines visible on top, and render live preview card below
          ranges.push(
            Decoration.widget({
              widget: new BlockMathWidget(source, renderer, from, to, true),
              block: true,
              side: 1,
            }).range(endLine.to),
          );
        }
      }
    },
  });

  return Decoration.set(ranges, true);
}

function changeAffectsMath(tr: Transaction, existing: DecorationSet): boolean {
  let affected = false;
  tr.changes.iterChanges((fromA, toA) => {
    if (affected) return;
    existing.between(fromA, toA, () => {
      affected = true;
      return false;
    });
  });
  if (affected) return true;

  const state = tr.state;
  tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
    if (affected) return;
    const startLine = state.doc.lineAt(fromB);
    const endLine = toB > startLine.to ? state.doc.lineAt(toB) : startLine;
    for (let n = startLine.number; n <= endLine.number; n++) {
      if (state.doc.line(n).text.includes('$')) {
        affected = true;
        break;
      }
    }
  });
  return affected;
}

export function mathDecorationsExtension(
  config: MossMathConfig = {},
): Extension {
  const mathDecorationsField = StateField.define<DecorationSet>({
    create(state) {
      return buildMathDecorations(state, config);
    },
    update(deco, tr) {
      for (const effect of tr.effects) {
        if (
          effect.is(refreshInlinePreview) ||
          effect.is(treeGrowthEffect) ||
          effect.is(setFrozen)
        ) {
          return buildMathDecorations(tr.state, config);
        }
      }

      const readOnlyChanged =
        tr.startState.facet(readOnlyFacet) !==
        tr.state.facet(readOnlyFacet);

      if (tr.docChanged) {
        if (changeAffectsMath(tr, deco)) {
          return buildMathDecorations(tr.state, config);
        }
        return deco.map(tr.changes);
      }

      if (readOnlyChanged) {
        return buildMathDecorations(tr.state, config);
      }

      if (tr.selection) {
        return buildMathDecorations(tr.state, config);
      }

      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [treeProgressPlugin, mathDecorationsField];
}
