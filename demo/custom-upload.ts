// Demo: a real upload backend wired into the widget flow.
//
// The package ships `mossDefaultSlashCommands` (a stub that uses
// `URL.createObjectURL` — gone on reload) and `mossUploadCommands`,
// the widget-flow command factory: pick file → progress widget →
// final markdown. To plug in your own backend, you only need a
// `MossUploader` — anything that takes a `File` plus a progress
// callback and resolves to `{ url }`. This file shows the pattern
// end-to-end:
//
//   1. `createUploader(options)` → a `MossUploader` that POSTs
//      multipart/form-data to a configurable endpoint and reports
//      XHR upload progress. Swap the body of `uploadFile` with your
//      real client (S3 presigned PUT, OSS STS, Supabase Storage,
//      your own /api/upload — whatever).
//
//   2. Compose it with the package's `mossUploadCommands(uploader)`
//      to get upload-image / upload-file slash commands that render
//      the progress widget, retry on failure, and land the final
//      `![alt|](url)` / `[name](url)` markdown on success.
//
//   3. Pass them to `mossSlashCommands({ commands: [...] })`,
//      replacing the package's stub uploads via
//      `overrideDefaultUploads`. The `apply` callback is the entire
//      contract — anything you can do from a CM6 transaction is fair
//      game.
//
// Why `apply` is allowed to be async:
//   CM6 doesn't await `apply` — it expects the function to dispatch
//   its own transactions whenever it's ready. `mossUploadCommands`
//   dispatches a register effect immediately (so the widget shows),
//   then resolves the final markdown whenever the upload settles.

import type { MossSlashCommand, MossUploader } from 'mossmd/features';
import { mossUploadCommands } from 'mossmd/features';

// ---------------------------------------------------------------------------
// 1. Your uploader.
//
//    Replace this function body with your real upload client. The
//    contract is intentionally tiny: `File` + progress callback in,
//    `{ url }` out. The demo implementation below hits a configurable
//    endpoint with multipart/form-data and reports `upload.onprogress`
//    as a 0..1 ratio; you'd swap in:
//
//      • S3 presigned PUT:  fetch(presignedUrl, { method: 'PUT', body: file })
//      • Supabase Storage:  supabase.storage.from('imgs').upload(path, file)
//      • Cloudinary:        cloudinary.uploader.unsignedUpload(file, preset)
//      • Your own /upload:  (the example below)
//
//    Whichever you use, return the public URL the editor should embed.
//    Errors throw — the widget surfaces them as a Failed status with a
//    retry button.
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

export function createUploader(options: UploaderOptions): MossUploader {
  return async function upload(file, onProgress): Promise<{ url: string }> {
    const body = new FormData();
    body.append('file', file);
    for (const [k, v] of Object.entries(options.fields ?? {})) {
      body.append(k, v);
    }

    const data: { url?: string } = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', options.endpoint);
      if (options.authorization) {
        xhr.setRequestHeader('Authorization', options.authorization);
      }
      // XHR (not fetch) so we get upload progress events. `fetch`
      // upload streaming is not yet widely available.
      xhr.upload.onprogress = (ev: ProgressEvent) => {
        if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
      };
      xhr.onerror = () => reject(new Error('network error'));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response as { url?: string });
        } else {
          reject(new Error(`upload failed: ${xhr.status}`));
        }
      };
      xhr.responseType = 'json';
      xhr.send(body);
    });

    if (!data.url) throw new Error('upload response missing url');
    return { url: data.url };
  };
}

// ---------------------------------------------------------------------------
// 2. Compose the uploader with the package's widget-flow commands.
//
//    `mossUploadCommands(uploader)` returns upload-image /
//    upload-file slash commands that:
//      - open the OS file picker
//      - register a pending-upload widget (preview + progress bar)
//      - call your uploader (reporting progress to the widget)
//      - on success replace the anchor line with the final markdown
//        (`![name|](url)` for image, `[name](url)` for file)
//      - on failure show a Failed status with retry / cancel buttons
//
//    For most consumers this is all you need. If you want a custom
//    flow (e.g. a modal picker, image resizing before upload), write
//    your own `MossSlashCommand[]` and dispatch `beginUpload` from
//    its `apply` callback — see `src/features/upload/index.ts`.
// ---------------------------------------------------------------------------

export function createUploadCommands(uploader: MossUploader): MossSlashCommand[] {
  return mossUploadCommands(uploader);
}

// ---------------------------------------------------------------------------
// 3. Composition: keep the package defaults, swap upload for custom.
//
//    A common pattern is to extend `mossDefaultSlashCommands` rather
//    than replace it — you keep the package's snippets and only
//    override the upload commands. The helper below drops the
//    package's stub upload-image / upload-file and inserts your real
//    ones in their place, preserving the rest.
// ---------------------------------------------------------------------------

export function overrideDefaultUploads(
  defaults: MossSlashCommand[],
  custom: MossSlashCommand[],
): MossSlashCommand[] {
  const customIds = new Set(custom.map((c) => c.id));
  const kept = defaults.filter((c) => !customIds.has(c.id));
  return [...kept, ...custom];
}
