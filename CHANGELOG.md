# Changelog

## 0.8.1 - 2026-09-22

### 新增

- 水平分隔线内置支持三种视觉样式：`---` 普通实线、`***` 舒缓波浪线、`___` 中间带符号的分隔线。
- 新增 `inlinePreviewConfig.horizontalRule.glyph`，支持自定义文本或 emoji 作为分隔线中间符号。

### 调整

- 将 HR 的波浪线和符号渲染从 Demo 私有实现收回编辑器核心样式。
- 删除 Demo 中独立的 `wavy-hr.ts` 自定义语法示例，避免消费者为内置 HR 样式额外注册扩展。
- Demo 使用 `🌿` 演示自定义 HR 符号。

### 修复

- 放宽波浪线重复周期，降低视觉密集和尖锐感。

## 0.8.0 - 2026-09-22

### 新增

- 新增顶层 `MossMDProps.icons` 配置，统一覆盖图片块、文件块和上传进度块的用户可见图标。
- 新增 `mossmd/icons` 子路径，导出 `MossIconRenderer`、`mossLucideIcon`、`renderLucideIcon` 和 `renderMossIcon`。
- 新增图片块、文件块、上传块的图标配置类型，并允许 Slash Command 直接使用自定义 `MossIconRenderer`。
- Demo 正文新增自定义图标代码示例。

### 调整

- 图标渲染从 `lucideSvg` 字符串方案切换为 DOM renderer 协议，不再依赖 `react-dom/server`。
- `MossMDProps.icons` 作为 React 入口的推荐配置方式，保留 feature 级 `imagesConfig.icons`、`fileBlocksConfig.icons`、`fileUpload.icons` 作为更细粒度覆盖。
- `mossFileUpload(config)` 复用 `mossUploadBlocks(config)` 的上传块视觉配置，上传行为和上传块展示配置边界更清晰。

### 修复

- 修复 Lucide SVG 的 `viewBox` 属性被错误转换导致图标裁切的问题。
- 修复默认 `fill` 被覆盖后部分图标填充颜色异常的问题。
- 修复 CodeMirror autocomplete 默认 icon 样式导致 slash command 图标尺寸异常和显示不全的问题。

### 文档

- 新增 `docs/icon-customization.md`，记录编辑器图标协议、开放范围、配置优先级和上传块配置关系。
- README 增加顶层 `icons` 配置示例。

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
