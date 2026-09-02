import { Decoration } from '@codemirror/view';
import type { Range, Text } from '@codemirror/state';

// ViewPlugin-sourced Decoration.replace ranges cannot cross a line break.
// Split multiline syntax into per-line ranges while keeping the newline in
// the document flow for stable height and position mapping.
export function pushReplace(
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

  let cursor = from;
  let firstSegment = true;
  while (cursor < to) {
    const line = doc.lineAt(cursor);
    const segmentEnd = Math.min(to, line.to);
    if (segmentEnd > cursor) {
      ranges.push(
        Decoration.replace(firstSegment ? spec : {}).range(cursor, segmentEnd),
      );
      firstSegment = false;
    }
    cursor = line.to + 1;
  }
}
