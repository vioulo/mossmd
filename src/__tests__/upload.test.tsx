import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { MossMD, type MossMDHandle } from '../editor';
import type { MossIconRenderer } from '../core/icons';

const mounts: { host: HTMLElement; unmount: () => void }[] = [];

function mount(
  markdownSource: string,
  fileUpload: NonNullable<React.ComponentProps<typeof MossMD>['fileUpload']>,
  editorHandleRef?: { current: MossMDHandle | null },
  props: Pick<React.ComponentProps<typeof MossMD>, 'icons'> = {},
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <MossMD
        markdownSource={markdownSource}
        fileUpload={fileUpload}
        editorHandleRef={editorHandleRef}
        {...props}
      />,
    );
  });
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!);
  if (!view) throw new Error('Editor view did not mount');
  mounts.push({ host, unmount: () => root.unmount() });
  return { host, view };
}

function testIcon(name: string): MossIconRenderer {
  return ({ document, size = 16 }) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-moss-test-icon', name);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    return svg;
  };
}

function dataTransfer(files: File[]): DataTransfer {
  return {
    files: files as unknown as FileList,
    items: [],
    getData: () => '',
  } as unknown as DataTransfer;
}

function itemDataTransfer(files: File[]): DataTransfer {
  return {
    files: { length: 0 },
    items: files.map((file) => ({ getAsFile: () => file })),
    getData: () => '',
  } as unknown as DataTransfer;
}

function pasteEvent(transfer: DataTransfer): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: transfer });
  return event;
}

function dropEvent(transfer: DataTransfer): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    clientX: { value: 1 },
    clientY: { value: 1 },
  });
  return event;
}

afterEach(() => {
  for (const mountPoint of mounts.splice(0)) {
    act(() => mountPoint.unmount());
    mountPoint.host.remove();
  }
  vi.restoreAllMocks();
});

