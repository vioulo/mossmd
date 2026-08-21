# 架构

本文档涵盖 `mossmd` 的设计理念与实现细节。它不是每个函数的清单 —— 而是在改动任何东西之前值得记住的一套决策，因为表面积很小，但每一块都是承重墙。

## 为什么选 CodeMirror 6

大多数所见即所得 markdown 编辑器都构建在 ProseMirror 之上（Milkdown、Tiptap 等）。它们能提供精致的编辑表面，但无法虚拟化 —— ProseMirror 的状态模型要求整棵文档树都驻留内存并作为 DOM 挂载。对长文档而言这不可接受：打开时间随体积线性增长、滚动在布局变动下抖动、内存压力加剧、iOS 的惯性滚动会在大高度变化时卡顿。

CodeMirror 6 原生支持虚拟化。它只渲染视口、解析器（`@lezer/markdown`）是增量的，整个系统围绕可干净组合的装饰构建。代价是 CM6 本质上是一个文本编辑器 —— CM6 里的"所见即所得"意味着在原始文本缓冲上精心编排装饰层，而不是像 ProseMirror 那样的富内容模型。

## 核心不变量 1：原始 markdown 是唯一数据源

**`state.doc` 中的文档文本永远是纯 markdown。** 每个装饰只读。这是整个设计遵循的唯一规则，值得说两遍：

- 屏幕所见可能与原始文本不同（隐藏的语法令牌、渲染后的列表符号、复选框 widget、渲染的图片、所见即所得表格等）。
- 你复制的内容、保存的内容、其他编辑器能解析的内容，永远是底层 markdown。

这个不变量是跨块选区"开箱即用"的原因 —— 浏览器选区映射到文档位置，复制时从这些位置读取原始 markdown。它也是协作编辑和 diff 可以在不重想视图层的情况下直接叠加上去的原因。还是用户所见与实际持久化内容一致的原因。

## 核心不变量 2：无布局漂移

早期迭代曾短暂发布过一种"块"预览模式：把每个块替换成渲染后的 HTML widget。光标在块间移动时，被点击的块展开成原始文本、离开的块重新折叠，每次都引起高度变化。实测大约每 10 次光标移动触发 0.1 个 CLS；实际上给用户的感觉是 UI 在光标下震动。

当前模式（"行内实时预览"）通过让行高**只依赖 CSS 类**来避免布局漂移，而不是依赖语法令牌是否可见。`.cm-moss-h1` 样式的标题行，无论 `# ` 前缀当前是隐藏还是显示，都是约 1.35em 高。激活/非激活状态通过 `Decoration.replace({})` 切换令牌可见性 —— 它从文档流中移除字符，但不改变所在行的高度。

同样的 10 次光标移动测试在行内模式下测得的 CLS 约为 0.003 —— 几乎全部来自光标本身的重绘。结构完全不动。

## 文件布局

```
src/
  index.ts               公共 API（MossEditor + 类型）
  editor.tsx             React shell + 命令式 handle
  inline-preview.ts      主装饰引擎（ViewPlugin）
  highlight.ts           ==highlight== markdown 解析扩展
  theme/index.ts         主题 + 语法高亮
  core/
    code-languages.ts    精选围栏代码语法注册表
    edit-helpers.ts      括号 / 强调自动配对
    read-only.ts         共享阅读模式 facet + CM6 扩展
    tree-progress.ts     解析进度跟踪
  features/
    index.ts              用户功能聚合入口
    image/index.ts        块图片 widget（StateField）
    table/index.ts        所见即所得表格（StateField）
    wiki-links/index.ts   wiki 链接 + 自动补全
    callout/index.ts      Callout 语法适配与视图扩展
  collab/                协作接口
  syntax/                自定义块语法（Lezer 语法）
  styles/
    tokens.css                共享编辑器/内容主题契约
    inline-preview.css        CodeMirror/编辑器表面样式
    content.css               渲染后 markdown 表面样式
```

`syntax/` 是通用的语法注册协议；`features/` 按用户功能聚合实现。一个
feature 可以使用既有 Markdown 节点，也可以同时提供新的 Lezer 语法和
CodeMirror 视图扩展。比如图片和表格复用现有 Markdown 语法，Callout
复用 blockquote 语法但提供自己的装饰行为。

每个 CodeMirror 模块都是**对等依赖**，这样消费方的打包器只解析一份副本。同一个 bundle 里出现两份 `@codemirror/state` 会静默破坏状态字段的身份检查；对等依赖正是用来阻止这种情况的。

## `MossEditor`

