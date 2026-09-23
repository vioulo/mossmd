# 公式与 HTML 渲染 Roadmap

本文档记录 MossMD 后续支持公式与 Obsidian 风格 HTML 渲染的落地路线。它是规划文档，不代表当前 API 已存在。

多光标目前沿用 CodeMirror / Sublime Text 风格交互，已经可以接受；本路线图不重新设计多光标，只关注公式和 HTML。

## 背景

MossMD 的核心约束保持不变：

- `state.doc` 是唯一数据源。
- 公式、HTML 等增强能力只能通过 Decoration、Widget 和 CSS 呈现。
- 保存、复制、搜索和协作同步都读取原始 Markdown。
- 光标进入相关源码范围时恢复源码，离开后恢复预览。
- 代码块和行内代码中的内容不能被新语法误解析。

当前项目状态：

- `@codemirror/lang-markdown` 不会把 `$...$` 或 `$$...$$` 解析为公式节点。
- Markdown parser 已能识别部分 `HTMLTag` 和 `HTMLBlock`，但 MossMD 当前没有 HTML 专用预览装饰。
- 自定义语法注册层已经存在，可以通过 `MossCustomSyntax.markdown` 注入 Lezer Markdown 扩展，通过 `MossCustomSyntax.extensions` 注入 CodeMirror 扩展。
- 实时预览已有 `readOnlyFacet`、`previewFrozenField`、`getPreviewActivity()`、`treeGrowthEffect` 等机制，新功能应复用这些状态模型。

## 共同基础

公式和 HTML 都需要先统一以下基础能力：

- 源码范围识别。
- 当前 selection 是否进入目标范围。
- 只读模式处理。
- `pointerdown` 冻结与 `pointerup` 后解冻重建。
- Widget 的点击定位源码行为。
- 异步渲染失败时的降级显示。
- 跨行 `Decoration.replace` 安全处理。

建议新增或复用的基础边界：

```text
src/features/math/
src/features/html/
src/core/decoration-utils.ts
src/core/preview-activity.ts
src/core/markdown-context.ts
```

如果后续公式或 HTML 都需要异步 renderer，可以再考虑抽出：

```text
src/core/render-adapter.ts
```

但第一版不急于增加抽象，除非两个 feature 出现真实重复。

## 公式支持

### 目标语法

第一版支持 Obsidian 常见写法：

```md
行内公式：$E = mc^2$

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
```

### 第一版范围

- 支持 `$...$` 行内公式。
- 支持 `$$...$$` 块级公式。
- 支持多行块公式。
- 支持 `\$` 转义。
- 排除 fenced code。
- 排除 inline code。
- 尽量避免把 `$20`、`$foo` 一类普通文本误判为公式。
- 公式渲染失败时保留源码可读，不破坏文档。
- 阅读模式始终显示公式预览，不显露源码。
- 编辑模式下，光标进入公式范围后显示原始 LaTeX。

### 推荐 API

公式渲染器不应强耦合到核心包。建议通过 renderer adapter 注入：

```ts
interface MossMathRenderer {
  render(
    source: string,
    mode: 'inline' | 'block',
  ): HTMLElement | Promise<HTMLElement>;
}
```

使用方式：

```tsx
<MossMD
  customSyntax={[
    mossMathSyntax({
      renderer: katexRenderer,
    }),
  ]}
/>
```

未来可以提供官方辅助：

```ts
import { mossMathSyntax, createKatexRenderer } from 'mossmd/features/math';
```

但 KaTeX / MathJax 不应默认打入主入口。

### 引擎选择

推荐第一版优先适配 KaTeX：

- 体积较小。
- 渲染速度快。
- 适合实时编辑器。
- 配合同步 Widget 更简单。

MathJax 作为后续 renderer：

- LaTeX 兼容范围更广。
- 更接近部分 Obsidian 用户预期。
- 异步初始化和渲染生命周期更复杂。

### 实现结构

建议目录：

