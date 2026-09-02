# Inline Preview Architecture

这份文档记录实时预览相关模块的长期边界。它补充 `architecture.md`，不替代行为规则文档。

## 依赖方向

```text
list-model
    +--> list-editing ----+
    +--> list-navigation -+--> inline-preview

preview-widgets -------> inline-preview
preview-activity ------> inline-preview
decoration-utils ------> inline-preview
```

依赖方向从纯规则和基础机制指向装饰装配层。`features` 可以使用自己的 Markdown 范围和 Widget，但不应反向依赖 `inline-preview.ts` 的内部实现。

## 模块职责

- `list-model.ts` 只解析列表行源码，并提供 marker、分隔空格、正文起点、层级上下文和编号辅助。它不依赖 Lezer、DOM 或 Decoration。
- `list-editing.ts` 消费列表模型，实现 Enter、Backspace、Tab、Shift-Tab 和有序列表重新编号。
- `list-navigation.ts` 消费列表模型，实现列表结构隐藏、Home/End、左右键、上下键和标记点击。
- `preview-widgets.ts` 定义任务状态、列表符号和代码复制 Widget。Widget 只从 `state.doc` 读取并通过事务修改原文。
- `preview-activity.ts` 定义焦点、当前激活行和鼠标冻结生命周期，并提供链接命中辅助。
- `decoration-utils.ts` 提供装饰构建的通用安全工具，例如将跨行 replace 拆成逐行范围。
- `inline-preview.ts` 负责遍历语法树、决定装饰策略并组装扩展。它是协调层，不是列表编辑或 Widget 的所有者。

## 数据与 DOM 边界

`state.doc` 是唯一 Markdown 数据源。装饰和 Widget 不保存第二份文档，也不把视觉 DOM 当作语义来源。保存、复制和协作同步都读取原文。

列表源码位置和视觉位置必须分开理解：

```text
markerFrom .. markerTo       列表标记源码
separatorFrom .. separatorTo 分隔空白源码
contentFrom                  列表正文的稳定源码起点
```

列表标记可以被 mark 或 Widget 重新呈现，结构性缩进可以被 replace 隐藏，但这些变化不能改变原文位置的含义。导航命令优先通过 `list-model` 计算源码边界；当前上下移动的相邻行兜底是对视觉布局的保护策略，待真实浏览器几何测试完善后再评估是否移除。

## 当前策略与后续边界

- 当前行规则负责标题、引用、列表、任务标记和代码围栏。
- 标准链接使用链接范围判断显露，不继承整行激活；Wiki 链接范围由 Wiki feature 独占。
- 图片、表格、文件块和上传块由各自 feature 的 Widget 负责。
- `isWikiLinkNode()` 目前仍是核心装饰层的过渡性排除判断。长期应由 feature 注册独占源码范围，届时再移除这项具体语法知识。
- `nearInlineRanges` 和通用 `decoration-policy` 尚未建立。本轮先统一已有 activity 生命周期和列表模型，避免在行为契约尚未覆盖时引入更大的策略抽象。
