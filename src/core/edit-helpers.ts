import { syntaxTree } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

// Resolve the ambiguity between an emphasis opener and an unordered-list
// marker. A lone `*` still auto-pairs so italic/bold typing keeps its current
// ergonomics. Once the next input is a space at a whitespace-only line
// prefix, the intent is unambiguously a list marker: consume the auto-added
// closer so `*|*` becomes `* |` before item text is entered.
export const startAsteriskList = Prec.highest(
  EditorView.inputHandler.of(startAsteriskListInput),
);

export function startAsteriskListInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (text !== ' ' || from !== to) return false;

  const { state } = view;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return false;
  }
  const line = state.doc.lineAt(from);
  const before = state.doc.sliceString(line.from, from);
  // Besides plain/nested list indentation, allow one or more CommonMark
  // blockquote prefixes (`> * `, `> > * `). Other prose before the star
  // remains emphasis and falls through untouched.
  if (!/^(?:[ \t]{0,3}>[ \t]?)*[ \t]*\*$/.test(before)) return false;
  if (state.doc.sliceString(from, from + 1) !== '*') return false;

  // Four-space indented and fenced code can legitimately begin with `* `.
  // Do not reinterpret those literal characters as a Markdown list marker.
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, -1);
    node;
    node = node.parent
  ) {
    if (node.name === 'CodeBlock' || node.name === 'FencedCode') return false;
  }

  view.dispatch({
    changes: { from, to: from + 1, insert: ' ' },
    selection: { anchor: from + 1 },
  });
  return true;
}

// Obsidian-style extension of emphasis pairs.
//
// Problem: CM6's built-in `closeBrackets()` handles single-char pairs
// well (type `*`, get `*|*`). Typing a second `*` with the cursor
// between them is treated as "step through the closer" and produces
// `**|` — which means writing bold (`**foo**`) is a 5-keystroke dance
// (star, star-step, content, star-new-pair, star-step).
//
// This handler fires when the user types `*` (or `_`) with the cursor
// sitting exactly between two matching characters — an empty pair
// that closeBrackets just inserted. Instead of stepping through, we
// extend the pair: `*|*` becomes `**|**`, ready for bold content. All
// other cases fall through to closeBrackets.
//
// Runs at Prec.high so it beats closeBrackets' input handler when
// both want to act on the keystroke.
export const extendEmphasisPair = Prec.high(
  EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== '*' && text !== '_') return false;
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty || from !== to) return false;

    const before = state.doc.sliceString(Math.max(0, from - 1), from);
    const after = state.doc.sliceString(
      from,
      Math.min(state.doc.length, from + 1),
    );
    if (before !== text || after !== text) return false;

    view.dispatch({
      changes: { from, insert: text + text },
      selection: { anchor: from + 1 },
    });
    return true;
  }),
);

// Auto-close markdown code fences.
//
// When the user completes an opening fence at the start of a line:
//
//   ```|
//
// immediately insert the matching closing fence below:
//
//   ```|
//   ```
//
// The cursor deliberately stays after the opening marker, not inside
// the block, so the user can still type an info string (`ts`, `rust`,
// etc.) and then press Enter into the fenced body. If the cursor is
// already inside an open fenced block, we do nothing — in that context
// typing ``` is likely the user's manual closing fence.
export const autoCloseCodeFence = Prec.highest(
  EditorView.inputHandler.of(autoCloseCodeFenceInput),
);

function isImeEnterKeyEvent(event: KeyboardEvent): boolean {
  return (
    (event.isComposing &&
      (event.key === 'Enter' || event.key === 'NumpadEnter')) ||
    (event.keyCode === 229 &&
      (event.key === 'Enter' || event.key === 'NumpadEnter'))
  );
}

const imeCompositionEndedAt = new WeakMap<EditorView, number>();

// IME candidate confirmation can arrive as an Enter-like key event after
// compositionend. Keep it out of every editor keymap, not just list handling,
// so Markdown, search, and consumer keymaps cannot turn candidate selection
// into a newline.
export const imeCompositionGuard = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      const recentlyEnded =
        view !== null &&
        Date.now() - (imeCompositionEndedAt.get(view) ?? 0) < 120;
      if (
        !isImeEnterKeyEvent(event) &&
        !(recentlyEnded && (event.key === 'Enter' || event.key === 'NumpadEnter'))
      ) {
        return false;
      }
      event.stopPropagation();
      return true;
    },
    compositionend(_event, view) {
      imeCompositionEndedAt.set(view, Date.now());
      return false;
    },
  }),
);

export function autoCloseCodeFenceInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (text !== '`' || from !== to) return false;

  const { state } = view;
  const line = state.doc.lineAt(from);
  const before = state.doc.sliceString(line.from, from);
  const after = state.doc.sliceString(from, line.to);
  const match = before.match(/^(\s{0,3})``$/);
  if (!match) return false;
  if (after !== '' && after !== '`') return false;
  if (isInsideFencedCodeBeforeLine(state.doc.toString(), line.number)) return false;

  const indent = match[1];
  const replaceTo = after === '`' ? from + 1 : from;
  const insert = '`\n' + indent + '```';
  view.dispatch({
    changes: { from, to: replaceTo, insert },
    selection: { anchor: from + 1 },
  });
  return true;
}

