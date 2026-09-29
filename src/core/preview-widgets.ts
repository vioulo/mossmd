import { Facet, type Text } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import {
  appendMossIcon,
  EMPTY_MOSS_ICON,
  type MossIconKey,
  type MossIconMap,
  type MossIconRenderer,
  mossIconFacet,
  resolveMossIcon,
} from './icons';

export interface MossTaskCheckboxStatus {
  icon?: MossIconRenderer;
  label?: string;
  completed?: boolean;
  filled?: boolean;
  toggleTo?: string;
}

export interface ResolvedTaskCheckboxStatus {
  icon: MossIconRenderer;
  label: string;
  completed: boolean;
  filled: boolean;
  toggleTo: string | null;
}

interface DefaultTaskCheckboxStatus {
  iconKey: MossIconKey;
  label: string;
  completed: boolean;
  filled: boolean;
  toggleTo: string | null;
}

export const DEFAULT_TASK_CHECKBOXES: Record<
  string,
  DefaultTaskCheckboxStatus
> = {
  ' ': { iconKey: 'task.todo', label: 'To Do', completed: false, filled: false, toggleTo: 'x' },
  '/': { iconKey: 'task.in-progress', label: 'In Progress', completed: false, filled: false, toggleTo: null },
  x: { iconKey: 'task.done', label: 'Done', completed: true, filled: false, toggleTo: ' ' },
  '-': { iconKey: 'task.cancelled', label: 'Cancelled', completed: false, filled: false, toggleTo: null },
  '<': { iconKey: 'task.scheduled', label: 'Scheduled', completed: false, filled: false, toggleTo: null },
  '!': { iconKey: 'task.important', label: 'Important', completed: false, filled: false, toggleTo: null },
  '?': { iconKey: 'task.question', label: 'Question', completed: false, filled: false, toggleTo: null },
  i: { iconKey: 'task.info', label: 'Information', completed: false, filled: false, toggleTo: null },
  S: { iconKey: 'task.amount', label: 'Amount', completed: false, filled: false, toggleTo: null },
  '*': { iconKey: 'task.star', label: 'Star', completed: false, filled: true, toggleTo: null },
  b: { iconKey: 'task.bookmark', label: 'Bookmark', completed: false, filled: true, toggleTo: null },
  '"': { iconKey: 'task.quote', label: 'Quote', completed: false, filled: false, toggleTo: null },
  n: { iconKey: 'task.note', label: 'Note', completed: false, filled: false, toggleTo: null },
  l: { iconKey: 'task.location', label: 'Location', completed: false, filled: false, toggleTo: null },
  I: { iconKey: 'task.idea', label: 'Idea', completed: false, filled: false, toggleTo: null },
  p: { iconKey: 'task.pro', label: 'Pro', completed: false, filled: false, toggleTo: null },
  c: { iconKey: 'task.con', label: 'Con', completed: false, filled: false, toggleTo: null },
  u: { iconKey: 'task.up', label: 'Up', completed: false, filled: false, toggleTo: null },
  d: { iconKey: 'task.down', label: 'Down', completed: false, filled: false, toggleTo: null },
};

const EMPTY_TASK_ICON = EMPTY_MOSS_ICON;

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
  iconMap: MossIconMap = {},
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
      (emptyVariant ? iconMap['task.empty'] ?? EMPTY_TASK_ICON : undefined) ??
      (defaults ? resolveMossIcon(defaults.iconKey, iconMap) : undefined) ??
      baseOverride?.icon ??
      EMPTY_TASK_ICON,
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
  iconMap: MossIconMap = {},
): ParsedTaskMarker | null {
  const match = lineText.slice(markerFrom).match(/^\[([^\]]+)\]/);
  if (!match) return null;
  const key = normalizeTaskStatusKey(match[1]);
  if (key == null) return null;
  const markerTo = markerFrom + match[0].length;
  const separator = lineText.slice(markerTo).match(/^\s/)?.[0] ?? '';
  if (markerTo < lineText.length && separator === '') return null;
  const status = resolveTaskCheckboxStatus(key, config, iconMap);
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
  iconMap: MossIconMap = {},
): ParsedTaskMarker | null {
  const listMatch = lineText.match(/^(\s*)([-*+])(\s+)/);
  if (!listMatch) return null;
  const [, indent] = listMatch;
  const markerFrom = listMatch[0].length;
  return parseTaskMarker(lineText, markerFrom, indent.length, config, iconMap);
}

export function fencedCodeSource(doc: Text, from: number, to: number): string {
  const raw = doc.sliceString(from, to);
  const lines = raw.split('\n');
  if (lines.length < 2) return raw;
  if (!/^ {0,3}(`{3,}|~{3,})/.test(lines[0])) return raw;
  if (!/^ {0,3}(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1])) return raw;
  return lines.slice(1, -1).join('\n');
}

const BULLET_SYMBOLS = ['✦', '✧'] as const;

export class BulletWidget extends WidgetType {
  private readonly symbol: (typeof BULLET_SYMBOLS)[number];

  constructor(depth: number) {
    super();
    this.symbol = BULLET_SYMBOLS[Math.abs(depth) % BULLET_SYMBOLS.length];
  }

  eq(other: BulletWidget): boolean {
    return other.symbol === this.symbol;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className =
      'cm-moss-list-marker cm-moss-unordered-marker cm-moss-bullet';
    span.textContent = this.symbol;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

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

export class CodeCopyWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }

  private button: HTMLButtonElement | null = null;
  private copiedTimer: number | null = null;
  private copyIcon: MossIconRenderer = EMPTY_MOSS_ICON;
  private copiedIcon: MossIconRenderer = EMPTY_MOSS_ICON;

  eq(other: CodeCopyWidget): boolean {
    return other.code === this.code;
  }

  private setCopied(copied: boolean): void {
    if (!this.button) return;
    this.button.classList.toggle('is-copied', copied);
    appendMossIcon(
      this.button,
      copied ? this.copiedIcon : this.copyIcon,
    );
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

  toDOM(view: EditorView): HTMLElement {
    const iconMap = view.state.facet(mossIconFacet);
    this.copyIcon = resolveMossIcon('code.copy', iconMap);
    this.copiedIcon = resolveMossIcon('code.copied', iconMap);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-moss-code-copy';
    appendMossIcon(button, this.copyIcon);
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
      if (this.status.icon !== EMPTY_TASK_ICON) {
        appendMossIcon(button, this.status.icon, {
          size: 17,
          strokeWidth: 2.5,
          fill: this.status.filled ? 'currentColor' : 'none',
          ariaHidden: true,
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
      if (
        !nextKey ||
        !resolveTaskCheckboxStatus(
          nextKey,
          config,
          view.state.facet(mossIconFacet),
        )
      ) return;
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