单个 `EditorView` 的 React 包装。卸载时销毁视图；文档身份（`documentId ?? markdownSource`）作为视图的 key，避免光标/撤销状态从一个文档泄漏到下一个。

组件通过 `editorHandleRef` 暴露命令式 handle：`focus`、`undo`、`redo`、`openSearch(query?)`、`closeSearch`、`isSearchOpen`、`getMarkdown`、`getContentDOM`、`setReadOnly(readOnly)`、`setCollabAdapter(adapter)`。

值得注意的 props：

- `markdownSource` —— 初始内容；挂载后编辑器拥有文档。
- `onMarkdownChange` —— 每次文档变更都会触发，包括内部变更（复选框切换、紧凑列表续行）。
- `initialSearchText` —— 预填打开搜索面板，适合把用户落到某个搜索命中处。
- `readOnly` —— 切换基于 Compartment 的阅读模式而不重挂载，保留滚动与搜索状态，同时禁用文本与表格编辑。
- `onLinkClick` —— 编辑时点击外链图标、或阅读模式中点击渲染后的链接时调用。默认 `window.open`；可为特定平台 shell（Tauri、Capacitor、Electron）覆盖。
- `codeLanguages` —— 围栏代码块的语法；默认 `[]`。用法见 README。
- `collabAdapter` —— 可选的协作适配器（yjs 等）。
- `extensions` —— 追加到内置集合之上的额外 CM6 扩展。

## `inline-preview.ts` —— 装饰引擎

三块组成，各自有存在的具体理由。

### `previewFrozenField`

一个布尔 `StateField`，跟踪装饰重建是否暂停。由冻结插件的 `setFrozen` effect 切换。

### `freezeMousePlugin`

一个 `ViewPlugin`，在 `view.dom` 上有**捕获阶段**的 `pointerdown` 监听、在 `window` 上有 `pointerup` 监听。在内容 DOM 内 pointerdown 时，分发 `setFrozen(true)`；pointerup 后约 100ms 尾延时，分发 `setFrozen(false)`。

冻结存在的原因是：点击标题过去会立即显示 `# ` 前缀 —— 这会让标题文本在用户点击过程中向右移动，有时会把点击变成一处微型拖拽选区。现在显示要等点击完全结束。

**捕获阶段很重要**：`@codemirror/lang-markdown` 自己的 pointerdown handler 在冒泡阶段运行并分发选区变更。没有捕获，CM6 会在我们冻结之前就重建装饰，reveal 还是会触发。**内容 DOM 过滤也很重要**：没有它，滚动条拖拽会触发冻结，整个拖拽期间都停止装饰重建 —— 深层内容在 mouseup 前一直保持原始状态。

### `inlinePreviewPlugin`

一个 `ViewPlugin`，其 `decorations` facet 驱动显示。在文档变更、选区变更或焦点变更时重建，受冻结标志约束。**不在视口变更时重建** —— 仅滚动不应重建装饰，因为在 iOS 上，每当重建为上滚视口顶部的行产生新装饰时（CM6 的锚点与滚动动画冲突），就会中断惯性动量。

构建函数调用 `ensureSyntaxTree(state, state.doc.length, 200)`，在遍历树之前强制全文解析覆盖。部分解析意味着初始解析窗口之外的内容永远渲染成原始的 `##`/`**`，因为装饰不再随滚动重建。全文覆盖是一次性开销；后续调用几乎免费，因为树到达目标后 `ensureSyntaxTree` 会短路。

## 什么会被隐藏、设置样式或替换

- **行类**（无条件按块类型应用）：`cm-moss-h1`..`h6`、`cm-moss-blockquote`、`cm-moss-fenced-code`、`cm-moss-hr`、`cm-moss-task-done`。它们设置字号/字重/装饰。激活与非激活状态之间没有高度变化，因为类不关心光标位置。

- **行内内容标记**（无条件应用在语法令牌之间的内容上）：`cm-moss-strong`、`cm-moss-em`、`cm-moss-inline-code`、`cm-moss-strike`、`cm-moss-link`。链接标记还通过 `::after` 伪元素渲染一个"外部打开"图标；只有图标的命中区域可点击，因为链接文本本身是可编辑的散文。

- **隐藏装饰**（仅应用到非激活行）：`HeaderMark`、`EmphasisMark`、`CodeMark`、`CodeInfo`、`LinkMark`、`URL`、`LinkTitle`、`StrikethroughMark`、`QuoteMark` 以及 `Escape`。标题和引用标记会吞掉一个尾随空格，避免隐藏状态下的行显得缩进。`Escape` 只隐藏前导反斜杠 —— 来自 RSS 或其他源的 `\.`、`\,` 密集内容在聚焦前读起来很干净。

