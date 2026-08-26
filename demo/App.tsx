import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  Code2,
  Copy,
  Download,
  Moon,
  RotateCcw,
  Sun,
} from 'lucide-react';
import {
  MossMD,
  type MossMDHandle,
} from 'mossmd';
import { MOSS_CODE_LANGUAGES } from 'mossmd/code-languages';
import {
  mossCalloutSyntax,
  mossDefaultSlashCommands,
  mossUploadCommands,
  type MossSlashCommand,
  type MossUploader,
  type WikiLinkSuggestion,
} from 'mossmd/features';
import 'mossmd/editor.css';
import {
  SAMPLE_SIZES,
  generateSampleMarkdown,
  type SampleSize,
} from './sample-content';
import { wavyHrSyntax } from './wavy-hr';
import { overrideDefaultUploads } from './custom-upload';

// Demo-only slash commands — markdown snippet helpers shipped alongside
// the demo, NOT in the package. The package itself only ships the
// upload-image / upload-file skeletons (`mossDefaultSlashCommands`).
// Consumers are expected to compose their own snippet set on top.
const DEMO_SNIPPET_COMMANDS: MossSlashCommand[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    detail: '# Title',
    keywords: ['heading', 'title'],
    icon: 'snippet',
    apply: (view, from, to) =>
      view.dispatch({
        changes: { from, to, insert: '# ' },
        selection: { anchor: from + 2 },
      }),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    detail: '## Section',
    keywords: ['heading', 'section'],
    icon: 'snippet',
    apply: (view, from, to) =>
      view.dispatch({
        changes: { from, to, insert: '## ' },
        selection: { anchor: from + 3 },
      }),
  },
  {
    id: 'bullet-list',
    label: 'Bullet list',
    detail: '- item',
    keywords: ['list', 'unordered', 'bullet'],
    icon: 'list',
    apply: (view, from, to) =>
      view.dispatch({
        changes: { from, to, insert: '- ' },
        selection: { anchor: from + 2 },
      }),
  },
  {
    id: 'ordered-list',
    label: 'Numbered list',
    detail: '1. item',
    keywords: ['list', 'ordered', 'number'],
    icon: 'list',
    apply: (view, from, to) =>
      view.dispatch({
        changes: { from, to, insert: '1. ' },
        selection: { anchor: from + 3 },
      }),
  },
  {
    id: 'quote',
    label: 'Quote',
    detail: '> text',
    keywords: ['blockquote', 'quote'],
    icon: 'snippet',
    apply: (view, from, to) =>
      view.dispatch({
        changes: { from, to, insert: '> ' },
        selection: { anchor: from + 2 },
      }),
  },
  {
    id: 'code-block',
    label: 'Code block',
    detail: '``` fenced',
    keywords: ['code', 'fence', 'snippet'],
    icon: 'code',
    apply: (view, from, to) =>
      view.dispatch({
        changes: { from, to, insert: '```js\n\n```' },
        selection: { anchor: from + 5 },
      }),
  },
  {
    id: 'hr',
    label: 'Horizontal rule',
    detail: '--- solid / *** wavy / ___ glyph',
    keywords: ['divider', 'rule', 'separator'],
    icon: 'rule',
    apply: (view, from, to) =>
      view.dispatch({
        changes: { from, to, insert: '---' },
        selection: { anchor: from + 3 },
      }),
  },
  {
    id: 'table',
    label: 'Table',
    detail: '2×2 grid',
    keywords: ['grid', 'matrix'],
    icon: 'table',
    apply: (view, from, to) =>
      view.dispatch({
        changes: { from, to, insert: '| a | b |\n| - | - |\n| c | d |' },
      }),
  },
  {
    id: 'callout',
    label: 'Callout',
    detail: '> [!note]',
    keywords: ['note', 'tip', 'warning', 'box'],
    icon: 'callout',
    apply: (view, from, to) =>
      view.dispatch({
        changes: { from, to, insert: '> [!note]\n> ' },
        selection: { anchor: from + 11 },
      }),
  },
  {
    id: 'image-url',
    label: 'Image by URL',
    detail: '![alt|caption](url)',
    keywords: ['picture', 'photo'],
    icon: 'image',
    apply: (view, from, to) =>
      view.dispatch({
        changes: { from, to, insert: '![alt|caption](https://)' },
        selection: { anchor: from + 5 },
      }),
  },
];

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