export const separateHorizontalRule = Prec.highest(
  EditorView.inputHandler.of(separateHorizontalRuleInput),
);

export function separateHorizontalRuleInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (text !== '-' || from !== to) return false;

  const { state } = view;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return false;
  }

  const line = state.doc.lineAt(from);
  const before = state.doc.sliceString(line.from, from);
  const after = state.doc.sliceString(from, line.to);
  if (!/^ {0,3}--$/.test(before) || after.trim()) return false;
  if (line.number === 1 || state.doc.line(line.number - 1).text.trim() === '') {
    return false;
  }
  if (isInsideMarkdownCode(state, from)) return false;

  view.dispatch({
    changes: [
      { from: line.from, insert: '\n' },
      { from, insert: '-' },
    ],
    selection: { anchor: from + 2 },
  });
  return true;
}

function isInsideFencedCodeBeforeLine(doc: string, lineNumber: number): boolean {
  const lines = doc.split('\n');
  let marker: '`' | '~' | null = null;
  let markerLength = 0;

  for (let i = 0; i < lineNumber - 1; i++) {
    const match = lines[i].match(/^ {0,3}(`{3,}|~{3,})/);
    if (!match) continue;

    const currentMarker = match[1][0] as '`' | '~';
    const currentLength = match[1].length;
    if (!marker) {
      marker = currentMarker;
      markerLength = currentLength;
    } else if (currentMarker === marker && currentLength >= markerLength) {
      marker = null;
      markerLength = 0;
    }
  }

  return marker !== null;
}

function isInsideMarkdownCode(
  state: EditorView['state'],
  position: number,
): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, -1);
    node;
    node = node.parent
  ) {
    if (
      node.name === 'CodeBlock' ||
      node.name === 'FencedCode' ||
      node.name === 'InlineCode'
    ) {
      return true;
    }
  }
  return false;
}

const DIGIT_PUNCTUATION: Record<string, string> = {
  '。': '.',
  '．': '.',
  '｡': '.',
  '，': ',',
  '、': ',',
  '：': ':',
  '；': ';',
  '？': '?',
  '！': '!',
};

export const normalizeDigitPunctuation = Prec.highest(
  [
    EditorView.inputHandler.of(normalizeDigitPunctuationInput),
    EditorView.domEventHandlers({
      input(_event, view) {
        scheduleDigitPunctuationNormalization(view);
        return false;
      },
      compositionend(_event, view) {
        scheduleDigitPunctuationNormalization(view);
        return false;
      },
    }),
  ],
);

const digitPunctuationTimers = new WeakMap<EditorView, number>();

function scheduleDigitPunctuationNormalization(view: EditorView): void {
  if (digitPunctuationTimers.has(view)) return;

  const retry = (): void => {
    digitPunctuationTimers.delete(view);
    if (view.composing) {
      digitPunctuationTimers.set(view, window.setTimeout(retry, 16));
      return;
    }
    normalizeDigitPunctuationAtCursor(view);
  };

  digitPunctuationTimers.set(view, window.setTimeout(retry, 0));
}

function normalizeDigitPunctuationAtCursor(view: EditorView): void {
  if (view.composing) return;

  const { state } = view;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return;
  }

  const cursor = state.selection.main.head;
  const line = state.doc.lineAt(cursor);
  const before = state.doc.sliceString(line.from, cursor);
  let punctuationFrom = -1;
  let punctuation: string | undefined;

  for (let index = before.length - 1; index > 0; index--) {
    if (!/\d/.test(before[index - 1])) continue;
    const candidate = DIGIT_PUNCTUATION[before[index]];
    if (candidate) {
      punctuationFrom = line.from + index;
      punctuation = candidate;
      break;
    }
  }

  if (punctuationFrom < 0 || !punctuation) return;
  if (isInsideMarkdownCode(state, punctuationFrom)) return;

  const after = state.doc.sliceString(
    punctuationFrom + 1,
    Math.min(state.doc.length, punctuationFrom + 2),
  );
  const insert = after === ' ' ? punctuation : `${punctuation} `;
  view.dispatch({
    changes: { from: punctuationFrom, to: punctuationFrom + 1, insert },
    selection: { anchor: cursor + insert.length - 1 },
  });
}

export function normalizeDigitPunctuationInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  const sourcePunctuation = text[0];
  const punctuation = sourcePunctuation ? DIGIT_PUNCTUATION[sourcePunctuation] : undefined;
  if (!punctuation || from !== to || from === 0 || view.composing) return false;

  const { state } = view;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return false;
  }
  if (!/\d/.test(state.doc.sliceString(from - 1, from))) return false;

  if (isInsideMarkdownCode(state, from)) return false;

  const rest = text.slice(sourcePunctuation.length);
  const after = state.doc.sliceString(from, Math.min(state.doc.length, from + 1));
  const separator = rest.startsWith(' ') || after === ' ' ? '' : ' ';
  const insert = `${punctuation}${separator}${rest}`;
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: from + insert.length },
  });
  return true;
}
