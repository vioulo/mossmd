import { type Extension } from '@codemirror/state';
import { defineMossSyntax, type MossCustomSyntax } from '../../syntax';
import { mossMathMarkdown } from './markdown';
import {
  mathDecorationsExtension,
  type MossMathConfig,
} from './decoration';
import {
  defaultMathRenderer,
  type MossMathRenderer,
} from './widget';

export interface KatexOptions {
  displayMode?: boolean;
  throwOnError?: boolean;
  errorColor?: string;
  macros?: Record<string, string>;
  [key: string]: unknown;
}

export interface KatexLike<O = KatexOptions> {
  renderToString(tex: string, options?: O): string;
}

export function createKatexRenderer<O = KatexOptions>(
  katex: KatexLike<O>,
  defaultOptions?: O,
): MossMathRenderer {
  return {
    render(source: string, mode: 'inline' | 'block') {
      const isBlock = mode === 'block';
      const options = {
        displayMode: isBlock,
        throwOnError: false,
        ...defaultOptions,
      } as O;
      return katex.renderToString(source, options);
    },
  };
}

export function mossMath(config: MossMathConfig = {}): Extension {
  return [mathDecorationsExtension(config)];
}

export function mossMathSyntax(config: MossMathConfig = {}): MossCustomSyntax {
  return defineMossSyntax({
    name: 'math',
    description: 'LaTeX math formulas ($...$ and $$...$$)',
    markdown: mossMathMarkdown,
    extensions: mossMath(config),
  });
}

export { mossMathMarkdown, defaultMathRenderer };
export type { MossMathConfig, MossMathRenderer };
