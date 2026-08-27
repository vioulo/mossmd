import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { Check, MoveDiagonal2, Pencil, X } from 'lucide-react';
import { lucideSvg } from '../../core/icons';
import { readOnlyFacet } from '../../core/read-only';
import { treeGrowthEffect, treeProgressPlugin } from '../../core/tree-progress';

export interface MossImagesConfig {
  /** Show the image edit button in editable mode. Defaults to true. */
  editable?: boolean;
  /** Show the image resize handle in editable mode. Defaults to true. */
  resizable?: boolean;
}

export interface MossImageEdit {
  src: string;
  alt: string;
  caption: string | null;
  width: string | null;
}

const EDIT_ICON = lucideSvg(Pencil, { size: 16 });
const RESIZE_ICON = lucideSvg(MoveDiagonal2, { size: 16 });
const SAVE_ICON = lucideSvg(Check, { size: 15 });
const CLOSE_ICON = lucideSvg(X, { size: 15 });
const IMAGE_WIDTH_RE = /^(?:\d+(?:\.\d+)?)(?:%|px|rem|em|vw)$/;
const MIN_IMAGE_WIDTH = 160;

// Image blocks.
//
// When a markdown image (`![alt](url)`) appears in the doc, we render
// the actual image as a block-level widget immediately below the line
// that contains its source. This follows Obsidian's model: the
// markdown text and the rendered image coexist, with the markdown
// visible only when its line is active (cursor on the line).
//
// Block widgets can't come from a ViewPlugin (CM6 requires them to
// originate from a StateField or a mandatory facet), so this lives
// in its own StateField alongside the ViewPlugin-based inline
// decorations. The two compose naturally — CM6 layers their
// decoration sets at render time.
//
// Scope: we emit one image widget per Image node. Images inside
// otherwise-text paragraphs still get a widget below the paragraph;
// it's visually slightly awkward but matches the "always render
// the image" invariant. Most markdown in practice has images on
// their own line, where this looks right.

// Session-lifetime cache of observed natural image dimensions, keyed
// by URL. CM6's virtualizer unmounts line DOM when it leaves the
// viewport and calls `toDOM` again on the way back. Without a
// cache, the `<img>` starts with no intrinsic size on each remount,
// lays out as a zero-height box, measures, then snaps to its real
// size once decode completes — and the heightmap grows under the
// scroll animation. On iOS that reads as an anchor conflict and
// halts kinetic scroll, but only in the direction where the growth
// opposes the scroll (e.g. scrolling up past a remounting image
// that just grew taller pushes content down against the motion).
// Setting `width` and `height` attrs from this cache pins the
// aspect ratio on mount, so there's no grow-after-mount event.
const dimensionCache = new Map<string, { w: number; h: number }>();

function parseImageMarkdown(raw: string): MossImageEdit | null {
  const match = raw.match(/^!\[([^\]]*)\]\(([^\s)"']+)(?:\s+["'][^)]*["'])?\)$/);
  if (!match) return null;
  const [, altRaw, src] = match;
  if (!src) return null;

  const pipeIdx = altRaw.indexOf('|');
  if (pipeIdx < 0) {
    return { src, alt: altRaw, caption: altRaw || null, width: null };
  }

  const left = altRaw.slice(0, pipeIdx);
  let right = altRaw.slice(pipeIdx + 1);
  let width: string | null = null;
  const widthMatch = right.match(/^(.*)\|width=(\d+(?:\.\d+)?(?:%|px|rem|em|vw))$/);
  if (widthMatch) {
    right = widthMatch[1];
    width = widthMatch[2];
  }
  if (right === '') return { src, alt: left, caption: null, width };
  if (left === '') return { src, alt: right, caption: right, width };
  return { src, alt: left, caption: right, width };
}

function serializeImage(image: MossImageEdit): string {
  const caption = image.caption ?? '';
  const width = image.width ? `|width=${image.width}` : '';
  return `![${image.alt}|${caption}${width}](${image.src})`;
}

function imageRangeAtWidget(
  view: EditorView,
  wrap: HTMLElement,
  expectedSrc: string,
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
      if (result || node.name !== 'Image') return;
      const parsed = parseImageMarkdown(view.state.doc.sliceString(node.from, node.to));
      if (parsed?.src === expectedSrc) result = { from: node.from, to: node.to };
    },
  });
  return result;
}

