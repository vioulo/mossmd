# MossMD 架构调优与内核重构计划

本文档记录 MossMD 针对代码组织、目录对称性、核心引擎瘦身及 CM6 原生架构演进的技术调优方案。该方案旨在消除历史包袱、理顺模块职责、精简手写适配逻辑，使代码库更加内聚且易于长期维护。

---

## 一、 调优目标与核心原则

1. **目录与导出镜像对齐**：源码目录与包导出子路径（Subpath Exports）形成 1:1 直观映射，消除模块分家割裂。
2. **纯粹的注册协议中心**：`src/syntax/` 严格只保留通用注册协议与类型容器，不寄宿任何具体语法实现。
3. **拥抱 CodeMirror 6 原生机制**：剔除手动拦截键盘事件的手写“模拟跳跃”代码，采用 CM6 标准的 `atomicRanges` 等声明式机制处理不可见结构的导航。
4. **高内聚的领域模块**：将功能高度绑定的零散文件收纳合并，减少跨文件传递与概念碎片化。
5. **无破坏性与零回归**：对外公开 API、CSS 变量、测试套件全部平滑过渡。

### 基线快照（2026-10-15，改动前实测）

本文所有体量数字均以此快照为准，实施后可直接比对：

| 指标 | 实测值 |
|---|---|
| `src/` 总行数（TS/TSX） | 15551 行 |
| `src/core/inline-preview.ts` | 1190 行 / 44755 字节 |
| 列表三文件合计 | 791 行（`list-model` 185 + `list-editing` 310 + `list-navigation` 296） |
| `src/editor.tsx` | 885 行 / 30219 字节 |
| `src/features/table/index.ts` | 1608 行 |
| `dist/` 全量 JS（拼接 gzip） | 86977 字节 |
| 根入口静态可达 JS（拼接 gzip） | 81485 字节 |
| 纯 `core/` JS（拼接 gzip） | 28934 字节 |
| CSS 三份合计（gzip） | 18249 字节（`inline-preview.css` 15952 / `content.css` 1603 / `tokens.css` 1789） |
| 单元测试总数 | **189**（vitest 实测，13 个文件；`editor.test.tsx` 52、`list-editing.test.ts` 32、`table-widget.test.ts` 22、`edit-helpers.test.ts` 20） |
| E2E 测试总数 | 15 |

> 度量口径：`dist/*.js` 按模块拼接后整体 gzip，用于近似“单一 flat bundle”的真实传输体积。逐模块独立 gzip 会因丢失跨模块重复串而系统性高估。

---

## 二、 重点重构方案细则

### 1. 高亮语法（Highlight）收归 Core 内置扩展

#### (1) 现状与问题分析
- 当前 `src/syntax/highlight.ts` 是全仓唯一的“破例特权语法”：它寄宿在 `src/syntax/` 下，但 `AGENTS.md` 明文规定“`src/syntax` 只保留注册协议，不承载具体功能”。
- 技术上，`==highlight==` 是为了扩展 Lezer Markdown AST 而编写的 `parseInline` 扩展（`MarkdownConfig`）。在现实中，它已经被 `editor.tsx` 默认绑定，并被 `core/inline-preview.ts` 和 `features/table/` 作为内置基础内联标记直接依赖。

#### (2) 改造实施方案
- **位置迁移**：将分词解析器 `highlightMarkdown` 及算法 `matchHighlight` 迁入 **`src/core/highlight.ts`**（作为 core 的基础 Markdown 扩展）。
- **净化 `src/syntax/`**：`src/syntax/` 目录下仅保留注册协议（`MossCustomSyntax`、`defineMossSyntax`、`registerMossSyntax`），彻底兑现“仅作为注册中心”的架构定位。
- **内部消费方改造**：`editor.tsx:61`（`import { highlightMarkdown }`）与 `features/table/index.ts:28`（`import { matchHighlight }`）的导入路径同步改为 `../core/highlight` / `../../core/highlight`。

#### (3) 兼容性边界：`mossmd/syntax/highlight` 子路径的真实处置

原文写“在 `src/index.ts` 中继续导出 `mossHighlightMarkdown` 即可保持兼容”，**这只兜住了根入口，不成立**。该子路径实际被四处正式登记，是全仓公开契约的一部分：

| 位置 | 登记内容 |
|---|---|
| `package.json` `exports["./syntax/highlight"]` | 指向 `dist/syntax/highlight.js` |
| `AGENTS.md:60` | 公开入口清单 |
| `docs/architecture.md:118` | 子路径清单 |
| `README.md` | 无（README 未列出该子路径，属漏登记） |

**决定（二选一，必须明确写死）**：

- **方案 A（推荐，非破坏性）**：保留 `exports["./syntax/highlight"]` 这个 key 不变，仅把 target 改指向 `dist/core/highlight.js`。消费方 `import { mossHighlightMarkdown } from 'mossmd/syntax/highlight'` 零改动即可继续工作。同步更新 `AGENTS.md` 与 `docs/architecture.md` 中的路径描述。**代价**：`mossmd/syntax/highlight` 这个名字变成"历史别名"，与"目录即导出"原则略有出入。
- **方案 B（破坏性）**：删除该子路径，`==highlight==` 仅通过根入口 `mossHighlightMarkdown` 与 `mossmd/core/highlight` 暴露。需发 major 版本并在 CHANGELOG 中标注。

本文后续实施路径以**方案 A** 为准。方案 B 的收益（少一个别名）不足以抵消破坏下游构建的成本。

> **顺带修正**：`README.md` 的公开入口表格（"`mossmd/syntax` | 自定义语法注册协议"）从未登记 `mossmd/syntax/highlight`，说明文档与 `package.json` 已经漂移。本次改造应把子路径清单收敛为单一来源（见第五节）。

---

### 2. 列表（List）模块瘦身合并与原生 atomicRanges 替代

