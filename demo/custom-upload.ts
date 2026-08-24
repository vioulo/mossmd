// Demo: a custom upload command that overrides the package default.
//
// The package ships `mossDefaultSlashCommands` with a stub
// upload-image / upload-file command that uses `URL.createObjectURL`
// (a local blob URL — fine for a demo, gone on page reload). To plug
// your own upload service in, replace those commands with your own
// implementations of `MossSlashCommand.apply`. This file shows the
// pattern end-to-end:
//
//   1. Define an uploader — anything that takes a `File` and returns
//      a URL string. Below: a mock that POSTs multipart/form-data to
//      a configurable endpoint. Swap the body of `uploadFile` with
//      your real client (S3 presigned PUT, OSS STS, Supabase
//      Storage, your own /api/upload — whatever).
//
//   2. Define `MossSlashCommand` instances that:
//        - open the OS file picker
//        - call your uploader
//        - dispatch the resulting markdown back into the editor
//
//   3. Pass them to `mossSlashCommands({ commands: [...] })`,
//      instead of (or alongside) `mossDefaultSlashCommands`. The
//      `apply` callback is the entire contract — anything you can do
//      from a CM6 transaction (insert text, place the caret, replace
//      a range, even open another modal) is fair game.
//
// Why `apply` is allowed to be async:
//   CM6 doesn't await `apply` — it expects the function to dispatch
//   its own transactions whenever it's ready. That means async work
//   (file pick, network upload, image resizing) is fine; the user
//   just keeps typing while the upload runs, and the markdown lands
//   when the upload resolves.

import type { MossSlashCommand } from 'mossmd/features';

// ---------------------------------------------------------------------------
// 1. Your uploader.
//
//    Replace this function body with your real upload client. The
//    contract is intentionally tiny: `File` in, URL string out. The
//    demo implementation below hits a configurable endpoint with
//    multipart/form-data; you'd swap in:
//
//      • S3 presigned PUT:  fetch(presignedUrl, { method: 'PUT', body: file })
//      • Supabase Storage:  supabase.storage.from('imgs').upload(path, file)
//      • Cloudinary:        cloudinary.uploader.unsignedUpload(file, preset)
//      • Your own /upload:  (the example below)
//
//    Whichever you use, return the public URL the editor should
//    embed. Errors are caught and surface as a no-op (the user can
//    retry); a production app would probably also toast the user.
// ---------------------------------------------------------------------------

export interface UploaderOptions {
  /** Endpoint that accepts multipart/form-data with a `file` field
   *  and returns `{ url: string }` JSON. */
  endpoint: string;
  /** Optional auth header, e.g. `'Bearer ' + token`. */
  authorization?: string;
  /** Extra form fields, e.g. `{ folder: 'notes' }`. */
  fields?: Record<string, string>;
}

export function createUploader(options: UploaderOptions) {
  return async function upload(file: File): Promise<string> {
    const body = new FormData();
    body.append('file', file);
    for (const [k, v] of Object.entries(options.fields ?? {})) {
      body.append(k, v);
    }
    const res = await fetch(options.endpoint, {
      method: 'POST',
      body,
      headers: options.authorization ? { Authorization: options.authorization } : undefined,
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    const data = (await res.json()) as { url?: string };
    if (!data.url) throw new Error('upload response missing url');
    return data.url;
  };
}

// ---------------------------------------------------------------------------
// 2. Slash commands built on top of the uploader.
//
//    The `apply` callbacks below follow the same caret-placement
//    convention as `mossDefaultSlashCommands` — image inserts
//    `![name|](url)` and leaves the caret right after the `|` so
//    the user can type a caption immediately. File inserts
//    `[name](url)` and leaves the caret at line end.
//
//    Both commands share a tiny `pickFile` helper that creates a
//    hidden <input type=file>, waits for `change` (or focus-without-
//    change as a cancel signal), and resolves to either the File or
//    null. This is the same helper the package uses internally; we
//    reproduce it here so the file is self-contained.
// ---------------------------------------------------------------------------

export function createUploadCommands(uploader: (file: File) => Promise<string>): MossSlashCommand[] {
  return [
    {
      id: 'upload-image',
      label: 'Upload image',
      detail: 'Pick from disk, upload, insert ![alt|caption](url)',
      keywords: ['picture', 'photo', 'image', 'img'],
      apply: async (view, from, to) => {
        const file = await pickFile('image/*');
        if (!file) return; // user cancelled the picker
        // Uploader runs in the background — the user could keep
        // typing into the editor while this resolves. We dispatch
        // the result as soon as we have a URL.
        let url: string;
        try {
          url = await uploader(file);
        } catch (err) {
          console.error('[mossmd demo] image upload failed', err);
          return;
        }
        const insert = `![${file.name}|](${url})`;
        view.dispatch({
          changes: { from, to, insert },
          // Place the caret on the `|caption` slot. Position math:
          //   from  +  2  +  name.length  +  1
          //   ^       ^     ^                ^
          //   start   ![    name              |
          selection: { anchor: from + 2 + file.name.length + 1 },
        });
      },
    },
    {
      id: 'upload-file',
      label: 'Upload file',
      detail: 'Pick from disk, upload, link [name](url)',
      keywords: ['attachment', 'file', 'link'],
      apply: async (view, from, to) => {
        const file = await pickFile();
        if (!file) return;
        let url: string;
        try {
          url = await uploader(file);
        } catch (err) {
          console.error('[mossmd demo] file upload failed', err);
          return;
        }
        view.dispatch({
          changes: { from, to, insert: `[${file.name}](${url})` },
        });
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 3. Composition: keep the package defaults, swap upload for custom.
//
//    A common pattern is to extend `mossDefaultSlashCommands` rather
//    than replace it — you keep the package's snippets (if you've
//    added any via your own custom commands) and only override the
//    ones you want to control. The helper below drops the package's
//    stub upload-image / upload-file and inserts your real ones in
//    their place, preserving the rest.
// ---------------------------------------------------------------------------

export function overrideDefaultUploads(
  defaults: MossSlashCommand[],
  custom: MossSlashCommand[],
): MossSlashCommand[] {
  const customIds = new Set(custom.map((c) => c.id));
  const kept = defaults.filter((c) => !customIds.has(c.id));
  return [...kept, ...custom];
}

// ---------------------------------------------------------------------------
// Internal: same file-picker helper the package uses. Reproduced here
// so this demo file is self-contained — copy just this function if
// you want the picker behavior without the rest of the demo.
// ---------------------------------------------------------------------------

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
