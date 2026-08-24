import type { Extension } from '@codemirror/state';
import type { MarkdownExtension } from '@lezer/markdown';

export interface MossCustomSyntax {
  name: string;
  description?: string;
  markdown?: MarkdownExtension | readonly MarkdownExtension[];
  extensions?: Extension | readonly Extension[];
}

export interface RegisteredMossSyntax {
  syntaxes: readonly MossCustomSyntax[];
  markdownExtensions: MarkdownExtension[];
  extensions: Extension[];
}

export function defineMossSyntax(
  syntax: MossCustomSyntax,
): MossCustomSyntax {
  return syntax;
}

export function registerMossSyntax(
  syntaxes: readonly MossCustomSyntax[] = [],
): RegisteredMossSyntax {
  const seen = new Set<string>();
  const markdownExtensions: MarkdownExtension[] = [];
  const extensions: Extension[] = [];

  for (const syntax of syntaxes) {
    if (!syntax.name.trim()) {
      throw new Error('Moss custom syntax requires a non-empty name.');
    }
    if (seen.has(syntax.name)) {
      throw new Error(`Duplicate Moss custom syntax name: ${syntax.name}`);
    }
    seen.add(syntax.name);

    if (syntax.markdown) {
      markdownExtensions.push(
        ...(Array.isArray(syntax.markdown)
          ? syntax.markdown
          : [syntax.markdown]),
      );
    }
    if (syntax.extensions) {
      extensions.push(
        ...(Array.isArray(syntax.extensions)
          ? syntax.extensions
          : [syntax.extensions]),
      );
    }
  }

  return { syntaxes, markdownExtensions, extensions };
}
