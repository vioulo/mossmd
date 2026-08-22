# 架构

本文档记录 MossMD 当前实现的关键边界。它不是 API 清单，而是改代码前需要先确认的架构约束。

## 为什么选 CodeMirror 6

MossMD 要处理较长 Markdown 文档，并且要在编辑时保持滚动稳定。CodeMirror 6 原生支持虚拟化和增量解析，适合在纯文本缓冲上叠加装饰层。

与 ProseMirror 类富文本模型不同，MossMD 不维护第二份结构化文档。CodeMirror 的 `state.doc` 是唯一内容来源，预览、图片、表格、Wiki 链接、Callout 都只是编辑器视图层。

## 核心不变量

### 原始 Markdown 是唯一数据源

`state.doc` 永远保存纯 Markdown。所有装饰、Widget、CSS 类都不能成为数据来源。

这个约束带来几个结果：

- 保存、复制、协作同步都直接读取原文。
- 视觉层可以随时重建，不需要参与持久化。
- 和其它 Markdown 工具往返时不会引入隐藏状态。

### 无布局漂移

实时预览只隐藏语法令牌，不改变行高。标题、引用、列表等行高通过 `.cm-moss-*` CSS 类决定。点击进入一行时，即使源码令牌重新显露，行高也保持稳定。

### 鼠标冻结

点击标题或链接时，如果装饰立即重建，源码前缀可能在鼠标下方突然显露，导致光标位置漂移。`src/core/inline-preview.ts` 在 `pointerdown` 后短暂冻结装饰重建，并在 `pointerup` 后延迟释放。

### 窄失效

图片和表格等 StateField 会先判断事务是否真的影响对应结构。普通段落编辑只映射已有装饰，不做全文扫描。解析树尚未覆盖全文时，`tree-progress.ts` 会在后台解析推进后广播 `treeGrowthEffect`，让相关模块补建装饰。

## 当前文件布局

```text
src/
  index.ts
  editor.tsx
  core/
    custom-syntax.ts
    inline-preview.ts
    highlight.ts
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
  syntax/
    index.ts
  collab/
    index.ts
  theme/
    index.ts
  styles/
    tokens.css
    inline-preview.css
    content.css
```

`core` 放基础机制，`features` 按用户功能聚合，`custom-syntax` 放语法注册协议。图片和表格复用 Markdown 原生节点；Callout 复用 blockquote 结构并提供自己的装饰；未来 Mermaid 或 Kanban 如果需要新语法，也应作为 feature 落地。

## `MossEditor`

`editor.tsx` 是 React 包装层，负责创建和销毁 `EditorView`，并把内置扩展装配到同一个 `EditorState` 中。

文档身份使用 `documentId ?? markdownSource`。身份改变时重建编辑器，避免上一份文档的光标、撤销栈和搜索状态泄漏。

主要职责：

- 装配 Markdown 语言、主题、输入辅助、搜索、图片、表格、实时预览、阅读模式和自定义语法。
- 通过 `editorHandleRef` 暴露命令式方法。
- 管理 `readOnly` 的 `Compartment`，实现不重挂载切换。
- 管理 `collabAdapter` 的 attach/detach 生命周期。

## 实时预览

`inline-preview.ts` 是主装饰引擎，负责：

- 为标题、引用、代码块、任务列表等添加行类。
- 为强调、行内代码、删除线、高亮、链接等添加内容标记。
- 在非激活行隐藏 Markdown 语法令牌。
- 把列表符号、任务复选框、水平线等渲染为更接近阅读状态的表现。
- 处理鼠标冻结和紧凑列表 Enter 行为。

装饰构建会调用 `ensureSyntaxTree(state, state.doc.length, 200)`，尽量保证全文解析覆盖。若解析在首次构建时没有到达文末，`treeProgressPlugin` 会在解析树增长后触发补建。

## 功能模块

### 图片

`features/image/index.ts` 读取 Lezer 已解析出的 `Image` 节点，在图片源码行下方插入块级 Widget。图片节点仍保留在 Markdown 原文中，非激活行由实时预览隐藏源码。

图片尺寸会按 URL 缓存自然宽高，避免虚拟滚动重新挂载图片时出现高度跳变。

### 表格

`features/table/index.ts` 把 GFM Table 节点替换为交互式 `<table>` Widget。单元格内部可编辑，输入后重新序列化为 Markdown，并替换原表格源码范围。

表格 Widget 的 `eq()` 以结构为主，尽量保留 DOM，避免每次输入都丢失光标。宽表在自身 wrapper 内横向滚动，不撑宽编辑器。

### Wiki 链接

`features/wiki-links/index.ts` 用文本扫描识别 `[[target]]` 与 `[[target|label]]`。它提供装饰、点击打开、异步 resolve、自动补全和简单缓存。

当前 Wiki 链接不是 Lezer 新语法，而是一个基于文本范围的编辑器功能。

### Callout

`features/callout/index.ts` 识别 `> [!TYPE]` 形式的 Obsidian 风格 callout。它不定义新 Lezer 节点，而是复用 Markdown blockquote，给相关行添加类并在非激活状态下把标记替换为标签。

## 自定义语法注册

`src/core/custom-syntax.ts` 定义：

- `MossCustomSyntax`
- `RegisteredMossSyntax`
- `defineMossSyntax()`
- `registerMossSyntax()`

`MossEditor` 在挂载时调用 `registerMossSyntax(customSyntax)`。其中：

- `markdown` 会进入 `markdown({ extensions })`。
- `extensions` 会追加到编辑器扩展集合。
- `name` 必须非空且不能重复。

## 主题

`theme/index.ts` 导出两类扩展：

- `mossTheme`：CodeMirror 主题，绑定 `--moss-*` CSS 变量。
- `mossSyntax`：语法高亮样式，覆盖 Markdown 令牌和围栏代码内的语言令牌。

样式文件分三类：

- `tokens.css`：主题变量。
- `inline-preview.css`：编辑器内部样式。
- `content.css`：编辑器外 Markdown 内容样式。

## 代码语言

`core/code-languages.ts` 导出 `MOSS_CODE_LANGUAGES`。每个语言通过 `LanguageDescription.load()` 动态加载，避免主入口直接打包全部语法。

## 搜索

编辑器使用 `@codemirror/search`，并提供自定义极简搜索面板。命令式句柄可以打开或关闭搜索，也可以通过 `revealText(query)` 做不打开面板的定位高亮。

## 阅读模式

`core/read-only.ts` 同时使用三层机制：

- `EditorView.editable.of(false)` 关闭内容可编辑。
- `EditorState.readOnly.of(true)` 阻止普通输入事务。
- `readOnlyFacet` 供图片、表格、链接等功能读取当前模式。

阅读模式通过 `Compartment` 切换，不重建编辑器。

## 协作接口

`collab/index.ts` 提供 `CollabAdapter`：

```ts
interface CollabAdapter {
  attach(view: EditorView): Promise<void>;
  detach(): void | Promise<void>;
  onRemoteChange(cb: (doc: string) => void): () => void;
  getAwareness?(): unknown;
}
```

当前远程变更以整文档快照应用，并标记为 `Transaction.remote`。未来接入 yjs 时，可以在 `attach(view)` 内安装更细粒度的 CM6 扩展。