#### (1) 现状与痛点
当前列表系统被拆成了 3 个小文件（`list-model.ts` 185 行、`list-editing.ts` 310 行、`list-navigation.ts` 296 行，合计 **791 行**）：
- **概念割裂**：一个列表回车延续或光标跳转，需要在这 3 个文件之间互相导入数十个细碎 helper 与类型。
- **手写拦截过重**：在 `list-navigation.ts` 中，为了防止光标在被 `replace({})` 隐藏的列表结构缩进中逐格“空走”，手写了 `listStructurePlugin`，并在最高优先级 keymap 中手动拦截 `ArrowLeft` 和 `ArrowRight`（调用 `skipListStructure` 和 `moveByChar` 去强行算新坐标）。
- **辅助函数重复**：`nearestListItem` / `sameListItem` 在 `list-navigation.ts:23,30` 与 `inline-preview.ts:262,277` 各有一份实现，逻辑相同但独立演化。

#### (2) 改造核心：使用 CM6 原生 `atomicRanges` 替代手写键盘拦截

**原生方案（已核对 CM6 实现）**：
CodeMirror 6 通过 **`EditorView.atomicRanges`** Facet 声明原子范围，其类型为 `Facet<(view: EditorView) => RangeSet<any>>`。关键在于 `@codemirror/view` 的 `skipAtomicRanges` 仅在 `from < pos < to`（严格内部）时把光标吸附到边界——因此若只把**隐藏缩进** `[lineFrom, contentFrom)` 声明为原子范围，则：

- 光标从上一行右移进入缩进区 → 一次跨到 `contentFrom`（marker 左边界），符合预期；
- 光标停在 marker 左边界再左移 → `pos === from` 不触发吸附，正常跨行到上一行末尾，符合预期。

**CM6 内部消费点（均已确认调用 `skipAtomicRanges`）**：
- `EditorView.moveByChar` → `skipAtoms(...)`（`@codemirror/view` 内部）
- `EditorView.moveVertically` / `moveByGroup` 同样包裹 `skipAtoms`
- `applyDOMChange` 的 `userEvent === "select.pointer"` 分支 → `skipAtomsForSelection`
- `MouseSelection` 构造函数 → `this.atoms = view.state.facet(atomicRanges)...`
- `@codemirror/commands` 的 `deleteBy` → `skipAtomic(target, towards, ...)`

#### (3) 直接收益与真实行数核算

原文称"省去约 60~80 行胶水代码"。核算如下——**`listStructurePlugin` 不能删**，它是原子范围的产出方，只是改为通过 facet 暴露。

同时见 (4).2：`ArrowLeft` 的跨行语义**无法纯靠 atomic 复现**，若选择保留薄守卫（方案 b），净收益相应下降：

| 项 | 方案 a（全交 atomic） | 方案 b（保留跨行守卫） |
|---|---:|---:|
| 删除 `moveListHorizontally`（`:162-198`） | −36 | −36 |
| 删除 `skipListStructure`（`:94-123`） | −30 | −30 |
| 新增薄 `ArrowLeft` 跨行守卫（仅 `contentFrom` 左移） | 0 | +14 |
| 删除 ArrowLeft/ArrowRight keymap 条目 | −10 | −4（仅删 ArrowRight） |
| `listStructurePlugin` 保留（改造为 facet provider） | 0（约 60 行原地保留） | 0 |
| 新增 `EditorView.atomicRanges.of(...)` + plugin 提升 | +6 | +6 |
| **净收益** | **约 −70 行** | **约 −50 行** |

> **倾向方案 b**：方案 a 会让"从嵌套 marker 起点按一次左键回到上一行"变成需要按两次，这是**可感知的手感退化**，且会弄红一条已有测试。省 20 行的收益不值得换这个回归。

#### (4) 迁移的真实副作用面（已用探针实测，含两项对原论证的更正）

以下结论来自一次临时探针测试（挂载 `inlinePreview()` + 手工声明 `[lineFrom, contentStart)` 为 atomic，样品 `'1. parent\n    2. child'`，随后删除探针）。**其中两项推翻了本文早前的表述**，实施前必须按实测结果对待。

1. **退格键（Backspace）—— 风险成立，但原描述夸大**。
   - 实测（atomic）：`'1. parent\n    2. child'` → `'1. parent\n2. child'`。**4 个空格缩进被一次吞掉**。
   - 实测（无 atomic 基线）：→ `'1. parent\n  2. child'`，逐字符删除。
   - ⚠️ **更正**：原文（及本节初稿）称"把整段隐藏缩进 **+ 换行** 一次删掉"——**换行未被删除**。原因是原子范围是 `[lineFrom, contentStart)` = `[10, 14)`，即 4 个空格；换行在第 9 位，落在原子之外，故不受影响。
   - **善后**：强化 `deleteEmptyOrderedListMarkerBackward`（`core/edit-helpers.ts:374`，由 `list-editing.ts:302` 绑定）。需扩展覆盖"正文起点退格"这条新路径——当前它只处理整行仅剩标记的情形（`/^\s*\d{1,9}[.)]\s*$/`），无法拦住 `正文起点` 的缩进吞噬。

2. **🔴 `ArrowLeft` 跨行 —— 现有测试会失败（本节初稿判断错误，这是最重要的一条）**。
   - 现状（手写 `skipListStructure`）：从嵌套 marker 起点按一次左键，光标**一次**跨到上一行末尾。
     已有测试 `list-editing.test.ts`（"moves left from a nested marker start to the previous line end"）断言：从 markerFrom 按一次 → `'1. parent'.length`。
   - 实测（atomic）：从 `contentStart` 连续左移得到 `[10, 9, 8, 7, 6]`——**第一次落在 10**（原子左边界 = 该行物理起点），**第二次才到 9**（上一行末尾）。
   - ⚠️ **更正**：本节初稿称"`pos === from` 不触发吸附，正常跨行到上一行末尾，符合预期"——**不成立**。从原子内部左移时，`skipAtomicRanges(bias=-1)` 会吸附到 `from`（=10），而 10 是行的物理起点，**不是**上一行末尾；要再按一次才跨过换行。**该测试会红。**
   - **必须决策**（二选一，不可含糊）：
     - **(a) 接受多按一次**：更新该测试的期望，并在文档/CHANGELOG 说明行为变化（破坏现有手感）。
     - **(b) 保留一层薄 `ArrowLeft` 守卫**：仅处理"光标位于 `contentFrom` 且左移"的情形，直接落到上一行末尾——即保留 `skipListStructure` 的**跨行**职责，仅让"陷入缩进逐格空走"由 atomic 承担。这样约省 30 行而非 70 行（见 (3) 的行数核算需同步下调）。

