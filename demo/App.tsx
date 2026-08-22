import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MossEditor,
  type MossEditorHandle,
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

const SPOTLIGHTS: { label: string; phrase: string; needs?: keyof ContentToggles }[] = [
  { label: 'Callouts', phrase: 'Callouts keep Obsidian-style blocks readable' },
  { label: 'Code', phrase: 'Fenced code blocks pick up', needs: 'code' },
  { label: 'Tables', phrase: 'Tables render WYSIWYG', needs: 'tables' },
  { label: 'Checkboxes', phrase: 'Task lists are real checkboxes', needs: 'lists' },
  { label: 'Wiki links', phrase: 'Wiki links connect notes' },
  { label: 'Links', phrase: 'A link to' },
  { label: 'Escapes', phrase: 'Escapes like domain' },
];

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

  const editorRef = useRef<MossEditorHandle | null>(null);

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
    () => generateSampleMarkdown(sampleSize, togglesToOptions(toggles)),
    [sampleSize, toggles],
  );

  const handleMarkdownChange = useCallback((md: string) => {
    setLiveMarkdown(md);
    const view = editorRef.current?.getContentDOM();
    if (view) {
      const lines = view.querySelectorAll('.cm-line');
      let rendered = 0;
      lines.forEach((line) => {
        if (line.getBoundingClientRect().top < window.innerHeight &&
            line.getBoundingClientRect().bottom > 0) {
          rendered++;
        }
      });
      setPerf({ rendered, total: lines.length });
    }
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

  const jumpToSpotlight = useCallback((phrase: string) => {
    editorRef.current?.revealText(phrase);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
      <header className="demo-header">
        <div className="demo-title">MossMD Demo v{VERSION}</div>
        <div className="demo-controls">
          <div className="demo-control-group">
            <span className="demo-label">Sample</span>
            <select
              className="demo-select"
              value={sampleSize}
              onChange={(e) => setSampleSize(e.target.value as SampleSize)}
            >
              {SAMPLE_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="demo-control-group">
            <span className="demo-label">Theme</span>
            <select
              className="demo-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeMode)}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
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
          <div className="demo-control-group">
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
        </div>
      </header>

      <main className="demo-main">
        <div className="demo-editor-pane">
          <div className="demo-editor-wrapper">
            <MossEditor
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

        <aside className="demo-output-pane">
          <div className="demo-output-header">
            Live Markdown Output
            <label className="demo-checkbox">
              <input
                type="checkbox"
                checked={showSource}
                onChange={(e) => setShowSource(e.target.checked)}
              />
              Raw
            </label>
          </div>
          <div className="demo-output-content">
            {showSource ? liveMarkdown || initialMarkdown : liveMarkdown || '(start typing…)'}
          </div>
          <div className="demo-spotlight">
            {SPOTLIGHTS.map((spot) =>
              !spot.needs || toggles[spot.needs] ? (
                <button
                  key={spot.label}
                  className="demo-spotlight-btn"
                  onClick={() => jumpToSpotlight(spot.phrase)}
                >
                  {spot.label}
                </button>
              ) : null
            )}
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

      <footer className="demo-footer">
        MossMD — CodeMirror 6 Markdown editor with Obsidian-style live preview.
        <a href="https://github.com/vioulo/mossmd" target="_blank" rel="noopener noreferrer" style={{ marginLeft: 12 }}>
          GitHub
        </a>
      </footer>
    </div>
  );
}
