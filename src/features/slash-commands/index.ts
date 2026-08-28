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
import {
  Code2,
  File,
  FileImage,
  FileText,
  List,
  MessageSquare,
  Minus,
  Plus,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import { lucideSvg } from '../../core/icons';
import { readOnlyFacet } from '../../core/read-only';
import { mossUploadBlocks } from '../upload';

const SIDE_PLUS_ICON = lucideSvg(Plus, { size: 18, strokeWidth: 2 });

const SLASH_COMMAND_ICONS: Record<string, LucideIcon> = {
  image: FileImage,
  file: File,
  snippet: FileText,
  list: List,
  code: Code2,
  table: Table2,
  rule: Minus,
  callout: MessageSquare,
};

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
  /** Icon kind key rendered as a leading icon in the popup. Maps to a
   *  `.cm-completionIcon-moss-<icon>` CSS rule (see inline-preview.css).
   *  Built-in kinds: 'image', 'file', 'snippet', 'list', 'code',
   *  'table', 'rule', 'callout'. Omit to fall back to 'snippet'. */
  icon?: string;
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

function isSlashCommandCompletion(
  completion: Completion,
): completion is SlashCommandCompletion {
  return 'command' in completion;
}

function renderSlashCommandIcon(completion: Completion): Node | null {
  if (!isSlashCommandCompletion(completion)) return null;

  const iconKey = /^[\w-]+$/.test(completion.command.icon ?? '')
    ? completion.command.icon ?? 'snippet'
    : 'snippet';
  const Icon = SLASH_COMMAND_ICONS[iconKey] ?? FileText;
  const icon = document.createElement('span');
  icon.className = `cm-completionIcon cm-completionIcon-moss-${iconKey}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = lucideSvg(Icon, { size: 16, strokeWidth: 1.8 });
  return icon;
}

// `matchBefore` searches within the current line. Do not anchor this
// expression at the start, otherwise an indented line such as `  /` can
// never match; the line-start policy is checked separately below.
const SLASH_QUERY_RE = /\/[\w-]*$/;

export function mossSlashCommands(config: MossSlashCommandsConfig): Extension {
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
    EditorState.languageData.of(() => [{ autocomplete: autocompleteHandler }]),
    // Global autocomplete config (without override). Equal-valued
    // scalar fields merge without conflict, so multiple features can
    // each call `autocompletion(...)` to set defaults; the values
    // must agree or CM6 throws "Config merge conflict".
    autocompletion({
      activateOnTyping: true,
      // Wiki-link completion may disable CodeMirror's shared icon
      // renderer. Slash commands render their own Lucide icon below,
      // so they remain visible when both completion features are enabled.
      icons: false,
      addToOptions: [
        {
          position: 20,
          render: renderSlashCommandIcon,
        },
      ],
      closeOnBlur: true,
    }),
  ];

  if (config.sideButton) {
    extensions.push(sidePlusButtonPlugin);
  }

  // Upload progress widgets. Always included — cheap no-op when no
  // pending-upload markers exist in the doc. The orchestration lives
  // in `mossUploadCommands(uploader)`'s `apply` callbacks; this field
  // only renders state + dispatches effects.
  extensions.push(mossUploadBlocks());

  return extensions;
}

async function source(
  context: CompletionContext,
  config: MossSlashCommandsConfig,
): Promise<CompletionResult | null> {
  if (context.state.facet(readOnlyFacet)) return null;

  // Path A: user typed /query.
  const slashMatch = context.matchBefore(SLASH_QUERY_RE);
  if (slashMatch) {
    // Trigger gate: when triggerAtLineStart (default true), the slash
    // must be the first non-whitespace character on its line. Without
    // this gate, `https://...` mid-text would pop the menu.
    if (config.triggerAtLineStart !== false) {
      const line = context.state.doc.lineAt(slashMatch.from);
      const before = line.text.slice(0, slashMatch.from - line.from);
      if (before.trim() !== '') return null;
    } else {
      const line = context.state.doc.lineAt(slashMatch.from);
      const before = line.text.slice(0, slashMatch.from - line.from);
      if (before !== '' && !/\s$/.test(before)) return null;
    }
    const query = slashMatch.text.slice(1);
    const commands = await resolveCommands(config, query);
    if (context.aborted) return null;
    return {
      // Let CodeMirror filter the command query without treating `/` as
      // part of the completion text. `toOption` expands the apply range
      // back over the trigger when a command is accepted.
      from: slashMatch.from + 1,
      to: context.pos,
      options: commands.map((cmd) => toOption(cmd)),
      validFor: config.suggest ? () => false : /^[\w-]*$/,
    };
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
    type: 'moss-' + (cmd.icon ?? 'snippet'),
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
      const triggerFrom =
        from > 0 && view.state.sliceDoc(from - 1, from) === '/'
          ? from - 1
          : from;
      void cmd.apply(view, triggerFrom, to);
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
// The button is a non-block decoration at the start of the active line.
// CSS moves it visually into the left gutter without changing the row's
// document layout.
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
    btn.innerHTML = SIDE_PLUS_ICON;
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
    btn.addEventListener('click', (event) => {
      // Keep the follow-up click from being handled by the editor after
      // the mousedown handler has placed the caret on this line.
      event.preventDefault();
      event.stopPropagation();
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
      this.decorations = buildSidePlusDecorations(view);
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
    detail: 'Pick from disk and insert ![alt](url)',
    keywords: ['picture', 'photo', 'image', 'img'],
    icon: 'image',
    apply: async (view, from, to) => {
      const file = await pickFile('image/*');
      if (!file) return;
      const url = URL.createObjectURL(file);
      const insert = `![${file.name}](${url})`;
      view.dispatch({
        changes: { from, to, insert },
        // Drop the caret right after `![name` so the user can type
        // `|caption` to split alt and caption, or leave as-is (the
        // name doubles as caption by default).
        selection: { anchor: from + 2 + file.name.length },
      });
    },
  },
  {
    id: 'upload-file',
    label: 'Upload file',
    detail: 'Pick from disk and link [name](url)',
    keywords: ['attachment', 'file', 'link'],
    icon: 'file',
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
