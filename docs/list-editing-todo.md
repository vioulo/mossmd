# 列表编辑与导航

本文档记录 MossMD 列表功能当前的实现边界、源码模型和剩余风险。它保留长期有效的设计约束，不再记录已经完成的阶段性 TODO。源码显隐规则见 [`live-preview-rules.md`](./live-preview-rules.md)，实时预览模块边界见 [`inline-preview-architecture.md`](./inline-preview-architecture.md)。

## 模块职责

列表相关逻辑按以下边界组织：

- `src/core/list-model.ts`：只根据源码解析一行列表，提供位置和上下文信息；不依赖 Lezer、DOM 或 Decoration。
- `src/core/list-editing.ts`：实现 Enter 延续、空项退出、Tab、Shift-Tab 和有序列表重排。
- `src/core/list-navigation.ts`：实现列表结构隐藏、Home、End、左右键、上下键和标记点击。
- `src/core/edit-helpers.ts`：处理中文数字标点归一化、IME 保护，以及空有序标记的逐字符退格。
- `src/core/inline-preview.ts`：组装列表相关装饰和扩展，不拥有列表编辑规则。
- `src/styles/inline-preview.css` 与 `src/theme/index.ts`：负责列表标记的视觉布局和颜色。

## 源码模型

`ListLineInfo` 是列表交互的共享基础。它的实际字段如下：

```ts
interface ListLineInfo {
  indent: string;
  marker: string;
  markerFrom: number;
  markerTo: number;
  separatorFrom: number;
  separatorTo: number;
  ordered: boolean;
  number: number | null;
  delimiter: '.' | ')' | null;
  taskPrefix: string | null;
  contentFrom: number;
  content: string;
}
```

`parseListLine(lineText, lineFrom)` 只按原始源码判断编辑语义。它要求列表标记后存在空白，因此：

```text
1.       普通正文
1. text  有序列表
```

这条规则有意独立于 Lezer。解析器可以把空的 `1.` 识别为 `ListMark`，但编辑器不能因此提前进入列表交互或把一次退格当成删除整个结构。

当前模型还提供这些实际使用的辅助函数：

- `listContentStart(line)`：返回列表标记和正文起点，用于 Home、左右键和上下键。
- `continuationFor(prefix, nextNumber?)`：生成 Enter 后的下一项前缀。
- `listItemLineRange(doc, startLineNumber, indentLength)`：取得列表项及其延续行范围。
- `previousListPrefix()`、`previousListPrefixAtIndent()`、`nearestOuterListPrefix()`：查找同级或外层列表上下文。
- `nextOuterListNumber()`、`indentedOrderedNumber()`：计算缩进后的有序编号。

列表模型只负责源码位置和列表语义，不负责 CSS、Widget 或装饰构建。需要增加列表行为时，应优先扩展这个模型或其消费者，避免在多个模块重新解析列表正则。

## 当前行为

- 支持 `.` 和 `)` 两种有序标记，以及无序列表、任务列表、缩进列表和引用中的列表。
- Enter 会延续列表并计算下一个有序编号；空列表项再次按 Enter 会退出或回到外层列表。
- Tab、Shift-Tab 会调整当前列表项及其延续行的缩进。
- 空的有序列表标记按字符退格，不会被 CodeMirror 的结构化删除命令一次移除。
- Home 第一次到正文起点，第二次到列表标记；End 到源码行末。
- 左右键会跳过不可见的列表结构缩进；上下键跨列表项时保留正文偏移。
- 点击列表标记会聚焦编辑器，并把光标放到标记末尾。

## 几何边界

列表预览会隐藏结构缩进和部分分隔空白，也会用固定槽位重新呈现标记。因而必须区分三种位置：

```text
源码位置       markerFrom .. markerTo、separatorFrom .. contentFrom
DOM 位置       装饰隐藏或重排后的节点位置
视觉位置       标记槽位、padding、换行形成的屏幕坐标
```

以下不变量需要保持：

- `state.doc` 中的源码位置永远不变。
- 活动行和非活动行的正文起点、行高和包装行几何尽量稳定。
- 光标经过隐藏结构时一次跨过结构范围，不逐个访问不可见位置。
- 多位数编号、嵌套列表、长文本换行和中英文混排不能改变上下移动的目标。

`list-navigation.ts` 当前在列表项之间移动时，先调用 CodeMirror 的视觉移动，再使用相邻源码行和正文偏移修正结果。这是针对实时预览几何的明确导航策略，不应扩展成普通段落的通用方向键特判。

## 尚需覆盖的风险

- `edit-helpers.ts` 的空有序标记退格仍使用局部正则，没有完全复用 `parseListLine()`；修改列表标记格式时要同步检查这条路径。
- 列表模型对空行、引用、缩进和代码块的优先级需要继续用表格化测试固定。
- 需要真实浏览器测试验证 `coordsAtPos()`、`posAtCoords()`、`lineBlockAt()`，特别是多位数编号和长文本换行。
- 需要验证解析树增长、装饰冻结、IME、撤销/重做和远程整文档更新后，列表正文位置仍然可预测。

列表几何问题与图片、文件块造成的高度图问题是两条独立的技术线。前者关注行内 marker 和正文的水平映射，后者关注 block widget 的垂直高度；修复其中一类不能替代另一类。

## 测试位置

- `src/__tests__/list-editing.test.ts`：列表命令、装饰、点击、Home/End、方向键和缩进。
- `src/__tests__/edit-helpers.test.ts`：中文标点归一化、IME 和空有序标记退格。
- `tests/e2e/inline-preview.spec.ts`：真实浏览器中的方向键和块级装饰高度。

新增列表行为时，至少同时断言 Markdown 原文、可见 DOM 和最终光标位置。Wiki 链接等行内语法的显隐规则不在本文重复描述，统一遵循 [`live-preview-rules.md`](./live-preview-rules.md)。
