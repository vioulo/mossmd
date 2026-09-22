# Changelog

## 0.7.2 - 2026-09-22

### Added

- Added unified image and file upload handling for paste, drag-and-drop, and batch input.
- Added `MossMDProps.fileUpload` with upload limits, MIME filtering, kind resolution, concurrency control, retry, cancel, and abort support.
- Added the public `mossmd/features/upload` subpath export.

### Fixed

- Preserved image Markdown compatibility with `![name](url)` while allowing users to add `|caption` or `|width=...` afterward.
- Prevented file drops from falling through to CodeMirror's default text insertion.
- Preserved batch upload order and placed the caret on a new editable line after uploaded blocks.
- Cleaned up upload runtime state and object URLs when uploads finish, are cancelled, or the editor is destroyed.

### Internal

- Added upload coverage for paste, drop, batch ordering, selection replacement, cancellation, read-only mode, and image block caret placement.
- Fixed the package consumer smoke script so its temporary Vite app builds correctly.
