export { MossEditor } from './editor';
export type {
  MossEditorHandle,
  MossEditorProps,
} from './editor';

export { mossInlinePreview } from './core/inline-preview';
export type { MossInlinePreviewConfig } from './core/inline-preview';
export { mossHighlightMarkdown } from './core/highlight';
export { mossTheme, mossSyntax } from './theme';
export {
  autoCloseCodeFence,
  extendEmphasisPair,
  startAsteriskList,
} from './core/edit-helpers';
export { mossReadOnlyExtension, mossReadOnlyFacet } from './core/read-only';
export { noopCollabAdapter } from './collab';
export type { CollabAdapter } from './collab';
export {
  defineMossSyntax,
  registerMossSyntax,
} from './core/custom-syntax';
export type {
  RegisteredMossSyntax,
  MossCustomSyntax,
} from './core/custom-syntax';
export { MOSS_CODE_LANGUAGES } from './core/code-languages';
export { setFrozen, defaultOnLinkClick } from './core/inline-preview';