const MOSS_DEMO_SYNTAX = [mossCalloutSyntax(), wavyHrSyntax()];

// Compose the package's default upload skeletons with a demo-specific
// uploader that uses the new widget flow (`mossUploadCommands`). The
// demo "uploader" simulates progress over ~1.5s and resolves with a
// local object URL so the page works without a backend — in a real
// app you'd swap this for `createUploader({ endpoint: '/api/upload' })`
// (see `demo/custom-upload.ts`). `overrideDefaultUploads` drops the
// package's stub upload-image / upload-file and inserts the widget-
// flow versions in their place, leaving the snippet commands intact.
const demoUploader: MossUploader = (file, onProgress) =>
  new Promise((resolve) => {
    let pct = 0;
    const tick = (): void => {
      pct = Math.min(1, pct + 0.08 + Math.random() * 0.12);
      onProgress(pct);
      if (pct < 1) {
        window.setTimeout(tick, 90 + Math.random() * 130);
      } else {
        resolve({ url: URL.createObjectURL(file) });
      }
    };
    tick();
  });
const demoUploadCommands = mossUploadCommands(demoUploader);

const MOSS_DEMO_SLASH_COMMANDS = {
  commands: overrideDefaultUploads(
    [...DEMO_SNIPPET_COMMANDS, ...mossDefaultSlashCommands],
    demoUploadCommands,
  ),
  sideButton: true,
};

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

