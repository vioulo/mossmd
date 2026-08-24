import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MossMD,
  type MossMDHandle,
} from 'mossmd';
import { MOSS_CODE_LANGUAGES } from 'mossmd/code-languages';
import {
  mossCalloutSyntax,
  type WikiLinkSuggestion,
} from 'mossmd/features';
import 'mossmd/editor.css';
import {
  SAMPLE_SIZES,
  generateSampleMarkdown,
  type SampleOptions,
  type SampleSize,
} from './sample-content';

type ThemeMode = 'dark' | 'light';

declare const __APP_VERSION__: string;
const VERSION = __APP_VERSION__;
const DEMO_TITLE = `MossMD demo v${VERSION}`;

const WIKI_TARGETS: WikiLinkSuggestion[] = [
  { target: 'project-atlas', label: 'Project Atlas', detail: 'Project' },
  { target: 'meeting-notes', label: 'Meeting Notes', detail: 'Recent' },
  { target: 'roadmap', label: 'Editor Roadmap', detail: 'Planning' },
  { target: 'search-fallback', label: 'Search Fallback', detail: 'Content' },
];

const WIKI_SNIPPETS: Record<string, string> = {
  'project-atlas': 'A project planning page used for labeled wiki-link rendering.',
  'meeting-notes': 'Recent notes with a bare wiki-link target that resolves asynchronously.',
  'roadmap': 'A roadmap page for live preview, autocomplete, and deeplink behavior.',
  'search-fallback': 'Fallback result for testing content-like matching in the demo.',
};

interface ContentToggles {
  images: boolean;
  tables: boolean;
  lists: boolean;
  code: boolean;
}

const DEFAULT_TOGGLES: ContentToggles = {
  images: true,
  tables: true,
  lists: true,
  code: true,
};

const MOSS_DEMO_SYNTAX = [mossCalloutSyntax()];

