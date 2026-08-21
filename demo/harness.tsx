import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MossEditor,
  type MossEditorHandle,
} from 'mossmd';
import 'mossmd/editor.css';
import './harness.css';

type HarnessTheme = 'dark' | 'light';

interface HarnessOptions {
  readOnly?: boolean;
  theme?: HarnessTheme;
}

interface HarnessController {
  load(markdown: string, options?: HarnessOptions): Promise<void>;
  focus(): void;
  undo(): void;
  redo(): void;
  openSearch(query?: string): void;
  getMarkdown(): string;
  getOpenedUrls(): string[];
}

declare global {
  interface Window {
    mossHarness?: HarnessController;
  }
}

interface HarnessState {
  markdown: string;
  readOnly: boolean;
  revision: number;
  theme: HarnessTheme;
}

function Harness() {
  const handleRef = useRef<MossEditorHandle | null>(null);
  const openedUrls = useRef<string[]>([]);
  const pendingLoad = useRef<(() => void) | null>(null);
  const [state, setState] = useState<HarnessState>({
    markdown: '# harness ready',
    readOnly: false,
    revision: 0,
    theme: 'dark',
  });

  useLayoutEffect(() => {
    window.mossHarness = {
      load(markdown, options = {}) {
        openedUrls.current = [];
        return new Promise<void>((resolve) => {
          pendingLoad.current = resolve;
          setState((current) => ({
            markdown,
            readOnly: options.readOnly ?? false,
            revision: current.revision + 1,
            theme: options.theme ?? 'dark',
          }));
        });
      },
      focus() {
        handleRef.current?.focus();
      },
      undo() {
        handleRef.current?.undo();
      },
      redo() {
        handleRef.current?.redo();
      },
      openSearch(query) {
        handleRef.current?.openSearch(query);
      },
      getMarkdown() {
        return handleRef.current?.getMarkdown() ?? '';
      },
      getOpenedUrls() {
        return [...openedUrls.current];
      },
    };

    return () => {
      delete window.mossHarness;
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    const resolve = pendingLoad.current;
    if (!resolve) return;
    pendingLoad.current = null;
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }, [state]);

  return (
    <main className="harness-shell" data-harness-revision={state.revision}>
      <div className="harness-editor">
        <MossEditor
          documentId={`fixture-${state.revision}`}
          editorHandleRef={handleRef}
          markdownSource={state.markdown}
          onLinkClick={(url) => openedUrls.current.push(url)}
          readOnly={state.readOnly}
        />
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(<Harness />);
