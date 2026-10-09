# MossMD

[![npm version](https://img.shields.io/npm/v/mossmd?color=7c3aed&labelColor=2d2d2d)](https://www.npmjs.com/package/mossmd)
[![license](https://img.shields.io/npm/l/mossmd?color=7c3aed&labelColor=2d2d2d)](./LICENSE)

MossMD 是一个基于 CodeMirror 6 的 React Markdown 编辑器，提供接近 Obsidian Live Preview 的编辑体验。Markdown 原文始终是唯一数据源，预览内容由只读装饰生成。

项目起源和演进过程见 [项目起源](./docs/project-origin.md)。

## 特性

- 标题、强调、链接、图片、表格、任务列表、Callout 等内容在编辑区内实时预览。
- 光标所在位置显示 Markdown 语法，复制、保存和协作同步始终使用原始 Markdown。
- 图片和文件链接渲染为块级组件，支持预览、编辑、缩放、下载和复制链接。
- 所见即所得表格、智能列表编辑、Wiki 链接、查找面板和阅读模式。
- 通过斜杠命令、上传器、图标协议、自定义语法和 CodeMirror 扩展进行组合。
- 主题使用 `--moss-*` CSS 变量，内置默认和蓝色明暗主题 preset。

## 安装

```bash
bun add mossmd \
  @codemirror/state @codemirror/view @codemirror/commands \
  @codemirror/autocomplete @codemirror/language @codemirror/search \
  @codemirror/lang-markdown \
  @lezer/common @lezer/highlight @lezer/markdown \
  react react-dom
```

CodeMirror、Lezer 和 React 相关包是对等依赖，需要由应用一并安装。围栏代码语言包按需安装；也可以使用 `mossmd/code-languages` 提供的精选列表。

## 快速开始

```tsx
import { MossMD } from 'mossmd';
import 'mossmd/editor.css';

export function App() {
  return (
    <MossMD
      markdownSource={'# Hello\n\nA paragraph.'}
      onMarkdownChange={(markdown) => console.log(markdown)}
    />
  );
}
```

编辑器会填满父容器，外层应提供明确的高度约束，例如 flex 或 grid 容器。
编辑器外渲染 Markdown 时，可组合使用 `mossmd/content.css` 和 `mossmd/tokens.css`。

## 常用配置

### 受控 Markdown 与文档身份

`markdownSource` 用于打开文档，`onMarkdownChange` 接收编辑后的完整 Markdown。编辑器挂载后以内部 `state.doc` 为数据源；需要切换文档时，请同时改变 `documentId`，避免光标、撤销记录和搜索状态泄漏到另一份文档。

```tsx
<MossMD
  documentId={note.id}
  markdownSource={note.markdown}
  onMarkdownChange={(markdown) => saveNote(note.id, markdown)}
/>
```

### 阅读模式

```tsx
<MossMD markdownSource={markdown} readOnly />
```

阅读模式会保持整篇文档的预览状态，禁用文本编辑；链接仍可打开，任务复选框和查找功能仍可使用。也可以通过命令式句柄动态切换。

### 命令式句柄

```tsx
import { useRef } from 'react';
import { MossMD, type MossMDHandle } from 'mossmd';

export function Toolbar({ markdown }: { markdown: string }) {
  const editor = useRef<MossMDHandle | null>(null);

  return (
    <>
      <button onClick={() => editor.current?.openSearch()}>搜索</button>
      <button onClick={() => editor.current?.undo()}>撤销</button>
      <MossMD markdownSource={markdown} editorHandleRef={editor} />
    </>
  );
}
```

句柄提供 `focus`、`undo`、`redo`、`openSearch`、`closeSearch`、`revealText`、`isSearchOpen`、`getMarkdown`、`getContentDOM`、`setReadOnly` 和 `setCollabAdapter`。

### 搜索与定位

- `initialSearchText`：挂载时打开搜索面板并填入查询。
- `initialRevealText`：挂载时滚动到第一个匹配位置，并显示短暂高亮，不打开面板。
- `searchPanelPosition`：设置为 `top`、`center` 或 `bottom`。

```tsx
<MossMD
  markdownSource={markdown}
  initialRevealText="需要定位的内容"
  searchPanelPosition="bottom"
/>
```

## 内置功能

### 图片与文件块

独立成行的图片和非图片文件链接会渲染为块级组件，源码仍保留在文档中。

- 图片块支持预览、编辑 alt/标题/URL、调整宽度和复制图片链接。
- 文件块支持下载、复制链接，以及点击后选中完整 Markdown 源码。
- 图片宽度使用扩展语法保存，例如 `![alt|caption|width=72%](url)`。
- 可通过 `imagesConfig` 和 `fileBlocksConfig` 局部关闭或覆盖对应能力。

```tsx
<MossMD
  markdownSource={markdown}
  imagesConfig={{ editable: false, resizable: false, previewable: true }}
  fileBlocksConfig={{}}
/>
```

### 上传与斜杠命令

`slashCommandsConfig` 可配置行首 `/` 和 `+` 按钮触发的命令面板。上传器由应用注入，上传过程显示为临时 Widget，完成后写入最终 Markdown。

```tsx
import { MossMD } from 'mossmd';
import {
  mossDefaultSlashCommands,
  mossUploadCommands,
  type MossUploader,
} from 'mossmd/features';

const uploader: MossUploader = async (file, onProgress, signal) => {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/upload', {
    method: 'POST',
    body: form,
    signal,
  });
  onProgress(1);
  return { url: (await response.json()).url };
};

<MossMD
  markdownSource={markdown}
  slashCommandsConfig={{
    commands: [...mossDefaultSlashCommands, ...mossUploadCommands(uploader)],
    sideButton: true,
  }}
  fileUpload={{ uploader, maxConcurrency: 3, maxFiles: 20 }}
/>
```

`fileUpload` 还支持图片和普通文件的粘贴、拖拽及批量上传。图片生成 `![name](url)`，普通文件生成 `[name](url)`；只读模式不会启动上传。

### 表格、任务列表与分隔线

- 表格单元格可直接编辑，宽表在自身容器中横向滚动。
- 任务列表支持标准状态和扩展状态，例如 `- [/] In Progress`、`- [!] Important`。
- `---`、`***`、`___` 分别提供直线、波浪线和普通分隔线；对称语法可携带原文图标，例如 `---⭐---`。

### Wiki 链接与 Callout

```tsx
import { MossMD } from 'mossmd';
import { mossCalloutSyntax, mossWikiLinks } from 'mossmd/features';

<MossMD
  markdownSource={'> [!NOTE]\n> Read [[project-atlas|the design doc]].'}
  customSyntax={[mossCalloutSyntax()]}
  extensions={[
    mossWikiLinks({
      suggest: async (query) => store.search(query),
      resolve: async (target) => store.resolve(target),
      onOpen: (target) => router.open(target),
    }),
  ]}
/>
```

### 围栏代码高亮

```tsx
import { MOSS_CODE_LANGUAGES } from 'mossmd/code-languages';

<MossMD markdownSource={markdown} codeLanguages={MOSS_CODE_LANGUAGES} />
```

也可以传入自行组装的 `LanguageDescription[]`。语言包在匹配到对应围栏时按需加载。

## 定制外观与图标

### 主题

```tsx
import 'mossmd/editor.css';
import 'mossmd/tokens.css';

<div data-theme="blue-light">
  <MossMD markdownSource="# Blue Moss" />
</div>
```

可用主题属性包括 `dark`、`light`、`blue` 和 `blue-light`。`tokens.css` 提供共享颜色、字体和字号变量；`editor.css` 提供编辑器表面样式；`content.css` 提供编辑器外 Markdown 内容样式。

### 图标

图标通过语义化 `MossIconMap` 提供，未配置的图标会显示为空占位。Lucide 适配器是可选依赖：

```tsx
import type { MossIconMap } from 'mossmd/icons';
import { mossLucideIcon } from 'mossmd/icons/lucide';
import { Copy, Download, File, Pencil, ScanEye } from 'lucide-react';

const icons: MossIconMap = {
  'image.edit': mossLucideIcon(Pencil),
  'image.preview': mossLucideIcon(ScanEye),
  'image.copy-link': mossLucideIcon(Copy),
  'file.file': mossLucideIcon(File),
  'file.download': mossLucideIcon(Download),
  'file.copy-link': mossLucideIcon(Copy),
};

<MossMD markdownSource={markdown} icons={icons} />
```

完整的 renderer 类型、优先级和全部语义 key 见 [图标方案](./docs/icon-customization.md)。

## 扩展 MossMD

### 自定义语法

完整功能通常放在 feature 模块中；简单语法可以通过 `customSyntax` 注册：

```tsx
import { MossMD } from 'mossmd';
import { defineMossSyntax } from 'mossmd/syntax';

const syntax = defineMossSyntax({
  name: 'example',
  description: 'Example syntax',
  markdown: exampleMarkdown,
  extensions: exampleDecorations(),
});

<MossMD markdownSource={markdown} customSyntax={[syntax]} />
```

### CodeMirror 组合

`MossMD` 暴露 `extensions`，可追加 autocomplete、装饰、keymap、vim mode 或协作扩展。也可以直接组合 `mossInlinePreview`、`mossTheme`、`mossSyntax` 和 `mossmd/features` 中的各个 feature。

### 协作

通过 `collabAdapter` 接入协作同步层。适配器实现 `attach`、`detach` 和 `onRemoteChange`，可在其中接入 yjs、Automerge 或自定义同步服务。

```ts
import type { CollabAdapter } from 'mossmd/collab';
```

## 入口与深入文档

| 入口 | 内容 |
| --- | --- |
| `mossmd` | `MossMD`、主题、输入辅助、阅读模式、语法协议和代码语言注册表 |
| `mossmd/features` | 图片、文件块、表格、Wiki 链接、Callout、斜杠命令和上传功能 |
| `mossmd/syntax` | 自定义语法注册协议 |
| `mossmd/code-languages` | 精选围栏代码语言列表 |
| `mossmd/collab` | 协作适配器接口 |
| `mossmd/editor.css` | 编辑器样式 |
| `mossmd/content.css` | 编辑器外 Markdown 内容样式 |
| `mossmd/tokens.css` | 主题令牌 |

- [项目起源](./docs/project-origin.md)
- [架构说明](./docs/architecture.md)
- [实时预览架构](./docs/inline-preview-architecture.md)
- [实时预览规则](./docs/live-preview-rules.md)
- [列表编辑优化 TODO](./docs/list-editing-todo.md)
- [图标方案](./docs/icon-customization.md)
- [上传实现](./docs/file-upload-implementation.md)
- [公式与 HTML roadmap](./docs/math-html-roadmap.md)
- [测试说明](./docs/testing.md)

## 许可证

MIT。见 [LICENSE](./LICENSE)。
