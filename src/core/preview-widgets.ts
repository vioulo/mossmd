import { Facet, type Text } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import {
  BadgeDollarSign,
  Bookmark,
  CalendarCheck,
  Check,
  Circle,
  CircleAlert,
  CircleQuestionMark,
  Copy,
  Info,
  Lightbulb,
  LoaderCircle,
  MapPin,
  Minus,
  Quote,
  Square,
  Star,
  StickyNote,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { lucideSvg } from './icons';

export interface MossTaskCheckboxStatus {
  icon?: LucideIcon;
  label?: string;
  completed?: boolean;
  filled?: boolean;
  toggleTo?: string;
}

export interface ResolvedTaskCheckboxStatus {
  icon: LucideIcon;
  label: string;
  completed: boolean;
  filled: boolean;
  toggleTo: string | null;
}

export const DEFAULT_TASK_CHECKBOXES: Record<
  string,
  ResolvedTaskCheckboxStatus
> = {
  ' ': { icon: Square, label: 'To Do', completed: false, filled: false, toggleTo: 'x' },
  '/': { icon: LoaderCircle, label: 'In Progress', completed: false, filled: false, toggleTo: null },
  x: { icon: Check, label: 'Done', completed: true, filled: false, toggleTo: ' ' },
  '-': { icon: Minus, label: 'Cancelled', completed: false, filled: false, toggleTo: null },
  '<': { icon: CalendarCheck, label: 'Scheduled', completed: false, filled: false, toggleTo: null },
  '!': { icon: CircleAlert, label: 'Important', completed: false, filled: false, toggleTo: null },
  '?': { icon: CircleQuestionMark, label: 'Question', completed: false, filled: false, toggleTo: null },
  i: { icon: Info, label: 'Information', completed: false, filled: false, toggleTo: null },
  S: { icon: BadgeDollarSign, label: 'Amount', completed: false, filled: false, toggleTo: null },
  '*': { icon: Star, label: 'Star', completed: false, filled: true, toggleTo: null },
  b: { icon: Bookmark, label: 'Bookmark', completed: false, filled: true, toggleTo: null },
  '"': { icon: Quote, label: 'Quote', completed: false, filled: false, toggleTo: null },
  n: { icon: StickyNote, label: 'Note', completed: false, filled: false, toggleTo: null },
  l: { icon: MapPin, label: 'Location', completed: false, filled: false, toggleTo: null },
  I: { icon: Lightbulb, label: 'Idea', completed: false, filled: false, toggleTo: null },
  p: { icon: ThumbsUp, label: 'Pro', completed: false, filled: false, toggleTo: null },
  c: { icon: ThumbsDown, label: 'Con', completed: false, filled: false, toggleTo: null },
  u: { icon: TrendingUp, label: 'Up', completed: false, filled: false, toggleTo: null },
  d: { icon: TrendingDown, label: 'Down', completed: false, filled: false, toggleTo: null },
};

export const taskCheckboxConfigFacet = Facet.define<
  Partial<Record<string, MossTaskCheckboxStatus>>,
  Partial<Record<string, MossTaskCheckboxStatus>>
>({
  combine: (values) => values[0] ?? {},
});

function normalizeTaskStatusKey(raw: string): string | null {
  if (raw === '\\*' || raw === '*') return '*';
  if (raw === 'X' || raw === 'x') return 'x';
  if (raw.length === 1 || (raw.length === 2 && raw.startsWith('-'))) {
    return raw;
  }
  return null;
}

export function resolveTaskCheckboxStatus(
  key: string,
  config: Partial<Record<string, MossTaskCheckboxStatus>>,
): ResolvedTaskCheckboxStatus | null {
  const emptyVariant = key.startsWith('-') && key.length > 1;
  const baseKey = emptyVariant ? key.slice(1) : key;
  const defaults = DEFAULT_TASK_CHECKBOXES[key] ?? DEFAULT_TASK_CHECKBOXES[baseKey];
  const override = config[key];
  const baseOverride = emptyVariant ? config[baseKey] : undefined;
  if (!defaults && !override && !baseOverride) return null;
  const fallbackToggleTo =
    key === ' ' ? 'x' : key === 'x' ? ' ' : emptyVariant ? baseKey : `-${key}`;
  const toggleTo =
    override?.toggleTo ??
    (emptyVariant
      ? baseOverride?.toggleTo ?? fallbackToggleTo
      : defaults?.toggleTo ?? fallbackToggleTo);
  return {
    icon:
      override?.icon ??
      (emptyVariant ? Circle : undefined) ??
      defaults?.icon ??
      baseOverride?.icon ??
      Circle,
    label:
      override?.label ??
      baseOverride?.label ??
      defaults?.label ??
      `Task: ${baseKey}`,
    completed: emptyVariant
      ? false
      : override?.completed ?? defaults?.completed ?? false,
    filled: emptyVariant
      ? false
      : override?.filled ?? defaults?.filled ?? false,
    toggleTo,
  };
}

export function shouldUseNativeTaskCheckbox(
  key: string,
  config: Partial<Record<string, MossTaskCheckboxStatus>>,
): boolean {
  return (key === ' ' || key === 'x') && config[key]?.icon == null;
}

export interface ParsedTaskMarker {
  key: string;
  raw: string;
  markerFrom: number;
  markerTo: number;
  listFrom: number;
  separator: string;
  status: ResolvedTaskCheckboxStatus;
}

function parseTaskMarker(
  lineText: string,
  markerFrom: number,
  listFrom: number,
  config: Partial<Record<string, MossTaskCheckboxStatus>>,
): ParsedTaskMarker | null {
  const match = lineText.slice(markerFrom).match(/^\[([^\]]+)\]/);
  if (!match) return null;
  const key = normalizeTaskStatusKey(match[1]);
  if (key == null) return null;
  const markerTo = markerFrom + match[0].length;
  const separator = lineText.slice(markerTo).match(/^\s/)?.[0] ?? '';
  if (markerTo < lineText.length && separator === '') return null;
  const status = resolveTaskCheckboxStatus(key, config);
  if (!status) return null;
  return {
    key,
    raw: match[0],
    markerFrom,
    markerTo,
    listFrom,
    separator,
    status,
  };
}

