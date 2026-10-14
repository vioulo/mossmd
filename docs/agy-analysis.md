对 **MossMD** 项目进行了全面的代码与架构分析，整理出以下维度的系统分析报告：

---

### 一、 项目定位与核心理念

[MossMD](file:///home/k-k/Documents/kk/mossmd/README.md) 是一个面向 React 18/19、基于 **CodeMirror 6 (CM6)** 构建的 **Obsidian 风格实时预览（Live Preview）Markdown 编辑器**。

项目最初起源于个人博客系统对高品质书写体验的需求（早期参考了 [atomic-editor](https://github.com/kenforthewin/atomic-editor) 并逐步演进为独立架构），其核心差异在于**不维护类似 ProseMirror 那样的抽象富文本 AST 文档模型**，而是坚持：

1. **原始 Markdown 是唯一数据源 (Single Source of Truth)**：
   `state.doc` 永远是纯文本 Markdown。所有标题、粗体、链接、图片、表格、Wiki 双链、Callout 等均由**只读装饰（Decorations）和组件（Widgets）**在视图层渲染。复制、持久化保存、外部格式互操作与协作同步均直接针对原文，杜绝了富文本与 Markdown 双向转换带来的数据丢失或语法污染。
2. **零布局漂移 (Zero Layout Shift)**：
   实时预览仅在非激活时隐藏语法令牌，行高、行间距完全由 `.cm-moss-*` 的 CSS 类（如固定 `line-height` 与 `min-height: 1lh`）严格定义，而不是由令牌的显示/隐藏决定，彻底解决光标进入行时文字上下跳动的问题。
3. **鼠标冻结机制 (Pointer Freeze)**：
   点击标题或链接时，如果在 `pointerdown` 瞬间立刻展开源码（例如展开 `# ` 前缀），文字会向右滑动导致光标位置错位甚至触发微拖拽。[inline-preview.ts](file:///home/k-k/Documents/kk/mossmd/src/core/inline-preview.ts) 在按下时短暂冻结装饰重建，等待释放后再平滑展开。
4. **窄失效与增量解析 (Narrow Invalidation)**：
   利用 Lezer 的增量语法树（AST），普通文本编辑只做局部装饰映射而不做全文扫描；当后台语法树扩增时，通过 [tree-progress.ts](file:///home/k-k/Documents/kk/mossmd/src/core/tree-progress.ts) 的 `treeGrowthEffect` 广播精准补建。

---

### 二、 架构与目录职责

项目遵循清晰的分层解耦设计，严格划分底层机制、功能特性与语法协议：

```text
src/
├── index.ts                 # 根导出入口
├── editor.tsx               # React 封装层与 CM6 Extension 装配
├── core/                    # 核心机制与底层运行时
│   ├── inline-preview.ts    # 实时预览主引擎 (遍历 Lezer AST，生成装饰)
│   ├── preview-activity.ts  # 焦点状态、激活范围计算、鼠标冻结管理器
│   ├── preview-widgets.ts   # 列表 Bullet、代码复制、任务复选框等 Widget
│   ├── edit-helpers.ts      # 输入辅助 (* 列表消解、加粗配对、代码围栏闭合等)
│   ├── list-editing.ts      # 列表智能编辑 (自动重排序号、缩进回退等)
│   ├── list-model.ts        # 列表纯文本正则模型与解析器
│   ├── list-navigation.ts   # 列表键盘导航增强
│   ├── read-only.ts         # 阅读模式 (Compartment 隔离与只读 Facet)
│   ├── tree-progress.ts     # Lezer 解析进度监听与异步补偿机制
│   ├── icons.ts             # 解耦的统一图标协议 (MossIconMap)
│   └── code-languages.ts    # 围栏代码高亮动态按需加载器
├── features/                # 独立用户功能模块 (Feature Modules)
│   ├── image/               # 独立行图片块 Widget (支持缩放、Alt/宽度编辑、尺寸缓存)
│   ├── file-blocks/         # 文件链接卡片 Widget (下载、复制、选中源码)
│   ├── table/               # 所见即所得交互表格 (contenteditable，回写 Markdown)
│   ├── wiki-links/          # 双链 [[target|label]] 解析、异步 Resolve、自动补全
│   ├── callout/             # Obsidian 风格提示块 (> [!NOTE])，复用引用结构
│   ├── slash-commands/      # 行首 "/" 和 "+" 触发的快捷命令菜单
│   ├── upload/              # 上传进度临时 Widget，完成后落盘为 Markdown
│   └── search/              # 紧凑定位查找栏与 revealText 定位高亮
├── syntax/                  # 自定义语法扩展协议
│   ├── index.ts             # defineMossSyntax / registerMossSyntax 注册中心
│   └── highlight.ts         # ==highlight== 高亮标记语法解析与扩展
├── theme/                   # 主题与高亮扩展
│   └── index.ts             # 绑定 CSS 变量 (--moss-*) 的 CM6 主题配置
├── collab/                  # 协作接口
│   └── index.ts             # CollabAdapter 边界定义 (预留 CRDT/Yjs)
└── styles/                  # 样式实现 (仅有的副作用模块)
    ├── tokens.css           # 设计 Token (色阶、间距、字体)
    ├── inline-preview.css   # 编辑器核心渲染样式
    └── content.css          # 编辑器外纯 HTML 渲染样式
```

---

### 三、 核心技术实现解析

#### 1. 实时预览的状态分级体系
在 [live-preview-rules.md](file:///home/k-k/Documents/kk/mossmd/docs/live-preview-rules.md) 中，MossMD 提出了区分于传统编辑器的**三级显隐模型**，不使用单一的 `active` 布尔值：
- **编辑器焦点 (editorFocused)**：总闸门。一旦失焦，所有内容回到整篇阅读预览态。
- **当前行激活 (activeLines)**：用于行级块结构（标题 `# `、引用 `> `、列表符号 `- `、水平线 `---`）。光标进入该行即展现结构语法。
- **行内贴近 (nearInline)**：用于普通链接 `[text](url)` 和 Wiki 链接 `[[target]]`。**绝不因当前行被激活而展开整行内的所有链接**，只有光标真正落在或贴近链接范围闭区间 `[from, to]` 时才展开该链接的语法标记，避免视觉跳变。
- **Widget 优先 (Widget Priority)**：图片、表格、文件卡片即使在当前行，依然优先以可视化 Widget 呈现，通过内部编辑控件或明确交互来修改数据。

#### 2. 所见即所得表格 ([features/table/index.ts](file:///home/k-k/Documents/kk/mossmd/src/features/table/index.ts))
- 将整个 Markdown Table 节点替换为 `Decoration.replace` 块级 Widget，内部为原生 `<table>`，单元格设置 `contenteditable`。
- **DOM 保活与焦点维持**：Widget 的 `eq(other)` 判定只比较行数和列数（结构性相等）。用户在单元格中打字时，通过 DOM `input` 事件重新序列化 Markdown 并 dispatch 替换源码，由于 `eq` 为 true，CM6 会保留原有 DOM 树，光标和焦点不会丢失。
- **边界控制**：表格外层包装 `.cm-moss-table-scroll` 容器，横向溢出在表格内部滚动，配合 `.cm-content { min-width: 0 }`，杜绝宽表格撑破编辑器视口。

#### 3. 智能编辑辅助与中文体验优化 ([core/edit-helpers.ts](file:///home/k-k/Documents/kk/mossmd/src/core/edit-helpers.ts), [core/list-editing.ts](file:///home/k-k/Documents/kk/mossmd/src/core/list-editing.ts))
- **`*` 号二义性消除**：打出 `*` 时由 CM6 配对为 `*|*`；如果后续紧接着按空格，自动识别为无序列表意图，将 `*|*` 调整为 `* |`，不再需要手动删除多余的 `*`。
- **Obsidian 风格加粗**：在 `*|*` 之间再键入 `*` 时，自动扩展为 `**|**`，而不是跳出闭合符。
- **有序列表标号自动重排**：维护列表缩进与层级模型，插入或删除项时自动将错乱的序号校正为 `1., 2., 3.`。
- **输入法（IME）防护**：完善的 composition 保护，防止中文输入法候选过程中的按键被错误截获。

#### 4. 热插拔只读模式与文档切换 ([core/read-only.ts](file:///home/k-k/Documents/kk/mossmd/src/core/read-only.ts), [editor.tsx](file:///home/k-k/Documents/kk/mossmd/src/editor.tsx))
- **阅读模式无缝切换**：采用 CM6 `Compartment` 动态重配，切换时不重新挂载 React 组件，无闪烁且保留当前滚动位置与搜索状态。
- **文档身份保护**：以 `documentId ?? markdownSource` 为组件 key。切换不同文章时强制重新挂载，防止历史撤销栈（Undo Stack）和光标选区泄露到下一篇文档中。

---

### 四、 工程化与测试策略

1. **零外部框架依赖的纯净包结构**：
   - CodeMirror 生态包与 React 均被配置为 `peerDependencies`。
   - 导出的子路径粒度极细（支持单独引入 `mossmd/features/table`、`mossmd/theme`、`mossmd/code-languages` 等），打包体积高度可控。
2. **测试金字塔**：
   - **单元与状态契约测试**：`bun run test`（基于 Vitest + Happy DOM），覆盖列表编辑逻辑、表格重序列化、只读模式切换等。
   - **端到端测试**：`bun run test:e2e`（Playwright），覆盖真实浏览器环境下的光标跳转、选区交互与复合操作。
   - **打包与消费方验证**：`bun run test:package` 自动构建干净的项目环境，验证 ESM 导出映射。
3. **样式与主题隔离**：
   - 全面使用 `--moss-*` CSS 变量（如 `--moss-accent`, `--moss-bg`），支持明暗主题及外部无缝定制，不依赖 Tailwind 或外部 CSS-in-JS 运行库。

---

### 五、 总结与演进建议

MossMD 是一套**工程质量极高、目标极为明确**的现代化 Markdown 编辑器：
- **设计哲学清晰**：坚守纯文本 Markdown 原文为唯一真理，避免了传统富文本模型难以维护的脏状态。
- **体验打磨深入**：针对 Live Preview 常见的“跳行”、“光标漂移”、“表格丢失焦点”、“符号二义性”等硬核问题提供了优雅的技术解决方案。
- **扩展性优良**：通过 `MossCustomSyntax`、`MossUploader`、`MossIconMap` 提供了灵活的外部接入能力。

**后续可关注的扩展方向**（参考项目内部 Roadmap）：
1. **数学公式与图表**：进一步扩展独立的 Math (KaTeX) 与 Mermaid 渲染 Feature。
2. **富文本表格增强**：支持表格列对齐标志（`:---:`）以及单元格内的行内格式化。
3. **细粒度协同**：将目前的整篇文档快照协同升级为结合 `y-codemirror.next` 的细粒度 CRDT 增量协同。