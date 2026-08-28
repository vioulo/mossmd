// File link blocks.
//
// When a markdown link `[label](url)` refers to a non-image file (by
// extension) and sits alone on its paragraph, we render a card-style
// block widget below the source line — big file glyph + extension
// badge + file name + size hint. This mirrors the image-block
// treatment so uploaded files get a real visual placeholder instead
// of disappearing into plain blue underlines.
//
// Raw markdown is the only source of truth; the widget is a read-only
// decoration. Its actions operate on the original link in the document.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  Prec,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { Download, File as FileIconLucide, Trash2 } from 'lucide-react';
import { lucideSvg } from '../../core/icons';
import { readOnlyFacet } from '../../core/read-only';
import { treeGrowthEffect, treeProgressPlugin } from '../../core/tree-progress';

const FILE_ICON = lucideSvg(FileIconLucide, { size: 40 });
const DOWNLOAD_ICON = lucideSvg(Download, { size: 16 });
const DELETE_ICON = lucideSvg(Trash2, { size: 16 });

// Non-image file extensions that we'll turn into a file card. The URL
// regex alone isn't enough — we need to skip links that are obviously
// web pages (html/php/aspx) and keep those that look like downloads.
const FILE_EXT_RE = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|md|csv|zip|rar|7z|tar|gz|bz2|json|yaml|yml|xml|svg|ps|ai|sketch|fig|mp3|wav|flac|aac|ogg|mp4|mov|avi|mkv|webm|exe|msi|dmg|pkg|deb|rpm|apk|ipa|epub|mobi|key|numbers|pages)$/i;

function isFileUrl(url: string): boolean {
  // Strip query + hash before testing extension.
  const clean = url.split('?')[0].split('#')[0];
  if (FILE_EXT_RE.test(clean)) return true;
  // Object URLs (file uploads via URL.createObjectURL) always look
  // like files — they have no extension in the URL string but are
  // definitely attachments.
  if (clean.startsWith('blob:')) return true;
  return false;
}

function isInlineImage(url: string): boolean {
  const clean = url.split('?')[0].split('#')[0];
  return /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(clean);
}

// A file link is "alone on its line" when the line it lives on has
// no other visible content besides whitespace. That's the same
// convention image blocks use for their widget placement.
function linkIsAloneOnLine(
  state: EditorState,
  linkFrom: number,
  linkTo: number,
): boolean {
  const line = state.doc.lineAt(linkFrom);
  if (state.doc.lineAt(linkTo).from !== line.from) return false; // multi-line → treat as inline
  const before = state.doc.sliceString(line.from, linkFrom);
  const after = state.doc.sliceString(linkTo, line.to);
  return before.trim() === '' && after.trim() === '';
}

interface FileLink {
  label: string;
  url: string;
}

function parseFileLink(raw: string): FileLink | null {
  const match = raw.match(/^\[([^\]]*)\]\(([^\s)"']+)(?:\s+["'][^)]*["'])?\)$/);
  if (!match || !match[2] || !isFileUrl(match[2])) return null;
  return { label: match[1], url: match[2] };
}

const dimensionCache = new Map<string, { w: number; h: number }>();

function fileRangeAtWidget(
  view: EditorView,
  wrap: HTMLElement,
  expectedUrl: string,
): { from: number; to: number } | null {
  const widgetPos = view.posAtDOM(wrap);
  if (widgetPos < 0) return null;
  const line = view.state.doc.lineAt(Math.max(0, widgetPos - 1));
  const tree =
    ensureSyntaxTree(view.state, view.state.doc.length, 200) ?? syntaxTree(view.state);
  let result: { from: number; to: number } | null = null;

  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (result || node.name !== 'Link') return;
      const parsed = parseFileLink(view.state.doc.sliceString(node.from, node.to));
      if (parsed?.url === expectedUrl && linkIsAloneOnLine(view.state, node.from, node.to)) {
        result = { from: node.from, to: node.to };
      }
    },
  });
  return result;
}

