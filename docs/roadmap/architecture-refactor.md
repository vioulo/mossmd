# MossMD 架构调优与内核重构计划

本文档记录 MossMD 针对代码组织、目录对称性、核心引擎瘦身及 CM6 原生架构演进的技术调优方案。该方案旨在消除历史包袱、理顺模块职责、精简手写适配逻辑，使代码库更加内聚且易于长期维护。

---

## 一、 调优目标与核心原则

1. **目录与导出镜像对齐**：源码目录与包导出子路径（Subpath Exports）形成 1:1 直观映射，消除模块分家割裂。
2. **纯粹的注册协议中心**：`src/syntax/` 严格只保留通用注册协议与类型容器，不寄宿任何具体语法实现。
3. **拥抱 CodeMirror 6 原生机制**：剔除手动拦截键盘事件的手写“模拟跳跃”代码，采用 CM6 标准的 `atomicRanges` 等声明式机制处理不可见结构的导航。
4. **高内聚的领域模块**：将功能高度绑定的零散文件收纳合并，减少跨文件传递与概念碎片化。
5. **无破坏性与零回归**：对外公开 API、CSS 变量、测试套件全部平滑过渡。

### 基线快照（2026-10-15 实测）

所有重构改动以当前实测基线为准：

| 指标 | 实测值 | 说明 |
|---|---|---|
| `src/` 总行数（TS/TSX） | 15551 行 | 源码总规模 |
| `src/core/inline-preview.ts` | 1190 行 / 44755 字节 | 核心行内预览引擎 |
| 列表三文件合计 | 791 行 | `list-model` 185 + `list-editing` 310 + `list-navigation` 296 |
| `src/editor.tsx` | 885 行 / 30219 字节 | 根编辑组件 |
| `dist/` 全量 JS（拼接 gzip） | 86977 字节 | 整体传输体积近似值 |
| 根入口静态可达 JS（拼接 gzip） | 81485 字节 | 根入口引用的静态可达体积 |
| 纯 `core/` JS（拼接 gzip） | 28934 字节 | 不含 features 的核心基础体积 |
| CSS 三份合计（gzip） | 18249 字节 | `inline-preview.css` 15952 / `content.css` 1603 / `tokens.css` 1789 |
| **单元测试总数** | **189**（13 个测试文件） | **权威标准以 `bun run test` 终端输出为准**（避免 `it.each` 展开导致 grep 误计） |
| E2E 测试总数 | 15 | Playwright 桌面端套件 |

---

## 二、 重点重构方案细则

### 1. 高亮语法（Highlight）收归 Core 内置扩展

#### 方案设计
- **现状定位**：`==highlight==` 是扩展 Lezer Markdown AST 的核心内联标记，已被 `editor.tsx` 默认绑定，并被 `core/inline-preview.ts` 和 `features/table/` 深度依赖。它留在 `src/syntax/` 违背了“`src/syntax` 只保留注册协议”的原则。
- **位置迁移**：将分词解析器 `highlightMarkdown` 与匹配算法 `matchHighlight` 迁入 **`src/core/highlight.ts`**，`src/syntax/` 仅保留注册协议接口。
- **内部消费对齐**：`editor.tsx` 与 `features/table/index.ts` 导入路径同步改为指向 `core/highlight`。
- **平滑兼容策略**：为避免破坏外部依赖，保留 `package.json` 中的 `exports["./syntax/highlight"]` 导出子路径，但将其 target 指向 `dist/core/highlight.js`。消费方既有代码零改动即可继续工作。

---

### 2. 列表（List）模块瘦身合并与原生 atomicRanges 替代

#### (1) 现状与痛点
当前列表系统被拆成了 3 个小文件（共 791 行）：概念分散，且为了防止光标在隐藏缩进中空走，在 `list-navigation.ts` 中手写了 296 行逻辑去拦截实体按键。

#### (2) 改造核心：CM6 原生 `EditorView.atomicRanges`
采用 CodeMirror 6 标准的 `atomicRanges` Facet 声明隐藏缩进 `[lineFrom, contentFrom)` 为原子范围。CM6 内核的 `skipAtomicRanges` 将在指针选区、字符移动、垂直移动与删除操作中自动吸附边界，直接消灭手写拦截胶水代码。