function formatBytes(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(2)} MB`;
}

export function App() {
  const [sampleSize, setSampleSize] = useState<SampleSize>('1 page');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [readOnly, setReadOnly] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [liveMarkdown, setLiveMarkdown] = useState('');
  const [copied, setCopied] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const [, setOpenedWikiTarget] = useState<string | null>(null);
  const [showTopButton, setShowTopButton] = useState(false);
  const [perf, setPerf] = useState<{ rendered: number; total: number; size: string }>({
    rendered: 0,
    total: 0,
    size: '0 B',
  });

  const editorRef = useRef<MossMDHandle | null>(null);

  const revealText = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('reveal');
  }, []);

  const documentId = useMemo(
    () => `${sampleSize}|${resetNonce}`,
    [sampleSize, resetNonce],
  );

  const initialMarkdown = useMemo(
    () => {
      const md = generateSampleMarkdown(sampleSize, { title: DEMO_TITLE });
      // Always end with exactly one trailing blank line so the `+`
      // block button is reachable at the bottom of the doc on load.
      return `${md.replace(/\n+$/, '')}\n\n`;
    },
    [sampleSize],
  );

  const measurePerf = useCallback(() => {
    const markdown = liveMarkdown || initialMarkdown;
    const total = markdown ? markdown.split('\n').length : 0;
    const size = formatBytes(markdown.length);
    const view = editorRef.current?.getContentDOM();
    if (!view) {
      setPerf({ rendered: 0, total, size });
      return;
    }

    const scroller = view.closest('.cm-scroller') as HTMLElement | null;
    const rect = scroller?.getBoundingClientRect();
    const viewportTop = rect?.top ?? 0;
    const viewportBottom = rect?.bottom ?? window.innerHeight;

    const lines = view.querySelectorAll('.cm-line');
    let rendered = 0;
    lines.forEach((line) => {
      const box = line.getBoundingClientRect();
      if (box.top < viewportBottom && box.bottom > viewportTop) {
        rendered++;
      }
    });
    setPerf({ rendered, total: lines.length || total, size });
  }, [initialMarkdown, liveMarkdown]);

  const measurePerfRef = useRef(measurePerf);
  useEffect(() => {
    measurePerfRef.current = measurePerf;
  }, [measurePerf]);

  const handleMarkdownChange = useCallback((md: string) => {
    setLiveMarkdown(md);
    requestAnimationFrame(() => measurePerfRef.current());
  }, []);

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
    const md = liveMarkdown || initialMarkdown;
    if (!md) return;
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [liveMarkdown, initialMarkdown]);

  const downloadMarkdown = useCallback(() => {
    const md = liveMarkdown || initialMarkdown;
    if (!md) return;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mossmd-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [liveMarkdown, initialMarkdown]);

  const resetEditor = useCallback(() => {
    setResetNonce((n) => n + 1);
    setLiveMarkdown('');
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let scroller: HTMLElement | null = null;
    let firstFrame = 0;
    let secondFrame = 0;
    let measureFrame = 0;

    const scheduleMeasure = () => {
      if (measureFrame) return;
      measureFrame = window.requestAnimationFrame(() => {
        measureFrame = 0;
        measurePerfRef.current();
      });
    };

    const handleScroll = () => {
      if (scroller) {
        setShowTopButton(scroller.scrollTop > 200);
      }
      scheduleMeasure();
    };

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const content = editorRef.current?.getContentDOM();
        scroller = content?.closest('.cm-scroller') as HTMLElement | null;
        if (!scroller) return;
        scroller.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
      });
    });

    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.cancelAnimationFrame(measureFrame);
      if (scroller) scroller.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [documentId]);

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
      <main className="demo-main">
        {/* Left floating cluster: pages capsule */}
        <div className="demo-pill-cluster demo-pill-cluster-left">
          <div className="demo-pill-card" role="group" aria-label="Sample page size">
            <span className="demo-pill-label">Pages:</span>
            {SAMPLE_SIZES.map((size) => {
              const num = size.match(/\d+/)?.[0] ?? size;
              return (
                <button
                  key={size}
                  type="button"
                  className={`demo-pill ${sampleSize === size ? 'is-active' : ''}`}
                  onClick={() => setSampleSize(size)}
                  aria-pressed={sampleSize === size}
                  title={size}
                >
                  {num}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right floating cluster: live/ro | actions | theme */}
        <div className="demo-pill-cluster demo-pill-cluster-right">
          <div className="demo-pill-card" role="group" aria-label="Edit mode">
            <button
              type="button"
              className={`demo-pill ${!readOnly ? 'is-active' : ''}`}
              onClick={() => setReadOnly(false)}
              aria-pressed={!readOnly}
            >
              Live
            </button>
            <button
              type="button"
              className={`demo-pill ${readOnly ? 'is-active' : ''}`}
              onClick={() => setReadOnly(true)}
              aria-pressed={readOnly}
            >
              RO
            </button>
          </div>
          <div className="demo-pill-card">
            <button
              type="button"
              className="demo-pill demo-icon-pill"
              onClick={resetEditor}
              aria-label="Reset"
              title="Reset"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              className="demo-pill demo-icon-pill"
              onClick={copyMarkdown}
              aria-label="Copy markdown"
              title="Copy markdown"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button
              type="button"
              className="demo-pill demo-icon-pill"
              onClick={downloadMarkdown}
              aria-label="Download"
              title="Download"
            >
              <Download size={14} />
            </button>
            <button
              type="button"
              className={`demo-pill demo-icon-pill ${showSource ? 'is-active' : ''}`}
              onClick={() => setShowSource((open) => !open)}
              aria-pressed={showSource}
              aria-label="Raw markdown"
              title="Raw markdown"
            >
              <Code2 size={14} />
            </button>
          </div>
          <div className="demo-pill-card">
            <button
              type="button"
              className="demo-pill demo-icon-pill"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </div>

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
              slashCommandsConfig={MOSS_DEMO_SLASH_COMMANDS}
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

        <aside className={`demo-float demo-raw-panel demo-raw-float ${showSource ? 'is-open' : ''}`} aria-hidden={!showSource}>
          <div className="demo-panel-title">Raw markdown</div>
          <div className="demo-output-content">
            {showSource ? liveMarkdown || initialMarkdown : liveMarkdown || '(start typing…)'}
          </div>
        </aside>
        <div className="demo-status-bar" role="status" aria-label="Document status">
          <span className="demo-stat">
            <span className="demo-stat-label">Rendered</span>
            <strong>{perf.rendered}</strong>
          </span>
          <span className="demo-stat">
            <span className="demo-stat-label">Total</span>
            <strong>{perf.total}</strong>
          </span>
          <span className="demo-stat">
            <span className="demo-stat-label">Size</span>
            <strong>{perf.size}</strong>
          </span>
        </div>
      </main>

      <button
        type="button"
        className={`demo-top-button ${showTopButton ? 'is-visible' : ''}`}
        onClick={scrollToTop}
        aria-label="Back to top"
        title="Back to top"
      >
        <ArrowUp size={18} />
      </button>
    </div>
  );
}
