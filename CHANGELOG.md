# Changelog

## 0.11.0 - 2026-10-29

### 新增与移动端体验 (Mobile-First)

- **移动端快捷操作栏 (`mossMobileToolbar`)**：
  - 新增视口吸附的移动操作栏，支持行内加粗、倾斜、删除线、高亮、代码、公式、图片、表格、列表及常用块级结构快捷插入；
  - 接入 `window.visualViewport` 动态感知软键盘弹起与收起，工具栏与浮层控件自适应动态避让；
  - 侧边 `+` 悬浮按钮在触屏小屏下自动隐退并跳过几何测量，块级命令无缝移交至移动动作栏。
- **触屏手势与人机工程学对齐**：
  - 解除 `freezeMousePlugin` 对触摸事件的阻断，放行浏览器原生触控惯性滚动（Kinetic Touch Scrolling）；
  - 移动端（`pointer: coarse`）链接与交互按钮热区全面扩充至 Apple HIG 标准 44×44px，彻底杜绝小屏误触脱靶。
- **React 受控状态平滑接入**：
  - 新增 `controlled` 属性，支持外部状态以最小 CodeMirror 事务就地同步，彻底消除打字时整机销毁重装（`view.destroy()`）的历史顽疾；
  - 解耦内部稳定实例标识，未指定 `documentId` 时保持长生命周期，避免焦点丢失与 IME 输入法中断。

### 性能与长文调优 (Performance)

- **选区窄失效机制 (Narrow Invalidation)**：
  - 重构 `inline-preview` 刷新触发机制，方向键跨行与局部编辑时仅针对进出激活行重绘装饰，彻底消除长文 $O(N)$ 全篇语法树遍历。
- **HeightMap 预估高度注入 (Anti-Jitter Scrolling)**：
  - 为表格（Table）、数学块公式（BlockMath）、图片（Image）、文件块（FileBlock）与上传块全量注入精准 `estimatedHeight`，彻底消除 1000 行大文档快速滚动时 14px 高度塌陷引起的视口重排抖动。
- **LaTeX 渲染 LRU 缓存**：
  - 内置内存级 `MathRenderLruCache`（默认 800 条），复用已编译的 HTML 结构，长文公式重绘与滚动挂载耗时由毫秒级降至微秒级。
- **表格输入微任务合并**：
  - 表格单字符输入实施 Microtask Batching 合并派发，并完整保护英文输入末尾空格，杜绝打字阻塞。

### 内核重构 (Core Architecture)

- **CodeMirror 原生 atomicRanges 落地**：
  - 列表结构性缩进全面注册至 `EditorView.atomicRanges` Facet，由内核原生接管指针拖选、触控吸附与跨原子跳跃；
  - 剔除手写全局方向键拦截（精简 67 行胶水代码），由极薄跨行守卫保证单次跨行手感。

## 0.10.0 - 2026-10-14

### 新增

- **数学公式（LaTeX）扩展**：支持行内公式（`$...$`）与块级独立公式（`$$...$$`）语法解析及所见即所得实时预览。
- **可插拔渲染协议**：核心保持轻量化零重度依赖绑定，通过 `MossMathRenderer` 接口及 `createKatexRenderer(katex)` 适配器支持外部按需注入 KaTeX 等数学排版引擎，并内置优雅的 fallback 降级渲染与语法报错捕获。
- **子路径与功能导出**：公开导出 `mossmd/features/math`（包含 `mossMath`、`mossMathSyntax`、`createKatexRenderer` 等）。
- **专业排版样式适配**：在 `inline-preview.css` 与 `content.css` 中增加公式样式与横向滚动保护，并在 Demo 中内置量子力学薛定谔方程与拉马努金无穷连分数的高复杂度展示。

### 优化