describe('file upload input', () => {
  it('uses top-level icon overrides for upload progress blocks', async () => {
    const uploader = vi.fn(
      () => new Promise<{ url: string }>(() => undefined),
    );
    const file = new File(['text'], 'notes.txt', { type: 'text/plain' });
    const { host } = mount(
      '',
      { uploader },
      undefined,
      {
        icons: {
          upload: {
            file: testIcon('top-upload-file'),
          },
        },
      },
    );
    const content = host.querySelector<HTMLElement>('.cm-content')!;

    await act(async () => {
      content.dispatchEvent(pasteEvent(dataTransfer([file])));
      await Promise.resolve();
    });

    expect(
      host.querySelector('[data-moss-test-icon="top-upload-file"]'),
    ).not.toBeNull();
  });

  it('pastes images as image markdown and files as ordinary links', async () => {
    const uploader = vi.fn(async (file: File) => ({
      url: `https://cdn.example/${file.name}`,
    }));
    const image = new File(['image'], 'photo.png', { type: 'image/png' });
    const file = new File(['text'], 'report.pdf', { type: 'application/pdf' });
    const handle = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount('', { uploader }, handle);
    const content = host.querySelector<HTMLElement>('.cm-content')!;

    await act(async () => {
      content.dispatchEvent(pasteEvent(dataTransfer([image, file])));
      await Promise.resolve();
    });

    expect(uploader).toHaveBeenCalledTimes(2);
    expect(handle.current?.getMarkdown()).toContain(
      '![photo.png](https://cdn.example/photo.png)',
    );
    expect(handle.current?.getMarkdown()).toContain(
      '[report.pdf](https://cdn.example/report.pdf)',
    );
  });

  it('reads files from DataTransfer.items and handles dropped files', async () => {
    const uploader = vi.fn(async (file: File) => ({
      url: `https://cdn.example/${file.name}`,
    }));
    const file = new File(['text'], 'notes.txt', { type: 'text/plain' });
    const { host, view } = mount('Before', { uploader });
    const content = host.querySelector<HTMLElement>('.cm-content')!;

    await act(async () => {
      content.dispatchEvent(dropEvent(itemDataTransfer([file])));
      await Promise.resolve();
    });

    expect(view.state.doc.toString()).toContain(
      '[notes.txt](https://cdn.example/notes.txt)',
    );
  });

  it('prevents the default drop behavior for files', async () => {
    const uploader = vi.fn(async (file: File) => ({
      url: `https://cdn.example/${file.name}`,
    }));
    const file = new File(['sql'], 'query.sql', { type: 'application/sql' });
    const { host } = mount('', { uploader });
    const content = host.querySelector<HTMLElement>('.cm-content')!;
    const event = dropEvent(dataTransfer([file]));

    await act(async () => {
      content.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(uploader).toHaveBeenCalledWith(
      file,
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('keeps batch order even when uploads resolve out of order', async () => {
    const resolvers = new Map<string, (value: { url: string }) => void>();
    const uploader = vi.fn(
      (file: File) =>
        new Promise<{ url: string }>((resolve) => {
          resolvers.set(file.name, resolve);
        }),
    );
    const files = ['one.txt', 'two.txt', 'three.txt'].map(
      (name) => new File([name], name, { type: 'text/plain' }),
    );
    const { host, view } = mount('', {
      uploader,
      maxConcurrency: 3,
    });
    const content = host.querySelector<HTMLElement>('.cm-content')!;

    act(() => {
      content.dispatchEvent(pasteEvent(dataTransfer(files)));
    });
    expect(uploader).toHaveBeenCalledTimes(3);

    await act(async () => {
      resolvers.get('three.txt')!({ url: 'https://cdn.example/3' });
      resolvers.get('two.txt')!({ url: 'https://cdn.example/2' });
      await Promise.resolve();
    });
    expect(view.state.doc.toString()).toBe('');

    await act(async () => {
      resolvers.get('one.txt')!({ url: 'https://cdn.example/1' });
      await Promise.resolve();
    });
    expect(view.state.doc.toString()).toBe(
      '[one.txt](https://cdn.example/1)\n\n' +
        '[two.txt](https://cdn.example/2)\n\n' +
        '[three.txt](https://cdn.example/3)\n',
    );
    expect(view.state.selection.main.from).toBe(view.state.doc.length);
  });

  it('places the caret after a batch of image blocks', async () => {
    const uploader = vi.fn(async (file: File) => ({
      url: `https://cdn.example/${file.name}`,
    }));
    const files = ['first.png', 'second.png'].map(
      (name) => new File(['image'], name, { type: 'image/png' }),
    );
    const { host, view } = mount('', { uploader });
    const content = host.querySelector<HTMLElement>('.cm-content')!;

    await act(async () => {
      content.dispatchEvent(pasteEvent(dataTransfer(files)));
      await Promise.resolve();
    });

    expect(view.state.doc.toString()).toBe(
      '![first.png](https://cdn.example/first.png)\n' +
        '![second.png](https://cdn.example/second.png)\n',
    );
    expect(view.state.selection.main.from).toBe(view.state.doc.length);
  });

  it('replaces a selection without losing surrounding markdown', async () => {
    const uploader = vi.fn(async () => ({ url: 'https://cdn.example/x.png' }));
    const handle = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host, view } = mount('Before selected After', { uploader }, handle);
    act(() => {
      view.dispatch({ selection: { anchor: 7, head: 15 } });
    });
    const content = host.querySelector<HTMLElement>('.cm-content')!;
    const image = new File(['image'], 'x.png', { type: 'image/png' });

    await act(async () => {
      content.dispatchEvent(pasteEvent(dataTransfer([image])));
      await Promise.resolve();
    });

    expect(handle.current?.getMarkdown()).toBe(
      'Before \n\n![x.png](https://cdn.example/x.png)\n\n After',
    );
    expect(view.state.selection.main.from).toBe(
      'Before \n\n![x.png](https://cdn.example/x.png)\n\n'.length,
    );
  });

  it('does not upload in read-only mode', () => {
    const uploader = vi.fn(async () => ({ url: 'https://cdn.example/x' }));
    const image = new File(['image'], 'x.png', { type: 'image/png' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <MossMD
          markdownSource=""
          readOnly
          fileUpload={{ uploader }}
        />,
      );
    });
    mounts.push({ host, unmount: () => root.unmount() });

    const content = host.querySelector<HTMLElement>('.cm-content')!;
    const event = pasteEvent(dataTransfer([image]));
    act(() => content.dispatchEvent(event));

    expect(uploader).not.toHaveBeenCalled();
  });

  it('can cancel an upload while it is still in progress', () => {
    let signal: AbortSignal | undefined;
    const uploader = vi.fn(
      (_file: File, _onProgress: (ratio: number) => void, nextSignal?: AbortSignal) => {
        signal = nextSignal;
        return new Promise<{ url: string }>(() => undefined);
      },
    );
    const handle = createRef<MossMDHandle | null>() as {
      current: MossMDHandle | null;
    };
    const { host } = mount('', { uploader }, handle);
    const content = host.querySelector<HTMLElement>('.cm-content')!;
    const file = new File(['text'], 'pending.txt', { type: 'text/plain' });

    act(() => {
      content.dispatchEvent(pasteEvent(dataTransfer([file])));
    });
    const cancel = host.querySelector<HTMLButtonElement>(
      '.cm-moss-upload-btn.cancel',
    );
    expect(cancel).not.toBeNull();

    act(() => cancel?.click());

    expect(signal?.aborted).toBe(true);
    expect(handle.current?.getMarkdown()).toBe('');
    expect(host.querySelector('.cm-moss-upload')).toBeNull();
  });
});
