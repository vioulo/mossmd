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
5. 装饰更新尽量做窄失效（Narrow Invalidation），普通文本编辑与方向键导航不应触发整篇重建。
6. 自定义 Block Widget 必须提供语义预估高度（`estimatedHeight`），杜绝视口塌陷（14px 塌陷）与滚动中的 HeightMap 行高突变抖动。
7. 移动端触控人机工效对齐：交互热区 ≥ 44px，触屏拖拽滑动绝不调用 `preventDefault()` 阻断浏览器原生触控惯性滚动。
8. React 组件接入解耦：未传入 `documentId` 时采用内部稳定实例标识，打字与受控状态回流绝不触发整机卸载重装（`view.destroy()`）。

## 当前目录职责

```text
src/
  index.ts                 根入口，导出编辑器、主题、基础扩展和语法注册协议
  editor.tsx               React 包装与 CodeMirror 扩展装配
  core/
    code-languages.ts      围栏代码语言注册表
    decoration-utils.ts    装饰区间安全分割工具
    edit-helpers.ts        Markdown 输入辅助与标点配对
    highlight.ts           ==highlight== 核心分词扩展
    icons.ts               图标协议与通用 SVG 转换
    inline-preview.ts      主实时预览装饰引擎（窄失效更新）
    list-model.ts          有序/无序列表文本模型分析
    list-editing.ts        列表回车续行、缩进与重编号
    list-navigation.ts     CM6 原生 atomicRanges 声明与极薄跨行导航
    markdown-context.ts    Markdown 代码块/文本上下文检测
    preview-activity.ts    光标激活范围管理、点击冻结与手势分流
    preview-widgets.ts     复选框、复制按钮、列表 Bullet
    read-only.ts           阅读模式 Compartment 与 Facet
    tree-progress.ts       Lezer 解析进度广播与懒加载节流
    visual-viewport.ts     移动端软键盘动态避让与视口感知
  features/
    index.ts               用户功能聚合入口
    callout/index.ts       Obsidian 风格 Callout 装饰
    file-blocks/index.ts   文件链接卡片 widget
    image/index.ts         图片块 widget 与浮动尺寸控制
    math/index.ts          数学公式行内与块级实时预览（带 LRU 缓存）
    mobile-toolbar/index.ts  移动端底部动作栏与软键盘快捷插入
    search/index.ts        查找替换面板与精准定位
    slash-commands/index.ts  行首 `/` 与 `+` 触发的命令面板
    table/index.ts         所见即所得表格（带微任务输入合并）
    upload/index.ts        上传进度块 widget 与上传命令
    wiki-links/index.ts    Wiki 链接、解析与自动补全
  icons/
    lucide.ts              可选 Lucide 图标适配器
  syntax/
    index.ts               `MossCustomSyntax`、`defineMossSyntax()`、`registerMossSyntax()`
    highlight.ts           `==highlight==` Markdown 扩展导出
  collab/index.ts          协作适配器接口（本地优先轻量快照）
  theme/index.ts           主题扩展与默认配色
  styles/
    tokens.css             主题令牌
    inline-preview.css     编辑器主样式
    content.css            编辑器外 Markdown 内容样式
    mobile.css             移动端触控热区与响应式浮层样式
```

## 公开入口

- `mossmd`：`MossMD`、`MossMDHandle`/`MossMDProps`、主题、输入辅助、阅读模式、语法注册协议、代码语言注册表。
- `mossmd/features`：图片、文件块、表格、Wiki 链接、Callout、斜杠命令、上传块、数学公式等用户功能。
- `mossmd/features/image`、`mossmd/features/table`、`mossmd/features/wiki-links`、`mossmd/features/callout`、`mossmd/features/slash-commands`、`mossmd/features/math`：单个 feature 的子路径。
- `mossmd/syntax`：自定义语法注册协议；`mossmd/syntax/highlight`：`==highlight==` 扩展。
- `mossmd/code-languages`：精选围栏代码语言列表。
- `mossmd/theme`：主题扩展。
- `mossmd/collab`：协作接口。
- `mossmd/editor.css`（`styles.css` 别名）、`mossmd/content.css`、`mossmd/tokens.css`：样式入口。

