import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

export function isLineInsideMarkdownCode(
  state: EditorState,
  lineNumber: number,
): boolean {
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
