import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { type Extension, type Range } from '@codemirror/state';
import { readOnlyFacet } from '../../core/read-only';
import { defineMossSyntax, type MossCustomSyntax } from '../index';

export type MossCalloutType =
  | 'note'
  | 'abstract'
  | 'info'
  | 'todo'
  | 'tip'
  | 'important'
  | 'success'
  | 'question'
  | 'warning'
  | 'caution'
  | 'failure'
  | 'danger'
  | 'bug'
  | 'example'
  | 'quote'
  | (string & {});

export interface MossCalloutsConfig {
  aliases?: Record<string, MossCalloutType>;
}

interface CalloutLine {
  from: number;
  to: number;
  number: number;
  type: string;
  label: string;
  markerFrom: number;
  markerTo: number;
  titleFrom: number;
  hasTitle: boolean;
}

const CALLOUT_START_RE = /^(\s{0,3}>\s?)(\[!([A-Za-z][\w-]*)\][+-]?)([ \t]*)/;
const BLOCKQUOTE_LINE_RE = /^\s{0,3}>/;

const DEFAULT_ALIASES: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};

class CalloutMarkerWidget extends WidgetType {
  constructor(
    private readonly type: string,
    private readonly label: string,
  ) {
    super();
  }

  override eq(other: CalloutMarkerWidget): boolean {
    return this.type === other.type && this.label === other.label;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = `cm-moss-callout-label cm-moss-callout-label-${this.type}`;
    span.textContent = this.label;
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

export function mossCallouts(config: MossCalloutsConfig = {}): Extension {
  const aliases = {
    ...DEFAULT_ALIASES,
    ...normalizeAliases(config.aliases ?? {}),
  };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(readonly view: EditorView) {
        this.decorations = buildCalloutDecorations(view, aliases);
      }

      update(update: ViewUpdate): void {
        const readOnlyChanged =
          update.startState.facet(readOnlyFacet) !==
          update.state.facet(readOnlyFacet);

        if (
          update.docChanged ||
          update.selectionSet ||
          update.focusChanged ||
          readOnlyChanged
        ) {
          this.decorations = buildCalloutDecorations(update.view, aliases);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

export function mossCalloutSyntax(
  config: MossCalloutsConfig = {},
): MossCustomSyntax {
  return defineMossSyntax({
    name: 'callout',
    description: 'Obsidian-style blockquote callouts',
    extensions: mossCallouts(config),
  });
}

function buildCalloutDecorations(
  view: EditorView,
  aliases: Record<string, string>,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const doc = view.state.doc;
  const activeLines = findActiveLines(view);

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber);
    const start = parseCalloutStart(line.text, line.from, aliases);
    if (!start) continue;
    start.number = line.number;

    const lines: CalloutLine[] = [start];
    let nextNumber = lineNumber + 1;
    while (nextNumber <= doc.lines) {
      const nextLine = doc.line(nextNumber);
      if (!BLOCKQUOTE_LINE_RE.test(nextLine.text)) break;
      if (parseCalloutStart(nextLine.text, nextLine.from, aliases)) break;
      lines.push({
        from: nextLine.from,
        to: nextLine.to,
        number: nextLine.number,
        type: start.type,
        label: start.label,
        markerFrom: nextLine.from,
        markerTo: nextLine.from,
        titleFrom: nextLine.from,
        hasTitle: false,
      });
      nextNumber++;
    }

    for (let i = 0; i < lines.length; i++) {
      const calloutLine = lines[i];
      const positionClasses = [
        i === 0 ? 'cm-moss-callout-first' : '',
        i === lines.length - 1 ? 'cm-moss-callout-last' : '',
        i > 0 && i < lines.length - 1 ? 'cm-moss-callout-middle' : '',
      ].filter(Boolean).join(' ');
      ranges.push(
        Decoration.line({
          class: `cm-moss-callout cm-moss-callout-${calloutLine.type} ${positionClasses}`,
        }).range(calloutLine.from),
      );
    }

    if (!activeLines.has(start.number)) {
      ranges.push(
        Decoration.replace({
          widget: new CalloutMarkerWidget(start.type, start.label),
        }).range(start.markerFrom, start.markerTo),
      );
    }

    if (start.hasTitle && start.titleFrom < start.to) {
      ranges.push(
        Decoration.mark({ class: 'cm-moss-callout-title' }).range(
          start.titleFrom,
          start.to,
        ),
      );
    }

    lineNumber = nextNumber - 1;
  }

  return Decoration.set(ranges, true);
}

function findActiveLines(view: EditorView): Set<number> {
  const activeLines = new Set<number>();
  if (view.state.facet(readOnlyFacet) || !view.hasFocus) return activeLines;

  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number++) {
      activeLines.add(number);
    }
  }

  return activeLines;
}

function parseCalloutStart(
  text: string,
  lineFrom: number,
  aliases: Record<string, string>,
): CalloutLine | null {
  const match = text.match(CALLOUT_START_RE);
  if (!match) return null;

  const rawType = match[3].toLowerCase();
  const type = normalizeType(aliases[rawType] ?? rawType);
  const markerFrom = lineFrom + match[1].length;
  const markerTo = lineFrom + match[0].length;
  const titleFrom = markerTo;

  return {
    from: lineFrom,
    to: lineFrom + text.length,
    number: 0,
    type,
    label: labelForType(type),
    markerFrom,
    markerTo,
    titleFrom,
    hasTitle: text.slice(match[0].length).trim().length > 0,
  };
}

function normalizeAliases(
  aliases: Record<string, MossCalloutType>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [from, to] of Object.entries(aliases)) {
    normalized[normalizeType(from)] = normalizeType(to);
  }
  return normalized;
}

function normalizeType(type: string): string {
  return type.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function labelForType(type: string): string {
  return type
    .split('-')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}