3. **鼠标选区吸附 —— 条件性成立**。
   - 实测：以 `dispatch({ selection })` 直接设置到原子内部（12），落点**未**被吸附（得到 12）。
   - 即吸附**只在 pointer 路径**发生：`applyDOMChange` 的 `userEvent === 'select.pointer'` 分支与 `MouseSelection` 才会调 `skipAtomicRanges`。程序化选区不受影响。
   - **验证项**：真实指针拖拽（`mousedown` 起于隐藏缩进区）确认端点吸附行为；且与 `listMarkerMouseDown`（`list-navigation.ts:235`）的手动定位叠加后，marker 点击仍落在 `markerFrom + markerLength`。

4. **`Home` / `End` / 垂直移动 —— 无需改动**。
   `cursorLineStart`（`@codemirror/commands`）直接取 `lineBlockAt().from`，**不走** atomic 管线，故 `moveListLineBoundary` 的分级语义不受影响，保留即可；`moveVertically` 走 `skipAtoms`，需确认与 `moveListVertically` 的 offset 补偿不冲突。

#### (5) IME 守卫：现状更正与改进

**原文第 5 条表述与代码不符，需更正**：

- 原文：*"所有列表按键操作严格遵循 `if (view.composing) return false;`"*
- 实测：`list-navigation.ts` 中 `composing` 出现 **0 次**——当前根本不存在该守卫。（`list-editing.ts` 有 3 处，`edit-helpers.ts` 有 3 处，但导航模块没有。）
- 且 `@codemirror/view` 的 `runHandlers` / `runScopeHandlers` 内部**没有**全局 composing 短路。

**因此改造后 IME 行为是收益而非风险**：左右键的手写拦截整体消失，IME 合成期间的左右键不再被最高优先级 keymap 捕获（拼音选字时的左右移动恢复为原生行为）。这一条应从"待保留的守卫"改写为**验收收益项**：

> ✅ 验收：中文输入法合成态下，列表行内左右方向键由 CM6 原生处理，keymap 不再拦截。

若实施中确实需要保留守卫（例如发现合成态下 atomic 吸附影响候选框定位），再按需补 `if (view.composing) return false;`，并补充对应测试。

#### (6) 模块合并方案

三文件整合为单一模块 **`src/core/list.ts`**：

- 体量估算：791 行 − 约 70 行胶水 + 约 6 行 facet 装配 ≈ **720~730 行**（非原文的 650~700）。
- 导出唯一的扩展装配函数：`listExtension()`（替代当前 `listEditingExtension()` + `listNavigationExtension()` 的双入口）。
- 对外仅暴露必要的模型与分析工具（如 `parseListLine`、`listContentStart`、`ListLineInfo`），内部私有算法彻底封装。
- **顺带消除重复**：`nearestListItem` / `sameListItem` / `listItemDepth` 统一由 `list.ts` 导出，`inline-preview.ts` 改为导入，消除两份实现。

#### (7) 测试覆盖现状（验收标准必须据此调整）

**关键发现**：不存在 `list-navigation.test.ts`。方向键 / Home 的行为测试全部混在 `list-editing.test.ts`（32 个测试）中——其中第 338-448 行覆盖 `ArrowUp`、`Home`、`ArrowDown`、`ArrowLeft`、`ArrowRight`。E2E 侧仅在 `inline-preview.spec.ts` 有 4 处方向键/Home 操作，无列表专用导航用例。

**验收标准修正**：
- `list-editing.test.ts` 32 个测试全部通过（含其中第 338-448 行的导航断言）——这是**真实的回归护栏**，不可跳过。
- **必须新增**：列表导航专项测试文件，覆盖"光标从 marker 左边界左移跨行"、"隐藏缩进区拖拽选区"、"正文起点退格不吞整段缩进"三条新路径。原文"E2E 真实键盘导航无漂移"过于笼统，无法证伪。

---

### 3. 拒绝空壳目录：单文件模块扁平化 (Flattening Single-File Modules)

在现代 ESM 架构与 `package.json` 的 `exports` 映射机制下，**“只有当模块真正由多个内部模块协同构成时，才应建立文件夹”**。为几十行代码建立单文件文件夹（如 `collab/index.ts`、`syntax/index.ts`），不仅增加了目录层级噪音，还会导致 IDE 中出现“满屏难以分辨的 `index.ts`”。

因此，针对外围支撑能力，推行**单文件模块扁平化**：

#### (1) 代码语言清单：`src/code-languages.ts`
- **调整**：直接扁平化为单文件 `src/code-languages.ts`，不再设立只有单个 `index.ts` 的空壳文件夹。
- **导出映射**：`mossmd/code-languages` 1:1 映射到 `dist/code-languages.js`。

#### (2) 语法注册协议：`src/syntax.ts`
- **调整**：在 `highlight.ts` 收归 core 后，原 `src/syntax/index.ts`（仅 57 行）直接扁平化为顶层单文件 `src/syntax.ts`。
- **导出映射**：`mossmd/syntax` 1:1 映射到 `dist/syntax.js`。

#### (3) 协同抽象接口：`src/collab.ts`
- **调整**：原 `src/collab/index.ts`（仅 20 行定义 `CollabAdapter` 接口）直接扁平化为 `src/collab.ts`，消除冗余空目录。
- **导出映射**：`mossmd/collab` 1:1 映射到 `dist/collab.js`。

#### (4) 主题基底：`src/theme.ts`
- **调整**：原 `src/theme/index.ts` 扁平化为单文件 `src/theme.ts`。
- **为什么 Theme 不需要文件夹？**
  - **核心原理**：MossMD 的主题架构基于 **CSS 自定义属性（`--moss-*`）与属性驱动**（如 `<div data-theme="blue">`），而非通过 JS 运行时动态切换不同的 CodeMirror Theme 实例。
  - **单一通用基底**：`mossTheme` 与 `mossSyntax` 在 CodeMirror 层面只负责一件事——将所有编辑器元素与语法 Token 的颜色、字体全面绑定到 `--moss-*` 变量。
  - **未来扩展方式**：未来无论扩展多少种明暗、色系主题，全部通过 CSS（如 `tokens.css`）中的变量覆写完成，CodeMirror 内部根本不需要维护 `darkTheme.ts`、`lightTheme.ts` 等多个 JS 实例。因此 TS 侧永远只需要这一份通用的基底，单文件 `src/theme.ts` 即可终身满足需求。