function formatBytes(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(2)} MB`;
}

function findWikiTarget(target: string): WikiLinkSuggestion | undefined {
  return WIKI_TARGETS.find((candidate) => candidate.target === target);
}

function suggestWikiTargets(query: string): Promise<WikiLinkSuggestion[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return Promise.resolve(WIKI_TARGETS);
  return Promise.resolve(
    WIKI_TARGETS.filter((target) => {
      const snippet = WIKI_SNIPPETS[target.target] ?? '';
      return (
        target.label.toLowerCase().includes(normalized) ||
        target.target.toLowerCase().includes(normalized) ||
        snippet.toLowerCase().includes(normalized)
      );
    }),
  );
}

function resolveWikiTarget(target: string): Promise<WikiLinkSuggestion | null> {
  return Promise.resolve(findWikiTarget(target) ?? null);
}

function togglesToOptions(t: ContentToggles): SampleOptions {
  return {
    mode: t.images ? 'with images' : 'imageless',
    tables: t.tables ? 'with tables' : 'no tables',
    lists: t.lists ? 'with lists' : 'no lists',
    codeBlocks: t.code ? 'with code blocks' : 'no code blocks',
  };
}

export function App() {
  const [sampleSize, setSampleSize] = useState<SampleSize>('1 page');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [readOnly, setReadOnly] = useState(false);
  const [toggles, setToggles] = useState<ContentToggles>(DEFAULT_TOGGLES);
  const [showSource, setShowSource] = useState(false);
  const [liveMarkdown, setLiveMarkdown] = useState('');
  const [copied, setCopied] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const [perf, setPerf] = useState<{ rendered: number; total: number }>({
    rendered: 0,
    total: 0,
  });
  const [, setOpenedWikiTarget] = useState<string | null>(null);

  const editorRef = useRef<MossMDHandle | null>(null);

  const revealText = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('reveal');
  }, []);

  const documentId = useMemo(
    () =>
      `${sampleSize}|${toggles.images}|${toggles.tables}|${toggles.lists}|${toggles.code}|${resetNonce}`,
    [sampleSize, toggles, resetNonce],
  );

  const initialMarkdown = useMemo(
    () => generateSampleMarkdown(sampleSize, {
      ...togglesToOptions(toggles),
      title: DEMO_TITLE,
    }),
    [sampleSize, toggles],
  );

  const measurePerf = useCallback(() => {
    const markdown = liveMarkdown || initialMarkdown;
    const total = markdown ? markdown.split('\n').length : 0;
    const view = editorRef.current?.getContentDOM();
    if (!view) {
      setPerf({ rendered: 0, total });
      return;
    }

    const lines = view.querySelectorAll('.cm-line');
    let rendered = 0;
    lines.forEach((line) => {
      if (
        line.getBoundingClientRect().top < window.innerHeight &&
        line.getBoundingClientRect().bottom > 0
      ) {
        rendered++;
      }
    });
    setPerf({ rendered, total: lines.length || total });
  }, [initialMarkdown, liveMarkdown]);

  const handleMarkdownChange = useCallback((md: string) => {
    setLiveMarkdown(md);
    measurePerf();
  }, [measurePerf]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const content = editorRef.current?.getContentDOM();
    const scroller = content?.closest('.cm-scroller') as HTMLElement | null;
    scroller?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleLinkClick = useCallback((url: string) => {
    if (url.startsWith('http')) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      setOpenedWikiTarget(url);
    }
  }, []);

  const handleWikiOpen = useCallback((target: string) => {
    setOpenedWikiTarget(target);
  }, []);

  const handleWikiSuggest = useCallback(async (query: string) => {
    return suggestWikiTargets(query);
  }, []);

  const handleWikiResolve = useCallback(async (target: string) => {
    const result = await resolveWikiTarget(target);
    if (result) {
      return { target: result.target, label: result.label, status: 'resolved' as const };
    }
    return { target, label: target, status: 'missing' as const };
  }, []);

  const handleWikiSerialize = useCallback((suggestion: WikiLinkSuggestion) => {
    return `[[${suggestion.target}${suggestion.label && suggestion.label !== suggestion.target ? `|${suggestion.label}` : ''}}]]`;
  }, []);

  const copyMarkdown = useCallback(async () => {
    if (liveMarkdown) {
      await navigator.clipboard.writeText(liveMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [liveMarkdown]);

  const downloadMarkdown = useCallback(() => {
    if (liveMarkdown) {
      const blob = new Blob([liveMarkdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mossmd-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [liveMarkdown]);

  const resetEditor = useCallback(() => {
    setResetNonce((n) => n + 1);
    setLiveMarkdown('');
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let first = 0;
    let second = 0;
    first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        measurePerf();
      });
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [documentId, measurePerf]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        editorRef.current?.openSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="demo-shell" data-theme={theme}>
      <div className="demo-toolbar">
        <div className="demo-toolbar-actions">
          <button
            className="demo-btn"
            onClick={copyMarkdown}
            disabled={!liveMarkdown}
          >
            {copied ? 'Copied!' : 'Copy MD'}
          </button>
          <button className="demo-btn" onClick={downloadMarkdown} disabled={!liveMarkdown}>
            Download
          </button>
          <button className="demo-btn" onClick={resetEditor}>
            Reset
          </button>
          <button className="demo-btn primary" onClick={() => editorRef.current?.focus()}>
            Focus
          </button>
        </div>
        <div className="demo-toolbar-actions">
          <button
            className={`demo-btn demo-icon-btn ${theme === 'dark' ? 'is-dark' : 'is-light'}`}
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 12.7A8.5 8.5 0 0 1 11.3 3a8.5 8.5 0 1 0 9.7 9.7Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4.5" />
                <path d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6" />
              </svg>
            )}
          </button>
          <button
            className={`demo-btn demo-raw-toggle ${showSource ? 'is-active' : ''}`}
            onClick={() => setShowSource((open) => !open)}
            aria-pressed={showSource}
          >
            Raw
          </button>
        </div>
      </div>

      <main className="demo-main">
        <aside className="demo-float demo-float-left">
          <section className="demo-panel demo-controls-card">
            <div className="demo-panel-title">Controls</div>
            <div className="demo-controls">
              <div className="demo-control-group">
                <span className="demo-label">Page</span>
                <div className="demo-page-group" role="group" aria-label="Sample page size">
                  {SAMPLE_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={`demo-page-btn ${sampleSize === size ? 'is-active' : ''}`}
                      onClick={() => setSampleSize(size)}
                      aria-pressed={sampleSize === size}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
              <div className="demo-control-group">
                <label className="demo-checkbox">
                  <input
                    type="checkbox"
                    checked={readOnly}
                    onChange={(e) => setReadOnly(e.target.checked)}
                  />
                  Read-only
                </label>
              </div>
              <div className="demo-control-group">
                <label className="demo-checkbox">
                  <input
                    type="checkbox"
                    checked={toggles.images}
                    onChange={(e) => setToggles({ ...toggles, images: e.target.checked })}
                  />
                  Images
                </label>
                <label className="demo-checkbox">
                  <input
                    type="checkbox"
                    checked={toggles.tables}
                    onChange={(e) => setToggles({ ...toggles, tables: e.target.checked })}
                  />
                  Tables
                </label>
                <label className="demo-checkbox">
                  <input
                    type="checkbox"
                    checked={toggles.lists}
                    onChange={(e) => setToggles({ ...toggles, lists: e.target.checked })}
                  />
                  Lists
                </label>
                <label className="demo-checkbox">
                  <input
                    type="checkbox"
                    checked={toggles.code}
                    onChange={(e) => setToggles({ ...toggles, code: e.target.checked })}
                  />
                  Code
                </label>
              </div>
            </div>
          </section>
        </aside>

        <div className="demo-editor-pane">
          <div className="demo-editor-wrapper">
            <MossMD
              documentId={documentId}
              markdownSource={initialMarkdown}
              editorHandleRef={editorRef}
              onMarkdownChange={handleMarkdownChange}
              onLinkClick={handleLinkClick}
              readOnly={readOnly}
              codeLanguages={MOSS_CODE_LANGUAGES}
              customSyntax={MOSS_DEMO_SYNTAX}
              initialRevealText={revealText}
              inlinePreviewConfig={{ onLinkClick: handleLinkClick }}
              wikiLinksConfig={{
                suggest: handleWikiSuggest,
                resolve: handleWikiResolve,
                onOpen: handleWikiOpen,
                openOnClick: true,
                serializeSuggestion: handleWikiSerialize,
              }}
            />
          </div>
        </div>

        <aside className={`demo-float demo-float-right demo-raw-panel ${showSource ? 'is-open' : ''}`} aria-hidden={!showSource}>
          <div className="demo-panel-title">Raw markdown</div>
          <div className="demo-output-content">
            {showSource ? liveMarkdown || initialMarkdown : liveMarkdown || '(start typing…)'}
          </div>
          <div className="demo-perf">
            <div className="demo-perf-item">
              <span>Rendered:</span>
              <strong>{perf.rendered}</strong>
            </div>
            <div className="demo-perf-item">
              <span>Total lines:</span>
              <strong>{perf.total}</strong>
            </div>
            <div className="demo-perf-item">
              <span>Size:</span>
              <strong>{formatBytes(liveMarkdown.length || initialMarkdown.length)}</strong>
            </div>
          </div>
        </aside>
      </main>

      <button
        type="button"
        className="demo-top-button"
        onClick={scrollToTop}
        aria-label="Back to top"
        title="Back to top"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>

      <div className="demo-statusbar" aria-label="Document status">
        <div className="demo-status-item">
          <span>Rendered</span>
          <strong>{perf.rendered}</strong>
        </div>
        <div className="demo-status-item">
          <span>Total lines</span>
          <strong>{perf.total}</strong>
        </div>
        <div className="demo-status-item">
          <span>Size</span>
          <strong>{formatBytes(liveMarkdown.length || initialMarkdown.length)}</strong>
        </div>
      </div>
    </div>
  );
}
