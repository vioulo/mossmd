import { ViewPlugin, type ViewUpdate, EditorView } from '@codemirror/view';
import { type Extension } from '@codemirror/state';

/**
 * Mobile Visual Viewport & Soft Keyboard Avoidance Extension.
 *
 * Observes `window.visualViewport` resize and scroll events to calculate
 * the keyboard occluded height and visual viewport boundaries. Exposes
 * `--moss-keyboard-offset` and `--moss-visual-viewport-height` CSS variables
 * on the editor host element so floating toolbars and search panels can
 * smoothly dodge the virtual keyboard.
 *
 * When the keyboard opens, automatically scrolls the active selection
 * into view with a safety margin.
 */
export function visualViewportExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      private cleanup: (() => void) | null = null;

      constructor(private readonly view: EditorView) {
        this.setup();
      }

      private updateViewport = () => {
        const vv = typeof window !== 'undefined' ? window.visualViewport : null;
        if (!vv) return;

        const windowHeight = window.innerHeight;
        const visibleBottom = vv.height + (vv.offsetTop ?? 0);
        const keyboardOffset = Math.max(0, windowHeight - visibleBottom);

        const host = this.view.dom.parentElement ?? this.view.dom;
        host.style.setProperty(
          '--moss-keyboard-offset',
          `${Math.round(keyboardOffset)}px`,
        );
        host.style.setProperty(
          '--moss-visual-viewport-height',
          `${Math.round(vv.height)}px`,
        );

        if (keyboardOffset > 0 && this.view.hasFocus) {
          const mainHead = this.view.state.selection.main.head;
          window.requestAnimationFrame(() => {
            if (this.view.hasFocus) {
              this.view.dispatch({
                effects: EditorView.scrollIntoView(mainHead, {
                  y: 'nearest',
                  yMargin: 40,
                }),
              });
            }
          });
        }
      };

      private setup() {
        const vv = typeof window !== 'undefined' ? window.visualViewport : null;
        if (!vv) return;

        vv.addEventListener('resize', this.updateViewport);
        vv.addEventListener('scroll', this.updateViewport);
        this.updateViewport();

        this.cleanup = () => {
          vv.removeEventListener('resize', this.updateViewport);
          vv.removeEventListener('scroll', this.updateViewport);
        };
      }

      update(_: ViewUpdate) {}

      destroy() {
        if (this.cleanup) {
          this.cleanup();
          this.cleanup = null;
        }
      }
    },
  );
}