#### (3) 方案决策：采纳“方案 b”（保留跨行薄守卫）
探针实测表明，若纯交由 atomic 接管（方案 a），会导致从嵌套 marker 起点按左方向键需按两次才能跨到上一行末尾（破坏现有 A1 测试与手感）；且在正文起点按退格键时会吞噬整段 4 空格缩进。

**确定方案（方案 b）**：
1. **删除冗余手写逻辑**：移除 `moveListHorizontally`（36 行）与 `skipListStructure` 的行内判定（30 行），删除 ArrowRight keymap 拦截。
2. **保留极薄 ArrowLeft 跨行守卫**（约 14 行）：仅当光标位于 `contentFrom` 且向左移动时，直接跳至上一行末尾，保持单次按键跨行手感。
3. **退格守卫强化**：扩展 `deleteEmptyOrderedListMarkerBackward`，拦截“正文起点退格”，防止 atomicRanges 误吞整段缩进。
4. **IME 原生收益**：左右方向键手写拦截移除后，中文输入法合成期间的左右移动直接交还 CM6 原生处理，无需特殊守卫。
5. **文件合并**：三文件整合为 **`src/core/list.ts`**（约 720~730 行），统一导出 `listExtension()`。顺带将 `inline-preview.ts` 中重复的 `nearestListItem` 等 helper 统一由 `list.ts` 提供。

---

### 3. 拒绝空壳目录：单文件模块扁平化

遵循“仅当模块由多个内部组件协同构成时才建立目录”的原则，消除单文件空壳文件夹：

1. **代码语言清单**：扁平化为 `src/code-languages.ts`，导出映射为 `mossmd/code-languages`。
2. **语法注册协议**：原 `src/syntax/index.ts` 扁平化为 `src/syntax.ts`，导出映射为 `mossmd/syntax`。
3. **协同抽象接口**：原 `src/collab/index.ts` 扁平化为 `src/collab.ts`，导出映射为 `mossmd/collab`。
4. **主题基底**：原 `src/theme/index.ts` 扁平化为 `src/theme.ts`。MossMD 基于 `--moss-*` CSS 自定义属性驱动，无需在 JS 维护多套主题实例，单文件即可终身满足需求。
5. **图标生态保留目录**：`src/icons/` 保留为目录，由协议层 `index.ts` 与可选适配器 `lucide.ts` 共同组成。
6. **边界保护**：扁平化原则仅适用于外围支撑模块，`src/core/` 内部文件（如 `markdown-context.ts`、`preview-activity.ts` 等）按职责内聚在 core 中，保持原位。

---

### 4. `editor.tsx` 架构解耦（引擎装配 vs React 外壳）

#### (1) 现状
`src/editor.tsx` 目前为 885 行（约 30KB），混杂了纯 CM6 扩展编排、状态 Compartment 管理、URL 初始查找高亮（Reveal）与 React 挂载逻辑。

#### (2) 改造实施
* **提取 CM6 扩展编排工厂**：将扩展装配逻辑迁至 **`src/core/setup.ts`**（`createMossExtensions(options)`，约 −250 行）。
* **提取初始高亮与滚动定位**：将纯 CM6 StateField 与动画逻辑（735-885 行）迁至 **`src/core/reveal.ts`**（约 −150 行）。
* **React 外壳纯净化**：`editor.tsx` 仅保留 DOM 挂载、`useRef` 句柄转发、props 归一化与微量 Compartment 重配置，体量降至 **< 500 行 / 17KB**。
* **验收**：`editor.test.tsx` 52 个测试全量零改动通过。

---

### 5. 架构决策记录 (ADR)：`inline-preview.ts` 保持不拆分

针对此前将 `inline-preview.ts`（1190 行）拆分为多个子模块的设想，经深度代码考古与实测，**正式否决拆分**：

