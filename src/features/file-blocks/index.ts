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
import {
  appendMossIcon,
  type MossIconMap,
  type MossIconRenderer,
  mossIconFacet,
  resolveMossIcon,
} from '../../core/icons';
import { readOnlyFacet } from '../../core/read-only';
import { treeGrowthEffect, treeProgressPlugin } from '../../core/tree-progress';

export interface MossFileBlockIcons {
  file: MossIconRenderer;
  download: MossIconRenderer;
  copyLink: MossIconRenderer;
}

export interface MossFileBlocksConfig {
  icons?: Partial<MossFileBlockIcons>;
  iconMap?: MossIconMap;
}

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

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to the legacy copy command below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}

function fileRangeIsSelected(view: EditorView, wrap: HTMLElement): boolean {
  if (!view.hasFocus || view.state.facet(readOnlyFacet)) return false;
  const range = fileRangeAtWidget(view, wrap, wrap.dataset.url ?? '');
  return (
    !!range &&
    view.state.selection.ranges.some(
      (selection) =>
        selection.from === range.from && selection.to === range.to,
    )
  );
}

const fileSelectionPlugin = ViewPlugin.fromClass(
  class {
    private readonly editorRoot: HTMLElement | null;

    constructor(readonly view: EditorView) {
      this.editorRoot = view.dom.parentElement;
      this.sync();
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
        this.sync();
      }
    }

    private sync(): void {
      let hasSelectedFile = false;
      for (const wrap of this.view.dom.querySelectorAll<HTMLElement>(
        '.cm-moss-file-block',
      )) {
        const selected = fileRangeIsSelected(this.view, wrap);
        wrap.classList.toggle(
          'cm-moss-file-block-selected',
          selected,
        );
        hasSelectedFile ||= selected;
      }
      this.editorRoot?.classList.toggle(
        'moss-cm-file-selection-active',
        hasSelectedFile,
      );
    }

    destroy(): void {
      this.editorRoot?.classList.remove('moss-cm-file-selection-active');
    }
  },
);

function selectFileSource(view: EditorView, wrap: HTMLElement): void {
  if (view.state.facet(readOnlyFacet)) return;
  const range = fileRangeAtWidget(view, wrap, wrap.dataset.url ?? '');
  if (!range) return;
  view.focus();
  view.dispatch({
    selection: { anchor: range.from, head: range.to },
    userEvent: 'select.pointer',
  });
}

class FileBlockWidget extends WidgetType {
  private copyLinkTimer: number | null = null;

  constructor(
    readonly label: string,
    readonly url: string,
    readonly ext: string,
    readonly icons: MossFileBlockIcons,
  ) {
    super();
  }

  eq(other: FileBlockWidget): boolean {
    return (
      other.label === this.label &&
      other.url === this.url &&
      other.ext === this.ext &&
      other.icons.file === this.icons.file &&
      other.icons.download === this.icons.download &&
      other.icons.copyLink === this.icons.copyLink
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const slot = document.createElement('div');
    slot.className = 'cm-moss-file-block-slot';

    const wrap = document.createElement('div');
    wrap.className = 'cm-moss-file-block';
    wrap.dataset.url = this.url;
    wrap.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || view.state.facet(readOnlyFacet)) return;
      const target = event.target;
      if (target instanceof Element && target.closest('button')) return;
      event.preventDefault();
      event.stopPropagation();
      selectFileSource(view, wrap);
    });

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
      appendMossIcon(glyph, this.icons.file, { size: 40, strokeWidth: 2 });
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
    appendMossIcon(download, this.icons.download, {
      size: 16,
      strokeWidth: 2,
    });
    download.setAttribute('aria-label', 'Download file');
    download.title = 'Download file';
    download.addEventListener('pointerdown', stopEditorEvent);
    download.addEventListener('click', (event) => {
      stopEditorEvent(event);
      downloadFile({ label: this.label, url: this.url });
    });
    actions.appendChild(download);

    const copyLink = document.createElement('button');
    copyLink.type = 'button';
    copyLink.className = 'cm-moss-file-block-copy-link';
    appendMossIcon(copyLink, this.icons.copyLink, {
      size: 16,
      strokeWidth: 2,
    });
    copyLink.setAttribute('aria-label', 'Copy link');
    copyLink.title = 'Copy link';
    copyLink.addEventListener('pointerdown', stopEditorEvent);
    copyLink.addEventListener('click', async (event) => {
      stopEditorEvent(event);
      if (!(await copyTextToClipboard(this.url))) return;
      copyLink.classList.add('is-copied');
      copyLink.setAttribute('aria-label', 'Copied');
      copyLink.title = 'Copied';
      appendMossIcon(
        copyLink,
        resolveMossIcon('code.copied', view.state.facet(mossIconFacet)),
        { size: 16, strokeWidth: 2 },
      );
      if (this.copyLinkTimer != null) window.clearTimeout(this.copyLinkTimer);
      this.copyLinkTimer = window.setTimeout(() => {
        this.copyLinkTimer = null;
        copyLink.classList.remove('is-copied');
        copyLink.setAttribute('aria-label', 'Copy link');
        copyLink.title = 'Copy link';
        appendMossIcon(copyLink, this.icons.copyLink, {
          size: 16,
          strokeWidth: 2,
        });
      }, 1200);
    });
    actions.appendChild(copyLink);
    wrap.appendChild(actions);
    slot.appendChild(wrap);
    return slot;
  }

  ignoreEvent(): boolean {
    return true;
  }

  destroy(): void {
    if (this.copyLinkTimer != null) window.clearTimeout(this.copyLinkTimer);
    this.copyLinkTimer = null;
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

function buildFileBlocks(
  state: EditorState,
  config: MossFileBlocksConfig,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const icons: MossFileBlockIcons = {
    file: config.icons?.file ?? resolveMossIcon('file.file', config.iconMap),
    download:
      config.icons?.download ?? resolveMossIcon('file.download', config.iconMap),
    copyLink:
      config.icons?.copyLink ??
      resolveMossIcon('file.copy-link', config.iconMap),
  };
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
            icons,
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

export function mossFileBlocks(config: MossFileBlocksConfig = {}): Extension {
  const fileBlocksField = StateField.define<DecorationSet>({
    create: (state) => buildFileBlocks(state, config),
    update(deco, tr) {
      for (const effect of tr.effects) {
        if (effect.is(treeGrowthEffect)) return buildFileBlocks(tr.state, config);
      }
      const readOnlyChanged =
        tr.startState.facet(readOnlyFacet) !== tr.state.facet(readOnlyFacet);
      if (readOnlyChanged) return buildFileBlocks(tr.state, config);
      if (!tr.docChanged) return deco;
      const mapped = deco.map(tr.changes);
      if (!changeAffectsFileBlocks(tr, deco)) return mapped;
      return buildFileBlocks(tr.state, config);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [
    fileBlocksField,
    Prec.highest(fileSourcePreviewPlugin),
    fileSelectionPlugin,
    treeProgressPlugin,
  ];
}