```text
src/features/math/
  index.ts
  markdown.ts
  decoration.ts
  widget.ts
```

职责划分：

- `markdown.ts` 定义 Lezer Markdown 扩展，产生 `InlineMath` / `BlockMath` 节点。
- `decoration.ts` 根据语法树和编辑状态生成预览装饰。
- `widget.ts` 渲染公式预览 DOM。
- `index.ts` 导出 `mossMath()` 和 `mossMathSyntax()`。

### 交互规则

行内公式属于“行内贴近显露”：

- 光标进入公式源码范围或边界时，显示完整 `$...$`。
- 光标只是在同一行其它位置时，保持公式预览。
- 非空选区与公式范围相交时，显示源码。

块级公式属于“Widget 优先”：

- 非激活状态显示块级公式 Widget。
- 光标进入公式块任意一行时，显示完整源码块。
- `pointerdown` 期间保持冻结，解冻后重建。

### 测试清单

最低覆盖：

- 行内公式正常渲染。
- 块级公式正常渲染。
- 多行块公式正常渲染。
- 行内代码中的 `$x$` 不渲染。
- fenced code 中的 `$x$` 不渲染。
- `\$x\$` 不渲染。
- `$20` 不误判。
- 未闭合 `$x` 不渲染。
- 光标进入行内公式后显示源码。
- 光标离开行内公式后恢复预览。
- 光标进入块公式后显示源码。
- 光标离开块公式后恢复预览。
- 只读模式下始终显示预览。
- renderer 抛错时不破坏编辑器。
- 复制 / `getMarkdown()` 仍返回原始 LaTeX。

## HTML 渲染

### 目标语法

支持 Obsidian 常见的直接 HTML：

```html
<mark>重点</mark>
<u>下划线</u>
<kbd>Cmd</kbd>
<sup>2</sup>
<sub>n</sub>
```

后续支持少量块级结构：

```html
<details>
  <summary>展开说明</summary>
  这里是折叠内容。
</details>
```

### 安全原则

HTML 是高风险功能，不能简单把原文交给 `innerHTML`。

第一版应采用 allowlist：

```text
mark
u
kbd
sup
sub
br
span
details
summary
```

第一版允许的属性：

```text
class
title
open
```

默认禁止：

```text
script
style
iframe
form
object
embed
事件属性，例如 onclick
javascript: URL
任意外部资源注入
```

如未来提供不安全模式，必须显式配置：

```ts
interface MossHtmlConfig {
  enabled?: boolean;
  allowedTags?: readonly string[];
  allowedAttributes?: readonly string[];
  allowUnsafeHtml?: boolean;
}
```

`allowUnsafeHtml` 必须在文档里标记为危险选项，不应默认开启。

### 推荐 API

```tsx
<MossMD
  customSyntax={[
    mossHtmlSyntax({
      allowedTags: ['mark', 'u', 'kbd', 'details', 'summary'],
    }),
  ]}
/>
```

也可以先导出基础扩展：

```ts
import { mossHtml, mossHtmlSyntax } from 'mossmd/features/html';
```

是否默认启用需要谨慎。建议第一版作为 opt-in feature 发布，验证安全策略和用户预期后再考虑进入默认装配。

### 实现结构

建议目录：

```text
src/features/html/
  index.ts
  sanitizer.ts
  inline.ts
  block.ts
  widget.ts
```

职责划分：

- `sanitizer.ts` 处理标签和属性白名单。
- `inline.ts` 处理 `<mark>text</mark>` 这类行内 HTML。
- `block.ts` 处理 `HTMLBlock`。
- `widget.ts` 渲染块级 HTML。
- `index.ts` 导出 `mossHtml()` 和 `mossHtmlSyntax()`。

### 行内 HTML 策略

例如：

```html
<mark>重点</mark>
```

建议处理方式：

- 识别成对的 `HTMLTag`。
- 隐藏开闭标签。
- 对中间内容添加对应 CSS class。
- 光标进入标签范围时显示完整 HTML。
- 中间文本仍留在 CodeMirror 文本流中，不替换成整个 widget。