function startImageResize(
  view: EditorView,
  wrap: HTMLElement,
  frame: HTMLElement,
  img: HTMLImageElement,
  image: MossImageEdit,
  startEvent: PointerEvent,
): void {
  const containerWidth = wrap.getBoundingClientRect().width;
  const startWidth = frame.getBoundingClientRect().width;
  if (containerWidth <= 0 || startWidth <= 0) return;

  const minWidth = Math.min(MIN_IMAGE_WIDTH, containerWidth);
  let currentWidth = Math.max(startWidth, minWidth);
  if (currentWidth !== startWidth) {
    frame.style.width = `${currentWidth}px`;
    img.style.width = '100%';
  }
  const update = (event: PointerEvent): void => {
    event.preventDefault();
    currentWidth = Math.max(
      minWidth,
      Math.min(containerWidth, startWidth + event.clientX - startEvent.clientX),
    );
    frame.style.width = `${currentWidth}px`;
    img.style.width = '100%';
  };
  const finish = (): void => {
    window.removeEventListener('pointermove', update);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    if (view.state.facet(readOnlyFacet)) return;

    const percentage = Math.round((currentWidth / containerWidth) * 1000) / 10;
    const range = imageRangeAtWidget(view, wrap, image.src);
    if (!range) return;
    view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
        insert: serializeImage({ ...image, width: `${percentage}%` }),
      },
    });
  };

  window.addEventListener('pointermove', update);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}

const activeImageEditors = new WeakMap<EditorView, () => void>();

function addImageEditorField(
  form: HTMLFormElement,
  labelText: string,
  value: string,
  field: string,
  type = 'text',
): HTMLInputElement {
  const label = document.createElement('label');
  label.className = 'cm-moss-image-editor-field';
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.dataset.imageField = field;
  input.autocomplete = 'off';
  label.appendChild(input);
  form.appendChild(label);
  return input;
}

