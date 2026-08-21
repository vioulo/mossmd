export interface SelectorExpectation {
  count: number;
  selector: string;
  text?: string;
}

export interface MarkdownContractCase {
  containsText?: readonly string[];
  markdown: string;
  name: string;
  notContainsText?: readonly string[];
  selectors?: readonly SelectorExpectation[];
}

export const MARKDOWN_CONTRACTS: readonly MarkdownContractCase[] = [
  {
    name: 'valid highlight',
    markdown: 'alpha ==glow== omega',
    containsText: ['alpha', 'glow', 'omega'],
    selectors: [{ selector: '.cm-moss-highlight', count: 1, text: 'glow' }],
  },
  {
    name: 'triple equals is not a partial highlight',
    markdown: 'alpha ===not highlighted=== omega',
    containsText: ['===not highlighted==='],
    selectors: [{ selector: '.cm-moss-highlight', count: 0 }],
  },
  {
    name: 'whitespace-invalid highlight remains source text',
    markdown: 'alpha == spaced == omega',
    containsText: ['== spaced =='],
    selectors: [{ selector: '.cm-moss-highlight', count: 0 }],
  },
  {
    name: 'highlight inside a table cell',
    markdown: '| Value |\n| --- |\n| ==glow== |',
    containsText: ['glow'],
    selectors: [
      {
        selector: '.cm-moss-table-cell-source .cm-moss-highlight',
        count: 1,
        text: 'glow',
      },
    ],
  },
  {
    name: 'invalid table highlight follows prose rules',
    markdown: '| Value |\n| --- |\n| ===not highlighted=== |',
    containsText: ['===not highlighted==='],
    selectors: [
      { selector: '.cm-moss-table-cell-source .cm-moss-highlight', count: 0 },
    ],
  },
  {
    name: 'bare URL stays visible',
    markdown: '- https://example.com',
    containsText: ['https://example.com'],
    selectors: [{ selector: '.cm-moss-link', count: 1 }],
  },
  {
    name: 'same-text link keeps its visible label',
    markdown: '[https://example.com](https://example.com)',
    containsText: ['https://example.com'],
    selectors: [
      { selector: '.cm-moss-link', count: 1, text: 'https://example.com' },
    ],
  },
  {
    name: 'escaped URL slashes render cleanly',
    markdown: String.raw`https:\/\/example.com`,
    containsText: ['https://example.com'],
    notContainsText: [String.raw`\/`],
  },
  {
    name: 'URL label does not expose its destination',
    markdown: '[https://label.example](https://destination.example)',
    containsText: ['https://label.example'],
    notContainsText: ['https://destination.example'],
    selectors: [
      {
        selector: '.cm-moss-link',
        count: 1,
        text: 'https://label.example',
      },
    ],
  },
];
