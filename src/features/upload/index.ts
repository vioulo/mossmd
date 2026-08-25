// Upload progress blocks + commands.
//
// Slash commands that upload a resource (image / file) don't insert
// the final markdown immediately — they register a pending upload
// here, which renders a block widget below the cursor's line while
// the uploader runs. The widget shows a local preview on the left
// and progress / status on the right; on success the orchestrator
// replaces the anchor line with the final markdown and the widget
// disappears. On failure the widget shows retry / cancel controls.
//
// Pending uploads live entirely in editor state (no doc marker), so
// they don't pollute raw markdown — copy / save / collab only ever
// see real text. The trade-off: reloading the page mid-upload drops
// the in-flight widget (the network request may still complete, but
// the editor no longer has a place to land the result). Acceptable
// for a transient affordance.
//
// The uploader is supplied by the consumer via
// `mossUploadCommands(uploader)`, so S3 / OSS / Supabase / a custom
// /api/upload all plug in by swapping one function.

import {
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { File as FileIconLucide, RotateCcw, X } from 'lucide-react';
import { lucideSvg } from '../../core/icons';
import type { MossSlashCommand } from '../slash-commands';

const FILE_ICON = lucideSvg(FileIconLucide, { size: 22 });
const RETRY_ICON = lucideSvg(RotateCcw, { size: 14 });
const CANCEL_ICON = lucideSvg(X, { size: 14 });

export type MossUploadKind = 'image' | 'file';

export interface MossUploadResult {
  url: string;
  /** Override the kind used to format the final markdown. If omitted,
   *  the command's own kind is used. */
  kind?: MossUploadKind;
}

export type MossUploader = (
  file: File,
  onProgress: (ratio: number) => void,
) => Promise<MossUploadResult>;

interface UploadEntry {
  id: string;
  pos: number;
  kind: MossUploadKind;
  fileName: string;
  fileSize: number;
  fileType: string;
  localUrl: string;
  phase: 'uploading' | 'error';
  progress: number;
  error?: string;
}

// Runtime bits that can't live in CM6 state (functions, the File
// object, the uploader closure). Keyed by upload id. Cleaned up on
// terminal success / cancel. Retry reuses the entry.
interface Runtime {
  file: File;
  uploader: MossUploader;
  lastProgress: number;
}
const runtime = new Map<string, Runtime>();

export const uploadEffects = {
  register: StateEffect.define<{
    id: string;
    pos: number;
    kind: MossUploadKind;
    fileName: string;
    fileSize: number;
    fileType: string;
    localUrl: string;
  }>(),
  progress: StateEffect.define<{ id: string; progress: number }>(),
  error: StateEffect.define<{ id: string; error: string }>(),
  retry: StateEffect.define<{ id: string }>(),
  remove: StateEffect.define<{ id: string }>(),
};

function applyEffects(entries: UploadEntry[], tr: Transaction): UploadEntry[] {
  let next = entries;
  for (const effect of tr.effects) {
    if (effect.is(uploadEffects.register)) {
      const p = effect.value;
      next = [...next, { ...p, phase: 'uploading' as const, progress: 0 }];
    } else if (effect.is(uploadEffects.progress)) {
      const p = effect.value;
      next = next.map((e) =>
        e.id === p.id ? { ...e, progress: p.progress, phase: 'uploading' as const } : e,
      );
    } else if (effect.is(uploadEffects.error)) {
      const p = effect.value;
      next = next.map((e) =>
        e.id === p.id ? { ...e, phase: 'error' as const, error: p.error } : e,
      );
    } else if (effect.is(uploadEffects.retry)) {
      const p = effect.value;
      next = next.map((e) =>
        e.id === p.id
          ? { ...e, phase: 'uploading' as const, progress: 0, error: undefined }
          : e,
      );
    } else if (effect.is(uploadEffects.remove)) {
      const p = effect.value;
      next = next.filter((e) => e.id !== p.id);
    }
  }
  return next;
}

const uploadField = StateField.define<UploadEntry[]>({
  create: () => [],
  update(entries, tr) {
    if (!tr.docChanged && tr.effects.length === 0) return entries;
    const mapped = tr.docChanged
      ? entries.map((e) => ({ ...e, pos: tr.changes.mapPos(e.pos) }))
      : entries;
    return tr.effects.length > 0 ? applyEffects(mapped, tr) : mapped;
  },
  provide: (f) => EditorView.decorations.from(f, buildDecorations),
});

function buildDecorations(entries: UploadEntry[]): DecorationSet {
  if (entries.length === 0) return Decoration.none;
  const ranges = entries.map((e) =>
    Decoration.widget({
      widget: new UploadWidget(e),
      block: true,
      side: 1,
    }).range(e.pos),
  );
  return Decoration.set(ranges, true);
}

class UploadWidget extends WidgetType {
  constructor(readonly entry: UploadEntry) {
    super();
  }

  eq(other: UploadWidget): boolean {
    const a = this.entry;
    const b = other.entry;
    return (
      a.id === b.id &&
      a.phase === b.phase &&
      a.progress === b.progress &&
      a.error === b.error
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const e = this.entry;
    const wrap = document.createElement('div');
    wrap.className = 'cm-moss-upload';
    wrap.dataset.id = e.id;

    const preview = document.createElement('div');
    preview.className = 'cm-moss-upload-preview';
    if (e.kind === 'image') {
      const img = document.createElement('img');
      img.src = e.localUrl;
      img.alt = e.fileName;
      preview.appendChild(img);
    } else {
      // File kind: a fuller card-style placeholder so the block reads
      // as "complete" like the image thumbnail, not a tiny icon in a
      // big empty box. Big file glyph + extension badge.
      preview.classList.add('cm-moss-upload-preview-file');
      const glyph = document.createElement('span');
      glyph.className = 'cm-moss-upload-file-glyph';
      glyph.innerHTML = FILE_ICON;
      const ext = document.createElement('span');
      ext.className = 'cm-moss-upload-ext';
      ext.textContent = extOf(e.fileName) || 'FILE';
      preview.append(glyph, ext);
    }

    const body = document.createElement('div');
    body.className = 'cm-moss-upload-body';

    const meta = document.createElement('div');
    meta.className = 'cm-moss-upload-meta';
    meta.textContent = `${e.fileName} · ${formatBytes(e.fileSize)}`;

    const progress = document.createElement('div');
    progress.className = 'cm-moss-upload-progress';
    const bar = document.createElement('div');
    bar.className = 'cm-moss-upload-bar';
    progress.appendChild(bar);

    const status = document.createElement('div');
    status.className = 'cm-moss-upload-status';

    const actions = document.createElement('div');
    actions.className = 'cm-moss-upload-actions';

    body.append(meta, progress, status, actions);
    wrap.append(preview, body);

    this.paint(wrap, view);
    return wrap;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    this.paint(dom, view);
    return true;
  }

  paint(dom: HTMLElement, view: EditorView): void {
    const e = this.entry;
    const bar = dom.querySelector<HTMLElement>('.cm-moss-upload-bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(1, e.progress)) * 100}%`;
    const status = dom.querySelector<HTMLElement>('.cm-moss-upload-status');
    if (status) {
      const pct = Math.round(e.progress * 100);
      status.textContent =
        e.phase === 'error'
          ? `Failed: ${e.error ?? 'unknown error'}`
          : `Uploading ${pct}%`;
      status.classList.toggle('is-error', e.phase === 'error');
    }
    const actions = dom.querySelector<HTMLElement>('.cm-moss-upload-actions');
    if (actions) {
      actions.innerHTML = '';
      if (e.phase === 'error') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'cm-moss-upload-btn retry';
        retry.innerHTML = RETRY_ICON;
        retry.title = 'Retry upload';
        retry.addEventListener('click', (ev) => {
          ev.preventDefault();
          retryUpload(view, e.id);
        });
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'cm-moss-upload-btn cancel';
        cancel.innerHTML = CANCEL_ICON;
        cancel.title = 'Cancel upload';
        cancel.addEventListener('click', (ev) => {
          ev.preventDefault();
          cancelUpload(view, e.id);
        });
        actions.append(retry, cancel);
      }
    }
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export function mossUploadBlocks(): Extension {
  return uploadField;
}

export function beginUpload(
  view: EditorView,
  anchorPos: number,
  kind: MossUploadKind,
  file: File,
  uploader: MossUploader,
): void {
  const id = genId();
  const localUrl = URL.createObjectURL(file);
  runtime.set(id, { file, uploader, lastProgress: 0 });
  view.dispatch({
    effects: uploadEffects.register.of({
      id,
      pos: anchorPos,
      kind,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      localUrl,
    }),
  });
  void runUploader(view, id, runtime.get(id)!);
}

export function retryUpload(view: EditorView, id: string): void {
  const rt = runtime.get(id);
  if (!rt) return;
  if (!hasEntry(view, id)) return;
  view.dispatch({ effects: uploadEffects.retry.of({ id }) });
  void runUploader(view, id, rt);
}

export function cancelUpload(view: EditorView, id: string): void {
  const entry = readEntry(view, id);
  runtime.delete(id);
  if (entry?.localUrl) URL.revokeObjectURL(entry.localUrl);
  if (hasEntry(view, id)) {
    view.dispatch({ effects: uploadEffects.remove.of({ id }) });
  }
}

async function runUploader(
  view: EditorView,
  id: string,
  rt: Runtime,
): Promise<void> {
  const onProgress = (ratio: number) => {
    const clamped = Math.max(0, Math.min(1, ratio));
    if (Math.abs(clamped - rt.lastProgress) < 0.02 && clamped < 1) return;
    rt.lastProgress = clamped;
    if (!hasEntry(view, id)) return;
    view.dispatch({ effects: uploadEffects.progress.of({ id, progress: clamped }) });
  };

  try {
    const { url, kind } = await rt.uploader(rt.file, onProgress);
    const entry = readEntry(view, id);
    if (!entry) return; // cancelled or doc no longer has the anchor
    const line = view.state.doc.lineAt(entry.pos);
    const resolvedKind = kind ?? entry.kind;
    const md =
      resolvedKind === 'file'
        ? `[${entry.fileName}](${url})`
        : `![${entry.fileName}](${url})`;
    // For images, drop the caret right after `![name` so the user
    // can type `|caption` to give alt and caption different text,
    // or leave it as-is (the name doubles as caption by default).
    // For files, leave the caret at the end of the inserted link.
    const caret =
      resolvedKind === 'file'
        ? line.from + md.length
        : line.from + 2 + entry.fileName.length;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: md },
      effects: uploadEffects.remove.of({ id }),
      selection: { anchor: caret },
    });
    if (entry.localUrl) URL.revokeObjectURL(entry.localUrl);
    runtime.delete(id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!hasEntry(view, id)) return;
    view.dispatch({ effects: uploadEffects.error.of({ id, error: msg }) });
    // keep runtime so retry can reuse it
  }
}

function hasEntry(view: EditorView, id: string): boolean {
  const entries = view.state.field(uploadField, false);
  return Array.isArray(entries) && entries.some((e) => e.id === id);
}

function readEntry(view: EditorView, id: string): UploadEntry | undefined {
  const entries = view.state.field(uploadField, false);
  return Array.isArray(entries) ? entries.find((e) => e.id === id) : undefined;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `up_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i + 1).toUpperCase() : '';
}

// ---------------------------------------------------------------------------
// Commands
//
// `mossUploadCommands(uploader)` returns upload-image / upload-file
// slash commands wired to the widget flow. On `apply` they pick a
// file, clear any `/query` trigger text on the line, then call
// `beginUpload` which registers the pending entry and kicks off the
// uploader. The `+` button path lands here too (its line is already
// empty, so `clearTriggerLine` is a no-op).
// ---------------------------------------------------------------------------

export function mossUploadCommands(uploader: MossUploader): MossSlashCommand[] {
  return [
    {
      id: 'upload-image',
      label: 'Upload image',
      detail: 'Pick from disk, upload, insert ![alt](url)',
      keywords: ['picture', 'photo', 'image', 'img'],
      icon: 'image',
      apply: async (view, from) => {
        const file = await pickFile('image/*');
        if (!file) return;
        const line = view.state.doc.lineAt(from);
        clearTriggerLine(view, line);
        beginUpload(view, line.from, 'image', file, uploader);
      },
    },
    {
      id: 'upload-file',
      label: 'Upload file',
      detail: 'Pick from disk, upload, link [name](url)',
      keywords: ['attachment', 'file', 'link'],
      icon: 'file',
      apply: async (view, from) => {
        const file = await pickFile();
        if (!file) return;
        const line = view.state.doc.lineAt(from);
        clearTriggerLine(view, line);
        beginUpload(view, line.from, 'file', file, uploader);
      },
    },
  ];
}

function clearTriggerLine(
  view: EditorView,
  line: { from: number; to: number; text: string },
): void {
  if (line.text.trim() === '') return;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: '' },
    selection: { anchor: line.from },
    userEvent: 'input',
  });
}

function pickFile(accept?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.position = 'fixed';
    input.style.top = '-9999px';
    input.style.opacity = '0';

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener('focus', onFocus, true);
    };
    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled && !input.files?.length) {
          cleanup();
          resolve(null);
        }
      }, 300);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    });
    window.addEventListener('focus', onFocus, true);
    document.body.appendChild(input);
    input.click();
  });
}