#### (5) 图标生态：`src/icons/`（唯一保留目录）
- **保留依据**：图标生态由两部分组成：
  1. `src/icons/index.ts`：定义 `MossIconMap` 语义 key、`MossIconRenderer` 协议与通用创建函数（对应 `mossmd/icons`）；
  2. `src/icons/lucide.ts`：负责可选的 Lucide 适配器（对应 `mossmd/icons/lucide`）。
- **效果**：该目录拥有真正的多模块分工（协议层 + 可选外置适配器），保留文件夹名副其实。

#### (6) `src/core/` 内不参与扁平化的单文件（避免误伤）

"单文件即扁平"原则**只适用于顶层外围支撑模块**，不适用于 `core/` 内部。`core/` 是一个内聚目录，其成员按职责而非按导出入口组织，拆成扁平顶层文件反而会破坏 core 的边界感。以下文件保持原位：

| 文件 | 行数 | 说明 |
|---|---|---|
| `core/markdown-context.ts` | 18 | `isLineInsideMarkdownCode`，被 `inline-preview.ts`（:322、:422）与 `list-editing.ts`（:37、:122）依赖 |
| `core/decoration-utils.ts` | 约 30 | `pushReplace` |
| `core/tree-progress.ts` | 134 | Lezer 解析进度广播 |
| `core/read-only.ts` | — | 阅读模式 facet |
| `core/preview-activity.ts` | 223 | 焦点状态、冻结、链接命中 |
| `core/preview-widgets.ts` | 416 | 任务复选框、复制按钮、Bullet widget |
| `core/edit-helpers.ts` | 391 | 标点归一化、加粗配对、退格守卫 |

> ⚠️ **原文遗漏**：`core/markdown-context.ts` 在此前的目录规划中完全缺失。它虽小（18 行），但被 core 与 list 双方依赖，必须显式列入目标树——否则"1:1 镜像对齐"的第一原则自身就漏了一个模块。

---

### 4. `editor.tsx` 架构解耦（引擎装配 vs React 外壳）

#### (1) 现状分析
- `editor.tsx` 目前 **885 行 / 30219 字节**。它混杂了纯 CM6 Extension 编排逻辑（Compartment 分配、自定义语法合并、各 feature 装配）和 React 状态挂载胶水逻辑。
- **结构构成**（按行号实测）：
  | 区段 | 行号 | 内容 |
  |---|---|---|
  | 类型与常量 | 1-98 | import、`MossMDHandle`、`MossMDProps` |
  | React 组件 | 308-733 | `MossMD()` 主体（含 config 归一化、Compartment ref、挂载 effect） |
  | Initial reveal | 735-885 | `setInitialReveal`、`initialRevealField`、`findInitialRevealRange`、`buildRevealCandidates`、`scrollMatchNearTop`、`findScrollParent` |

#### (2) 改造方案

**必须明确"什么算外壳"**——原文只提"装配工厂"，但按 34 字节/行折算，8~10KB 目标 ≈ **235~295 行**，而 `editor.tsx` 的 React 组件体本身就有约 415 行（含大量 config 归一化），**不额外划走 Initial reveal 就达不到目标**。

| 迁出内容 | 去向 | 估算 |
|---|---|---|
| CM6 扩展编排（Compartment、feature 装配、自定义语法合并） | `src/core/setup.ts` → `createMossExtensions(options)` | 约 −250 行 |
| **Initial reveal 整段（735-885）** | `src/core/reveal.ts`（纯 CM6 逻辑，与 React 无关） | 约 −150 行 |
| Compartment 实例管理（`readOnlyCompartmentRef`、`searchCompartmentRef`） | `setup.ts` 内聚为 `MossSetupHandle` | 约 −20 行 |

**`editor.tsx` 保留部分**（外壳职责）：
- DOM 挂载与 `rootRef`；
- `useRef` 句柄暴露（`MossMDHandle` 的实现，转发到 setup 返回的 controller）；
- React props → options 的归一化（`resolvedImagesConfig`、`resolvedFileBlocksConfig` 等 `iconMap` 合并，见 :362-372）；
- props 变化时的 `dispatch({ effects: compartment.reconfigure(...) })` 微量同步；

**目标体量**：885 − 420 ≈ **465 行 / 约 16KB**。

> ⚠️ 原文"8~10KB"偏乐观。除非把 props 归一化也搬进 setup（但那样 setup 就要理解 React props 的形状，反而加重耦合），否则 **14~17KB** 是更现实的目标。建议把验收标准改为"低于 500 行 / 17KB"，而非追逐 10KB 这个数字。

**验收**：`editor.test.tsx` **52 个**测试零改动通过。

> ⚠️ **测试计数务必以 vitest 输出为准，不要 grep 源码**。`editor.test.tsx` 含两处 `it.each([...])` 表（:1217、:1231），会被展开成多个用例；用 `grep -c 'it('` 会数出 47 而非真实的 52，进而误判为"丢了测试"。**权威来源：`bun run test` 的 `Tests N passed` 行。**

---

### 5. `inline-preview.ts`：评估结论为**不拆分**（决策记录）

本节曾规划把 `inline-preview.ts`（1190 行 / 44755 字节）拆为 `preview-hr.ts` + `preview-list.ts` + `preview-inline.ts`，将其压到 450~500 行。**经逐行核对，该方案已否决**——以下是存档的否决理由，供未来重新评估时参考，不作为待办项。

#### (1) 否决理由一：拆分买不到任何体积收益

原论证把该文件称为"体积瓶颈"（gzip 12.8KB，占纯 `core/` 的约 44%），这个**比例**没错，但推不出"拆了变小"：

- 当前构建是 `tsc` 1:1 ESM 直出，**模块数量不影响产物体积**；
- 即便将来引入 tsup，这三个模块也始终被 `inlinePreview()` 一同引用——**没有任何消费方会只取其一**。没有切割边界就没有可剔除的代码。

