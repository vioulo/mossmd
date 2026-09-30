# Changelog

## 0.9.1 - 2026-09-30

### 调整

- 将 slash menu 的 side `+` 按钮改为编辑器 overlay，不再挂载到 `.cm-content` 或依赖宿主预留 gutter。
- 将表格单元格操作按钮移动到右侧边框中心，避免表头和横向滚动边缘裁切按钮。
- 表格单元格支持渲染行内代码，并在编辑时按光标位置显露对应 Markdown 分隔符。

### 修复

- 修复围栏代码块首行点阵背景被纵向拉长的问题。
- 修复表格插入、删除行列不能通过 `Ctrl/Cmd+Z` 撤销的问题。
- 修复表格单元格内容编辑未进入 CodeMirror 历史记录、无法撤销和重做的问题。
- 修复表格撤销后光标跳到文档标题或行首的问题，恢复到原表格单元格及相近光标位置。
- 保留表格单元格中的反斜杠转义源码：预览态隐藏反斜杠，进入编辑态后显示完整原文。
- 修复表格单元格内行内代码点击后未显示反引号源码的问题。

## 0.9.0 - 2026-09-29

### 新增

- 新增 `data-theme="blue"` 和 `data-theme="blue-light"` 蓝色主题 preset。
- 蓝色主题覆盖编辑器与内容渲染共用的 `--moss-*` token，并同步调整链接、选区、搜索高亮、代码背景和语法高亮。
- 新增水平分隔线对称图标语法，例如 `---⭐---` 和 `***🌿***`。
- 新增语义化 `MossIconKey` / `MossIconMap` 图标协议，由宿主项目提供具体图标 renderer。
- 新增可选的 `mossmd/icons/lucide` 适配层，支持 Lucide 图标转换为 DOM SVG。

### 调整

- 无序列表预览态 marker 改为按嵌套层级轮换 `✦` / `✧`。
- 移除 `inlinePreviewConfig.horizontalRule.glyph`，水平分隔线图标改由 Markdown 原文语法表达。
- `MossMDProps.icons` 改为扁平的语义 key 映射，不再由编辑器核心维护 Lucide 图标源。
- Lucide 从运行时依赖改为可选 peer dependency，其他图标库可以通过自己的适配器接入。

### 修复

- 修复表格单元格内 `==highlight==` 点击后未显露源码分隔符的问题。
- 修复 Lucide `1.48.0` 新版图标节点结构导致 SVG 只有外壳没有 path 的问题。

### 文档

- README 增加蓝色主题 preset 的使用示例。
- Demo 将配色切换与明暗切换拆成两个独立按钮，可组合预览默认/蓝色与深色/浅色。
- 默认 `---`、`***`、`___` 不再自动附加图标，图标由 Markdown 原文显式提供。
- 新增图标协议与 Lucide 适配器文档，并更新 Demo 的图标映射示例。

## 0.8.2 - 2026-09-23

### 修复

- 修复 Cloudflare 构建环境下 Lucide SVG 属性类型不兼容导致的 TypeScript 检查失败。

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
