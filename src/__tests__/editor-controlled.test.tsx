import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MossMD, type MossMDHandle } from '../editor';

const hosts: HTMLElement[] = [];

function mount(element: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  return { host, root };
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

describe('controlled and uncontrolled MossMD lifecycle', () => {
  it('does not destroy or remount the editor when markdownSource is updated by onMarkdownChange in controlled state', () => {
    let setDocFn: (doc: string) => void = () => {};

    function ControlledComponent() {
      const [doc, setDoc] = useState('initial text');
      setDocFn = setDoc;
      return (
        <MossMD
          markdownSource={doc}
          onMarkdownChange={setDoc}
        />
      );
    }

    const { host } = mount(<ControlledComponent />);
    const editorDomBefore = host.querySelector('.cm-editor');
    expect(editorDomBefore).not.toBeNull();

    act(() => {
      setDocFn('initial text edited');
    });

    const editorDomAfter = host.querySelector('.cm-editor');
    expect(editorDomAfter).toBe(editorDomBefore);
  });

  it('updates document in-place without remounting when controlled=true receives new markdownSource', () => {
    let setDocFn: (doc: string) => void = () => {};
    const handleRef: { current: MossMDHandle | null } = { current: null };

    function ControlledSync() {
      const [doc, setDoc] = useState('# Title 1');
      setDocFn = setDoc;
      return (
        <MossMD
          controlled
          markdownSource={doc}
          editorHandleRef={handleRef}
        />
      );
    }

    const { host } = mount(<ControlledSync />);
    const editorDomBefore = host.querySelector('.cm-editor');
    expect(handleRef.current?.getMarkdown()).toBe('# Title 1');

    // External reset
    act(() => {
      setDocFn('# Title 2 (external)');
    });

    const editorDomAfter = host.querySelector('.cm-editor');
    expect(editorDomAfter).toBe(editorDomBefore);
    expect(handleRef.current?.getMarkdown()).toBe('# Title 2 (external)');
  });

  it('preserves editor edits during parent re-renders when controlled is false (uncontrolled mode)', () => {
    let setParentState: (n: number) => void = () => {};
    const handleRef: { current: MossMDHandle | null } = { current: null };

    function UncontrolledParent() {
      const [, setCount] = useState(0);
      setParentState = (n) => setCount(n);
      return (
        <MossMD
          markdownSource="static seed"
          editorHandleRef={handleRef}
        />
      );
    }

    const { host } = mount(<UncontrolledParent />);
    const editorDomBefore = host.querySelector('.cm-editor');
    expect(handleRef.current?.getMarkdown()).toBe('static seed');

    // Unrelated parent re-render should not remount or overwrite editor
    act(() => {
      setParentState(1);
    });

    const editorDomAfter = host.querySelector('.cm-editor');
    expect(editorDomAfter).toBe(editorDomBefore);
    expect(handleRef.current?.getMarkdown()).toBe('static seed');
  });

  it('properly tears down and creates a fresh editor when documentId changes', () => {
    let setDocId: (id: string) => void = () => {};
    const handleRef: { current: MossMDHandle | null } = { current: null };

    function MultiDocComponent() {
      const [docId, setDocIdState] = useState('doc-1');
      setDocId = setDocIdState;
      return (
        <MossMD
          documentId={docId}
          markdownSource={docId === 'doc-1' ? 'Doc 1 content' : 'Doc 2 content'}
          editorHandleRef={handleRef}
        />
      );
    }

    const { host } = mount(<MultiDocComponent />);
    const editorDomBefore = host.querySelector('.cm-editor');
    expect(handleRef.current?.getMarkdown()).toBe('Doc 1 content');

    // Switch documents via documentId
    act(() => {
      setDocId('doc-2');
    });

    const editorDomAfter = host.querySelector('.cm-editor');
    // When switching documentId, tearing down and creating fresh view is expected
    expect(editorDomAfter).not.toBe(editorDomBefore);
    expect(handleRef.current?.getMarkdown()).toBe('Doc 2 content');
  });
});
