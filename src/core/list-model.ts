import type { Text } from '@codemirror/state';

/**
 * Source-level information for one Markdown list item line.
 *
 * This model deliberately does not depend on Lezer or decorations. The
 * editor uses it for interaction semantics, where `1.` is not a list until
 * its whitespace separator has been typed.
 */
export interface ListLineInfo {
  indent: string;
  marker: string;
  markerFrom: number;
  markerTo: number;
  separatorFrom: number;
  separatorTo: number;
  ordered: boolean;
  number: number | null;
  delimiter: '.' | ')' | null;
  taskPrefix: string | null;
  contentFrom: number;
  content: string;
}

export type TextLine = ReturnType<Text['lineAt']>;

export function parseListLine(
  lineText: string,
  lineFrom: number,
): ListLineInfo | null {
  const match = lineText.match(/^(\s*)([-*+]|\d{1,9}[.)])(\s+)/);
  if (!match) return null;

  const [, indent, marker, separator] = match;
  const markerFrom = lineFrom + indent.length;
  const markerTo = markerFrom + marker.length;
  const separatorFrom = markerTo;
  const separatorTo = separatorFrom + separator.length;
  const rest = lineText.slice(separatorTo - lineFrom);
  const orderedMatch = marker.match(/^(\d{1,9})([.)])$/);
  const taskMatch = rest.match(/^\[(\\\*|-[^\]]|[^\]])\](\s*)/);
  const taskPrefix = taskMatch?.[0] ?? null;

  return {
    indent,
    marker,
    markerFrom,
    markerTo,
    separatorFrom,
    separatorTo,
    ordered: orderedMatch != null,
    number: orderedMatch ? Number.parseInt(orderedMatch[1], 10) : null,
    delimiter: orderedMatch ? (orderedMatch[2] as '.' | ')') : null,
    taskPrefix,
    contentFrom: lineFrom + separatorTo - lineFrom,
    content: rest.slice(taskPrefix?.length ?? 0),
  };
}

export function listContentStart(
  line: TextLine,
): { markerFrom: number; contentFrom: number } | null {
  const prefix = parseListLine(line.text, line.from);
  if (!prefix) return null;
  return {
    markerFrom: prefix.markerFrom,
    contentFrom: prefix.contentFrom,
  };
}

export function orderedMarker(
  number: number,
  delimiter: '.' | ')' | null,
): string {
  return `${number}${delimiter ?? '.'}`;
}

export function continuationFor(
  prefix: ListLineInfo,
  nextNumber?: number,
): string {
  const marker = prefix.ordered
    ? orderedMarker(nextNumber ?? (prefix.number ?? 0) + 1, prefix.delimiter)
    : prefix.marker;
  return `${prefix.indent}${marker} ${prefix.taskPrefix ? '[ ] ' : ''}`;
}

export function previousListPrefixAtIndent(
  doc: Text,
  beforeLine: number,
  indentLength: number,
  ordered: boolean,
): ListLineInfo | null {
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

export function previousListPrefix(
  doc: Text,
  beforeLine: number,
): ListLineInfo | null {
  for (let number = beforeLine; number >= 1; number--) {
    const line = doc.line(number);
    const prefix = parseListLine(line.text, line.from);
    if (prefix) return prefix;
    if (line.text.trim() && line.text.search(/\S/) <= 0) return null;
  }
  return null;
}

export function nearestOuterListPrefix(
  doc: Text,
  beforeLine: number,
  indentLength: number,
): ListLineInfo | null {
  let best: ListLineInfo | null = null;
  for (let number = beforeLine; number >= 1; number--) {
    const line = doc.line(number);
    const prefix = parseListLine(line.text, line.from);
    if (!prefix || prefix.indent.length >= indentLength) continue;
    if (!best || prefix.indent.length > best.indent.length) best = prefix;
    if (best.indent.length === 0) break;
  }
  return best;
}

export function listItemLineRange(
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

export function nextOuterListNumber(
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

export function indentedOrderedNumber(
  doc: Text,
  lineNumber: number,
  newIndentLength: number,
): number {
  return nextOuterListNumber(doc, lineNumber - 1, newIndentLength);
}
