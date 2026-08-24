// Slash commands.
//
// Two trigger paths share one completion source:
//
//   * Type `/` at the start of an (otherwise empty) line → popup opens,
//     filters as you type. URL mid-text `/` doesn't fire because the
//     trigger requires line-start with only whitespace before.
//   * Click the `+` button rendered at the start of the cursor's line
//     when that line is empty → popup opens via `startCompletion`.
//
// Both paths land in the same source, which calls `config.suggest` (or
// filters `config.commands` locally) and applies the chosen command's
// `apply` callback. `apply` may be async — that's how upload-image /
// upload-file pick from disk and then dispatch the resulting markdown.
//
// The `/` trigger character is temporary scaffolding: when a command
// is selected, `apply` replaces the `/query` range with the command's
// snippet, so the slash doesn't survive in the doc. Raw markdown
// remains the only source of truth (project invariant).
//
// Default commands ship an upload-image / upload-file skeleton that
// uses the browser file picker and creates a local object URL — fine
// for a demo, but consumers are expected to either override these or
// supply their own commands that talk to a real upload service.

import {
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { readOnlyFacet } from '../../core/read-only';

export interface MossSlashCommand {
  /** Stable id; used for dedupe and React keys if a consumer renders
   *  their own popup. */
  id: string;
  /** Primary text shown in the popup. */
  label: string;
  /** Secondary text. */
  detail?: string;
  /** Extra tokens used by the default fuzzy matcher. */
  keywords?: string[];
  /** Replace the `/query` range (or the empty cursor range when
   *  triggered via the `+` button) with this command's markdown.
   *  May be async — file pickers and network uploads are fine. */
  apply: (view: EditorView, from: number, to: number) => void | Promise<void>;
}

export interface MossSlashCommandsConfig {
  commands: MossSlashCommand[];
  /** When false, `/` fires anywhere preceded by whitespace. Default
   *  true — only at line start with only whitespace before, so URL
   *  mid-text `/` doesn't pop the menu. */
  triggerAtLineStart?: boolean;
  /** Show a `+` button at the start of the cursor's line when that
   *  line is empty. Clicking opens the same popup via
   *  `startCompletion`. Default false. */
  sideButton?: boolean;
  /** Optional async filter. When omitted, the default matcher filters
   *  `commands` by label / keyword / id against the query. */
  suggest?: (
    query: string,
  ) => Promise<MossSlashCommand[]> | MossSlashCommand[];
  /** Max results shown. Default 12. */
  maxResults?: number;
}

interface SlashCommandCompletion extends Completion {
  command: MossSlashCommand;
}

const SLASH_QUERY_RE = /^\/[\w-]*$/;

export function mossSlashCommands(config: MossSlashCommandsConfig): Extension {
  console.log('[mossmd slash] mossSlashCommands() called, sideButton=', !!config.sideButton, 'commands=', config.commands.length);
  // Register the source via `EditorState.languageData` (additive,
  // mergeable) rather than `autocompletion({ override: [...] })`
  // (single-valued, conflicts on merge). Multiple features can each
  // contribute their own completion sources this way without
  // colliding — wiki-links and slash-commands coexist cleanly.
  //
  // CRITICAL: the `autocomplete` value MUST be a stable function
  // reference. `CompletionState.update` looks up the existing
  // ActiveSource via `this.active.find(s => s.source == source)` —
  // identity comparison. If the provider returns a fresh arrow each
  // call, the lookup never matches, every update creates a new
  // ActiveSource (starting Inactive), and the Activate transition
  // gets thrown away by the `active == this.active` short-circuit
  // check downstream. The result: provider fires, but the source is
  // never queried.
  const autocompleteHandler = (context: CompletionContext): Promise<CompletionResult | null> =>
    source(context, config);
  const extensions: Extension[] = [
    EditorState.languageData.of(() => {
      console.log('[mossmd slash] languageData provider called');
      return [{ autocomplete: autocompleteHandler }];
    }),
    // Global autocomplete config (without override). Equal-valued
    // scalar fields merge without conflict, so multiple features can
    // each call `autocompletion(...)` to set defaults; the values
    // must agree or CM6 throws "Config merge conflict".
    autocompletion({
      activateOnTyping: true,
      icons: false,
      closeOnBlur: true,
    }),
  ];

  if (config.sideButton) {
    extensions.push(sidePlusButtonPlugin);
  }

  return extensions;
}

async function source(
  context: CompletionContext,
  config: MossSlashCommandsConfig,
): Promise<CompletionResult | null> {
  // TEMP DEBUG — remove once popup is verified working.
  console.log('[mossmd slash] source queried', {
    pos: context.pos,
    explicit: context.explicit,
    textBefore: context.state.doc.sliceString(Math.max(0, context.pos - 10), context.pos),
  });
  if (context.state.facet(readOnlyFacet)) return null;

  // Path A: user typed /query.
  const slashMatch = context.matchBefore(SLASH_QUERY_RE);
  console.log('[mossmd slash] slashMatch', slashMatch?.text);
  if (slashMatch) {
    // Trigger gate: when triggerAtLineStart (default true), the slash
    // must be the first non-whitespace character on its line. Without
    // this gate, `https://...` mid-text would pop the menu.
    if (config.triggerAtLineStart !== false) {
      const line = context.state.doc.lineAt(slashMatch.from);
      const before = line.text.slice(0, slashMatch.from - line.from);
      console.log('[mossmd slash] lineStart check, before=', JSON.stringify(before), 'slashFrom=', slashMatch.from, 'lineFrom=', line.from);
      if (before.trim() !== '') return null;
    }
    const query = slashMatch.text.slice(1);
    const commands = await resolveCommands(config, query);
    console.log('[mossmd slash] resolved commands=', commands.length, 'aborted=', context.aborted);
    if (context.aborted) return null;
    const result = {
      // Include the `/` in the replace range so `apply` can wipe it.
      from: slashMatch.from,
      to: context.pos,
      options: commands.map((cmd) => toOption(cmd)),
      validFor: /^\/?[\w-]*$/,
    };
    console.log('[mossmd slash] returning result, options=', result.options.length, 'from=', result.from, 'to=', result.to);
    return result;
  }

  // Path B: explicit invocation via the side `+` button. CM6 sets
  // `context.explicit = true` when `startCompletion` is called. Only
  // fire when the cursor is on an empty (whitespace-only) line, so
  // programmatically opening the menu doesn't surprise users mid-prose.
  if (context.explicit && isCursorOnEmptyLine(context.state, context.pos)) {
    const commands = await resolveCommands(config, '');
    if (context.aborted) return null;
    return {
      from: context.pos,
      options: commands.map((cmd) => toOption(cmd)),
      validFor: /^[\w-]*$/,
    };
  }

  return null;
}

async function resolveCommands(
  config: MossSlashCommandsConfig,
  query: string,
): Promise<MossSlashCommand[]> {
  const list = config.suggest ? await config.suggest(query) : config.commands;
  const filtered = config.suggest ? list : defaultFilter(list, query);
  return filtered.slice(0, config.maxResults ?? 12);
}

function defaultFilter(
  commands: MossSlashCommand[],
  query: string,
): MossSlashCommand[] {
  const q = query.toLowerCase();
  if (!q) return [...commands];
  const scored: { cmd: MossSlashCommand; score: number }[] = [];
  for (const cmd of commands) {
    const label = cmd.label.toLowerCase();
    const id = cmd.id.toLowerCase();
    const keywords = cmd.keywords?.map((k) => k.toLowerCase()) ?? [];
    let score = 0;
    if (label === q || id === q) score = 100;
    else if (label.startsWith(q) || id.startsWith(q)) score = 80;
    else if (label.includes(q) || id.includes(q)) score = 60;
    else if (keywords.some((k) => k.includes(q))) score = 40;
    if (score > 0) scored.push({ cmd, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.cmd);
}

function toOption(cmd: MossSlashCommand): SlashCommandCompletion {
  return {
    label: cmd.label,
    detail: cmd.detail,
    type: 'function',
    apply: (
      view: EditorView,
      _completion: Completion,
      from: number,
      to: number,
    ) => {
      // Forward to the command's apply. We don't await — CM6 doesn't
      // expect apply to return a promise, but async side effects (file
      // upload, network) are fine since they dispatch their own
      // transactions when ready.
      void cmd.apply(view, from, to);
    },
    command: cmd,
  };
}

function isCursorOnEmptyLine(
  state: { doc: { lineAt: (pos: number) => { text: string } } },
  pos: number,
): boolean {
  const line = state.doc.lineAt(pos);
  return line.text.trim() === '';
}

// ---------------------------------------------------------------------------
// Side `+` button
//
// A non-block widget rendered at the start of the cursor's line when
// that line is empty. Clicking focuses the editor and calls
// `startCompletion`, which lands in path B of the source above. Only
// the cursor's line gets a button — keeps the DOM cheap on long docs
// and matches Notion's "discoverable on the active empty line" UX
// rather than rendering buttons for every empty line in the viewport.
//
// Non-block widgets can come straight from a ViewPlugin (unlike block
// widgets, which CM6 requires to originate from a StateField). CSS
// positions the button absolutely so it lives in the left gutter
// without shifting the empty line's text.
// ---------------------------------------------------------------------------

class SidePlusWidget extends WidgetType {
  constructor(readonly lineFrom: number) {
    super();
  }

  eq(other: SidePlusWidget): boolean {
    return other.lineFrom === this.lineFrom;
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-moss-side-plus';
    btn.textContent = '+';
    btn.title = 'Add a block (or type /)';
    btn.setAttribute('aria-label', 'Add a block');
    btn.addEventListener('mousedown', (event) => {
      // Prevent the editor from stealing focus / moving the caret
      // before we dispatch our own selection.
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      view.dispatch({
        selection: { anchor: this.lineFrom },
        scrollIntoView: false,
      });
      startCompletion(view);
    });
    return btn;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildSidePlusDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  if (state.facet(readOnlyFacet)) return Decoration.none;
  if (!view.hasFocus) return Decoration.none;

  const sel = state.selection.main;
  if (!sel.empty) return Decoration.none;

  const line = state.doc.lineAt(sel.head);
  if (line.text.trim() !== '') return Decoration.none;

  // Only render when the cursor is at the start of the empty line —
  // if the user moved into the middle of whitespace, don't show the
  // button (they're navigating, not adding a block).
  if (sel.head !== line.from) return Decoration.none;

  return Decoration.set(
    [
      Decoration.widget({
        widget: new SidePlusWidget(line.from),
        // Non-block: renders inline at line.from. CSS shifts it
        // absolutely into the left gutter without taking a row.
        side: -1,
      }).range(line.from),
    ],
    true,
  );
}

const sidePlusButtonPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      console.log('[mossmd slash] sidePlusButtonPlugin constructor, hasFocus=', view.hasFocus, 'readOnly=', view.state.facet(readOnlyFacet));
      this.decorations = buildSidePlusDecorations(view);
      console.log('[mossmd slash] constructor decorations size=', this.decorations.size);
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
        this.decorations = buildSidePlusDecorations(update.view);
      }
    }
  },
  { decorations: (p) => p.decorations },
);

