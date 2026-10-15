# 编辑器图标方案

MossMD 的图标只属于视图层：它们可以影响按钮、占位符和命令菜单的呈现，但不能写入 Markdown，也不能成为协作或保存的数据来源。

## 当前分层

- `core/icons.ts` 只提供共享图标协议、语义 key 和渲染工具。
- 编辑器核心不携带具体图标源；宿主项目通过 `MossIconMap` 补全语义 key。
- `icons/lucide.ts` 是可选适配层，使用 Lucide 时从 `mossmd/icons/lucide` 引入。
- Widget 和按钮通过 DOM `Node` 插入图标，不要求消费方使用 Lucide。
- 用户可见的图片、文件、上传、搜索、表格、Slash command、任务和代码块图标都可以通过语义 key 覆盖。

## 轻量化约束

图标渲染不能依赖 `react-dom/server`。编辑器运行在浏览器 DOM 中，默认 Lucide 图标应直接从 Lucide 的 `iconNode` 数据创建 SVG DOM。

Slash command 的图标由 TypeScript 渲染真实 SVG，不再在 CSS 中维护重复的 data URI 背景图。CSS 只负责尺寸、颜色和布局。

## 公共类型

自定义图标使用 renderer，而不是 SVG 字符串：

```ts
export type MossIconRenderer = (props: MossIconProps) => Node;
```

renderer 接收 `document`、`size`、`strokeWidth`、`className`、`fill`、`ariaHidden` 等上下文，并返回一个新的 DOM 节点。每次调用都应创建新节点，避免同一个节点被多个按钮移动。

Lucide 图标可以通过 `mossLucideIcon(Icon, defaults)` 包装成 `MossIconRenderer`。配置面只接受 Moss renderer，避免把 React 组件类型扩散到 widget API。

## 可配置范围

React 入口优先使用顶层 `icons` 聚合配置：

- 图片块：`image.*`
- 文件块：`file.*`
- 上传进度块：`upload.*`

Feature 级配置仍然保留，适合手工组合 CodeMirror extensions 或只想局部覆盖某个 feature 的场景。优先级是“离使用点越近越高”：`imagesConfig.icons`、`fileBlocksConfig.icons`、`fileUpload.icons` 会覆盖顶层 `icons` 中对应的项。

语义 key 也覆盖搜索、表格、Slash command 和任务状态：

- 搜索面板：`search.previous`、`search.next`、`search.close`
- 表格菜单：`table.menu`、`table.row-above`、`table.row-below`、`table.column-left`、`table.column-right`、`table.delete`
- Slash command：`slash.*`
- 任务 checkbox：`task.*`

底层仍开放这些局部覆盖点：

- 任务 checkbox：`inlinePreviewConfig.taskCheckboxes[status].icon`
- Slash command：`MossSlashCommand.icon`
- 图片块：`imagesConfig.icons` / `mossImages({ icons })`
- 文件块：`fileBlocksConfig.icons` / `mossFileBlocks({ icons })`
- 上传进度块：`MossUploadBlockConfig.icons` / `mossUploadBlocks({ icons })`

外链图标仍由 CSS mask/data URI 管理；它不属于 block icon 配置，后续如要开放应走 link/theme 配置。

## 配置示例

```ts
import type { MossIconMap } from 'mossmd/icons';
import { mossLucideIcon } from 'mossmd/icons/lucide';
import { Paperclip } from 'lucide-react';

const icons: MossIconMap = {
  'file.file': mossLucideIcon(Paperclip, { size: 40 }),
};

<MossMD
  icons={icons}
/>;
```

Slash command 继续兼容内置 key：

```ts
{ id: 'upload-file', label: 'Upload file', icon: 'file', apply }
```

也可以直接传 renderer：

```ts
{ id: 'attach', label: 'Attach', icon: mossLucideIcon(Paperclip), apply }
```