- **精细化光标交互与定界符保护**：
  - **行内公式**：鼠标点击时激活源码并全选内部公式内容（自动排除 `$` 语法定界符），避免误删语法符号；方向键移动时光标平滑进入单脱字符状态，移出时自动恢复渲染。
  - **块级公式**：鼠标点击时展开上方可编辑源码并全选公式主体（自动排除 `$$` 语法定界符与换行），下方同步保留渲染对照卡片（`.cm-moss-math-block-preview`）；方向键移动时光标以单点脱字符进入源码行，下方保留预览卡片；光标离开后自动折叠恢复纯渲染状态。
- **语法鲁棒性**：完整支持反斜杠转义保护（`\$`）、数字货币避让（如 `$20 and $30` 不误判为公式）、行内代码块内隔离，以及块级公式无需空行直接打断前序段落的 Lezer 块边界判定。

## 0.9.4 - 2026-10-14

### 新增

- 建立基于 14px / 28px 垂直栅格的排版尺度体系，明确代码块行高（28px）与正文行高（1.75 / 28px）。
- 统一 H1~H6 标题字号与严格基线行高，修复 H6 字号小于正文的排版缺陷。

### 调整

- 优化代码块点阵背景：点阵采样移至 14px 单元中心（7px, 7px）并水平居中，消除左上边框压边与右下留白过大的问题，实现上下左右对称呼吸感。
- 优化代码块空行光标：采用 18px 字符行盒高度与上下 5px 对称内边距，使空行光标与文字行光标高度一致且垂直居中，不再撑满整行。
- 重构图片编辑浮层：容器内边距、阴影和圆角改用绝对视觉单位，表单输入框改为独立 0.875rem（14px）字号，避免嵌套 `em` 导致的过度缩水。
- 操作控件统一样式：搜索替换按钮、侧边 `+` 按钮、上传块按钮统一接入 `--moss-control-size` 与 `--moss-control-radius`。
- 对齐表格与行内代码：统一编辑器内与外部只读渲染（content.css）的表格单元格 padding（`0.4em 0.65em`）与行内代码圆角/字号。

### 修复

- 修复正文空行装饰打入代码块内部，导致代码块内空行行高跳动和点阵拉伸的问题。
- 消除正文默认字号（`1.0625rem` -> `1rem`）和行高 fallback（`1.7` -> `1.75`）的历史残留冲突，防止回退时击穿基线栅格。
- 修复未命名 Wiki 链接在末尾光标处的解析判定，优化 Happy DOM 下测试环境的事件调度。

## 0.9.3 - 2026-10-10

### 新增

- 新增 `contentWidth`，支持默认阅读宽度、自定义 CSS 宽度和 `full` 全宽模式。
- 新增统一的图标与操作按钮尺寸 token。
- 新增行内链接激活协议文档，统一普通 Markdown 链接与 Wiki 链接的源码显隐规则。
- `closeBrackets add '='`

### 调整

- 统一图片、文件、代码、表格和 slash side-plus 的操作控件尺寸与图标尺寸。
- side-plus 在正文左侧空间不足时自动隐藏。
- 表格操作 popup 继承编辑器主题和 Moss token。
- Wiki 链接使用统一的源码范围判断，支持光标边界、选区相交、阅读模式和点击冻结期间的稳定渲染。
- Wiki 链接测试覆盖源码显隐、内联代码排除、点击打开和解析策略。

## 0.9.2 - 2026-10-09

### 新增

- 图片块左下角新增复制链接按钮，并在复制成功后显示短暂的完成状态。
- 文件块操作按钮改为下载和复制链接，支持点击文件块选中完整 Markdown 源码。

### 调整

- 图片块和文件块选中态统一使用强调色边框，选中时操作按钮持续显示。
- 图片、文件块的复制与完成图标保持一致尺寸。

### 修复

- 修复图片、文件块高度参与 CodeMirror 高度图计算不准确，导致方向键上下移动跳块的问题。
- 修复选中文件块时光标错误出现在块左上角的问题。

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