开发阶段不保留旧的 `mossmd/plugins/*` 或 `mossmd/syntax/callout` 兼容路径。

## 自定义语法约定

完整功能放在 `src/features/<name>/`。如果该功能需要新语法，就在 feature 内部提供 `markdown.ts`、`decoration.ts`、`widget.ts` 等模块，并从 `index.ts` 导出一个 `MossCustomSyntax`。

`src/syntax` 只保留注册协议，不承载具体功能目录。只有确实需要生成解析器时，才在对应 feature 中加入 `.lezer` 和生成脚本。

## 协作接口

MossMD 遵循本地优先（Local-First）原则，协作边界位于 `src/collab/index.ts`：

```ts
interface CollabAdapter {
  attach(view: EditorView): Promise<void>;
  detach(): void | Promise<void>;
  onRemoteChange(cb: (doc: string) => void): () => void;
  getAwareness?(): unknown;
}
```

编辑器通过 `collabAdapter?: CollabAdapter` 接收实现，默认使用 `noopCollabAdapter`。当前接口以整文档快照为边界，满足单人多端云盘同步和文件外部刷新需求。多人毫秒级实时协同（基于 CM6 Changeset 或 Yjs CRDT）的长期技术路线已独立归档至 `docs/roadmap/collab.md`，核心层暂不引入重型协同运行时。

## 开发命令

```bash
bun run dev
bun run build
bun run typecheck
bun run test
bun run test:e2e
bun run test:package
```

Demo 位于 `demo/App.tsx`，用于手工验证；Harness 位于 `demo/harness.tsx`，用于确定性 E2E 测试。

## 测试策略

1. `bun run test` 使用 Vitest 配置，覆盖逻辑、状态和 Happy DOM 下的 DOM 契约（当前实测 221 项测试全绿）。不要使用 `bun test`：它会直接启动 Bun 原生测试运行器，不读取 `vitest.config.ts`，也不会加载 Happy DOM。
2. `bun run test:e2e` 覆盖真实浏览器行为。
3. `bun run test:package` 覆盖打包、导出映射和干净消费方构建。
4. 共享 Markdown 契约放在 `src/__tests__/fixtures/markdown-contracts.ts`。

## 探针实测与反推测原则 (Probe-First Engineering)

Agent 在进行架构设计、重构或性能调优时，**严禁依赖纸面推演与“乐观假设”，必须以真实探针（Probe）数据和运行期表现为唯一真理**：

1. **探针先行，拒绝纸面断言 (Probe Before Refactor)**：
   - 在改造 CodeMirror 底层机制（如 Facet、选区吸附、`atomicRanges`、键盘拦截）前，必须先编写可运行的最小探针断言真实序列。
   - 严禁凭文档想象“某机制换成原生后手感完全一致”；必须实测边界场景（如边界跨行跳跃、边界退格、指针拖拽）。
2. **代码考古优先，警惕“无知重构” (Respect Historical Compromises)**：
   - 凡看到看似“低效或冗余”的实现（如全文档 `ensureSyntaxTree`、特殊的行高锁定、手写方向键拦截），必须先搜索注释与上下文。
   - 很多设计是为解决特定平台历史顽疾（如 iOS 惯性滚动中断、中文 IME 候选截获、微拖拽抖动）留下的血泪护栏。在未能证明且复测该顽疾已彻底解决前，严禁盲目将其当作“性能缺陷”重构。
3. **结构内聚高于形式行数 (Cohesion Over Line Count)**：
   - 单文件行数大（如 1000+ 行）绝非拆分的充分理由。
   - 若遍历状态高度共享（如 `tree.iterate` 期间修改 `activeLines`、`return false` 跳过子树），强行拆分只会引入隐蔽的静默渲染回归。没有独立的消费边界和专属单测护栏，严禁强行拆解。
4. **运行期为唯一信源 (Runtime Truth Over Grep)**：
   - 测试总数与通过率必须以 `bun run test`（Vitest 终端实际展开数）为准，严禁通过 grep 源码用例数统计（避免 `it.each` 表格展开偏差）。
   - 包体积必须以 `dist/*.js` 整体拼接 gzip 的真实传输大小为准，明确区分未压缩体积（DCE/Minify -40%）与网络传输体积（gzip -10~20%），严禁使用模糊的估算口径。

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