export function parseListTaskMarker(
  lineText: string,
  config: Partial<Record<string, MossTaskCheckboxStatus>>,
): ParsedTaskMarker | null {
  const listMatch = lineText.match(/^(\s*)([-*+])(\s+)/);
  if (!listMatch) return null;
  const [, indent] = listMatch;
  const markerFrom = listMatch[0].length;
  return parseTaskMarker(lineText, markerFrom, indent.length, config);
}

export function fencedCodeSource(doc: Text, from: number, to: number): string {
  const raw = doc.sliceString(from, to);
  const lines = raw.split('\n');
  if (lines.length < 2) return raw;
  if (!/^ {0,3}(`{3,}|~{3,})/.test(lines[0])) return raw;
  if (!/^ {0,3}(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1])) return raw;
  return lines.slice(1, -1).join('\n');
}

export class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className =
      'cm-moss-list-marker cm-moss-unordered-marker cm-moss-bullet';
    span.textContent = '•';
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export const BULLET_WIDGET = new BulletWidget();

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back to the legacy path below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (document.execCommand('copy')) return;
  } finally {
    textarea.remove();
  }

  throw new Error('Copy failed');
}

const CODE_COPY_ICON = lucideSvg(Copy, { size: 16 });
const CODE_COPY_SUCCESS_ICON = lucideSvg(Check, { size: 16 });

export class CodeCopyWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }

  private button: HTMLButtonElement | null = null;
  private copiedTimer: number | null = null;

  eq(other: CodeCopyWidget): boolean {
    return other.code === this.code;
  }

  private setCopied(copied: boolean): void {
    if (!this.button) return;
    this.button.classList.toggle('is-copied', copied);
    this.button.innerHTML = copied ? CODE_COPY_SUCCESS_ICON : CODE_COPY_ICON;
    this.button.setAttribute('aria-label', copied ? 'Copied' : 'Copy code');
    this.button.title = copied ? 'Copied' : 'Copy code';
  }

  private clearTimer(): void {
    if (this.copiedTimer != null) {
      window.clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
  }

  private flashCopied(): void {
    this.clearTimer();
    this.setCopied(true);
    this.copiedTimer = window.setTimeout(() => {
      this.copiedTimer = null;
      this.setCopied(false);
    }, 1200);
  }

  toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-moss-code-copy';
    button.innerHTML = CODE_COPY_ICON;
    button.setAttribute('aria-label', 'Copy code');
    button.title = 'Copy code';
    this.button = button;
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const copied = await copyTextToClipboard(this.code)
        .then(() => true)
        .catch(() => false);
      if (copied) this.flashCopied();
    });
    return button;
  }

  destroy(): void {
    this.clearTimer();
    this.button = null;
  }

  ignoreEvent(event: Event): boolean {
    return event.type === 'mousedown' || event.type === 'click';
  }
}

export class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly raw: string,
    readonly status: ResolvedTaskCheckboxStatus,
    readonly markerFrom: number,
    readonly native = key === ' ' || key === 'x',
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return (
      other.key === this.key &&
      other.raw === this.raw &&
      other.status.icon === this.status.icon &&
      other.status.label === this.status.label &&
      other.status.completed === this.status.completed &&
      other.status.filled === this.status.filled &&
      other.markerFrom === this.markerFrom &&
      other.native === this.native
    );
  }

  toDOM(view: EditorView): HTMLElement {
    if (!this.native) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className =
        `cm-moss-list-marker cm-moss-unordered-marker cm-moss-task-status${
          this.key.startsWith('-') ? ' cm-moss-task-status-empty' : ''
        }`;
      button.setAttribute('contenteditable', 'false');
      button.setAttribute('aria-label', this.status.label);
      button.title = this.status.label;
      button.dataset.status = this.key;
      if (this.status.icon !== Circle) {
        button.innerHTML = lucideSvg(this.status.icon, {
          size: 17,
          strokeWidth: 2.5,
          fill: this.status.filled ? 'currentColor' : 'none',
          'aria-hidden': 'true',
        });
      }
      this.bindToggle(button, view);
      return button;
    }

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-moss-task-checkbox';
    input.checked = this.status.completed;
    input.className =
      'cm-moss-list-marker cm-moss-unordered-marker cm-moss-task-checkbox';
    input.setAttribute('contenteditable', 'false');
    input.setAttribute('aria-label', this.status.label);
    input.title = this.status.label;
    input.dataset.status = this.key;
    this.bindToggle(input, view);
    return input;
  }

  private bindToggle(element: HTMLElement, view: EditorView): void {
    element.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = view.state.doc.sliceString(
        this.markerFrom,
        this.markerFrom + this.raw.length,
      );
      if (current !== this.raw) return;

      const config = view.state.facet(taskCheckboxConfigFacet);
      const nextKey = this.status.toggleTo;
      if (!nextKey || !resolveTaskCheckboxStatus(nextKey, config)) return;
      const nextRaw = `[${nextKey}]`;
      view.dispatch({
        changes: {
          from: this.markerFrom,
          to: this.markerFrom + this.raw.length,
          insert: nextRaw,
        },
      });
    });
  }

  ignoreEvent(event: Event): boolean {
    return event.type === 'mousedown' || event.type === 'click';
  }
}
