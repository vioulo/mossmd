# 列表编辑优化 TODO

本文档记录 MossMD 列表编辑和实时预览的结构性问题。目标不是继续为单个现象增加键盘特判，而是让 Markdown 源码、列表语义、视觉布局和光标移动共享同一套规则。

源码显隐的通用规则见 [`live-preview-rules.md`](./live-preview-rules.md)。列表标记属于“当前行显露”；同一行中的标准链接和 Wiki 链接属于“行内贴近显露”，不能因为列表行被激活而一起展开。

## 现状

当前列表相关逻辑分布在以下位置：

- `src/core/edit-helpers.ts`
  - 中文标点归一化
  - IME composition 期间的延迟处理
  - 空有序列表标记的 Backspace
- `src/core/inline-preview.ts`
  - `ListMark` 装饰、列表缩进和标记颜色
  - Enter 延续列表
  - 有序列表重新编号
  - 点击数字标记聚焦
  - 上下方向键兜底
- `src/styles/inline-preview.css`
  - 标记的 `inline-block` 宽度和间距
  - 活动行与非活动行的标记布局
- `src/theme/index.ts`
  - 列表标记颜色覆盖语法高亮
- `src/__tests__/edit-helpers.test.ts`
  - 输入归一化和退格逻辑
- `src/__tests__/list-editing.test.ts`
  - 列表命令、装饰、点击和部分键盘行为

当前已经处理的行为：

- `1.` 在输入空格前保持普通正文。
- `1. ` 才进入有序列表语义。
- 中文输入法产生 `1。` 时归一化为 `1.`，不自动插入空格。
- 空有序列表退格时逐字符删除。
- 活动有序列表保留源码空格，但取消额外的视觉右边距。
- 点击数字标记时直接聚焦，并将光标放到标记末尾。
- 上下移动异常时按相邻源码行兜底。

这些修复解决了已发现的现象，但其中“活动行样式调整”和“上下键兜底”仍然说明底层布局模型不够稳定。

## 核心问题

### 1. 解析器语义和编辑器语义不一致

Lezer Markdown 会把单独的 `1.` 解析为 `OrderedList/ListItem/ListMark`，因为 CommonMark 允许解析空列表项。MossMD 的交互规则却要求必须有分隔空格：

```text
1.       普通正文
1. text  有序列表
```

如果不同模块直接信任语法树，就会出现未输入空格就显示列表、默认退格一次删除整个标记等问题。

### 2. 视觉 DOM 和源码位置不一致

实时预览同时使用了：

- `Decoration.replace` 隐藏前导缩进和分隔空格；
- `Decoration.mark` 包裹数字标记；
- `display: inline-block`、固定宽度和 `margin-right` 扩展标记视觉区域；
- 活动行与非活动行不同的装饰。

CodeMirror 的点击和上下移动依赖 DOM 几何，而不是只依赖源码行号。装饰重建后，下面几种位置可能不再等价：

```text
源码位置       5. text 中的字符位置
DOM 位置       被隐藏或扩展后的可视字符位置
视觉位置       padding、text-indent、marker 宽度形成的位置
```

这解释了点击数字难聚焦、从第 5 项向上跳到列表外等问题。

### 3. 列表规则分散，存在多套判断

`parseListLine()`、语法树中的 `ListMark`、`insertTightListItem()`、`orderedListRenumberChanges()` 和装饰构建分别判断“这是不是列表”。它们对以下情况的边界容易不一致：

- `1.` 与 `1. `；
- `1)` 与 `1) `；
- 空行后的列表；
- `---` 后的列表；
- 缩进列表和嵌套列表；
- 代码块中的数字标记；
- 组合输入尚未结束时的临时文本。

### 4. 异步过程会改变光标附近的布局

当前同时存在：

- Lezer 增量解析；
- `ensureSyntaxTree()` 和 tree growth 刷新；
- IME 延迟归一化；
- 有序列表异步重新编号；
- 点击后的短暂装饰冻结。

这些过程都可能在用户输入或移动光标后重建装饰。只要重建改变了水平几何，就可能影响下一次点击、方向键或输入位置。