function openImageEditor(
  view: EditorView,
  wrap: HTMLElement,
  image: MossImageEdit,
): void {
  activeImageEditors.get(view)?.();

  const form = document.createElement('form');
  form.className = 'cm-moss-image-editor';
  form.setAttribute('aria-label', 'Edit image');

  const heading = document.createElement('div');
  heading.className = 'cm-moss-image-editor-title';
  heading.textContent = 'Edit image';
  form.appendChild(heading);

  const altInput = addImageEditorField(form, 'Alt text', image.alt, 'alt');
  const captionInput = addImageEditorField(
    form,
    'Caption',
    image.caption ?? '',
    'caption',
  );
  const widthInput = addImageEditorField(form, 'Width', image.width ?? '', 'width');
  const srcInput = addImageEditorField(form, 'Image URL', image.src, 'src', 'url');

  const error = document.createElement('div');
  error.className = 'cm-moss-image-editor-error';
  error.setAttribute('role', 'alert');
  form.appendChild(error);

  const actions = document.createElement('div');
  actions.className = 'cm-moss-image-editor-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'cm-moss-image-editor-button';
  cancel.innerHTML = CLOSE_ICON;
  cancel.setAttribute('aria-label', 'Cancel image edit');
  cancel.title = 'Cancel';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'cm-moss-image-editor-button is-primary';
  save.innerHTML = SAVE_ICON;
  save.setAttribute('aria-label', 'Save image');
  save.title = 'Save';
  actions.append(cancel, save);
  form.appendChild(actions);

  const close = (): void => {
    form.remove();
    if (activeImageEditors.get(view) === close) activeImageEditors.delete(view);
  };
  activeImageEditors.set(view, close);

  cancel.addEventListener('click', close);
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (view.state.facet(readOnlyFacet)) {
      close();
      return;
    }

    const next: MossImageEdit = {
      alt: altInput.value.trim(),
      caption: captionInput.value.trim() || null,
      src: srcInput.value.trim(),
      width: widthInput.value.trim() || null,
    };
    if (!next.src) {
      error.textContent = 'Image URL is required.';
      srcInput.focus();
      return;
    }
    if (/[^\S\r\n]|[)"']/.test(next.src)) {
      error.textContent = 'Image URL cannot contain spaces, quotes, or ).';
      srcInput.focus();
      return;
    }
    if (/[\]|\r\n]/.test(next.alt) || /[\]\r\n]/.test(next.caption ?? '')) {
      error.textContent = 'Alt text cannot contain ], |; fields cannot contain line breaks.';
      return;
    }
    if (next.width && !IMAGE_WIDTH_RE.test(next.width)) {
      error.textContent = 'Width must use a CSS unit such as 72%, 640px, or 24rem.';
      widthInput.focus();
      return;
    }

    const range = imageRangeAtWidget(view, wrap, image.src);
    if (!range) {
      error.textContent = 'The image is no longer available.';
      return;
    }
    close();
    view.dispatch({ changes: { from: range.from, to: range.to, insert: serializeImage(next) } });
  });

  wrap.appendChild(form);
  altInput.focus();
  altInput.select();
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly caption: string | null,
    readonly width: string | null,
    readonly canEdit: boolean,
    readonly canResize: boolean,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.caption === this.caption &&
      other.width === this.width &&
      other.canEdit === this.canEdit &&
      other.canResize === this.canResize
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-moss-image';
    if (this.caption) wrap.classList.add('cm-moss-image-has-caption');
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.loading = 'lazy';
    // Set intrinsic dims from the cache so the widget reserves the
    // right box before the image decodes — prevents the remount +
    // resize cycle that halts iOS momentum scroll. On first-ever
    // mount the cache is cold; the `load` listener below records
    // the natural dims so subsequent remounts come up pre-sized.
    // CSS (`max-width: 100%; height: auto` on the img) still lets
    // the browser scale the attributes to the content column.
    const cached = dimensionCache.get(this.src);
    if (cached) {
      img.width = cached.w;
      img.height = cached.h;
    } else {
      img.addEventListener('load', () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          dimensionCache.set(this.src, {
            w: img.naturalWidth,
            h: img.naturalHeight,
          });
        }
      });
    }
    const frame = document.createElement('div');
    frame.className = 'cm-moss-image-frame';
    if (this.width) {
      frame.classList.add('cm-moss-image-frame-sized');
      frame.style.width = this.width;
      img.style.width = '100%';
    }
    frame.appendChild(img);
    wrap.appendChild(frame);

    if (this.canEdit) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'cm-moss-image-edit';
      edit.innerHTML = EDIT_ICON;
      edit.setAttribute('aria-label', 'Edit image');
      edit.title = 'Edit image';
      edit.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      edit.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!view.state.facet(readOnlyFacet)) {
          openImageEditor(view, wrap, {
            src: this.src,
            alt: this.alt,
            caption: this.caption,
            width: this.width,
          });
        }
      });
      frame.appendChild(edit);
    }

    if (this.canResize) {
      const resize = document.createElement('button');
      resize.type = 'button';
      resize.className = 'cm-moss-image-resize';
      resize.innerHTML = RESIZE_ICON;
      resize.setAttribute('aria-label', 'Resize image');
      resize.title = 'Resize image';
      resize.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        startImageResize(
          view,
          wrap,
          frame,
          img,
          {
            src: this.src,
            alt: this.alt,
            caption: this.caption,
            width: this.width,
          },
          event,
        );
      });
      frame.appendChild(resize);
    }

    // Caption: rendered below the image. The default syntax is
    // `![alt](url)` — no pipe — and the whole alt text doubles as
    // the visible caption. To give alt and caption different text,
    // use `![alt|caption](url)`. A trailing pipe (`![alt|](url)`)
    // is the explicit "no caption" form. `img.alt` always gets the
    // accessibility text.
    if (this.caption) {
      const caption = document.createElement('figcaption');
      caption.className = 'cm-moss-image-caption';
      caption.textContent = this.caption;
      wrap.appendChild(caption);
    }

    return wrap;
  }

  // Block CM6's mouse handling so clicking the rendered image does not
  // activate the hidden markdown source line. The edit button and its
  // form own their events inside the widget.
  ignoreEvent(): boolean {
    return true;
  }
}

