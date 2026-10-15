# 实时预览架构与交互规范

本文档定义 MossMD 实时预览（Live Preview）引擎的核心架构、模块边界与 Markdown 源码显隐交互规范。它是装饰实现、状态管理和回归测试的长期技术基准。

---

## 一、 架构设计与依赖拓扑

### 1. 核心依赖方向

```text
list-model
    +--> list-editing ----+
    +--> list-navigation -+--> inline-preview
                          |
preview-widgets ----------> inline-preview
preview-activity ---------> inline-preview
decoration-utils ---------> inline-preview
```

依赖方向由纯规则和基础机制严格指向装饰装配层：
- `features`（如图片、表格、Wiki 链接、公式等）可以使用自己的 Markdown 范围和 Widget，但不应反向依赖 `inline-preview.ts` 的内部实现。
- 核心装饰层通过 `core/preview-activity.ts` 统一消费选区、焦点与冻结状态。

### 2. 模块职责分工

- `inline-preview.ts`：负责遍历 Lezer 语法树、调度装饰策略并组装主 CodeMirror 扩展。它是装配协调层，不拥有具体的列表算法或 Widget 私有业务。
- `preview-activity.ts`：定义编辑器焦点（`editorFocused`）、当前激活行（`activeLines`）与鼠标冻结（`previewFrozenField`）生命周期，并暴露统一的链接激活命中函数 `isPreviewRangeActive()`。
- `preview-widgets.ts`：定义任务复选框状态、列表 Bullet 符号、代码块一键复制等核心 Widget。所有 Widget 仅从 `state.doc` 读取数据并通过事务修改原文。
- `decoration-utils.ts`：提供装饰构建的安全工具（如将可能跨行的 replace 装饰拆解为逐行安全范围）。
- `list-model.ts`、`list-editing.ts`、`list-navigation.ts`：列表纯文本模型、结构延续、退格重排与键盘导航。详细边界参见 [`./list-editing.md`](./list-editing.md)。

### 3. 数据与 DOM 边界

- **`state.doc` 是唯一真实数据源**：装饰与 Widget 绝不保存第二份文档模型，也不把视觉 DOM 作为语义来源。保存、复制、撤销与协作同步均直接针对原文 Markdown。
- **源码位置与视觉几何彻底解耦**：列表结构缩进、语法定界符可以被隐藏或替换，但字符位置索引（`from .. to`）恒定。导航命令优先通过纯文本模型计算目标，在视觉几何不一致时以相邻源码行兜底。

---

## 二、 基本交互模型

实时预览的状态管理明确区分三个正交维度，严禁简化为单一的 `active` 布尔值：

### 1. 编辑器焦点 (`editorFocused`)
表示编辑器是否真正拥有宿主 DOM 焦点。
- 只有编辑器获得焦点时，才允许展开编辑源码。
- 编辑器失去焦点后，整体退回阅读预览态；当前光标/选区可保留，但不得仅凭残留选区展开源码。
- 阅读模式（`readOnly`）始终禁止源码显露。
- 焦点是所有源码展开行为的总开关，优先于任何具体语法的局部策略。

### 2. 当前行激活 (`activeLines`)
选区覆盖的源码行集合（单光标所在行即为其所在行）。
- 适用于需要“用户编辑整行结构”的块级语法：光标进入该行，行级结构标记即刻显露。
- **当前行激活绝不传播到同一行内的行内链接**。
- 多选区场景下，所有选区覆盖的行均计入当前行集合。

### 3. 行内贴近 (`nearInline`)
光标或非空选区与某一行内语法范围相交，或光标位于该范围的源码边界。
- 空选区使用闭区间源码位置判断：`[from, to]`。
- 非空选区使用范围相交判断：`selection.from <= to && selection.to >= from`。
- 严格基于 CodeMirror 字符位置，不用屏幕像素距离，也不把整行当成贴近。
- 一次仅激活当前目标链接，杜绝点击相邻内容时同时展开多个链接。

---

## 三、 显隐分级与策略优先级

每类语法只能归属于一种主策略。处理优先级从高到低为：

1. **阅读模式 (Read-Only)**：全部保持渲染态，禁止显露编辑源码。
2. **交互冻结 (Pointer Freeze)**：鼠标 `pointerdown` 到释放尾部期间冻结装饰重建，防止源码展开导致光标坐标漂移。
3. **行内贴近 (Near Inline)**：链接、公式等局部语法依据光标贴近展开自身。
4. **当前行激活 (Active Lines)**：标题、引用、列表等行级结构展开当前行标记。
5. **非激活状态 (Inactive)**：显示阅读态 Widget、标记或隐藏语法令牌。

当“行内贴近”与“当前行激活”同时成立时，行内语法使用自己的局部策略。即：**当前行不能覆盖链接策略**。

---

## 四、 语法归类与实现细则