function downloadFile(file: FileLink): void {
  const link = document.createElement('a');
  link.href = file.url;
  link.download = file.label || 'download';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function deleteFileBlock(view: EditorView, wrap: HTMLElement, expectedUrl: string): void {
  if (view.state.facet(readOnlyFacet)) return;
  const range = fileRangeAtWidget(view, wrap, expectedUrl);
  if (!range) return;

  const line = view.state.doc.lineAt(range.from);
  let from = line.from;
  let to = line.to;

  // Remove the source line break as well. If the block has a blank line
  // directly after it, consume that separator too so deletion does not
  // leave an empty row where the block used to be.
  if (line.to < view.state.doc.length) {
    to = line.to + 1;
    const nextLine = view.state.doc.lineAt(to);
    if (nextLine.text.trim() === '') {
      to = nextLine.to < view.state.doc.length ? nextLine.to + 1 : nextLine.to;
    }
  } else if (line.from > 0) {
    from = line.from - 1;
    const previousLine = view.state.doc.lineAt(from);
    if (previousLine.text.trim() === '') {
      from = previousLine.from > 0 ? previousLine.from - 1 : previousLine.from;
    }
  }

  view.dispatch({ changes: { from, to } });
}

class FileBlockWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly url: string,
    readonly ext: string,
    readonly canDelete: boolean,
  ) {
    super();
  }

  eq(other: FileBlockWidget): boolean {
    return (
      other.label === this.label &&
      other.url === this.url &&
      other.ext === this.ext &&
      other.canDelete === this.canDelete
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-moss-file-block';

    const preview = document.createElement('div');
    preview.className = 'cm-moss-file-block-preview';

    // For image URLs (jpg/png/webp…), show a thumbnail instead of the
    // generic file glyph. Keeps the card layout consistent even when
    // the URL resolves to an image but the link form `[]()` was used
    // instead of `![]()`.
    if (isInlineImage(this.url)) {
      const img = document.createElement('img');
      img.src = this.url;
      img.alt = this.label;
      img.loading = 'lazy';
      const cached = dimensionCache.get(this.url);
      if (cached) {
        img.width = cached.w;
        img.height = cached.h;
      } else {
        img.addEventListener('load', () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            dimensionCache.set(this.url, {
              w: img.naturalWidth,
              h: img.naturalHeight,
            });
          }
        });
      }
      preview.classList.add('cm-moss-file-block-preview-image');
      preview.appendChild(img);
    } else {
      const glyph = document.createElement('span');
      glyph.className = 'cm-moss-file-block-glyph';
      glyph.innerHTML = FILE_ICON;
      const ext = document.createElement('span');
      ext.className = 'cm-moss-file-block-ext';
      ext.textContent = this.ext || 'FILE';
      preview.classList.add('cm-moss-file-block-preview-file');
      preview.append(glyph, ext);
    }

    const meta = document.createElement('div');
    meta.className = 'cm-moss-file-block-meta';

    const name = document.createElement('div');
    name.className = 'cm-moss-file-block-name';
    name.textContent = this.label;

    const info = document.createElement('div');
    info.className = 'cm-moss-file-block-info';
    info.textContent = `${this.ext || 'FILE'} · attachment`;

    meta.append(name, info);
    wrap.append(preview, meta);

    const actions = document.createElement('div');
    actions.className = 'cm-moss-file-block-actions';
    const stopEditorEvent = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
    };

    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'cm-moss-file-block-download';
    download.innerHTML = DOWNLOAD_ICON;
    download.setAttribute('aria-label', 'Download file');
    download.title = 'Download file';
    download.addEventListener('pointerdown', stopEditorEvent);
    download.addEventListener('click', (event) => {
      stopEditorEvent(event);
      downloadFile({ label: this.label, url: this.url });
    });
    actions.appendChild(download);

    if (this.canDelete) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'cm-moss-file-block-delete';
      remove.innerHTML = DELETE_ICON;
      remove.setAttribute('aria-label', 'Delete file');
      remove.title = 'Delete file';
      remove.addEventListener('pointerdown', stopEditorEvent);
      remove.addEventListener('click', (event) => {
        stopEditorEvent(event);
        deleteFileBlock(view, wrap, this.url);
      });
      actions.appendChild(remove);
    }
    wrap.appendChild(actions);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildFileSourceDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const tree =
    ensureSyntaxTree(view.state, view.state.doc.length, 200) ?? syntaxTree(view.state);
  tree.iterate({
    enter: (node) => {
      if (node.name !== 'Link') return;
      for (let p = node.node.parent; p; p = p.parent) {
        if (p.name === 'Table' || p.name === 'Image' || p.name === 'Footnote') return;
      }
      const file = parseFileLink(view.state.doc.sliceString(node.from, node.to));
      if (!file || !linkIsAloneOnLine(view.state, node.from, node.to)) return;
      ranges.push(Decoration.replace({}).range(node.from, node.to));
    },
  });
  return Decoration.set(ranges, true);
}

const fileSourcePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(readonly view: EditorView) {
      this.decorations = buildFileSourceDecorations(view);
    }

    update(update: ViewUpdate): void {
      const treeGrew = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(treeGrowthEffect)),
      );
      if (update.docChanged || treeGrew) {
        this.decorations = buildFileSourceDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function extOf(url: string, label: string): string {
  const cleanUrl = url.split('?')[0].split('#')[0];
  const dot = cleanUrl.lastIndexOf('.');
  if (dot > 0) {
    return cleanUrl.slice(dot + 1).toUpperCase();
  }
  // Fall back to the extension in the label if the URL is a blob
  // (which has no extension of its own).
  const dotLabel = label.lastIndexOf('.');
  if (dotLabel > 0) {
    return label.slice(dotLabel + 1).toUpperCase();
  }
  return '';
}

function buildFileBlocks(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const tree =
    ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);

  tree.iterate({
    enter: (node) => {
      if (node.name !== 'Link') return;
      // Skip links inside tables / images / other blocks.
      for (let p = node.node.parent; p; p = p.parent) {
        if (p.name === 'Table') return;
        if (p.name === 'Image') return;
        if (p.name === 'Footnote') return;
      }
      const raw = state.doc.sliceString(node.from, node.to);
      const file = parseFileLink(raw);
      if (!file) return;
      if (!linkIsAloneOnLine(state, node.from, node.to)) return;

      const ext = extOf(file.url, file.label);
      const line = state.doc.lineAt(node.from);
      ranges.push(Decoration.line({ class: 'cm-moss-file-block-source-line' }).range(line.from));
      ranges.push(
        Decoration.widget({
          widget: new FileBlockWidget(
            file.label,
            file.url,
            ext,
            !state.facet(readOnlyFacet),
          ),
          block: true,
          side: 1,
        }).range(line.to),
      );
    },
  });

  return Decoration.set(ranges, true);
}

function changeAffectsFileBlocks(
  tr: Transaction,
  existing: DecorationSet,
): boolean {
  let affected = false;
  tr.changes.iterChanges((fromA, toA) => {
    if (affected) return;
    existing.between(fromA, toA, () => {
      affected = true;
      return false;
    });
  });
  if (affected) return true;

  const state = tr.state;
  tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
    if (affected) return;
    const startLine = state.doc.lineAt(fromB);
    const endLine = toB > startLine.to ? state.doc.lineAt(toB) : startLine;
    for (let n = startLine.number; n <= endLine.number; n++) {
      if (state.doc.line(n).text.includes('](')) {
        affected = true;
        break;
      }
    }
  });
  return affected;
}

export function mossFileBlocks(): Extension {
  const fileBlocksField = StateField.define<DecorationSet>({
    create: (state) => buildFileBlocks(state),
    update(deco, tr) {
      for (const effect of tr.effects) {
        if (effect.is(treeGrowthEffect)) return buildFileBlocks(tr.state);
      }
      const readOnlyChanged =
        tr.startState.facet(readOnlyFacet) !== tr.state.facet(readOnlyFacet);
      if (readOnlyChanged) return buildFileBlocks(tr.state);
      if (!tr.docChanged) return deco;
      const mapped = deco.map(tr.changes);
      if (!changeAffectsFileBlocks(tr, deco)) return mapped;
      return buildFileBlocks(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [fileBlocksField, Prec.highest(fileSourcePreviewPlugin), treeProgressPlugin];
}