适合这种策略的标签：

```text
mark
u
kbd
sup
sub
span
```

这类标签可以用 `Decoration.mark` + `Decoration.replace` 实现。

### 块级 HTML 策略

例如：

```html
<details>
  <summary>展开说明</summary>
  这里是折叠内容。
</details>
```

建议处理方式：

- 识别完整 `HTMLBlock`。
- 通过 sanitizer 构造安全 DOM。
- 用 Widget 替换整块源码。
- 光标进入块范围时显示原始 HTML。
- 第一版不在 HTML block 内继续解析 Markdown。

块级 HTML 属于“Widget 优先”，行为接近图片块、文件块和表格。

### CSS 约定

新增类名应使用 `cm-moss-html-*`：

```text
cm-moss-html-mark
cm-moss-html-kbd
cm-moss-html-block
cm-moss-html-details
```

主题值继续使用 `--moss-*` CSS 变量。

### 测试清单

最低覆盖：

- `<mark>text</mark>` 渲染为高亮。
- `<u>text</u>` 渲染为下划线。
- `<kbd>Ctrl</kbd>` 渲染为按键样式。
- `<sup>2</sup>` 和 `<sub>n</sub>` 正常渲染。
- 光标进入行内 HTML 后显示源码。
- 光标离开行内 HTML 后恢复预览。
- `<details><summary>...</summary>...</details>` 渲染为块级 Widget。
- 块级 HTML 点击后能定位到源码。
- `script` 标签不执行。
- `onclick` 属性被移除。
- `javascript:` URL 被拒绝。
- fenced code 中的 HTML 保持原文。
- inline code 中的 HTML 保持原文。
- 只读模式下始终显示预览。
- 复制 / `getMarkdown()` 仍返回原始 HTML。

## 与现有机制的整合

公式和 HTML 都需要接入：

- `readOnlyFacet`
- `previewFrozenField`
- `getPreviewActivity()`
- `ensureSyntaxTree()`
- `treeGrowthEffect`
- `pushReplace()`
- `customSyntax`

特别要遵循 Callout 最近收敛出的点击规则：

- Widget 的 `pointerdown` 可以主动定位源码。
- 定位源码时仍要让预览冻结机制接管视觉稳定性。
- 解冻事务需要触发装饰重建。
- 光标离开后必须恢复预览态。

## 落地顺序

推荐顺序：

1. 明确公式和 HTML 的公开配置形态。
2. 实现公式语法识别。
3. 实现行内公式预览。
4. 实现块级公式预览。
5. 补齐公式交互、只读模式和失败降级。
6. 补齐公式测试和 Demo 示例。
7. 实现安全 HTML sanitizer。
8. 实现行内 HTML 标签预览。
9. 实现 `details` / `summary` 块级 HTML。
10. 补齐 HTML 安全测试。
11. 更新 README、Demo 和导出映射。

## 暂不建议第一版支持

公式侧暂不支持：

- 自动编号。
- 交叉引用。
- 用户宏系统。
- 完整 MathJax 配置透传。
- 表格单元格内复杂公式编辑。

HTML 侧暂不支持：

- 任意 `innerHTML`。
- 任意 `style` 属性。
- `iframe`。
- `script`。
- HTML block 内继续解析完整 Markdown。
- 完整 Obsidian HTML 兼容模式。

编辑器侧暂不重做：

- 多光标行为。
- 列选择行为。
- VS Code 变量型 snippet 系统。

## 验收标准

一个功能可以认为达到第一版可用，需要满足：

- 原始 Markdown 完整保留。
- 预览和源码状态切换稳定。
- 点击和键盘移动不会造成光标漂移。
- 阅读模式行为明确。
- 大文档中解析树晚到时可以补建装饰。
- 失败时不破坏编辑器输入。
- 有单元测试覆盖核心范围。
- 涉及点击、Widget 或布局的行为有浏览器测试覆盖。