### 5. Wiki 链接曾被两个装饰层重复处理

用户可见的 Wiki 链接例如：

```text
Labeled: [[demo-project-atlas|Project Atlas]] · Bare: [[demo-meeting-notes]] · In code: `[[demo-project-atlas]]`
```

此前这里有两个相互重叠的处理路径：

- `src/features/wiki-links/index.ts` 用 `Decoration.mark` 包住 `[[target|` 和 `]]`，再通过 `font-size: 0`、透明颜色隐藏源码。
- `src/core/inline-preview.ts` 将 Markdown 解析器产生的 Wiki 内部 `Link` 节点当作普通 Markdown 链接，再次套用链接标记和光标附近显露规则。

Markdown 解析器对 `[[target|label]]` 的 `Link` 范围并不是完整 Wiki 范围，而是从第二个 `[` 到第一个 `]`。两个装饰层叠加后，隐藏的零字号节点仍留在 DOM 和 caret 映射中；点击后续正文（例如 `Bare` 的 `B` 或 `In code` 的 `o`）时，`posAtCoords` 可能把位置映射到前一个 Wiki 链接内部的 `]|]` 边界，于是错误地显示前一个链接源码。

当前已处理：

- [x] Wiki 非活动状态使用 `Decoration.replace({})` 移除隐藏语法的 DOM 内容，不再使用零字号隐藏。
- [x] 核心 inline preview 遇到被 `[[` / `]]` 包裹的解析 `Link` 时跳过，Wiki feature 独占该范围的预览和显露。
- [x] 活动状态仍通过 Wiki 链接自身的完整源码范围显示 `[[target|label]]`，原始 Markdown 仍只保存在 `state.doc`。
- [x] 增加后续正文点击回归测试，覆盖 `Bare` 的 `B` 和 `In code` 的 `o`，并确认前一个链接不会错误展开。

当前判断：这是与现有架构相符、风险较低的修复，足以解决本次光标落点错误；暂不为此单独重构整套预览引擎。

后续待评估：

- [ ] 将“由 feature 独占的源码范围”抽成通用协议或 facet，由 Wiki feature 注册排除范围，避免 `core/inline-preview.ts` 通过 `isWikiLinkNode()` 直接知道 Wiki 语法。
- [ ] 将标准 Markdown 链接、Wiki 链接和其他自定义行内语法统一到共享的 `nearInlineRanges` / activity 规则，避免各 feature 分别实现边界判断。
- [ ] 明确装饰归属和优先级：同一源码范围只能由一个 feature 负责隐藏、显露或生成 widget；解析器产生的重叠节点不能再次进入通用预览路径。
- [ ] E2E 环境完善后，使用真实浏览器验证 `posAtCoords`：点击链接后的普通文字、链接前后空格、方向键经过 `[[...]]` 边界，以及离开后恢复预览。
- [ ] 验证 `Decoration.replace({})` 在拖选、Backspace、Undo/Redo、远程文档更新和阅读模式切换下的源码位置稳定性。

## 结构性调整方向

### 1. 先拆开四种实时预览状态

当前代码里容易把“编辑器有焦点”“光标所在行”“光标位于链接内”和“鼠标交互冻结”混成一个激活条件。后续应明确维护以下四个独立概念：

```ts
interface PreviewActivity {
  editorFocused: boolean;
  activeLines: ReadonlySet<number>;
  nearInlineRanges: ReadonlySet<string>;
  frozen: boolean;
}
```

- `editorFocused`：源码显露的总开关。失焦和阅读模式不得仅凭残留选区显露源码。
- `activeLines`：当前选区覆盖的行，只服务于行级结构语法。
- `nearInlineRanges`：光标进入、选区相交或位于源码边界的行内范围，只服务于局部行内语法。
- `frozen`：鼠标按下到释放尾部期间保留旧装饰，不能被误当成“当前行激活”。

显隐优先级固定为：阅读模式 > 交互冻结 > 行内贴近 > 当前行激活 > 非激活预览。行内链接即使位于当前行，也不能继承 `activeLines`。