拆分唯一可能的收益是人的可读性。而体积（本计划第四节的量化目标）不受影响。

#### (2) 否决理由二：遍历状态耦合，`return` 语义是真实风险

`tree.iterate` 的 `enter` 回调（:397-850）不是一组独立分支，而是**共享可变状态的前序遍历**：

| 状态 | 写入方 | 读取方 |
|---|---|---|
| `activeLines` | `FencedCode` 分支 **:440 `activeLines.add(n)`** | :434、:498、:501、:551、:558、:751、:828 |
| `activeLinkStarts` | `Link` 分支 :452 | :496、:524 |

即 `FencedCode` 在遍历途中改写 `activeLines`，之后**所有** `ListMark` / `HIDEABLE_SYNTAX` / `Escape` / `HorizontalRule` / `TaskMarker` 分支的行为都取决于这次改写；`activeLinkStarts` 同理，依赖 `Link` 先于其子节点被访问。

叠加两项语义陷阱：

1. **`return false` 跳过整棵子树**，裸 `return` 只结束本次回调。回调内共 **4 处 `return false`**（:405、:413、:417、:426 —— 分隔线守卫与 `Link` 的 wiki / callout / task 三个跳过）与 4 处裸 `return`（:569、:666、:780、:781）。分发层若未正确透传，wiki 链接 / callout / 任务标记的 `Link` 节点将不再被跳过，其子节点被重新处理。
2. **`ranges` 的 push 顺序**影响同位置多装饰的稳定性（`Decoration.set(ranges, true)` 只按位置排序）。

这些都属于**类型检查无法发现、只有实际渲染才暴露**的静默回归。

#### (3) 否决理由三：目标路径的测试覆盖不足，改动缺乏护栏

| 检查项 | 结果 |
|---|---|
| `inline-preview.ts` 专属测试文件 | **不存在**，全靠 `editor.test.tsx` 间接覆盖 |
| `wiki-links.test.tsx` 是否挂载 `inlinePreview()` | **否** —— 仅组装 `wikiLinks()` + `previewActivityExtension()`，**测不到** `isWikiLinkNode` 那条 `return false` |
| callout 测试文件 | **不存在**；无任何测试 import `mossCallouts` |
| 现有兜底 | `editor.test.tsx` 有 `> [!NOTE]` 用例（:1125、:1149、:1164、:1205） |

结论：在补足用例之前动手，很可能**测试全绿而回归上线**。

#### (4) 保留的例外：`preview-hr.ts` 可选（低价值，非必做）

`inline-preview.ts:80-166` 的分隔线相关代码（`ParsedHorizontalRule`、`parseExtendedHorizontalRule`、`isPlainHorizontalRule`、`HorizontalRuleWidget`、`horizontalRuleClassNames`、`pushHorizontalRuleWidget`，约 90 行）经核对**全部为显式传参的纯函数**，不闭包任何遍历状态，只依赖 `pushReplace` 与 `Decoration` 类型——搬出为零语义风险。

但收益同样有限（1190 → 约 1100 行），**因此不列入任何 Phase**。若将来因其他原因需要触碰这段代码，可顺手抽离。

#### (5) 若未来重启此拆分，前置条件

1. **先补用例，再动手**：wiki `[[x]]`、callout `> [!note]`、自定义任务标记 `- [!]` 在**非活跃行**的源码隐藏行为，必须写成**挂在 `inlinePreview()` 全量装配下**的断言（当前的 `wiki-links.test.tsx` 测不到这条路径）。
2. **遍历不可拆**：只能拆函数，不能拆 `tree.iterate`。改为多趟遍历会破坏 `FencedCode` → `activeLines` → 后续分支的顺序依赖，并让每次光标移动的树遍历成本翻倍（:381-396 的注释记录了这一历史演进）。
3. **显式传递跳过语义**：若确有拆分需求，分发层须以 `boolean | void` 返回值透传 `return false`，并保持与当前一致的 push 顺序（分隔线 → Link → FencedCode → 标记 → 隐藏 → URL → Escape → ListMark → HR → Image → TaskMarker）。
4. **动机必须是可读性**，且需重新论证——无法用体积目标为其背书。

---

## 三、 调整后的目录规划对比（扁平直观架构）

```text
src/
├── __tests__/                  # 单元与 DOM 契约测试
│
├── core/                       # 👈 纯粹的编辑器核心运行时与排版引擎
│   ├── inline-preview.ts       # 实时预览装配协调层 + 装饰构建（保持不拆，见二.5）
│   ├── preview-activity.ts     # 焦点状态、激活范围计算、鼠标防抖
│   ├── preview-widgets.ts      # 任务复选框、复制按钮、列表 Bullet
│   ├── markdown-context.ts     # 👈 (补录) isLineInsideMarkdownCode 代码区判定
│   ├── decoration-utils.ts     # 装饰构建安全切分工具
│   ├── edit-helpers.ts         # 标点归一化、加粗配对、符号二义性消除
│   ├── highlight.ts            # 👈 (收归) ==highlight== 核心内联语法扩展
│   ├── list.ts                 # 👈 (合并) 列表模型、智能编辑、atomicRanges 原生导航
│   ├── read-only.ts            # 阅读模式 Compartment 与 Facet
│   ├── tree-progress.ts        # Lezer 异步语法树增长广播
│   ├── reveal.ts               # 👈 (迁出) 初始定位高亮：StateEffect + StateField + 滚动
│   └── setup.ts                # 👈 (提炼) 纯 CM6 扩展编排工厂函数
│
├── features/                   # 用户功能特性 (真正由多个内部组件构成的子系统)
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
├── icons/                      # 👈 真正拥有主协议与适配器的模块
│   ├── index.ts                # 👈 (迁入) 语义 key 协议与 MossIconRenderer
│   └── lucide.ts               # 可选 Lucide 适配器
│
├── code-languages.ts           # 👈 (扁平单文件) 动态代码语言注册表 (mossmd/code-languages)
├── syntax.ts                   # 👈 (扁平单文件) 纯粹自定义语法注册协议 (mossmd/syntax)
├── theme.ts                    # 👈 (扁平单文件) 通用主题与高亮样式基底 (mossmd/theme)
├── collab.ts                   # 👈 (扁平单文件) 协同抽象接口 (mossmd/collab)
│
├── styles/                     # CSS 样式产物
│   ├── tokens.css
│   ├── inline-preview.css
│   └── content.css
├── editor.tsx                  # 极轻薄 React 外壳组件
└── index.ts                    # 根导出入口
```

