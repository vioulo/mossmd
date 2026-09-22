// File input, upload progress blocks, and upload commands.
//
// The document remains plain markdown while an upload is in flight. Pending
// items live in a CM6 StateField, while File objects, abort controllers, and
// uploader callbacks live in the runtime maps below.

import {
  Facet,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { File as FileIconLucide, RotateCcw, X } from 'lucide-react';
import {
  appendMossIcon,
  mossLucideIcon,
  type MossIconRenderer,
} from '../../core/icons';
import { readOnlyFacet } from '../../core/read-only';
import type { MossSlashCommand } from '../slash-commands';

const DEFAULT_MAX_CONCURRENCY = 3;

export type MossUploadKind = 'image' | 'file';

export interface MossUploadResult {
  url: string;
  /** Override the input kind used to format the final markdown. */
  kind?: MossUploadKind;
}

export type MossUploader = (
  file: File,
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
) => Promise<MossUploadResult>;

export interface MossUploadItem {
  file: File;
  /** Defaults to image for image/* MIME types and file otherwise. */
  kind?: MossUploadKind;
}

export type MossUploadRejectReason =
  | 'max-files'
  | 'max-file-size'
  | 'max-total-size'
  | 'accept';

export interface MossUploadIcons {
  file: MossIconRenderer;
  retry: MossIconRenderer;
  cancel: MossIconRenderer;
}

export interface MossUploadOptions {
  resolveKind?: (file: File) => MossUploadKind;
  maxFiles?: number;
  maxFileSize?: number;
  maxTotalSize?: number;
  maxConcurrency?: number;
  accept?: string | readonly string[];
  onRejected?: (
    files: readonly File[],
    reason: MossUploadRejectReason,
  ) => void;
}

export interface MossUploadBlockConfig {
  /** Override icons rendered by upload progress blocks. */
  icons?: Partial<MossUploadIcons>;
}

export interface MossFileUploadConfig
  extends MossUploadOptions,
    MossUploadBlockConfig {
  uploader: MossUploader;
}

const DEFAULT_UPLOAD_ICONS: MossUploadIcons = {
  file: mossLucideIcon(FileIconLucide, { size: 22 }),
  retry: mossLucideIcon(RotateCcw, { size: 14 }),
  cancel: mossLucideIcon(X, { size: 14 }),
};

const uploadIconsFacet = Facet.define<MossUploadIcons, MossUploadIcons>({
  combine: (values) => values[0] ?? DEFAULT_UPLOAD_ICONS,
});

function resolveUploadIcons(
  config: MossUploadBlockConfig = {},
): MossUploadIcons {
  return { ...DEFAULT_UPLOAD_ICONS, ...config.icons };
}

interface UploadEntry {
  id: string;
  batchId: string;
  index: number;
  pos: number;
  to: number;
  kind: MossUploadKind;
  fileName: string;
  fileSize: number;
  fileType: string;
  localUrl: string;
  phase: 'uploading' | 'waiting' | 'error';
  progress: number;
  error?: string;
}

interface UploadRegistration {
  id: string;
  batchId: string;
  index: number;
  pos: number;
  to: number;
  kind: MossUploadKind;
  fileName: string;
  fileSize: number;
  fileType: string;
  localUrl: string;
}

type RuntimeStatus =
  | 'pending'
  | 'uploading'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'committed';

interface RuntimeItem {
  id: string;
  batchId: string;
  index: number;
  file: File;
  fileName: string;
  uploader: MossUploader;
  kind: MossUploadKind;
  localUrl: string;
  view: EditorView;
  controller: AbortController;
  lastProgress: number;
  status: RuntimeStatus;
  result?: MossUploadResult;
}

interface BatchRuntime {
  id: string;
  view: EditorView;
  items: RuntimeItem[];
  nextIndex: number;
  maxConcurrency: number;
}

const runtimeItems = new Map<string, RuntimeItem>();
const runtimeBatches = new Map<string, BatchRuntime>();

export const uploadEffects = {
  register: StateEffect.define<UploadRegistration>(),
  progress: StateEffect.define<{ id: string; progress: number }>(),
  waiting: StateEffect.define<{ id: string }>(),
  error: StateEffect.define<{ id: string; error: string }>(),
  retry: StateEffect.define<{ id: string }>(),
  remove: StateEffect.define<{ id: string }>(),
};

function applyEffects(entries: UploadEntry[], tr: Transaction): UploadEntry[] {
  let next = entries;
  for (const effect of tr.effects) {
    if (effect.is(uploadEffects.register)) {
      const registration = effect.value;
      next = [
        ...next,
        {
          ...registration,
          phase: 'uploading',
          progress: 0,
        },
      ];
    } else if (effect.is(uploadEffects.progress)) {
      const { id, progress } = effect.value;
      next = next.map((entry) =>
        entry.id === id
          ? { ...entry, progress, phase: 'uploading', error: undefined }
          : entry,
      );
    } else if (effect.is(uploadEffects.waiting)) {
      const { id } = effect.value;
      next = next.map((entry) =>
        entry.id === id ? { ...entry, phase: 'waiting' } : entry,
      );
    } else if (effect.is(uploadEffects.error)) {
      const { id, error } = effect.value;
      next = next.map((entry) =>
        entry.id === id ? { ...entry, phase: 'error', error } : entry,
      );
    } else if (effect.is(uploadEffects.retry)) {
      const { id } = effect.value;
      next = next.map((entry) =>
        entry.id === id
          ? { ...entry, phase: 'uploading', progress: 0, error: undefined }
          : entry,
      );
    } else if (effect.is(uploadEffects.remove)) {
      const { id } = effect.value;
      next = next.filter((entry) => entry.id !== id);
    }
  }
  return next;
}

const uploadField = StateField.define<UploadEntry[]>({
  create: () => [],
  update(entries, tr) {
    if (!tr.docChanged && tr.effects.length === 0) return entries;
    const mapped = tr.docChanged
      ? entries.map((entry) => ({
          ...entry,
          // Mapping with assoc=1 keeps pending uploads after text inserted
          // at their target instead of allowing a later upload to overwrite it.
          pos: tr.changes.mapPos(entry.pos, 1),
          to: tr.changes.mapPos(entry.to, 1),
        }))
      : entries;
    return tr.effects.length > 0 ? applyEffects(mapped, tr) : mapped;
  },
  provide: (field) => EditorView.decorations.from(field, buildDecorations),
});

function buildDecorations(entries: UploadEntry[]): DecorationSet {
  if (entries.length === 0) return Decoration.none;
  const ranges = entries.map((entry) =>
    Decoration.widget({
      widget: new UploadWidget(entry),
      block: true,
      side: 1,
    }).range(entry.pos),
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
    const entry = this.entry;
    const wrap = document.createElement('div');
    wrap.className = 'cm-moss-upload';
    wrap.dataset.id = entry.id;

    const preview = document.createElement('div');
    preview.className = 'cm-moss-upload-preview';
    if (entry.kind === 'image') {
      const image = document.createElement('img');
      image.src = entry.localUrl;
      image.alt = entry.fileName;
      preview.appendChild(image);
    } else {
      preview.classList.add('cm-moss-upload-preview-file');
      const glyph = document.createElement('span');
      glyph.className = 'cm-moss-upload-file-glyph';
      appendMossIcon(glyph, view.state.facet(uploadIconsFacet).file);
      const extension = document.createElement('span');
      extension.className = 'cm-moss-upload-ext';
      extension.textContent = extOf(entry.fileName) || 'FILE';
      preview.append(glyph, extension);
    }

    const body = document.createElement('div');
    body.className = 'cm-moss-upload-body';
    const meta = document.createElement('div');
    meta.className = 'cm-moss-upload-meta';
    meta.textContent = `${entry.fileName} · ${formatBytes(entry.fileSize)}`;

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
    const entry = this.entry;
    const bar = dom.querySelector<HTMLElement>('.cm-moss-upload-bar');
    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(1, entry.progress)) * 100}%`;
    }

    const status = dom.querySelector<HTMLElement>('.cm-moss-upload-status');
    if (status) {
      const pct = Math.round(entry.progress * 100);
      status.textContent =
        entry.phase === 'error'
          ? `Failed: ${entry.error ?? 'unknown error'}`
          : entry.phase === 'waiting'
            ? 'Waiting for earlier files'
            : `Uploading ${pct}%`;
      status.classList.toggle('is-error', entry.phase === 'error');
    }

    const actions = dom.querySelector<HTMLElement>('.cm-moss-upload-actions');
    if (!actions) return;
    actions.replaceChildren();
    if (entry.phase === 'error') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'cm-moss-upload-btn retry';
      appendMossIcon(retry, view.state.facet(uploadIconsFacet).retry);
      retry.title = 'Retry upload';
      retry.setAttribute('aria-label', 'Retry upload');
      retry.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        retryUpload(view, entry.id);
      });
      actions.appendChild(retry);
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cm-moss-upload-btn cancel';
    appendMossIcon(cancel, view.state.facet(uploadIconsFacet).cancel);
    cancel.title = 'Cancel upload';
    cancel.setAttribute('aria-label', 'Cancel upload');
    cancel.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelUpload(view, entry.id);
    });
    actions.appendChild(cancel);
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function uploadBlockExtensions(
  config: MossUploadBlockConfig = {},
): Extension[] {
  return [
    uploadIconsFacet.of(resolveUploadIcons(config)),
    uploadField,
    uploadCleanupPlugin,
  ];
}

export function mossUploadBlocks(
  config: MossUploadBlockConfig = {},
): Extension {
  return uploadBlockExtensions(config);
}

export function mossFileUpload(config: MossFileUploadConfig): Extension {
  return [
    ...uploadBlockExtensions(config),
    Prec.high(
      EditorView.domEventHandlers({
        paste: (event, view) => {
          if (event.defaultPrevented || !canUpload(view)) return false;
          if (isInsideTableCell(event.target)) return false;
          const files = filesFromDataTransfer(event.clipboardData);
          if (files.length === 0) return false;
          event.preventDefault();
          const { from, to } = view.state.selection.main;
          beginUploads(
            view,
            from,
            to,
            files.map((file) => ({ file })),
            config.uploader,
            config,
          );
          return true;
        },
        dragover: (event, view) => {
          if (event.defaultPrevented || !canUpload(view)) return false;
          if (filesFromDataTransfer(event.dataTransfer).length === 0) return false;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
          return true;
        },
        drop: (event, view) => {
          if (event.defaultPrevented || !canUpload(view)) return false;
          if (isInsideTableCell(event.target)) return false;
          const files = filesFromDataTransfer(event.dataTransfer);
          if (files.length === 0) return false;
          event.preventDefault();
          const coords = { x: event.clientX, y: event.clientY };
          const pos = view.posAtCoords(coords) ?? view.state.selection.main.from;
          beginUploads(
            view,
            pos,
            pos,
            files.map((file) => ({ file })),
            config.uploader,
            config,
          );
          return true;
        },
      }),
    ),
  ];
}

export function beginUpload(
  view: EditorView,
  anchorPos: number,
  kind: MossUploadKind,
  file: File,
  uploader: MossUploader,
): void {
  beginUploads(view, anchorPos, anchorPos, [{ file, kind }], uploader);
}

export function beginUploads(
  view: EditorView,
  from: number,
  to: number,
  items: readonly MossUploadItem[],
  uploader: MossUploader,
  options: MossUploadOptions = {},
): void {
  if (!canUpload(view) || items.length === 0) return;

  const accepted = selectUploadItems(items, options);
  if (accepted.length === 0) return;

  const batchId = genId();
  const start = Math.max(0, Math.min(from, view.state.doc.length));
  const end = Math.max(start, Math.min(to, view.state.doc.length));
  const batch: BatchRuntime = {
    id: batchId,
    view,
    items: [],
    nextIndex: 0,
    maxConcurrency: normalizeConcurrency(options.maxConcurrency),
  };

  for (const [index, item] of accepted.entries()) {
    const id = genId();
    const localUrl = createLocalUrl(item.file);
    const runtimeItem: RuntimeItem = {
      id,
      batchId,
      index,
      file: item.file,
      fileName: safeFileName(item.file.name, item.kind),
      uploader,
      kind: item.kind,
      localUrl,
      view,
      controller: new AbortController(),
      lastProgress: 0,
      status: 'pending',
    };
    runtimeItems.set(id, runtimeItem);
    batch.items.push(runtimeItem);
  }
  runtimeBatches.set(batchId, batch);

  view.dispatch({
    effects: batch.items.map((item) =>
      uploadEffects.register.of({
        id: item.id,
        batchId,
        index: item.index,
        pos: start,
        // Only the first item owns the selected range. The remaining items
        // are inserted at the mapped position after the first block.
        to: item.index === 0 ? end : start,
        kind: item.kind,
        fileName: item.fileName,
        fileSize: item.file.size,
        fileType: item.file.type,
        localUrl: item.localUrl,
      }),
    ),
  });

  scheduleBatch(batch);
}

export function retryUpload(view: EditorView, id: string): void {
  const item = runtimeItems.get(id);
  if (!item || item.view !== view || item.status !== 'error') return;
  const batch = runtimeBatches.get(item.batchId);
  if (!batch || !hasEntry(view, id)) return;

  item.status = 'pending';
  item.controller = new AbortController();
  item.lastProgress = 0;
  view.dispatch({ effects: uploadEffects.retry.of({ id }) });
  scheduleBatch(batch);
}

export function cancelUpload(view: EditorView, id: string): void {
  const item = runtimeItems.get(id);
  if (!item || item.view !== view) return;
  const batch = runtimeBatches.get(item.batchId);
  item.status = 'cancelled';
  item.controller.abort();
  removeRuntimeItem(item);
  if (hasEntry(view, id)) {
    view.dispatch({ effects: uploadEffects.remove.of({ id }) });
  }
  if (batch) {
    flushBatch(batch);
    scheduleBatch(batch);
  }
}

export function filesFromDataTransfer(
  transfer: DataTransfer | null,
): File[] {
  if (!transfer) return [];
  const direct = Array.from(transfer.files ?? []);
  if (direct.length > 0) return uniqueFiles(direct);

  const fromItems: File[] = [];
  for (const item of Array.from(transfer.items ?? [])) {
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  return uniqueFiles(fromItems);
}

async function runUpload(item: RuntimeItem): Promise<void> {
  item.status = 'uploading';
  const onProgress = (ratio: number): void => {
    if (isCancelled(item) || !hasEntry(item.view, item.id)) return;
    const progress = Math.max(0, Math.min(1, ratio));
    if (Math.abs(progress - item.lastProgress) < 0.02 && progress < 1) return;
    item.lastProgress = progress;
    safeDispatch(item.view, {
      effects: uploadEffects.progress.of({ id: item.id, progress }),
    });
  };

  try {
    const result = await item.uploader(
      item.file,
      onProgress,
      item.controller.signal,
    );
    if (isCancelled(item) || !hasEntry(item.view, item.id)) return;
    assertSafeUrl(result.url);
    item.result = result;
    item.status = 'success';
    safeDispatch(item.view, {
      effects: [
        uploadEffects.progress.of({ id: item.id, progress: 1 }),
        uploadEffects.waiting.of({ id: item.id }),
      ],
    });
    const batch = runtimeBatches.get(item.batchId);
    if (batch) {
      flushBatch(batch);
      scheduleBatch(batch);
    }
  } catch (error) {
    if (isCancelled(item)) return;
    item.status = 'error';
    const message = error instanceof Error ? error.message : String(error);
    if (hasEntry(item.view, item.id)) {
      safeDispatch(item.view, {
        effects: uploadEffects.error.of({ id: item.id, error: message }),
      });
    }
    const batch = runtimeBatches.get(item.batchId);
    if (batch) scheduleBatch(batch);
  }
}

function flushBatch(batch: BatchRuntime): void {
  if (!isViewUsable(batch.view)) {
    cleanupBatch(batch);
    return;
  }

  const cancelled: RuntimeItem[] = [];
  const ready: RuntimeItem[] = [];
  while (batch.nextIndex < batch.items.length) {
    const item = batch.items[batch.nextIndex];
    if (item.status === 'cancelled') {
      cancelled.push(item);
      batch.nextIndex++;
      continue;
    }
    if (item.status === 'success') {
      ready.push(item);
      batch.nextIndex++;
      continue;
    }
    break;
  }

  if (cancelled.length > 0 && ready.length === 0) {
    safeDispatch(batch.view, {
      effects: cancelled.map((item) => uploadEffects.remove.of({ id: item.id })),
    });
    for (const item of cancelled) removeRuntimeItem(item);
    flushBatch(batch);
    return;
  }

  if (ready.length === 0) {
    cleanupBatch(batch);
    return;
  }

  const firstEntry = readEntry(batch.view, ready[0].id);
  if (!firstEntry) {
    for (const item of [...cancelled, ...ready]) {
      item.status = 'committed';
      removeRuntimeItem(item);
    }
    flushBatch(batch);
    return;
  }

  const markdowns = ready.map((item) =>
    formatMarkdown(
      item.kind,
      item.fileName,
      item.result?.url ?? '',
      item.result?.kind,
    ),
  );
  const insertion = buildBlockInsertion(
    batch.view,
    firstEntry.pos,
    firstEntry.to,
    markdowns,
  );
  const effects = [
    ...cancelled.map((item) => uploadEffects.remove.of({ id: item.id })),
    ...ready.map((item) => uploadEffects.remove.of({ id: item.id })),
  ];

  try {
    batch.view.dispatch({
      changes: {
        from: firstEntry.pos,
        to: firstEntry.to,
        insert: insertion.text,
      },
      effects,
      selection: { anchor: firstEntry.pos + insertion.caretOffset },
    });
  } catch {
    cleanupBatch(batch);
    return;
  }

  for (const item of [...cancelled, ...ready]) {
    item.status = 'committed';
    removeRuntimeItem(item);
  }
  flushBatch(batch);
}

function scheduleBatch(batch: BatchRuntime): void {
  if (!runtimeBatches.has(batch.id) || !isViewUsable(batch.view)) {
    cleanupBatch(batch);
    return;
  }
  const active = batch.items.filter((item) => item.status === 'uploading').length;
  const available = Math.max(0, batch.maxConcurrency - active);
  const pending = batch.items.filter((item) => item.status === 'pending');
  for (const item of pending.slice(0, available)) {
    void runUpload(item);
  }
  cleanupBatch(batch);
}

function cleanupBatch(batch: BatchRuntime): void {
  const hasLiveItems = batch.items.some(
    (item) =>
      item.status !== 'committed' &&
      item.status !== 'cancelled',
  );
  if (!hasLiveItems) runtimeBatches.delete(batch.id);
}

function cleanupUploadsForView(view: EditorView): void {
  for (const batch of Array.from(runtimeBatches.values())) {
    if (batch.view !== view) continue;
    for (const item of batch.items) {
      item.status = 'cancelled';
      item.controller.abort();
      removeRuntimeItem(item);
    }
    runtimeBatches.delete(batch.id);
  }
}

function removeRuntimeItem(item: RuntimeItem): void {
  runtimeItems.delete(item.id);
  revokeLocalUrl(item.localUrl);
}

const uploadCleanupPlugin = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}

    destroy(): void {
      cleanupUploadsForView(this.view);
    }
  },
);

function canUpload(view: EditorView): boolean {
  return !view.state.facet(readOnlyFacet) && !view.state.readOnly;
}

function isInsideTableCell(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    Boolean(target.closest('.cm-moss-table-cell, .cm-moss-table-cell-source'));
}

function safeDispatch(
  view: EditorView,
  spec: Parameters<EditorView['dispatch']>[0],
): void {
  if (isViewUsable(view)) view.dispatch(spec);
}

function isViewUsable(view: EditorView): boolean {
  return view.dom.isConnected;
}

function hasEntry(view: EditorView, id: string): boolean {
  const entries = view.state.field(uploadField, false);
  return Array.isArray(entries) && entries.some((entry) => entry.id === id);
}

function readEntry(view: EditorView, id: string): UploadEntry | undefined {
  const entries = view.state.field(uploadField, false);
  return Array.isArray(entries)
    ? entries.find((entry) => entry.id === id)
    : undefined;
}

function buildBlockInsertion(
  view: EditorView,
  from: number,
  to: number,
  markdowns: readonly string[],
): { text: string; caretOffset: number } {
  const doc = view.state.doc;
  const fromLine = doc.lineAt(from);
  const toLine = doc.lineAt(to);
  const before = doc.sliceString(fromLine.from, from);
  const after = doc.sliceString(to, toLine.to);
  const prefix = before.trim() ? '\n\n' : '';
  // Leave a real editable line after an upload at the end of a document.
  // Without it, standalone image/file widgets occupy the visual area below
  // the hidden source line and the caret remains inside that source range.
  const suffix = after.trim() ? '\n\n' : '\n';
  const middle = markdowns.join('\n\n');
  const text = prefix + middle + suffix;
  return { text, caretOffset: text.length };
}

function formatMarkdown(
  kind: MossUploadKind,
  fileName: string,
  url: string,
  resultKind?: MossUploadKind,
): string {
  assertSafeUrl(url);
  const resolvedKind = resultKind ?? kind;
  return resolvedKind === 'file'
    ? `[${fileName}](${url})`
    : `![${fileName}](${url})`;
}

function assertSafeUrl(url: string): void {
  if (!url.trim() || /[\s"')]/.test(url)) {
    throw new Error('Uploader returned an invalid URL');
  }
}

function selectUploadItems(
  items: readonly MossUploadItem[],
  options: MossUploadOptions,
): { file: File; kind: MossUploadKind }[] {
  const accepted: { file: File; kind: MossUploadKind }[] = [];
  const rejected = new Map<MossUploadRejectReason, File[]>();
  const report = (file: File, reason: MossUploadRejectReason) => {
    const files = rejected.get(reason) ?? [];
    files.push(file);
    rejected.set(reason, files);
  };
  const maxFiles = normalizeLimit(options.maxFiles);
  const maxFileSize = normalizeLimit(options.maxFileSize);
  const maxTotalSize = normalizeLimit(options.maxTotalSize);
  const accepts = normalizeAccept(options.accept);
  let totalSize = 0;

  for (const item of items) {
    const file = item.file;
    if (maxFiles !== undefined && accepted.length >= maxFiles) {
      report(file, 'max-files');
      continue;
    }
    if (maxFileSize !== undefined && file.size > maxFileSize) {
      report(file, 'max-file-size');
      continue;
    }
    if (accepts.length > 0 && !matchesAccept(file, accepts)) {
      report(file, 'accept');
      continue;
    }
    if (maxTotalSize !== undefined && totalSize + file.size > maxTotalSize) {
      report(file, 'max-total-size');
      continue;
    }
    totalSize += file.size;
    accepted.push({
      file,
      kind: item.kind ?? options.resolveKind?.(file) ?? defaultKind(file),
    });
  }
  for (const [reason, files] of rejected) {
    options.onRejected?.(files, reason);
  }
  return accepted;
}

function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_CONCURRENCY;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function normalizeAccept(
  accept: string | readonly string[] | undefined,
): string[] {
  if (!accept) return [];
  const values: readonly string[] =
    typeof accept === 'string' ? accept.split(',') : accept;
  return values
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isCancelled(item: RuntimeItem): boolean {
  return item.status === 'cancelled';
}

function matchesAccept(file: File, accepts: readonly string[]): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return accepts.some((accept) => {
    if (accept.startsWith('.')) return name.endsWith(accept);
    if (accept.endsWith('/*')) return type.startsWith(accept.slice(0, -1));
    return type === accept;
  });
}

function defaultKind(file: File): MossUploadKind {
  return file.type.toLowerCase().startsWith('image/') ? 'image' : 'file';
}

function safeFileName(name: string, kind: MossUploadKind): string {
  const cleaned = name
    .replace(/[\[\]|\\\r\n]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || (kind === 'image' ? 'image' : 'file');
}

function uniqueFiles(files: readonly File[]): File[] {
  const seen = new Set<File>();
  const result: File[] = [];
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    result.push(file);
  }
  return result;
}

function createLocalUrl(file: File): string {
  return typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(file)
    : '';
}

function revokeLocalUrl(url: string): void {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `up_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function extOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index + 1).toUpperCase() : '';
}

