import { EditorView } from '@codemirror/view';

export interface CollabAdapter {
  attach(view: EditorView): Promise<void>;
  detach(): void | Promise<void>;
  /**
   * Subscribe to full-document snapshots produced by a remote source.
   * The editor applies snapshots as `Transaction.remote` replacements
   * so local change listeners still see the new markdown.
   */
  onRemoteChange(cb: (doc: string) => void): () => void;
  getAwareness?(): unknown;
}

export const noopCollabAdapter: CollabAdapter = {
  attach: async () => {},
  detach: () => {},
  onRemoteChange: () => () => {},
};