---

## 四、 性能与引入包大小优化方向 (Performance & Bundle Size)

在类似 MossMD 这样面向生产级的 CodeMirror 6 实时预览编辑器中，**「引入包文件大小」**与**「长文档运行时性能」**是决定开发者是否集成、用户书写是否流畅的核心指标。

### 1. 引入包文件大小控制 (Bundle Size)

#### (1) 坚守零常规依赖 (Zero Runtime Dependencies)
- `package.json` 保持 `dependencies` 为空，所有 `@codemirror/*`、`@lezer/*`、`react` 全面作为 `peerDependencies`，杜绝宿主打包时产生双份底层库。

#### (2) 重型排版引擎严格外部可插拔 (Pluggable Heavy Engines)
- **数学公式**：核心仅负责行内/块级 `$...$` 语法识别与容器占位，不打包排版引擎。宿主通过 `mathConfig.render` 注入 KaTeX（KaTeX 自身压缩后超 250KB + 字体），主包零膨胀。
- **图标生态**：`lucide-react` 作为可选依赖（`mossmd/icons/lucide`），宿主不引入就不产生打包体积。
- **动态按需代码语言包**：`code-languages.ts` 坚持动态 `import()`，围栏语言语法按需加载。

#### (3) 现代轻量化打包构建 (Lightweight Bundler)
- 目前采用纯 `tsc` 进行 1:1 ESM 转译。后续评估引入 `tsup`（底层 esbuild 已作为 vite 传递依赖存在于 `node_modules`），在保持细粒度子路径导出与完整类型的同时开启变量压缩与 DCE。
- **⚠️ 收益口径必须修正**：原文"预计纯 JS 体积可缩减 40%~50%"混淆了两种度量。
  - **未压缩体积**：minify 后缩减 40~50% 是合理的（标识符压缩 + 空白消除）。
  - **gzip 后体积**：gzip 已经吃掉了大量重复标识符，minify 的边际收益通常只有 **10~20%**。
  - 基线：全量 JS 拼接 gzip **86977 字节**；即使 minify 省 15%，也只降到约 74KB。
  - **结论**：若对外宣传"包体积缩减"，必须写明口径。建议表述为"未压缩体积缩减 40%+，gzip 传输体积缩减 10~20%"。

#### (4) ⚠️ 体积目标的自相矛盾（必须解决）

原文第四节写"主包（Core）JS 运行时大小保持极度克制（gzip 后 < 35KB）"，但实测数据与之冲突：

| 度量 | 实测（gzip） |
|---|---|
| 纯 `core/` 模块 | 28934 字节 |
| `editor.js` | 6393 字节 |
| **根入口静态可达全量** | **81485 字节** |
| 全量（含未被根入口引用的 callout/math） | 86977 字节 |

**根因**：`src/index.ts` → `editor.tsx` **静态 import 了 7 个 feature**（image、file-blocks、table、wiki-links、slash-commands、search、upload，见 `editor.tsx:56-84`）。只要这些是静态引用，tsup 的 DCE **一个都删不掉**。逐 feature 的 gzip 占用：

| feature | gzip | 未压缩 |
|---|---:|---:|
| `table` | 15471 | 56006 |
| `image` | 8323 | 32581 |
| `upload` | 6847 | 28337 |
| `slash-commands` | 5829 | 19060 |
| `wiki-links` | 5472 | 21768 |
| `file-blocks` | 5047 | 19110 |
| `search` | 1398 | 4798 |

**三个可选路线**（原文未选，导致目标悬空）：

- **路线 A（保守，不改架构）**：把目标改为"纯 core gzip < 30KB"，并明确 `<35KB` 指的是 **"不含任何 feature 的 core-only 子集"**。当前 28934 字节已接近达标，无需架构改动。
- **路线 B（激进，真正瘦身）**：把 feature 从 `editor.tsx` 的默认装配中移除，改为消费方显式组合（`<MossMD features={[mossTables(), mossImages()]} />`）。可达体积降至约 28934 + 6393 ≈ **35KB**。**代价**：破坏性 API 变更 + 消费方改动 + demo/harness 全部要改。
- **路线 C（折中）**：保留默认装配，但把 `table`（15471 字节，最重）与 `upload`（6847）标为可选，其余保持默认。

**建议**：本期选 **路线 A**（与"无破坏性、零回归"原则一致），把路线 B 作为独立 follow-up 立项。若要保留 `<35KB` 这个数字，必须显式注明其口径为 core-only。

#### (5) 关于 CSS 样式的架构定论（保持一体化，不进行分包）
- **定论**：**明确不推行 CSS 细粒度分包**。
- **原因**：
  1. Markdown 文档的输入内容具有不可预测性（用户随时可能复制粘贴复杂表格或数学公式进文档）；
  2. 若将 CSS 分割为各个 feature，一旦宿主应用遗漏某个样式引入，会导致文档局部排版彻底崩塌，迫使应用频繁重新打包；
  3. 整体 CSS 经 gzip 压缩后体积有限，分包维护成本极高而体积收益微弱。
- **实测数据**（原文仅写"仅数 KB"，现补精确值）：

  | 文件 | 未压缩 | gzip |
  |---|---:|---:|
  | `inline-preview.css` | 69174 | 15952 |
  | `content.css` | 6458 | 1603 |
  | `tokens.css` | 7059 | 1789 |
  | **合计** | **82691** | **18249** |

  > 注意 `inline-preview.css` 单文件 gzip 就近 **16KB**，已接近"数 KB"的 4 倍。结论（不拆包）依然成立，但论证依据应改成"拆包也无法消除这份体积——表格/公式的样式属于内容排版，不是可选功能"，而非"体积本就很小"。

  因此，CSS 继续保持开箱即用的一体化输出（`editor.css`、`content.css`、`tokens.css`）。