* **决策**：维持现有单一模块，不作文件拆分。
* **核心依据**：
  1. **零体积收益**：构建为 1:1 ESM，全量行内预览功能始终被整体引入，拆分无法产生任何 Tree-shaking 优势。
  2. **状态遍历强耦合**：`tree.iterate` 在遍历中由 `FencedCode` 分支动态改写共享状态 `activeLines`，并深层影响后续所有分支；且内部包含 4 处阻断子树的 `return false`。拆分极易引入静态类型检查无法捕获的静默渲染回归。
  3. **测试护栏不足**：行内预览核心分支缺乏细粒度单测隔离，拆分收益远低于回归风险。

---

## 三、 调整后的目录规划对比（扁平直观架构）

```text
src/
├── __tests__/                  # 单元与 DOM 契约测试
│
├── core/                       # 纯粹的编辑器核心运行时与排版引擎
│   ├── inline-preview.ts       # 实时预览装配协调层 + 装饰构建（保持内聚不拆分）
│   ├── preview-activity.ts     # 焦点状态、激活范围计算、鼠标防抖
│   ├── preview-widgets.ts      # 任务复选框、复制按钮、列表 Bullet
│   ├── markdown-context.ts     # isLineInsideMarkdownCode 代码区判定
│   ├── decoration-utils.ts     # 装饰构建安全切分工具
│   ├── edit-helpers.ts         # 标点归一化、加粗配对、符号二义性消除
│   ├── highlight.ts            # 👈 (收归) ==highlight== 核心内联语法扩展
│   ├── list.ts                 # 👈 (合并) 列表模型、智能编辑、atomicRanges 原生导航
│   ├── read-only.ts            # 阅读模式 Compartment 与 Facet
│   ├── tree-progress.ts        # Lezer 异步语法树增长广播
│   ├── reveal.ts               # 👈 (迁出) 初始定位高亮：StateEffect + StateField + 滚动
│   └── setup.ts                # 👈 (提炼) 纯 CM6 扩展编排工厂函数
│
├── features/                   # 用户功能特性 (由多个内部组件协同构成的子系统)
│   ├── image/                  # 图片块 Widget
│   ├── file-blocks/            # 文件链接卡片
│   ├── table/                  # 所见即所得交互表格
│   ├── wiki-links/             # Wiki 双链解析、补全与 Resolve
│   ├── callout/                # Obsidian 风格提示块
│   ├── slash-commands/         # 斜杠与加号快捷菜单
│   ├── upload/                 # 上传进度临时 Widget
│   ├── search/                 # 紧凑查找与精准定位
│   └── math/                   # LaTeX 数学公式行内与块级实时预览
│
├── icons/                      # 图标生态（协议层 + 可选外置适配器）
│   ├── index.ts                # 👈 (迁入) 语义 key 协议与 MossIconRenderer
│   └── lucide.ts               # 可选 Lucide 适配器
│
├── code-languages.ts           # 👈 (扁平单文件) 动态代码语言注册表 (mossmd/code-languages)
├── syntax.ts                   # 👈 (扁平单文件) 纯粹自定义语法注册协议 (mossmd/syntax)
├── theme.ts                    # 👈 (扁平单文件) 通用主题与高亮样式基底 (mossmd/theme)
├── collab.ts                   # 👈 (扁平单文件) 协同抽象接口 (mossmd/collab)
│
├── styles/                     # CSS 样式产物（保持一体化不分包）
│   ├── tokens.css
│   ├── inline-preview.css
│   └── content.css
├── editor.tsx                  # 轻薄 React 外壳组件
└── index.ts                    # 根导出入口
```

---

## 四、 包体积与构建调优方向

### 1. 依赖与体积控制原则
* **零常规运行依赖**：保持 `dependencies` 为空，所有 `@codemirror/*`、`@lezer/*`、`react` 均作为 `peerDependencies`。
* **重型引擎外部可插拔**：KaTeX、Mermaid、Lucide 等三方大体积库坚持适配器外置，主包零绑定。
* **构建体积度量口径**：
  * **未压缩体积**：引入构建压缩工具后预期可缩减 40%+；
  * **gzip 传输体积**：minify 边际收益为 10~20%；
  * **体积目标口径（路线 A）**：纯 Core 基础模块 gzip 维持 < 30KB（当前基线 28.9KB）；全量静态可达 JS gzip 维持 ≤ 82KB。