### 2. 建立语法归属表

新语法接入前必须先归类，禁止默认加入 `activeLines`：

| 归属 | 语法 | 显露范围 |
| --- | --- | --- |
| 当前行 | 标题、引用、列表、任务标记、代码围栏、水平线、Callout | 当前源码行或代码块范围 |
| 当前行 | 强调、删除线、高亮、行内代码定界符、转义符 | 当前源码行 |
| 行内贴近 | `[label](url)`、Wiki 链接 | 当前链接范围 |
| Widget 优先 | 图片、表格、文件块、上传块 | Widget 自己的编辑入口 |

标准链接和 Wiki 链接必须采用同一套范围规则：空光标在 `[from, to]` 边界内算贴近，非空选区与范围相交算贴近；不能使用整行或像素距离判断。行内代码中的 Wiki 文本属于代码，不进入 Wiki 归属。

### 3. 收敛装饰引擎的职责

建议将 `inline-preview.ts` 调整为“解析结果到装饰”的协调层，并抽出纯规则模块：

- `src/core/preview-activity.ts`：计算焦点、当前行、行内范围和冻结状态。
- `src/core/list-model.ts`：解析列表源码并提供列表上下文、编号和内容起点。
- `src/core/decoration-policy.ts`：根据语法归属决定 hide、mark、widget 或 line decoration。
- `src/features/wiki-links/index.ts`：保留 Wiki 扫描、解析和补全，但复用共享的焦点与行内范围规则。

这些模块只返回源码范围和策略，不保存第二份 Markdown。`inline-preview.ts` 仍负责组装 CodeMirror 装饰，但不再为每个语法重复判断“当前行是否激活”。

### 4. 先稳定源码几何，再处理导航特判

列表标记、缩进和分隔空格必须拥有明确的几何契约：

```text
源码范围       markerFrom .. markerTo
分隔空格       separatorFrom .. contentFrom
视觉槽位       markerSlotWidth
正文起点       contentFrom
包装行起点     wrappedContentFrom
```

活动态和非活动态必须保持 `contentFrom`、包装行起点和行高稳定。列表标记可以隐藏视觉字符，但不能让隐藏/显露改变正文槽位；关键分隔空格如果会影响 `posAtCoords()`，应优先保留逻辑位置并只改变其视觉表现。

ArrowUp/ArrowDown 兜底只能作为过渡保护。几何契约和 `coordsAtPos()` / `posAtCoords()` 测试稳定后，再决定是否删除；不能用更多方向键特判掩盖位置映射问题。

### 5. 将输入命令改为共享模型的消费者

空格、Enter、Backspace、Tab、Shift-Tab、点击标记和上下移动都先读取 `ListLineInfo`，再执行命令。命令不得自行重新解析列表正则，也不得只依赖 Lezer 的 `ListMark`。

补全同样遵守明确的插入协议：Wiki 触发文本已经包含开头 `[[`，序列化回调只返回开头之后的片段和结束 `]]`。补全提交后必须恢复编辑器焦点，保证 Home、End 和方向键继续作用于源码编辑器。

### 6. 以行为矩阵驱动重构

结构调整期间，每个状态组合都需要同时验证源码、视觉和光标三层结果：

- 当前行有列表但光标在同一行普通文本：列表标记显露，链接仍保持预览。
- 光标进入列表行内链接：只显露该链接，不显露同一行的其它链接。
- 光标位于链接边界：只激活一个目标链接，相邻链接不能同时显露。
- 编辑器失焦或进入阅读模式：所有编辑源码隐藏，Widget 保持阅读态。
- 列表活动态切换：正文起点、换行高度和上下方向键目标不变。
- IME、补全、鼠标冻结和异步解析完成后：源码位置仍可通过 `state.doc` 唯一确定。

## 目标模型

### A. 建立唯一的列表行模型

新增一个内部模块 `src/core/list-model.ts`，集中定义：

