# MossMD 规格说明

本文档描述当前仓库的实际实现，不再按阶段规划写。

## 项目目标

MossMD 是一个基于 CodeMirror 6 的 Obsidian 风格 Markdown 编辑器，特点是：

- 原始 Markdown 是唯一数据源
- 预览、图片、表格、Wiki 链接都只是只读装饰
- 滚动和点击尽量不引发布局漂移
- 通过 `features` 和 `syntax` 两层扩展机制支持自定义能力

## 当前目录

```text
src/
  index.ts
  editor.tsx
  inline-preview.ts
  highlight.ts
  theme/index.ts
  core/
    code-languages.ts
    edit-helpers.ts
    read-only.ts
    tree-progress.ts
  features/
    index.ts
    image/index.ts
    table/index.ts
    wiki-links/index.ts
    callout/index.ts
  syntax/index.ts
  collab/index.ts
  styles/
    tokens.css
    inline-preview.css
    content.css
```

## 公共入口

### 根入口 `mossmd`

根入口导出：

- `MossEditor`
- `mossInlinePreview`
- `mossHighlightMarkdown`
- `mossTheme`、`mossSyntax`
- `autoCloseCodeFence`、`extendEmphasisPair`、`startAsteriskList`
- `mossReadOnlyExtension`、`mossReadOnlyFacet`
- `noopCollabAdapter`、`CollabAdapter`
- `defineMossSyntax`、`registerMossSyntax`
- `MOSS_CODE_LANGUAGES`
- `setFrozen`、`defaultOnLinkClick`

### 功能入口 `mossmd/features`

聚合导出：

- `mossImageBlocks`
- `mossTables`
- `mossWikiLinks`
- `mossCallouts`
- `mossCalloutSyntax`

### 子路径

- `mossmd/features/image`
- `mossmd/features/table`
- `mossmd/features/wiki-links`
- `mossmd/features/callout`
- `mossmd/syntax`
- `mossmd/collab`
- `mossmd/code-languages`
- `mossmd/theme`

开发阶段不保留旧的 `mossmd/plugins/*` 兼容路径。

## 编辑器行为

`MossEditor` 是 React 外壳，内部由单个 `EditorView` 驱动。主要 props：

- `markdownSource`
- `documentId`
- `initialSearchText`
- `initialRevealText`
- `readOnly`
- `onMarkdownChange`
- `onLinkClick`
- `editorHandleRef`
- `codeLanguages`
- `extensions`
- `customSyntax`
- `inlinePreviewConfig`
- `tablesConfig`
- `wikiLinksConfig`
- `collabAdapter`

命令式句柄包含：

- `focus`
- `undo`
- `redo`
- `openSearch`
- `closeSearch`
- `revealText`
- `isSearchOpen`
- `getMarkdown`
- `getContentDOM`
- `setReadOnly`
- `setCollabAdapter`

## 当前功能

### 实时预览

`inline-preview.ts` 负责标题、引用、强调、行内代码、删除线、链接、列表、任务项、水平线等的装饰。它保留原始 Markdown，不把视觉状态写回文档。

### 图片块

`features/image/index.ts` 把 `Image` 节点渲染成源码行下方的块级 Widget，并缓存图片自然尺寸，减少虚拟滚动中的高度抖动。

### 表格

`features/table/index.ts` 把 GFM 表格替换为可编辑 `<table>` Widget。单元格内部维护原始 Markdown，输入后会重新序列化整张表。

### Wiki 链接

`features/wiki-links/index.ts` 提供：

- `[[target]]` / `[[target|label]]`
- 异步 resolve
- 自动补全
- 点击打开

### Callout

`features/callout/index.ts` 识别 Obsidian 风格 `> [!TYPE]` blockquote，并在非激活状态下把标记收起为紧凑标签。

### 自定义语法

`syntax/index.ts` 定义 `MossCustomSyntax`、`defineMossSyntax()`、`registerMossSyntax()`。`MossEditor` 会在挂载时把传入的 `customSyntax` 合并进 Markdown 扩展和 CM6 扩展集合。

### 主题

`theme/index.ts` 提供两类扩展：

- `mossTheme`：`EditorView.theme()`，绑定 `--moss-*` 变量
- `mossSyntax`：`HighlightStyle` + `syntaxHighlighting`

### 代码语言

`core/code-languages.ts` 提供 `MOSS_CODE_LANGUAGES`。语言通过动态 `import()` 加载，避免把所有语法一起打进主包。

### 阅读模式

`core/read-only.ts` 通过 `Compartment` 切换编辑/阅读状态。阅读模式下：

- 不能输入普通文本
- 链接直接打开
- 复选框仍可切换
- 搜索仍可用

### 协作接口

`collab/index.ts` 目前只是接口层，使用 `CollabAdapter` 抽象真实同步实现。默认提供 `noopCollabAdapter`。

## 主题变量

`tokens.css` 提供编辑器与渲染内容共用的主题变量，全部使用 `--moss-*` 前缀。`inline-preview.css` 和 `content.css` 分别负责编辑器表面与渲染内容表面。

## 测试

### 单元测试

- `src/__tests__/edit-helpers.test.ts`
- `src/__tests__/editor.test.tsx`
- `src/__tests__/markdown-contracts.test.tsx`
- `src/__tests__/multiline-decoration.test.tsx`
- `src/__tests__/read-only.test.tsx`
- `src/__tests__/table-widget.test.ts`
- `src/__tests__/wiki-links.test.tsx`

### E2E 测试

- `tests/e2e/browser-smoke.spec.ts`
- `tests/e2e/editing.spec.ts`
- `tests/e2e/inline-preview.spec.ts`
- `tests/e2e/mount.spec.ts`
- `tests/e2e/read-only.spec.ts`

### 包测试

`bun run test:package` 会打包、安装到干净消费方并构建，用来检查导出映射和发布文件。

## 构建

- `bun run dev`
- `bun run build`
- `bun run typecheck`
- `bun test`
- `bun run test:e2e`
- `bun run test:package`

## 备注

当前仓库保留 `src/syntax/index.ts` 作为注册协议，`src/features/*` 作为用户功能模块。若以后新增 Mermaid、Kanban 等能力，也应优先按 feature 落地，再决定是否引入新的语法模块。