function buildImageBlocks(
  state: EditorState,
  config: MossImagesConfig,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  // Push the parser to cover the whole doc so image nodes in
  // regions CM6 hasn't yet parsed get widgetized. Without this, for
  // moderately long atoms the initial parse doesn't reach the
  // bottom and images past the initial parse window render as raw
  // `![alt](url)` text forever — the StateField only rebuilds on
  // doc change, not on parser advance. 200ms is a generous
  // upper bound; typical atoms finish in well under 10ms.
  const tree =
    ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);

  tree.iterate({
    enter: (node) => {
      if (node.name !== 'Image') return;
      // Skip Images inside tables — the table widget renders them
      // as inline `<img>` elements in their cells. Emitting a
      // block widget below the table row would double-render and
      // the source it points at is hidden behind the table's
      // block-replace anyway.
      for (let p = node.node.parent; p; p = p.parent) {
        if (p.name === 'Table') return;
      }
      // Slice the whole image source and regex out src / alt. This
      // handles the common shapes — `![alt](url)` and
      // `![alt](url "title")` — without us walking the lezer tree
      // for each piece. We don't go to heroic lengths on edge cases
      // (escaped parens etc.); the regex fails safely by skipping
      // the widget.
      const parsed = parseImageMarkdown(state.doc.sliceString(node.from, node.to));
      if (!parsed) return;

      const line = state.doc.lineAt(node.from);
      ranges.push(
        Decoration.widget({
          widget: new ImageWidget(
            parsed.src,
            parsed.alt,
            parsed.caption,
            parsed.width,
            config.editable !== false && !state.facet(readOnlyFacet),
            config.resizable !== false &&
              config.editable !== false &&
              !state.facet(readOnlyFacet),
          ),
          block: true,
          // side: 1 places the block widget after the line's content,
          // so the image appears below its source line.
          side: 1,
        }).range(line.to),
      );
    },
  });

  return Decoration.set(ranges, true);
}

// Detect whether a doc change could have added, removed, or modified
// an Image node. Two cheap signals:
//
//   1. Any existing image decoration overlaps the changed range. That
//      covers edits to (or deletions of) an image already in the doc.
//   2. Any line touched by the change now contains the `![` marker.
//      That catches new images being typed AND edits that complete a
//      partially-typed image on an existing line.
//
// If neither signal fires, the change can't affect image widgets and
// we can skip `buildImageBlocks` entirely — `deco.map(tr.changes)`
// shifts existing decoration positions to the post-change doc, which
// is what we want for an unaffected edit. Turns per-keystroke cost
// from O(doc) to O(change size) on plain-prose edits of large atoms.
function changeAffectsImages(tr: Transaction, existing: DecorationSet): boolean {
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
      if (state.doc.line(n).text.includes('![')) {
        affected = true;
        break;
      }
    }
  });
  return affected;
}

export function mossImages(config: MossImagesConfig = {}): Extension {
  const imageBlocksField = StateField.define<DecorationSet>({
    create: (state) => buildImageBlocks(state, config),
    update(deco, tr) {
      // Tree-growth effect: the background parser caught up to a
      // region that wasn't parsed when we last built. Rebuild so any
      // newly-visible Image nodes get their widget.
      for (const effect of tr.effects) {
        if (effect.is(treeGrowthEffect)) return buildImageBlocks(tr.state, config);
      }
      const readOnlyChanged =
        tr.startState.facet(readOnlyFacet) !== tr.state.facet(readOnlyFacet);
      if (readOnlyChanged) return buildImageBlocks(tr.state, config);
      // Selection and viewport changes don't affect the widget set
      // (though they do affect whether the surrounding markdown is
      // shown, which is handled by the inline-preview ViewPlugin).
      if (!tr.docChanged) return deco;
      // Most keystrokes on a large atom are in plain prose with no
      // image nearby. Map existing decorations through the change and
      // skip the full-doc walk unless the change actually touches an
      // image.
      const mapped = deco.map(tr.changes);
      if (!changeAffectsImages(tr, deco)) return mapped;
      return buildImageBlocks(tr.state, config);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [imageBlocksField, treeProgressPlugin];
}