```ts
interface ListLineInfo {
  indent: string;
  marker: string;
  markerFrom: number;
  markerTo: number;
  separatorFrom: number | null;
  ordered: boolean;
  number: number | null;
  delimiter: '.' | ')' | null;
  taskPrefix: string | null;
  contentFrom: number;
  content: string;
}
```

该模块需要提供：

- `parseListLine()`：只按源码判断用户交互语义；
- `isValidListLine()`：统一要求有序标记后存在空白分隔符；
- `listLineAt()`：处理代码块、引用和缩进边界；
- `sameListContext()`：判断两行是否属于同一层级和同一列表；
- `nextOrderedNumber()`：统一 Enter、缩进和重新编号使用的编号规则。

该模块只负责列表源码和列表上下文，不负责 CSS 或 Decoration。列表显隐策略由通用预览活动模型决定。

语法树可以继续用于块归属和嵌套关系，但不能单独决定 `1.` 是否进入列表交互。

### B. 让列表视觉布局稳定

优先目标是：活动行和非活动行的水平几何尽可能相同。

建议顺序：

1. 保留源码分隔空格的逻辑位置。
2. 不让活动状态切换改变 marker 槽位总宽度。
3. 将固定槽位、数字文本和分隔空格的责任明确分开。
4. 避免用 `replace` 隐藏会影响光标落点的关键空格。
5. 对前导缩进可以继续使用替换装饰，但必须有统一的光标映射测试。

候选实现需要比较：

- 只用 `Decoration.mark` + 稳定 CSS 槽位；
- 使用独立的零宽/固定宽度 widget 作为视觉标记；
- 保留源码标记，通过伪元素或背景实现阅读态视觉。

选择标准是源码位置可编辑、上下键可预测、复制仍返回原文，并且不会引入行高变化。

### C. 集中列表交互命令

列表交互建议由一个扩展统一提供：

- 空格触发列表成立；
- Enter 延续或退出列表；
- Backspace 删除空标记；
- Tab / Shift-Tab 调整层级；
- 点击标记定位；
- ArrowUp / ArrowDown 在相邻列表项之间移动。

所有命令都应该先读取 `ListLineInfo`，而不是各自重新匹配正则或直接信任语法树。

## 实施计划

### P0：保留当前行为并补齐测试

- [x] `1.` 未输入空格时不显示有序列表预览。
- [x] 中文 `1。` 不自动补空格。
- [x] `1. ` 空标记逐字符 Backspace。
- [x] 活动有序标记只显示一个视觉分隔空格。
- [x] 点击数字标记可以聚焦。
- [x] 五项有序列表上下移动不跳出列表。
- [ ] 当前行激活列表时，同一行的标准链接和 Wiki 链接仍保持预览。
- [ ] 光标进入或位于链接边界时，只展开目标链接，不展开相邻链接。
- [ ] 为以上行为补充真实浏览器 Playwright 测试。

### P1：统一预览活动模型和语法归属

- [ ] 定义 `editorFocused`、`activeLines`、`nearInlineRanges`、`frozen` 四种独立状态。
- [ ] 把标准链接和 Wiki 链接从 `activeLines` 规则中排除。
- [ ] 统一标准链接与 Wiki 链接的范围相交、边界和相邻链接判定。
- [x] 让失焦、阅读模式和鼠标冻结在核心实时预览装饰中使用一致的生命周期。
- [ ] 为标题、列表、链接、Wiki、图片和表格建立语法归属表测试。

### P2：统一列表源码模型

- [x] 将 `parseListLine()` 从 `inline-preview.ts` 移到独立的 `list-model.ts`。
- [x] 明确有序列表的合法条件：数字、`.` 或 `)`、至少一个空白分隔符。
- [ ] 明确空列表项、空行、引用、缩进和代码块的优先级。
- [x] 让 Enter、Tab、Shift-Tab、Backspace 和 renumber 共用模型。
- [x] 删除重复的列表正则和重复的编号推导逻辑。
- [ ] 为 `1.`、`1) `、`1. `、缩进、引用、代码块建立表格化单元测试。

### P3：稳定列表装饰几何