---

### 2. 运行时性能与长文档优化 (Runtime Performance)

#### (1) 视口优先计算与异步 AST 推进 (Viewport-First Invalidation)
- 避免在超长文档加载时因全量 `ensureSyntaxTree` 产生 200ms 级的 UI 阻塞。
- 首屏优先保证当前视口及临近缓冲行的解析与装饰构建；超视口内容委托给后台异步微任务（`treeProgressPlugin`）增量推进，实现万行 Markdown 毫秒级立即可写。

#### (2) Widget 尺寸记忆与防抖动缓存 (Height Map Cache / Zero Jitter)
- 复杂的公式块或大表格向上滚出视口被 DOM 回收后，向下回滚重新挂载时会引发 CM6 HeightMap 重新测高，容易产生细微跳动（Scroll Jitter）。
- 建立 Widget 真实渲染高度缓存，二次唤醒时直接带上对应 `min-height` 占位，消除重排（Reflow）引发的滚动跳跃。

#### (3) 输入流与中文 IME 合成期性能守卫 (IME Pipeline Guard)
- 在 `view.composing === true` 期间，彻底冻结所有后台高开销运算（列表重新编号、全文档 Wiki 链接扫描、表格重序列化），仅在 `compositionend` 之后统一触发一次。
- 单元格打字引入微任务批处理（Microtask Batching），避免高频按键重复触发全表重序列化。

---

### 3. 量化性能目标

- **包体积指标**：**core-only 子集** gzip < 30KB（当前 28934 字节，已接近达标）；根入口全量 gzip 目标 ≤ 82KB 不再增长。重型外设 100% 可插拔。
- **首屏挂载指标**：万行长文档首屏可交互时间 (TTI) < 50ms。
- **滚动体验指标**：含复杂公式与宽表格的长文档高速滚动，实现零布局抖动（Zero Layout Shift）。
- **打字帧率指标**：中文/英文持续高速输入期间，保持稳定的 60fps 帧率（零掉帧）。

> **⚠️ 关于全局 `ensureSyntaxTree(state, doc.length, 200)`**：当前有 **8 处**调用点以 200ms 预算强制解析全文档——`inline-preview.ts:311`、`list-navigation.ts:38`、`image/index.ts:240,776`、`table/index.ts:1480`、`file-blocks/index.ts:109,397,461`、`tree-progress.ts:115`。
>
> 这套"全文档装饰 + 全文档解析"的设计是**有意的**，且注释中已说明原因（`inline-preview.ts:296-311`）：早期按视口重建装饰在 iOS 上会导致滚动惯性中断。因此第四节 (1) 提出的"视口优先、超视口委托异步"**不是简单的性能优化，而是一次架构回退**——必须同时解决当初驱动该设计的 iOS 滚动锚点问题，否则会引入已修复过的回归。
>
> **建议**：此项从 Phase 4 移出，单独立项并附 iOS 真机回归验证，不与 `tsup`/IME 等低风险项混在同一阶段。

---

## 五、 实施路径与验证阶段

> 每个 Phase 完成后必须执行完整回归：`bun run typecheck && bun run test`（**189 个单元测试 / 13 个文件**）以及 `bun run test:package`（打包与干净消费方构建）。

| 阶段 | 任务内容 | 风险等级 | 验证标准 |
|:---:|---|:---:|---|
| **Phase 1** | **单文件扁平化与高亮收归 Core**<br>• `syntax/highlight.ts` 迁入 `src/core/highlight.ts`（**`exports["./syntax/highlight"]` 改为指向新路径，保持 key 不变**）<br>• `src/syntax/index.ts` 扁平化为 `src/syntax.ts`<br>• `src/core/code-languages.ts` 扁平化为 `src/code-languages.ts`<br>• `src/collab/index.ts` 扁平化为 `src/collab.ts`<br>• `src/theme/index.ts` 扁平化为 `src/theme.ts`<br>• `src/core/icons.ts` 迁入 `src/icons/index.ts`<br>• 补录 `core/markdown-context.ts` 到文档与目标树 | 🟢 低 | `bun run typecheck`、`bun run test:package` 全过；`import { mossHighlightMarkdown } from 'mossmd/syntax/highlight'` 零改动可用；外部 import 零破坏 |
| **Phase 2** | **List 瘦身合并与 atomicRanges 替代**<br>• 合并三文件为 `src/core/list.ts`<br>• 引入 `EditorView.atomicRanges`，**按二.2(3) 选择方案 a 或 b**（推荐 b：保留 ArrowLeft 跨行薄守卫）<br>• 扩展 `deleteEmptyOrderedListMarkerBackward` 覆盖"正文起点退格"<br>• 统一 `nearestListItem` / `sameListItem` / `listItemDepth` 到 `list.ts` | 🟡 中 | 见下方 Phase 2 专项验收清单 |
| **Phase 3** | **`editor.tsx` 装配工厂函数提炼**<br>• 提炼 `src/core/setup.ts`（`createMossExtensions`）<br>• 迁出 Initial reveal（:735-885）→ `src/core/reveal.ts`<br>• Compartment 实例内聚为 setup 句柄 | 🟡 中 | `editor.test.tsx` **52 个**全部零改动通过；`editor.tsx` 降至 **< 500 行 / 17KB** |
| **Phase 4** | **构建调优（低风险部分）**<br>• 评估 `tsup` 压缩构建与无损 DCE<br>• IME 合成期性能守卫<br>• Widget 高度缓存防抖 | 🟡 中 | 未压缩体积缩减 40%+；**gzip 传输体积缩减 10~20%**；打包体积口径在文档中写明 |
| **Phase 5（独立立项）** | **视口优先 AST 与装饰失效重构**<br>• 全文档 `ensureSyntaxTree`（8 处调用点）改为视口优先<br>• 超视口装饰委托异步推进 | 🔴 **高** | 万行文档 TTI < 50ms；**iOS 真机滚动惯性不回归**（此项须先复现并解决原 `inline-preview.ts:296-311` 记录的锚点问题，方可动工） |

> **已否决、不在表中**：`inline-preview.ts` 拆分（详见二.5）。原方案列为高风险的 Phase 3，经核实无体积收益、且遍历状态耦合与测试覆盖不足构成静默回归风险，故整项取消。