export function mossUploadCommands(
  uploader: MossUploader,
  options: MossUploadOptions = {},
): MossSlashCommand[] {
  return [
    {
      id: 'upload-image',
      label: 'Upload image',
      detail: 'Pick from disk, upload, insert ![name](url)',
      keywords: ['picture', 'photo', 'image', 'img'],
      icon: 'image',
      apply: async (view, from) => {
        const files = await pickFiles('image/*');
        if (files.length === 0) return;
        const line = view.state.doc.lineAt(from);
        clearTriggerLine(view, line);
        beginUploads(
          view,
          line.from,
          line.from,
          files.map((file) => ({ file, kind: 'image' })),
          uploader,
          options,
        );
      },
    },
    {
      id: 'upload-file',
      label: 'Upload file',
      detail: 'Pick from disk, upload, insert [name](url)',
      keywords: ['attachment', 'file', 'link'],
      icon: 'file',
      apply: async (view, from) => {
        const files = await pickFiles();
        if (files.length === 0) return;
        const line = view.state.doc.lineAt(from);
        clearTriggerLine(view, line);
        beginUploads(
          view,
          line.from,
          line.from,
          files.map((file) => ({ file, kind: 'file' })),
          uploader,
          options,
        );
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

function pickFiles(accept?: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
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
          resolve([]);
        }
      }, 300);
    };
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      resolve(files);
    });
    window.addEventListener('focus', onFocus, true);
    document.body.appendChild(input);
    input.click();
  });
}