* **CSS 保持一体化开箱即用**：不推行 CSS 分包，避免宿主遗漏样式导致排版崩塌（总 CSS gzip 约 18KB）。

### 2. 运行时性能规划关联
长文档视口推进、大表格输入微任务合并、KaTeX LRU 缓存与移动端触控调优已从本重构方案剥离，并在 **[`docs/roadmap/performance-rendering-mobile.md`](./performance-rendering-mobile.md)** 中独立立项与规划。

---

## 五、 实施路径与验证阶段

> 每个 Phase 实施后必须执行基线校验：`bun run typecheck && bun run test`（189 项测试全过）以及 `bun run test:package`。

### 1. 前置准备：对齐四处路径登记表
Phase 1 动工前，以 `package.json` 的 17 个非 CSS 子路径为基准，补齐并对齐 `vite.config.ts`、`tsconfig.json` 和 `README.md`，消除路径缺失隐患。

### 2. 重构实施阶段表

| 阶段 | 核心任务 | 风险等级 | 验证标准 |
|:---:|---|:---:|---|
| **Phase 1** | **单文件扁平化与高亮收归 Core**<br>• `syntax/highlight.ts` 迁入 `src/core/highlight.ts`（保留 `exports["./syntax/highlight"]` 别名）<br>• 扁平化 `syntax.ts`、`code-languages.ts`、`collab.ts`、`theme.ts`<br>• `src/core/icons.ts` 迁入 `src/icons/index.ts` | 🟢 低 | `bun run typecheck`、`bun run test:package` 全过；既有 import 零破坏 |
| **Phase 2** | **List 瘦身合并与 atomicRanges 替代**<br>• 合并三文件为 `src/core/list.ts`<br>• 采用方案 b 引入 `atomicRanges` + 保留 ArrowLeft 跨行薄守卫<br>• 强化 `deleteEmptyOrderedListMarkerBackward` 覆盖正文起点退格<br>• 统一 `nearestListItem` 等 helper 消除重复 | 🟡 中 | 见下方 Phase 2 专项验收清单；既有 32 个列表测试全绿 |
| **Phase 3** | **`editor.tsx` 装配工厂函数提炼**<br>• 提炼 `src/core/setup.ts`（`createMossExtensions`）<br>• 迁出初始高亮定位（:735-885）至 `src/core/reveal.ts`<br>• Compartment 实例内聚收敛 | 🟡 中 | `editor.test.tsx` 52 个测试全量通过；`editor.tsx` 降至 < 500 行 / 17KB |
| **Phase 4** | **构建工具链与 IME 防抖优化**<br>• 评估轻量打包工具变量压缩与 DCE<br>• 中文 IME 合成期性能守卫验证 | 🟡 中 | 未压缩体积缩减 40%+，gzip 体积缩减 10~20% |

### 3. Phase 2 专项验收清单（atomicRanges 迁移）

#### A. 必须保持不变的既有行为（回归护栏）
* **A1 (成败判定点)**：从嵌套 marker 起点按 **1 次** `ArrowLeft`，光标直接跨到上一行末尾（测试：`moves left from a nested marker start to the previous line end`）。
* **A2**：从嵌套 marker 末尾连续左移，平滑跳过隐藏缩进。
* **A3**：从上一行末尾按 `ArrowRight` 直接进入嵌套正文，不停在隐藏缩进中。
* **A4**：`Home` / `End` 在有序列表行内分级跳转正常。
* **A5**：`ArrowUp` / `ArrowDown` 跨列表项保持相对正文列偏移。

#### B. 必须新增的保护用例
* **B1**：在嵌套正文起点按 **Backspace**，不得吞掉整段 4 空格缩进。
* **B2**：隐藏缩进区内的真实指针拖拽（`mousedown` 起于缩进），选区端点吸附正确。
* **B3**：中文 IME 合成态下，列表行内左右方向键由 CM6 原生接管，keymap 不拦截。
* **B4**：正文起点左右方向键移动进出对称。