### 阶段依赖说明

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
（无依赖）   （列表收敛）  （独立）     （独立）

Phase 5 独立立项，不与上述任何阶段并行
```

- **Phase 1 → Phase 2 → Phase 3 为推荐顺序**：Phase 1 先统一四处路径映射表，Phase 2 收敛列表边界，Phase 3 再动 `editor.tsx` 的装配层——前者为后者扫清路径与模块边界。
- **Phase 4 可与其他阶段并行**：只涉及构建配置与输入链路，不改源码结构。
- **Phase 5 不可与 Phase 4 合并**：Phase 4 是低风险构建/输入优化，Phase 5 是可能引入已修复回归的架构回退，混在一起会让高风险项借低风险项的"通过"蒙混过关。

### Phase 2 专项验收清单（atomicRanges 迁移）

以下全部为**实测数据支撑**的必检项（来源见二.2(4) 的探针结果），不是推测清单：

**A. 必须保持不变的既有行为（回归护栏）**

| # | 用例 | 现状期望 | 来源 |
|---|---|---|---|
| A1 | 从嵌套 marker 起点按 **1 次** `ArrowLeft` | 光标到 `'1. parent'.length`（上一行末尾） | `list-editing.test.ts` "moves left from a nested marker start to the previous line end" |
| A2 | 从嵌套 marker 末尾连续 `ArrowLeft` ×4 | `[end-1, end-2, parent.length, parent.length-1]` | 同上 "skips hidden nested-list indentation when moving left" |
| A3 | 从上一行末尾按 `ArrowRight` | 直接进入嵌套正文（`doc.indexOf('1. child')`），不停在隐藏缩进 | 同上 "enters nested ordered-item text without stopping in hidden indentation" |
| A4 | `Home` / `End` 在有序列表行内分级跳转 | 内容起点 → 行物理起点 | 同上 "moves Home and End within the current ordered-list source line" |
| A5 | `ArrowUp`/`ArrowDown` 跨列表项保持正文列偏移 | 相对 `contentFrom` 的 offset 不变 | 同上 "keeps upward movement…" / "keeps vertical movement in the body column…" |

> **A1 是 Phase 2 的成败判定点**。实测 atomic 方案下从 `contentFrom` 左移序列为 `[10, 9, ...]`——第一次停在行物理起点而非上一行末尾，**A1 会红**。故必须在二.2(3) 的**方案 b**（保留薄跨行守卫）与**方案 a**（更新 A1 期望并记录手感变化）之间显式选择；推荐 b。

**B. 必须新增的用例（覆盖新引入的路径）**

| # | 用例 | 期望 |
|---|---|---|
| B1 | 光标在嵌套正文起点（`contentFrom`）按 **Backspace** | **不得**一次吞掉全部缩进（当前实测会被吞 4 空格） |
| B2 | 隐藏缩进区内的**真实指针拖拽**（`mousedown` 起于缩进） | 选区端点吸附行为符合预期；`listMarkerMouseDown` 定位仍落在 `markerFrom + markerLength` |
| B3 | 中文 IME 合成态下按 `ArrowLeft`/`ArrowRight` | 由 CM6 原生处理，keymap 不拦截（**收益项**，见二.2(5)） |
| B4 | 从 `contentFrom` 按 `ArrowRight` 与按 `ArrowLeft` 的对称性 | 不产生"进得去、出不来"或反之的不对称 |

> **B2 说明**：探针显示**程序化**选区（`dispatch({ selection })`）落在原子内部时**不会**被吸附，吸附只发生在 pointer 路径（`applyDOMChange` 的 `select.pointer` 分支与 `MouseSelection`）。因此 B2 **必须用真实指针事件**验证，不能用 `dispatch` 模拟——否则会得到假阳性。

**C. 实施纪律**

- 探针已删除，未留痕；B1–B4 应作为**正式测试**写进 `list-editing.test.ts` 或新建 `list-navigation.test.ts`，而非依赖手工验证。
- 全部改动以 `bun run test`（**189 个**）输出为准，不以 grep 源码计数。


### 文档与配置的单一来源收敛（Phase 1 的前置动作）

扩展路径的实际登记处有 **4 张互相漂移的表**，Phase 1 改动前应先对齐：

| 位置 | 非 CSS 条目数 | 已确认缺失（相对基准） |
|---|---:|---|
| `package.json` `exports` | **17** | — （最完整，作为基准） |
| `vite.config.ts` `resolve.alias` | **12** | `mossmd/icons/lucide`、`mossmd/features/upload`、`mossmd/features/math`、`mossmd/features/search`、`mossmd/syntax/highlight` |
| `tsconfig.json` `paths` | **13** | `mossmd/features/math`、`mossmd/features/search`、`mossmd/features/slash-commands`、`mossmd/syntax/highlight` |
| `README.md` 公开入口表 | **6** | `mossmd/syntax/highlight`、`mossmd/theme`、`mossmd/icons`、`mossmd/icons/lucide` 及全部 `mossmd/features/*` 单子路径 |

**基准（`package.json` 的 17 个非 CSS 子路径）**：`.`、`code-languages`、`theme`、`features`、`features/{image,table,wiki-links,callout,slash-commands,upload,math,search}`、`icons`、`icons/lucide`、`collab`、`syntax`、`syntax/highlight`。

> 四表中没有任何两张完全一致：`vite` 缺 5 项，`tsconfig` 缺 4 项，`README` 缺 8 项。当前能正常工作是因为 `features/upload`、`features/math` 等未被 demo 直接 import，而 `demo/App.tsx` 用到的 `mossmd/icons/lucide` 靠 alias 未命中时的回退解析兜住——一旦 Phase 1 大规模改路径，这些隐性缺口会变成硬报错。
>
> **建议**：Phase 1 之前，以 `package.json` 为准，把 `vite.config.ts` / `tsconfig.json` / `README.md` 三处补齐并对齐；后续任何路径改动只需改一处再同步。相关文件（`scripts/test-package.mjs`、`vitest.config.ts`、以及内联 `mossmd/features/*` 的 `demo/App.tsx`、`demo/custom-upload.ts`）同批检查。



