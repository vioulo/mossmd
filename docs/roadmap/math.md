# 数学公式（LaTeX）Roadmap 与架构规范

> **状态**：✅ **已落地（Shipped in v0.10.0）**  
> **源码位置**：[`src/features/math/`](file:///home/k-k/Documents/kk/mossmd/src/features/math/)  
> **公开导出**：`mossmd/features/math`（以及 `mossmd/features` 聚合入口）

本文档记录 MossMD 中数学公式（LaTeX）的设计理念、架构决策、落地实现与未来演进方向。作为功能设计基石长期归档保存。

---

## 一、核心原则与架构决策

1. **原始 Markdown 为唯一数据源**  
   - `state.doc` 永远保存纯文本 LaTeX 源码。
   - 复制、撤销/重做、文档导出（`getMarkdown()`）以及协作同步均以原始 Markdown 为准，装饰层（Decorations & Widgets）不拥有也不修改数据状态。

2. **零核心重度依赖绑定（轻量化解耦）**  
   - KaTeX / MathJax 等复杂排版引擎体积较大（数百 KB 甚至数 MB），**严禁强行打包打入 `mossmd` 主入口包**。
   - 采用 **可插拔适配器（Adapter Pattern）**：
     ```ts
     export interface MossMathRenderer {
       render(
         source: string,
         mode: 'inline' | 'block',
       ): HTMLElement | Promise<HTMLElement> | string;
     }
     ```
   - 官方提供泛型 KaTeX 适配器辅助函数 `createKatexRenderer(katex, options)`，用户按需将外部 KaTeX 实例注入编辑器；未提供外部引擎时，编辑器内置无外部依赖的优雅 fallback 降级渲染。

3. **语法解析严谨避让**  
   - 通过 Lezer Markdown 扩展定义 `InlineMath`、`BlockMath` 与语法定界符标记 `InlineMathMark`、`BlockMathMark`。
   - 货币符号避让：闭合 `$` 后紧随数字（如 `$20 and $30`）不判定为公式。
   - 转义保护：支持反斜杠 `\$` 转义，转义后按普通文本处理。
   - 代码隔离：Fenced 代码块与行内代码（`` `...` ``）内部的 `$` 符号严格隔离，绝不触发公式解析。
   - 块级打断：块级公式支持无空行直接打断前序段落（通过 `endLeaf` 判定）。

---

## 二、光标交互与视觉标准

在实时预览（Live Preview）中，公式的交互遵循极佳的人机工效学体验：

### 1. 行内公式（`$...$`）
- **鼠标点击进入**：监听组件 pointerdown 事件，触发时自动激活源码，并**仅全选内部的 LaTeX 源码本身（排除前后的 `$` 定界符）**，使用户能够直接输入替换或复制公式，而不会误删 Markdown 语法结构。
- **键盘方向键进入**：光标移动到两个 `$` 之间时展开源码，光标以**单脱字符（Caret）**停留在对应字符位置，**不触发 select**。
- **离开恢复**：当光标移出公式范围时，自动恢复公式预览渲染态。

### 2. 块级公式（`$$...$$`）
- **鼠标点击进入**：
  - 上方展开显示完整的可编辑 LaTeX 源码，并**仅全选多行公式内容本身（自动排除首尾的 `$$` 语法定界符及首尾换行）**。
  - 下方**同步保留实时渲染对照卡片**（`.cm-moss-math-block-preview`），为复杂公式的编辑提供即时视觉对照反馈。
- **键盘方向键进入**：
  - 光标移动至公式覆盖行时，上方展开源码并保持单光标插入点（**不触发 select**）。
  - 下方同样保留渲染预览卡片。
- **离开折叠**：
  - 光标完全移出公式块覆盖行后，自动恢复为折叠渲染卡片。

### 3. 只读模式（Read-Only Mode）
- 当编辑器处于 `readOnly: true` 模式时，无论光标移动还是鼠标点击，公式均始终锁定在预览渲染态，绝不暴露原始语法源码。

---

## 三、实现目录与模块职责

```text
src/features/math/
  ├── index.ts        # 模块对外统一导出入口（mossMath, mossMathSyntax, createKatexRenderer 等）
  ├── markdown.ts     # Lezer Markdown 扩展（语法分词、货币避让与节点定义）
  ├── decoration.ts   # 装饰状态机（根据光标选区构建 replace/widget 实时预览装饰）
  └── widget.ts       # CodeMirror Widget 实现（DOM 挂载、选区计算与事件处理）
```

---

## 四、测试与验收清单

模块在 [`src/__tests__/math.test.tsx`](file:///home/k-k/Documents/kk/mossmd/src/__tests__/math.test.tsx) 中保持自动化测试全覆盖：

- [x] 行内公式 AST 词法解析。
- [x] 多行与单行块级公式 AST 解析。
- [x] 数字货币 `$20` 避让测试。
- [x] 转义反斜杠 `\$` 避让测试。
- [x] 行内代码块内隔离测试。
- [x] KaTeX 真实渲染器渲染集成。
- [x] 行内公式鼠标点击（全选源码并排除 `$` 定界符）与方向键单脱字符进入。
- [x] 块级公式点击（上方全选源码排除 `$$`，下方保留预览卡片）与方向键进入。
- [x] 只读模式下始终保留渲染、不暴露源码。
- [x] 渲染器抛错时优雅降级（`.cm-moss-math-error`）且不崩溃编辑器。
- [x] `getMarkdown()` 100% 保持纯文本 Markdown 不受装饰污染。

---

## 五、未来可演进方向（后续阶段）

以下能力作为后续高级需求备忘，非基础版本范围：

1. **公式自动编号与标签（Tagging & Numbering）**：支持形如 `\tag{1.1}` 的右侧编号对齐。
2. **公式交叉引用（Cross-referencing）**：文档内部通过锚点跳转至特定编号公式。
3. **全局用户宏（Custom Macros）**：允许用户在配置中注册全局自定义 LaTeX 宏并在所有公式中复用。
4. **MathJax 3 深度适配**：为需要完整 TeX/LaTeX 兼容性的场景提供可选的 MathJax 异步适配器。
