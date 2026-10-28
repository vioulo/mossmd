import { undo, redo } from '@codemirror/commands';
import {
  closeCompletion,
  completionStatus,
  startCompletion,
} from '@codemirror/autocomplete';
import { type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { readOnlyFacet } from '../../core/read-only';
import {
  appendMossIcon,
  mossIconFacet,
  resolveMossIcon,
  type MossIconKey,
} from '../../core/icons';
import {
  openImagePreview,
  copyImageLink,
  serializeImage,
  parseImageMarkdown,
  imageRangeAtWidget,
  resolveImageIcons,
  type MossImagesConfig,
} from '../image';
import {
  downloadFile,
  copyTextToClipboard,
  parseFileLink,
  fileRangeAtWidget,
  type FileLink,
} from '../file-blocks';

export interface MossMobileToolbarConfig {
  /** Images configuration passed for icons and preview. */
  imagesConfig?: MossImagesConfig;
}

function createIconButton(
  view: EditorView,
  iconKey: MossIconKey,
  label: string,
  onClick: (event: MouseEvent) => void,
  options: { isDanger?: boolean } = {},
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cm-moss-mobile-btn';
  if (options.isDanger) btn.classList.add('is-danger');
  btn.setAttribute('aria-label', label);

  const iconRenderer = resolveMossIcon(iconKey, view.state.facet(mossIconFacet));
  appendMossIcon(btn, iconRenderer, { size: 16, strokeWidth: 2, ariaHidden: true });

  const text = document.createElement('span');
  text.textContent = label;
  btn.appendChild(text);

  btn.addEventListener('pointerdown', (e) => {
    // Keep focus inside CodeMirror view when pressing toolbar buttons
    e.preventDefault();
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    onClick(e);
  });

  return btn;
}

export function mossMobileToolbar(
  config: MossMobileToolbarConfig = {},
): Extension {
  return ViewPlugin.fromClass(
    class {
      private readonly layer: HTMLDivElement;
      private currentWrap: HTMLElement | null = null;
      private sliderPanel: HTMLDivElement | null = null;
      private blockBtn: HTMLButtonElement | null = null;
      private isSliderOpen = false;

      constructor(private readonly view: EditorView) {
        this.layer = document.createElement('div');
        this.layer.className = 'cm-moss-mobile-bar';
        this.layer.setAttribute('role', 'toolbar');
        this.layer.setAttribute('aria-label', 'Mobile Actions');

        const host = view.dom.parentElement ?? view.dom;
        host.appendChild(this.layer);

        this.sync();
      }

      update(update: ViewUpdate): void {
        const readOnlyChanged =
          update.startState.facet(readOnlyFacet) !==
          update.state.facet(readOnlyFacet);
        const completionChanged =
          completionStatus(update.startState) !==
          completionStatus(update.state);

        if (
          update.docChanged ||
          update.selectionSet ||
          update.focusChanged ||
          readOnlyChanged ||
          completionChanged
        ) {
          this.sync();
        }
      }

      destroy(): void {
        this.layer.remove();
      }

      private sync(): void {
        const isEditable =
          this.view.hasFocus && !this.view.state.facet(readOnlyFacet);

        if (!isEditable) {
          this.layer.style.display = 'none';
          this.currentWrap = null;
          this.sliderPanel = null;
          this.blockBtn = null;
          this.isSliderOpen = false;
          this.layer.classList.remove('has-slider');
          return;
        }

        // 1. Detect selected image
        const selectedImageWrap =
          this.view.dom.querySelector<HTMLElement>('.cm-moss-image.cm-moss-image-selected');

        if (selectedImageWrap) {
          this.layer.style.display = '';
          this.blockBtn = null;
          this.renderImageToolbar(selectedImageWrap);
          return;
        }

        // 2. Detect selected file block
        const selectedFileWrap =
          this.view.dom.querySelector<HTMLElement>('.cm-moss-file-block.cm-moss-file-block-selected');

        if (selectedFileWrap) {
          this.layer.style.display = '';
          this.blockBtn = null;
          this.sliderPanel = null;
          this.isSliderOpen = false;
          this.layer.classList.remove('has-slider');
          this.renderFileToolbar(selectedFileWrap);
          return;
        }

        // 3. Fallback: Paragraph editing toolbar
        this.layer.style.display = '';
        this.sliderPanel = null;
        this.isSliderOpen = false;
        this.layer.classList.remove('has-slider');
        this.renderParagraphToolbar();
      }

      // --- Mode A: Image Active ---
      private renderImageToolbar(wrap: HTMLElement): void {
        if (this.currentWrap === wrap && this.layer.dataset.mode === 'image') {
          return;
        }
        this.currentWrap = wrap;
        this.layer.dataset.mode = 'image';
        this.layer.replaceChildren();

        const range = imageRangeAtWidget(this.view, wrap);
        if (!range) return;

        const raw = this.view.state.doc.sliceString(range.from, range.to);
        const image = parseImageMarkdown(raw);
        if (!image) return;

        // Optional Slider Panel
        this.sliderPanel = document.createElement('div');
        this.sliderPanel.className = 'cm-moss-mobile-slider-panel';
        this.sliderPanel.style.display = this.isSliderOpen ? 'flex' : 'none';

        const sliderHeader = document.createElement('div');
        sliderHeader.className = 'cm-moss-mobile-slider-header';
        sliderHeader.textContent = 'Image Width';

        const sliderValDisplay = document.createElement('span');
        sliderValDisplay.className = 'cm-moss-mobile-slider-val';
        const currentPct = parseInt(image.width || '100', 10) || 100;
        sliderValDisplay.textContent = `${currentPct}%`;
        sliderHeader.appendChild(sliderValDisplay);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'cm-moss-mobile-slider';
        slider.min = '15';
        slider.max = '100';
        slider.step = '5';
        slider.value = String(currentPct);

        const frame = wrap.querySelector<HTMLElement>('.cm-moss-image-frame');

        // Continuous drag updates visual width live
        slider.addEventListener('input', () => {
          const val = slider.value;
          sliderValDisplay.textContent = `${val}%`;
          if (frame) {
            frame.classList.add('cm-moss-image-frame-sized');
            frame.style.width = `${val}%`;
            const imgEl = frame.querySelector<HTMLElement>('img');
            if (imgEl) imgEl.style.width = '100%';
          }
        });

        // Release confirms transaction to CodeMirror
        const commitWidthChange = () => {
          const val = slider.value;
          const currentRange = imageRangeAtWidget(this.view, wrap, image.src);
          if (!currentRange) return;
          this.view.dispatch({
            changes: {
              from: currentRange.from,
              to: currentRange.to,
              insert: serializeImage({ ...image, width: `${val}%` }),
            },
          });
        };

        slider.addEventListener('change', commitWidthChange);
        slider.addEventListener('pointerup', commitWidthChange);

        // Preset row
        const presetRow = document.createElement('div');
        presetRow.className = 'cm-moss-mobile-preset-row';
        for (const pct of [25, 50, 75, 100]) {
          const presetBtn = document.createElement('button');
          presetBtn.type = 'button';
          presetBtn.className = 'cm-moss-mobile-preset-btn';
          presetBtn.textContent = pct === 100 ? 'Full' : `${pct}%`;
          presetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            slider.value = String(pct);
            sliderValDisplay.textContent = `${pct}%`;
            if (frame) {
              frame.classList.add('cm-moss-image-frame-sized');
              frame.style.width = `${pct}%`;
            }
            commitWidthChange();
          });
          presetRow.appendChild(presetBtn);
        }

        this.sliderPanel.append(sliderHeader, slider, presetRow);
        this.layer.appendChild(this.sliderPanel);

        // Main buttons
        const actionRow = document.createElement('div');
        actionRow.className = 'cm-moss-mobile-bar-actions';

        // 1. Preview
        actionRow.appendChild(
          createIconButton(this.view, 'mobile.preview', 'Preview', () => {
            openImagePreview(
              this.view,
              image,
              resolveImageIcons(config.imagesConfig ?? {}),
            );
          }),
        );

        // 2. Resize (Toggle Slider)
        const resizeBtn = createIconButton(this.view, 'mobile.resize', 'Resize', () => {
          this.isSliderOpen = !this.isSliderOpen;
          this.layer.classList.toggle('has-slider', this.isSliderOpen);
          if (this.sliderPanel) {
            this.sliderPanel.style.display = this.isSliderOpen ? 'flex' : 'none';
          }
          resizeBtn.classList.toggle('is-active', this.isSliderOpen);
        });
        if (this.isSliderOpen) {
          resizeBtn.classList.add('is-active');
          this.layer.classList.add('has-slider');
        }
        actionRow.appendChild(resizeBtn);

        // 3. Copy Link
        const copyBtn = createIconButton(this.view, 'mobile.copy', 'Copy', async () => {
          if (await copyImageLink(image.src)) {
            copyBtn.classList.add('is-copied');
            const label = copyBtn.querySelector('span');
            if (label) label.textContent = 'Copied';
            setTimeout(() => {
              copyBtn.classList.remove('is-copied');
              if (label) label.textContent = 'Copy';
            }, 1200);
          }
        });
        actionRow.appendChild(copyBtn);

        // 4. Delete
        actionRow.appendChild(
          createIconButton(
            this.view,
            'mobile.delete',
            'Delete',
            () => {
              const currentRange = imageRangeAtWidget(this.view, wrap, image.src);
              if (!currentRange) return;
              const line = this.view.state.doc.lineAt(currentRange.from);
              const isAlone =
                line.text.trim() ===
                this.view.state.doc.sliceString(currentRange.from, currentRange.to).trim();
              const from = isAlone ? line.from : currentRange.from;
              const to = isAlone
                ? Math.min(this.view.state.doc.length, line.to + 1)
                : currentRange.to;
              this.view.dispatch({ changes: { from, to, insert: '' } });
            },
            { isDanger: true },
          ),
        );

        this.layer.appendChild(actionRow);
      }

      // --- Mode B: File Block Active ---
      private renderFileToolbar(wrap: HTMLElement): void {
        if (this.currentWrap === wrap && this.layer.dataset.mode === 'file') {
          return;
        }
        this.currentWrap = wrap;
        this.layer.dataset.mode = 'file';
        this.layer.replaceChildren();

        const nameEl = wrap.querySelector('.cm-moss-file-block-name');
        const urlAttr = wrap.getAttribute('data-url') || '';
        let file: FileLink = { url: urlAttr, label: nameEl?.textContent || 'file' };

        const currentRange = fileRangeAtWidget(this.view, wrap, urlAttr);
        if (currentRange) {
          const parsed = parseFileLink(
            this.view.state.doc.sliceString(currentRange.from, currentRange.to),
          );
          if (parsed) file = parsed;
        }

        const actionRow = document.createElement('div');
        actionRow.className = 'cm-moss-mobile-bar-actions';

        // 1. Download
        actionRow.appendChild(
          createIconButton(this.view, 'mobile.download', 'Download', () => {
            downloadFile(file);
          }),
        );

        // 2. Copy Link
        const copyBtn = createIconButton(this.view, 'mobile.copy', 'Copy', async () => {
          if (await copyTextToClipboard(file.url)) {
            copyBtn.classList.add('is-copied');
            const txt = copyBtn.querySelector('span');
            if (txt) txt.textContent = 'Copied';
            setTimeout(() => {
              copyBtn.classList.remove('is-copied');
              if (txt) txt.textContent = 'Copy';
            }, 1200);
          }
        });
        actionRow.appendChild(copyBtn);

        // 3. Delete
        actionRow.appendChild(
          createIconButton(
            this.view,
            'mobile.delete',
            'Delete',
            () => {
              const currentRange = fileRangeAtWidget(this.view, wrap, file.url);
              if (!currentRange) return;
              const line = this.view.state.doc.lineAt(currentRange.from);
              const isAlone =
                line.text.trim() ===
                this.view.state.doc.sliceString(currentRange.from, currentRange.to).trim();
              const from = isAlone ? line.from : currentRange.from;
              const to = isAlone
                ? Math.min(this.view.state.doc.length, line.to + 1)
                : currentRange.to;
              this.view.dispatch({ changes: { from, to, insert: '' } });
            },
            { isDanger: true },
          ),
        );

        this.layer.appendChild(actionRow);
      }

      // --- Mode C: Paragraph Editing ---
      private renderParagraphToolbar(): void {
        if (this.currentWrap === null && this.layer.dataset.mode === 'paragraph') {
          if (this.blockBtn) {
            this.blockBtn.classList.toggle(
              'is-active',
              completionStatus(this.view.state) !== null,
            );
          }
          return;
        }
        this.currentWrap = null;
        this.layer.dataset.mode = 'paragraph';
        this.layer.replaceChildren();

        const actionRow = document.createElement('div');
        actionRow.className = 'cm-moss-mobile-bar-actions';

        // 1. Plus (Toggle Block / Slash Commands)
        this.blockBtn = createIconButton(this.view, 'mobile.block', 'Block', () => {
          const status = completionStatus(this.view.state);
          if (status === 'active' || status === 'pending') {
            closeCompletion(this.view);
            return;
          }

          const pos = this.view.state.selection.main.head;
          const line = this.view.state.doc.lineAt(pos);

          if (line.text.trim() === '') {
            this.view.focus();
            startCompletion(this.view);
          } else {
            // Append a clean new empty line below and open block completion explicitly
            const insertPos = line.to;
            this.view.dispatch({
              changes: { from: insertPos, insert: '\n' },
              selection: { anchor: insertPos + 1 },
            });
            this.view.focus();
            startCompletion(this.view);
          }
        });
        if (completionStatus(this.view.state) !== null) {
          this.blockBtn.classList.add('is-active');
        }
        actionRow.appendChild(this.blockBtn);

        // 2. Undo
        actionRow.appendChild(
          createIconButton(this.view, 'mobile.undo', 'Undo', () => {
            undo(this.view);
          }),
        );

        // 3. Redo
        actionRow.appendChild(
          createIconButton(this.view, 'mobile.redo', 'Redo', () => {
            redo(this.view);
          }),
        );

        // 4. Hide Keyboard (Blur)
        actionRow.appendChild(
          createIconButton(this.view, 'mobile.done', 'Done', () => {
            this.view.contentDOM.blur();
          }),
        );

        this.layer.appendChild(actionRow);
      }
    },
  );
}