- [ ] 记录每个列表行的 marker 槽位、内容起点和包装行起点。
- [ ] 保证活动状态切换前后内容起点不变。
- [ ] 评估是否可以不隐藏关键分隔空格。
- [ ] 评估 `Decoration.mark`、widget 和伪元素三种方案。
- [ ] 增加 `coordsAtPos()`、`posAtCoords()`、`lineBlockAt()` 相关浏览器测试。
- [ ] 覆盖不同数字宽度：`1.`、`9.`、`10.`、`100.`、`9999.`。
- [ ] 覆盖长文本换行、混合中英文和 RTL 文本。
- [ ] 当布局稳定后删除 ArrowUp/ArrowDown 的临时兜底，或保留为明确的列表导航策略。

### P4：统一输入和 IME 生命周期

- [ ] 记录 compositionstart、compositionupdate、compositionend 期间的源码状态。
- [ ] 确认 `1。` 归一化不会在候选词未确认时修改文档。
- [ ] 覆盖 `1。` 后输入中文、`1。` 后输入空格、直接按 Enter 和 Backspace。
- [ ] 检查延迟归一化与 renumber 定时器是否可能互相触发。
- [ ] 将需要延迟的操作限制在受影响行，避免整篇列表重建。

### P5：完整列表交互测试

- [ ] 普通列表：输入、回车、连续输入、空项退出。
- [ ] 无序列表：`-`、`*`、`+` 与任务列表。
- [ ] 有序列表：`.`、`)`、非连续编号和自动重新编号。
- [ ] 空行和水平线后的列表。
- [ ] 嵌套列表、Tab、Shift-Tab 和多行内容。
- [ ] 点击标记、点击内容、拖选、双击和 Shift 选择。
- [ ] Home、End、左右键、上下键、PageUp/PageDown。
- [ ] Undo/Redo 和远程文档更新。
- [ ] 编辑模式与阅读模式切换。

### P6：性能和维护性

- [ ] 测量列表装饰重建的耗时和触发范围。
- [ ] 验证普通段落输入不会触发整篇列表装饰重建。
- [ ] 验证大文档滚动不会因列表装饰产生额外刷新。
- [x] 为列表模块补充简短架构说明，说明源码位置与 DOM 位置的边界。
- [ ] 将列表相关 CSS 变量和布局常量集中命名，避免 TS/CSS 中出现隐含的重复数值。
- [ ] 评估 `preview-activity.ts` 和 `decoration-policy.ts` 是否已消除跨 feature 的重复状态判断。

## 验收矩阵

| 输入或操作 | 预期源码 | 预期视觉 | 预期光标行为 |
| --- | --- | --- | --- |
| 输入 `1.` | `1.` | 普通正文 | 左右键逐字符移动 |
| 再输入空格 | `1. ` | 有序标记着色 | 光标在空格后 |
| `1.` 后输入中文 | `1.中` | 普通正文 | 中文紧接句号 |
| `1。` 后输入中文 | `1.中` | 普通正文 | 不插入空格 |
| `1。` 后输入空格 | `1. ` | 有序列表 | 光标在内容起点 |
| 空 `1. ` Backspace | `1.` | 普通正文 | 只删除空格 |
| `1. text` 回车 | `1. text\n2. ` | 两行列表 | 光标在 `2. ` 后 |
| 第 5 项向上 | 不变 | 聚焦第 4 项 | 不跳到列表外 |
| 点击第 2 项数字 | 不变 | 第 2 行激活 | 编辑器聚焦 |
| `---` 或空行后输入列表 | 原文不变 | 后续列表正常渲染 | 输入位置稳定 |

## 风险和决策边界

- 不修改 `state.doc` 的纯 Markdown 约束。
- 不用语法树直接覆盖编辑器自己的 `1.` 交互语义。
- 不为了修复列表而改变普通段落的上下键行为。
- 不以隐藏源码为代价牺牲可预测的光标位置。
- 所有视觉优化都必须通过源码断言、DOM 断言和真实浏览器交互测试。
- P2 完成前，当前上下键兜底只能视为保护措施，不应继续叠加更多局部特判。
