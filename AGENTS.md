# MossMD 开发代理指南

## 项目概览

MossMD 是基于 CodeMirror 6 的 Obsidian 风格 Markdown 编辑器，面向 React 18+ / 19+。

- 包名：`mossmd`
- 包管理器：Bun
- 模块格式：仅 ESM
- 核心原则：原始 Markdown 是唯一数据源，所有预览都是只读装饰
- 当前架构：`core` 放基础机制，`features` 放用户功能，`syntax` 放自定义语法注册协议

## 核心不变量

1. 原始 Markdown 是唯一数据源，`state.doc` 永远保存纯文本 Markdown。
2. 装饰不拥有数据，复制、保存和协作同步都以原文为准。
3. 行高由 CSS 类决定，不由语法令牌显隐决定，避免布局漂移。
4. `pointerdown` 后短暂冻结装饰重建，避免点击过程中源码显露导致光标漂移。
5. 装饰更新尽量做窄失效，普通文本编辑不应触发整篇重建。

## 当前目录职责

```text
src/
  index.ts                 根入口，导出编辑器、主题、基础扩展和语法注册协议
  editor.tsx               React 包装与 CodeMirror 扩展装配
  inline-preview.ts        主实时预览装饰引擎
  highlight.ts             `==highlight==` Markdown 扩展
  core/
    code-languages.ts      围栏代码语言注册表
    edit-helpers.ts        Markdown 输入辅助
    read-only.ts           阅读模式 facet 与扩展
    tree-progress.ts       Lezer 解析进度广播
  features/
    index.ts               用户功能聚合入口
    image/index.ts         图片块 widget
    table/index.ts         所见即所得表格
    wiki-links/index.ts    Wiki 链接、解析与自动补全
    callout/index.ts       Obsidian 风格 Callout 装饰
  syntax/
    index.ts               `MossCustomSyntax`、`defineMossSyntax()`、`registerMossSyntax()`
  collab/index.ts          协作适配器接口
  styles/
    tokens.css             主题令牌
    inline-preview.css     编辑器样式
    content.css            编辑器外 Markdown 内容样式
```

## 公开入口

- `mossmd`：`MossEditor`、主题、输入辅助、阅读模式、语法注册协议、代码语言注册表。
- `mossmd/features`：图片、表格、Wiki 链接、Callout 等用户功能。
- `mossmd/features/image`、`mossmd/features/table`、`mossmd/features/wiki-links`、`mossmd/features/callout`：单个 feature 的子路径。
- `mossmd/syntax`：自定义语法注册协议。
- `mossmd/code-languages`：精选围栏代码语言列表。
- `mossmd/collab`：协作接口。
- `mossmd/editor.css`、`mossmd/content.css`、`mossmd/tokens.css`：样式入口。

开发阶段不保留旧的 `mossmd/plugins/*` 或 `mossmd/syntax/callout` 兼容路径。

## 自定义语法约定

完整功能放在 `src/features/<name>/`。如果该功能需要新语法，就在 feature 内部提供 `markdown.ts`、`decoration.ts`、`widget.ts` 等模块，并从 `index.ts` 导出一个 `MossCustomSyntax`。

`src/syntax` 只保留注册协议，不承载具体功能目录。只有确实需要生成解析器时，才在对应 feature 中加入 `.lezer` 和生成脚本。

## 协作接口

协作边界位于 `src/collab/index.ts`：

```ts
interface CollabAdapter {
  attach(view: EditorView): Promise<void>;
  detach(): void | Promise<void>;
  onRemoteChange(cb: (doc: string) => void): () => void;
  getAwareness?(): unknown;
}
```

编辑器通过 `collabAdapter?: CollabAdapter` 接收实现，默认使用 `noopCollabAdapter`。当前接口以整文档快照为边界，未来可在 `attach(view)` 中接入 yjs 等更细粒度扩展。

## 开发命令

```bash
bun run dev
bun run build
bun run typecheck
bun test
bun run test:e2e
bun run test:package
```

Demo 位于 `demo/App.tsx`，用于手工验证；Harness 位于 `demo/harness.tsx`，用于确定性 E2E 测试。

## 测试策略

1. `bun test` 覆盖逻辑、状态和 Happy DOM 下的 DOM 契约。
2. `bun run test:e2e` 覆盖真实浏览器行为。
3. `bun run test:package` 覆盖打包、导出映射和干净消费方构建。
4. 共享 Markdown 契约放在 `src/__tests__/fixtures/markdown-contracts.ts`。

## 文件约定

- TypeScript 使用严格模式，不引入 `any`。
- 除非确实能降低理解成本，否则不添加注释。
- 所有主题值使用 `--moss-*` CSS 变量。
- CodeMirror 与 React 包均作为对等依赖。
- 副作用仅限 CSS 文件。
- 不随手重构与当前任务无关的模块。

## 参考

- 原 atomic-editor：`/home/k-k/Documents/kk/atomic-editor`
- CodeMirror 6 文档：https://codemirror.net/docs/guide/
- Lezer 语法指南：https://lezer.codemirror.net/docs/guide/
- yjs + CodeMirror：https://github.com/yjs/y-codemirror