### 1. 当前行显露
光标进入所在行后显露源码，离开恢复预览：
- ATX 标题前缀（`# ` 至 `###### `）与 Setext 标题下划线。
- 引用前缀（`> `，含多层嵌套）。
- 列表标记：无序（`- `、`* `、`+ `）、有序（`1. `、`1) `）、任务状态（`[ ] `、`[x] `）。
- 围栏代码块定界符与语言标识。
- 水平分割线（`---`、`***`、`___`）。
- 行内强调（`*`、`_`）、删除线（`~~`）、高亮（`==`）及行内代码（`` ` ``）定界符。
- 转义反斜杠及 Callout 前缀。

行高、列表槽位与几何必须通过 `.cm-moss-*` CSS 锁定，显隐切换不得引发排版跳动。

### 2. 行内贴近显露与链接激活协议

普通 Markdown 链接与 Wiki 链接由不同机制解析（前者来自 Lezer AST，后者来自 feature 文本扫描），但必须遵循同一套激活协议：

#### (1) 状态判定规则
行内链接是否显示完整源码，仅当以下条件全部满足：
1. 编辑器拥有焦点（`editorFocused === true`）。
2. 当前非只读模式（`!readOnly`）。
3. 光标或非空选区与链接源码范围相交（`isPreviewRangeActive()`）。
   - **空光标**：闭区间包含 `from <= cursor <= to`（首尾边界均展开）。
   - **非空选区**：`selection.from <= to && selection.to >= from`。

#### (2) 冻结保护机制
- `previewFrozenField` 是全编辑器唯一的鼠标冻结状态。
- 普通链接与 Wiki 链接均读取该状态。冻结期间选区变化仅映射旧装饰，不重建视图；解冻事务强制触发一次更新。
- 文档内容变更在冻结期间仍必须立即重建，防止装饰偏移。

#### (3) 细则与排除边界
- **标准链接**：`[`、`]`、`(`、`)`、URL 与标题属于统一激活范围。未激活时仅显示 label 内容。
- **Wiki 链接**：`[[target]]` 或 `[[target|label]]` 全段属于统一激活范围。扫描器必须严格排除：fenced code、inline code、未闭合的 `[[...` 及空 target。代码反引号内的 `[[foo]]` 保持纯文本代码，不参与解析。

#### (4) 链接激活行为对照矩阵
示例：`查看 [文档](https://example.com) 和 [[project|项目]]。`

| 状态 | 普通链接 | Wiki 链接 |
|---|---|---|
| 阅读模式 | 显示预览 | 显示预览 |
| 编辑器失焦 | 显示预览 | 显示预览 |
| 光标在链接外（同行动作） | 隐藏 Markdown 语法（只显示 label） | 隐藏 `[[ ]]`（只显示 label） |
| 光标在链接内部 | 显示完整源码 | 显示完整源码 |
| 光标位于首尾边界 | 显示完整源码 | 显示完整源码 |
| 非空选区跨过链接 | 显示完整源码 | 显示完整源码 |
| `pointerdown` 短暂冻结 | 保持旧装饰 | 保持旧装饰 |
| 行内代码中的 Wiki 文本 | 不适用 | 不解析，保持原文 |

### 3. Widget 优先
以下复杂节点由独立 Widget 呈现，不因当前行聚焦而直接恢复全文源码：
- 图片块（含缩放、Alt 编辑、链接复制）。
- 表格 Widget（可编辑 `<table>`，通过单元格内编辑回写 Markdown）。
- 文件卡片块。
- 上传进度临时 Widget。
- 块级数学公式（Display Math `$$...$$`，聚焦时源码在上方显露并自动全选内容，下方保留预览卡片）。

---

## 五、 行为示例与规则验证

### 示例 1：Wiki 链接混合排版
```text
Labeled: [[demo-project-atlas|Project Atlas]] · Bare: [[demo-meeting-notes]] · In code: `[[demo-project-atlas]]`
```
- 光标在 `In code` 文本上：前两个 Wiki 链接保持预览，代码中的 `[[...]]` 保持反引号代码高亮。
- 光标进入 `Project Atlas` 内部或首尾边界：仅展开第一个 Wiki 链接源码，不影响第二个。
- 光标在代码反引号内部：不触发任何 Wiki 链接解析或提示。

### 示例 2：标准链接
```text
[Render semantic vector](https://example.org/1620e) for more.
```
- 光标在 `for more.` 文本上：仅渲染 `Render semantic vector` 文本，隐藏 `[]()` 及 URL。
- 光标进入 label 内部或链接首尾边界：展开完整 `[Render semantic vector](https://example.org/1620e)`。
- 移出链接后：立即恢复预览。

---

## 六、 输入与补全契约

Wiki 双链自动补全触发时，源码中已经存在开头的 `[[`。因此补全数据源的 `serializeSuggestion` 必须遵守插入片段契约：
- **输入**：`[[ro`
- **补全插入片段**：`roadmap|Editor Roadmap]]`
- **最终原文**：`[[roadmap|Editor Roadmap]]`

禁止重复插入开头的 `[[`，亦不得遗漏结尾的 `]]`。补全采纳后焦点必须留在编辑器内，光标置于合法位置。

---

## 七、 实现约束与回归测试矩阵

### 实现约束
1. 严禁把行级结构与行内链接混用未过滤的 `activeLines`。
2. 新增行内语法必须接入 `core/preview-activity.ts` 的 `isPreviewRangeActive()` 和 `previewFrozenField`，禁止 feature 维护私有选区判定。
3. `Decoration.replace` 必须保持行高与行内坐标的稳定。

### 回归测试覆盖矩阵
- [x] 当前行其它位置不会误展开行内标准链接或 Wiki 链接。
- [x] 光标进入链接内部或首尾边界时，仅展开目标链接源码。
- [x] 相邻近距离链接不会被鼠标单次点击同时展开。
- [x] 行内代码中的 `[[...]]` 不被解析为 Wiki 链接。
- [x] Wiki 补全不重复 `[[`，应用后编辑器保持焦点。
- [x] 链接展开态下方向键、Home、End 导航行为可预期。
- [x] 编辑、失焦与阅读模式切换时，显隐严格符合优先级。