- **Widget**（常开替换）：列表 `ListMark` 渲染为 `•`、`TaskMarker` 渲染为复选框、水平线通过行上的 CSS `::after` 规则渲染、每条图片源码行下方渲染图片（见 `features/image/`），还有完整的所见即所得表格（见 `features/table/`）。

- **列表布局**遵循解析出的 `ListItem` 祖先链。条目拥有的每条物理源码行（包括惰性/硬换行续行）都得到相同的悬挂缩进内容列。结构性的前导空格在视觉上被隐藏但文档保持不变，因此有序标记宽度和奇怪但合法的 CommonMark 缩进不会扭曲渲染出来的嵌套深度。

## `features/image/` —— 块图片 widget

图片不能从 `ViewPlugin` 输出，因为 CM6 要求块装饰来自 `StateField` 或强制 facet。图片状态字段与行内预览插件并存；CM6 在渲染时组合两套装饰。

对每个 `Image` 节点，字段在 `line.to` 处输出一个 `side: 1` 的块 widget，让图片立即渲染在源码行下方。表格内的图片被跳过 —— 表格 widget 会在单元格内联渲染它们。

尺寸不变量：`<img>` 使用 `display: block; max-width: 100%; height: auto`，在不超出自然尺寸的前提下适配阅读列。小图按自身尺寸渲染、左对齐。

**窄失效**：每次事务中，`changeAffectsImages` 检查变更是否与既有图片装饰重叠，或者变更行是否包含 `![`。两者都不命中时，状态字段返回经映射的既有集合（不变）。这让大文档中的纯散文编辑成本保持 O(变更大小) 而非 O(文档大小)。

## `features/table/` —— 所见即所得表格

表格在行级上放弃了"源码即 DOM"不变量：Table 节点的整个范围被替换为交互式 `<table>` widget。每个单元格是一小棵 DOM 树，拥有一个 contenteditable `<div>`，持有原始 markdown；当单元格包含 `![alt](url)` 时，下方还渲染一个图片预览条。

widget 的 `eq()` 只看结构（行 × 列数），因此 CM6 在每次按键分发之间保留既有 DOM，光标也能幸存于编辑。单元格输入会重新序列化整张表并替换当前源码范围 —— 每次通过 `posAtDOM + 树遍历` 重新解析该范围，因为先前的编辑会移动边界。

宽表在 wrapper 内拥有自己的横向滚动（`overflow-x: auto`），因此 10 列表格进入视口时不会把编辑器的内容列撑得比视口还宽。这曾是移动端溢出 bug 的根因，值得保留。

交互契约：

- Tab / Shift-Tab 在单元格间移动。在最后一个单元格后按 Tab 会追加新行并落在其第一个单元格上。
- 右键打开菜单：插入行 / 删除行 / 插入列 / 删除列。最后一列被夹住，保证 lezer 仍能把残余解析为 Table。
- 列对齐（`:---`、`---:`、`:---:`）会被解析并持久化。
- 图片单元格内，焦点离开单元格时原始 `![alt](url)` 隐藏 —— 静止时只显示图片，与表格外的块图片不变量一致。
- 紧邻表格之后的行的退格键会把整张表选中为原子单元，而不是把内容并进最后一行。

## 自定义语法框架（`syntax/` + `features/`）

MossMD 通过一层小型注册层支持自定义块语法。语法模块可以提供 Lezer Markdown 解析扩展、CodeMirror 视图扩展，或两者：

```ts
const syntax = mossCalloutSyntax();
```

`MossEditor` 在挂载时调用 `registerMossSyntax(customSyntax)`。Markdown 条目被转发进 `markdown({ extensions })`；视图条目追加在内置实时预览/表格/图片/wiki-link 扩展之后。注册层校验每个语法都有非空且唯一的名称，让意外的重复模块大声失败。

内置 Callout 模块（`src/features/callout/`）是对该接口的首次验证。它不需要生成语法，因为 Obsidian callout 是带 `[!TYPE]` 标记的 blockquote；它提供一个视图扩展，用于检测那些范围、应用 callout 行类、并把非激活行上的标记替换为紧凑标签。Mermaid/Kanban 式块可以遵循同样的形态，仅在语法需要时才添加 Markdown 解析扩展或生成语法。

## 紧凑 Enter 覆盖

`@codemirror/lang-markdown` 把 `insertNewlineContinueMarkup` 作为默认的 Enter handler。它会检查语法树以决定要延续的列表是"松散"（CommonMark：条目间有空行）还是紧凑，若是松散则往续行里插入空行以保持松散风格。

