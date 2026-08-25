# MossMD

[![npm version](https://img.shields.io/npm/v/mossmd?color=7c3aed&labelColor=2d2d2d)](https://www.npmjs.com/package/mossmd)
[![license](https://img.shields.io/npm/l/mossmd?color=7c3aed&labelColor=2d2d2d)](./LICENSE)

MossMD （苔藓 markdown） 是一个基于 CodeMirror 6 的 Obsidian live-view 风格 Markdown 编辑器，支持自定义块语法扩展。

起初是想在自己的博客系统中集成一款 markdown 编辑器，使用过 milkdown 等，但是与 obsidian 在书写体验上还是有差距，且或多或少存在不顺畅的点，于是想自己构建一款 live-view 风格的编辑器。

ChatGPT 推荐了 [atomic-editor](https://github.com/kenforthewin/atomic-editor)， 当前项目可以看作是它的 fork 版本，不过后续会在 AI 协作下添加了更多自定义功能，贴近 obsidian 的使用体验，构造一些自己需要的功能点。

## 特性

- **实时预览**：标题、强调、`==高亮==`、链接、图片和表格会直接在编辑区内渲染，语法只在光标所在行显露。
- **原始 Markdown 为唯一数据源**：所有装饰都只读，复制、保存、往返其它 Markdown 工具时都保持原文。
- **布局稳定**：行高只由 CSS 类决定，点击、编辑、滚动不会让页面抖动。
- **所见即所得表格**：单元格可直接编辑，宽表会在自身容器内横向滚动。
- **图片块**：`Image` 节点在源码行下方渲染为块级 Widget，并缓存自然尺寸以减少虚拟滚动抖动。
- **文件块**：单独成段的非图片文件链接渲染为带图标和扩展名徽章的卡片。
- **Wiki 链接**：支持 `[[target]]`、`[[target|label]]`、异步解析、自动补全和点击打开。
- **斜杠命令**：行首输入 `/` 或点击行首 `+` 触发命令面板，内置上传图片 / 文件骨架，可拼装自己的片段集。
- **上传块**：上传过程中显示带进度与状态的块级 Widget，成功后落回最终 Markdown，失败可重试或取消；上传器由消费方注入。
- **Callout**：识别 `> [!TYPE]` 形式的 Obsidian 风格块，非激活行收起为标签。
- **智能列表**：Enter 可延续紧凑列表和任务列表，空条目上按 Enter 会缩出列表。
- **代码高亮**：围栏代码块的语法在首次使用时才动态加载。
- **自定义语法**：通过 `MossCustomSyntax` 注册额外块，适合 Callout、Mermaid、Kanban 等扩展。
- **主题可配置**：全部颜色、字体、字号都来自 `--moss-*` CSS 变量。
- **查找面板**：内置轻量查找面板，样式与编辑器统一。
- **阅读模式**：`readOnly` 会把编辑器切成阅读表面，保留滚动和搜索状态。
- **协作接口**：`CollabAdapter` 预留给 yjs、Automerge 或自定义同步层。

## 安装

```bash
bun add mossmd \
  @codemirror/state @codemirror/view @codemirror/commands \
  @codemirror/autocomplete @codemirror/language @codemirror/search \
  @codemirror/lang-markdown \
  @lezer/common @lezer/highlight @lezer/markdown \
  react react-dom
```

CodeMirror 和 React 相关包都是对等依赖，需要和编辑器一起安装。围栏代码语言语法包（例如 `@codemirror/lang-javascript`、`@codemirror/lang-python`）也是按需安装。

## 使用

```tsx
import { MossMD } from 'mossmd';
import 'mossmd/editor.css';

export function App() {
  return (
    <MossMD
      markdownSource={'# Hello\n\nA paragraph.'}
      onMarkdownChange={(md) => console.log(md)}
    />
  );
}
```

编辑器会撑满父容器，外层请放在有高度约束的 flex 或 grid 容器里。渲染后的 Markdown 内容如果要在编辑器外复用，请配合 `mossmd/content.css` 和 `mossmd/tokens.css`。

## 命令式句柄

如果需要从外部控制编辑器，可以传 `editorHandleRef`。

```tsx
import { useRef } from 'react';
import { MossMD, type MossMDHandle } from 'mossmd';

export function ToolbarDemo() {
  const editor = useRef<MossMDHandle | null>(null);

  return (
    <>
      <button onClick={() => editor.current?.openSearch()}>搜索</button>
      <MossMD markdownSource={'…'} editorHandleRef={editor} />
    </>
  );
}
```

可用方法包括：`focus`、`undo`、`redo`、`openSearch(query?)`、`closeSearch`、`revealText(query)`、`isSearchOpen`、`getMarkdown`、`getContentDOM`、`setReadOnly(readOnly)`、`setCollabAdapter(adapter)`。

## 斜杠命令与上传

`slashCommandsConfig` 接收一个命令数组和一个 `sideButton` 开关。行首输入 `/` 或点击行首 `+` 会弹出命令面板；选中后 `apply` 回调负责把 `/query` 范围替换成最终片段。

```tsx
import { MossMD } from 'mossmd';
import { mossDefaultSlashCommands, mossUploadCommands } from 'mossmd/features';
import type { MossUploader } from 'mossmd/features';

const uploader: MossUploader = async (file, onProgress) => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  onProgress(1);
  return { url: (await res.json()).url };
};

const uploadCommands = mossUploadCommands(uploader);

<MossMD
  markdownSource={'…'}
  slashCommandsConfig={{
    commands: [...mossDefaultSlashCommands, ...uploadCommands],
    sideButton: true,
  }}
/>
```

上传在 pending 期间显示一个块级进度 Widget，成功后落回最终 Markdown，失败可重试或取消。pending 状态只活在编辑器内部，不会污染原文。

## 阅读模式

```tsx
<MossMD markdownSource={'…'} readOnly />
```

阅读模式会保持整篇文档渲染，不显示光标下的源码。链接可直接打开，任务复选框仍可切换，查找功能也正常工作。`readOnly` 通过 `Compartment` 动态切换，不会重挂载编辑器。

## 搜索结果落地

两个 prop 可以在挂载时把用户带到相关位置：

- `initialSearchText`：预填查询并打开搜索面板。
- `initialRevealText`：直接滚动到第一个命中处，并给一个淡出高亮，不打开面板。

两者都接受 `string | null`。`revealText(query)` 也可以在挂载后通过句柄触发。

## 语法高亮

围栏代码块默认只是等宽文本。要启用高亮，传入 `codeLanguages` 数组。

```tsx
import { MossMD } from 'mossmd';
import { MOSS_CODE_LANGUAGES } from 'mossmd/code-languages';

<MossMD markdownSource={'…'} codeLanguages={MOSS_CODE_LANGUAGES} />
```

如果你想自己组装语言列表，也可以直接传 `LanguageDescription[]`。

## Wiki 链接

```tsx
import { MossMD } from 'mossmd';
import { mossWikiLinks } from 'mossmd/features';

<MossMD
  markdownSource={'See [[project-atlas|the design doc]] for details.'}
  extensions={[
    mossWikiLinks({
      suggest: async (query) => store.search(query),
      resolve: async (target) => store.resolve(target),
      onOpen: (target) => router.open(target),
    }),
  ]}
/>
```

## 自定义语法

MossMD 提供自定义语法注册层。公开入口是 `mossmd/syntax`，源码对应的协议实现落在 `src/syntax/index.ts`。语法模块会把 `markdown` 交给 `@codemirror/lang-markdown`，把 `extensions` 追加到编辑器扩展集合之后。

```tsx
import { MossMD } from 'mossmd';
import { mossCalloutSyntax } from 'mossmd/features';

<MossMD
  markdownSource={markdown}
  customSyntax={[mossCalloutSyntax()]}
/>
```

如果你要自己定义模块，可以从 `mossmd/syntax` 引入 `defineMossSyntax`：

```ts
import { defineMossSyntax } from 'mossmd/syntax';

export const calloutSyntax = defineMossSyntax({
  name: 'callout',
  description: 'Callout 块',
  markdown: calloutMarkdown,
  extensions: calloutDecorations(),
});
```

内置的 Callout 模块识别 `> [!TYPE]` 这种 blockquote 结构。非激活行会显示紧凑标签，点回首行后再恢复原始标记，方便继续编辑。

## 主题

所有颜色、字体、字号都来自 CSS 自定义属性。你可以在编辑器祖先节点上覆盖这些变量，也可以通过 `data-theme="light"` 切换到浅色配色。

`mossmd/tokens.css` 提供共享主题令牌，`mossmd/editor.css` 负责编辑器表面样式，`mossmd/content.css` 负责渲染后的 Markdown。

## 底层组合

如果你不想使用完整的 React 包装，可以直接把各个模块拼起来：

```ts
import {
  mossInlinePreview,
  mossTheme,
  mossSyntax,
  extendEmphasisPair,
} from 'mossmd';
import {
  mossImages,
  mossFileBlocks,
  mossTables,
  mossWikiLinks,
  mossCallouts,
  mossSlashCommands,
  mossUploadBlocks,
} from 'mossmd/features';
```

上述函数都是独立的 CM6 模块，可以按需组合。

## 协作

`CollabAdapter` 预留给协作同步层。默认实现是 `noopCollabAdapter`，只是不做任何事。未来如果接入 yjs 或别的同步方案，只要实现 `attach`、`detach`、`onRemoteChange` 就行。

## 设计说明

更完整的架构说明见 [docs/architecture.md](./docs/architecture.md)。

- 原始 Markdown 是唯一数据源
- 行高只由 CSS 类控制
- 鼠标按下后会短暂冻结装饰重建
- 装饰重建只覆盖受影响的范围

## 许可证

MIT。见 [LICENSE](./LICENSE)。
