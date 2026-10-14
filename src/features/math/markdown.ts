import {
  type MarkdownConfig,
  type InlineContext,
  type BlockContext,
  type Line,
} from '@lezer/markdown';
import { tags as t } from '@lezer/highlight';

function isEscaped(text: string, pos: number): boolean {
  let count = 0;
  for (let p = pos - 1; p >= 0; p--) {
    if (text.charCodeAt(p) === 92 /* '\\' */) count++;
    else break;
  }
  return count % 2 === 1;
}

const InlineMathDelim = { resolve: 'InlineMath', mark: 'InlineMathMark' };

function parseInlineMath(cx: InlineContext, next: number, pos: number): number {
  if (next !== 36 /* '$' */) return -1;

  // If escaped by an odd number of backslashes, skip
  if (pos > cx.offset && cx.char(pos - 1) === 92) {
    let slashes = 0;
    for (let p = pos - 1; p >= cx.offset; p--) {
      if (cx.char(p) === 92) slashes++;
      else break;
    }
    if (slashes % 2 === 1) return -1;
  }

  // Double dollar is handled by block math, not single inline math
  if (cx.char(pos + 1) === 36) return -1;

  const prevCharCode = pos > cx.offset ? cx.char(pos - 1) : 32;
  const nextCharCode = pos + 1 < cx.end ? cx.char(pos + 1) : 32;
  const prevChar = String.fromCharCode(prevCharCode);
  const nextChar = String.fromCharCode(nextCharCode);

  // CommonMark Math delimiter rules:
  // - Open: next char is not whitespace and not '$'
  // - Close: prev char is not whitespace and not '$', and next char is not a digit (preventing $20/$30 traps)
  const openValid = !/\s/.test(nextChar) && nextChar !== '$';
  const closeValid =
    !/\s/.test(prevChar) && prevChar !== '$' && !/[0-9]/.test(nextChar);

  return cx.addDelimiter(InlineMathDelim, pos, pos + 1, openValid, closeValid);
}

function isBlockMathStart(line: Line): boolean {
  if (line.indent >= 4) return false;
  const text = line.text;
  const pos = line.pos;
  if (
    pos >= text.length ||
    text.charCodeAt(pos) !== 36 ||
    text.charCodeAt(pos + 1) !== 36
  ) {
    return false;
  }
  if (pos + 2 < text.length && text.charCodeAt(pos + 2) === 36) {
    return false; // $$$ is not block math
  }
  return true;
}

const BlockMathParser = {
  name: 'BlockMath',
  before: 'FencedCode',
  endLeaf(_cx: BlockContext, line: Line): boolean {
    return isBlockMathStart(line);
  },
  parse(cx: BlockContext, line: Line): boolean | null {
    if (!isBlockMathStart(line)) return false;
    const text = line.text;
    const pos = line.pos;

    const from = cx.lineStart + pos;
    // Check if it closes on the same line after pos + 2
    const rest = text.slice(pos + 2);
    const closeIndex = rest.indexOf('$$');
    if (closeIndex >= 0 && !isEscaped(rest, closeIndex)) {
      const end = cx.lineStart + pos + 2 + closeIndex + 2;
      cx.addElement(
        cx.elt('BlockMath', from, end, [
          cx.elt('BlockMathMark', from, from + 2),
          cx.elt('BlockMathMark', end - 2, end),
        ]),
      );
      cx.nextLine();
      return true;
    }

    // Multiline block math
    const marks = [cx.elt('BlockMathMark', from, from + 2)];
    let closed = false;
    let to = from + 2;

    while (cx.nextLine()) {
      const curText = line.text;
      const curPos = line.pos;
      const idx = curText.indexOf('$$', curPos);
      if (idx >= 0 && !isEscaped(curText, idx)) {
        const markFrom = cx.lineStart + idx;
        const markTo = markFrom + 2;
        marks.push(cx.elt('BlockMathMark', markFrom, markTo));
        to = markTo;
        closed = true;
        cx.nextLine();
        break;
      }
    }

    if (!closed) {
      to = cx.lineStart + line.text.length;
    }

    cx.addElement(cx.elt('BlockMath', from, to, marks));
    return true;
  },
};

export const mossMathMarkdown: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: t.special(t.content) },
    { name: 'InlineMathMark', style: t.processingInstruction },
    { name: 'BlockMath', block: true, style: t.special(t.content) },
    { name: 'BlockMathMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      parse: parseInlineMath,
      before: 'Escape',
    },
  ],
  parseBlock: [BlockMathParser],
};