在行内实时预览模式下松散和紧凑列表看起来一样，所以这个区分不值得它的代价。更糟的是，lezer 常把刚输入的列表项在靠近既有列表时归类为松散 —— 用户最终会在条目之间得到多余的空行。

`inline-preview.ts` 中的 `insertTightListItem` 以 `Prec.highest` 覆盖 Enter。绑定行为：

- 在 `BulletList` 内部，总是输出 `\n<indent><marker> `（紧凑）。
- 在任务条目内，输出 `\n<indent><marker> [ ] ` —— 新任务从不勾选开始，即使你是在已勾选项上按的 Enter。
- 在空的续行上（`- ` 后无内容，或 `- [ ] ` 后无内容），把该行替换为只有缩进，按用户的期望退出列表。

## 输入中的强调

CommonMark 的 flanking 规则认为 `**foo **` 不是强调，因为闭合的 `**` 前有空白。Lezer 也这么认为，不会输出 `StrongEmphasis`。结果：用户在 `**...**` 内输入时，每次按空格加粗样式都会闪烁开关。

`supplementMidTypingEmphasis` 修补了 UX：在聚焦行上，扫描光标所在处两侧成对的定界符（`**`、`__`、`~~`、`*`、`_`），无论 flanking 如何都自行输出标记。光标离开后，lezer 说了算，视觉回到该行序列化时真正会持久化的样子。

## 括号 / 强调自动配对

`closeBrackets()` 默认配对 `(`、`[`、`{`、`"`、`'`、`*`、`_`、`` ` ``；我们扩展 markdown 语言的 data facet 以包含 markdown 特定的对称定界符。`edit-helpers.ts` 里的 `extendEmphasisPair` 增加一个特殊情况：在空 `*|*`（或 `_|_`）内输入 `*` 会把这一对升级成 `**|**` —— 这是 Obsidian 的快捷方式，无需想双重按键就能快速输入粗体。`startAsteriskList` 解决另一种解释：在合法行前缀处的自动配对星号内输入空格会吞掉闭合符，使 `*|*` 在输入文本前变成无序列表标记 `* |`。

## `theme/index.ts`

两个 CM6 扩展：

- 一个 `EditorView.theme()`，其视觉/选区/滚动条样式绑定 `--moss-*` 自定义属性。完整变量列表见 README。
- 一对 `HighlightStyle` + `syntaxHighlighting`，同时为 markdown 令牌和围栏代码块内嵌套语法输出的令牌着色。代码语言颜色默认使用 Material Palenight 调色板，`[data-theme="light"]` 时切换到 GitHub 风格浅色调色板。

## `core/code-languages.ts`

精选围栏代码语言注册表。每种语言的 `load()` 都是动态 import，打包器会把每个语法拆成独立 chunk，用户只下载自己打开过的语法。

注册表通过 `/code-languages` 子路径暴露，消费方显式选择使用；主入口 bundle 没有任何 lang-* 依赖。

## 搜索

编辑器把 `@codemirror/search` 与一个自定义极简面板结合：输入框 + 命中计数 + 上/下一条/关闭图标按钮。无替换、无大小写/正则/整词开关 —— 面向读者而非编辑器。键盘用户获得 CM6 `searchKeymap` 的同等行为（Cmd/Ctrl+G 下一条，Shift+同键上一条，Escape 关闭）。

外部代码可通过命令式 handle 的 `isSearchOpen()` 检测"搜索是否打开"，它委托给 CM6 的 `searchPanelOpen(state)`。

## 协作接口

`src/collab/index.ts` 的 `CollabAdapter` 接口允许接入任意 CRDT/OT 实现（yjs、Automerge、自定义）。编辑器拥有适配器生命周期：挂载时 attach，文档切换/卸载时 detach，通过 `editorHandle.setCollabAdapter(adapter)` 切换而不重挂载视图。

```ts
interface CollabAdapter {
  attach(view: EditorView): Promise<void>;
  detach(): void;
  onRemoteChange(cb: (doc: string) => void): () => void;
  getAwareness?(): Awareness;
}
```

`onRemoteChange` 在首个接口版本里有意采用整文档：传入的快照以 `Transaction.remote` 事务替换 `state.doc`，让原始 markdown 保持为共享边界。yjs 适配器以后仍可在 `attach(view)` 内安装 CM6/yjs 原生扩展；这个接口留下那扇门，同时今天不把 yjs 变成依赖。

默认 `noopCollabAdapter` 什么都不做。消费方通过 `collabAdapter` prop 传入自己的实现，并可在运行时用 `editorHandle.setCollabAdapter(adapter)` 切换。