// ---------------------------------------------------------------------------
// Default commands
//
// Only the upload-image / upload-file skeletons ship in the package.
// They use the browser file picker and create a local object URL —
// fine for a demo, but production consumers should override these with
// commands that POST to their upload service.
// ---------------------------------------------------------------------------

export const mossDefaultSlashCommands: MossSlashCommand[] = [
  {
    id: 'upload-image',
    label: 'Upload image',
    detail: 'Pick from disk and insert ![alt|](url)',
    keywords: ['picture', 'photo', 'image', 'img'],
    apply: async (view, from, to) => {
      const file = await pickFile('image/*');
      if (!file) return;
      const url = URL.createObjectURL(file);
      const insert = `![${file.name}|](${url})`;
      view.dispatch({
        changes: { from, to, insert },
        // Drop the caret on the `|caption` slot so the user can type
        // a caption immediately. Position = after `![name|`.
        selection: { anchor: from + 2 + file.name.length + 1 },
      });
    },
  },
  {
    id: 'upload-file',
    label: 'Upload file',
    detail: 'Pick from disk and link [name](url)',
    keywords: ['attachment', 'file', 'link'],
    apply: async (view, from, to) => {
      const file = await pickFile();
      if (!file) return;
      const url = URL.createObjectURL(file);
      view.dispatch({
        changes: { from, to, insert: `[${file.name}](${url})` },
      });
    },
  },
];

function pickFile(accept?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
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
      // Give the change event a chance to fire first; if it didn't,
      // the user cancelled the picker.
      window.setTimeout(() => {
        if (!settled && !input.files?.length) {
          cleanup();
          resolve(null);
        }
      }, 300);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    });
    window.addEventListener('focus', onFocus, true);
    document.body.appendChild(input);
    input.click();
  });
}
