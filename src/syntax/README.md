# Moss 自定义语法

`syntax/` 是 Markdown 解析扩展及其配套 CodeMirror 视图扩展的注册层。

自定义块应打包成小型模块，导出 `MossCustomSyntax` 对象：

```ts
import { defineMossSyntax } from 'mossmd/syntax';

export const calloutSyntax = defineMossSyntax({
  name: 'callout',
  description: '> [!NOTE] 风格 callout 块',
  markdown: calloutMarkdown,
  extensions: calloutDecorations(),
});
```

然后传给 React 编辑器：

```tsx
<MossEditor
  markdownSource={markdown}
  customSyntax={[calloutSyntax]}
/>
```

`markdown` 字段被转发进 `@codemirror/lang-markdown` 的 `markdown({ extensions })` 选项。用于 Lezer Markdown 扩展，如 `defineNodes`、`parseInline`、`parseBlock` 或 `wrap`。

`extensions` 字段追加到编辑器的 CM6 扩展集合之后（内置的实时预览、图片、表格、wiki-link 和只读扩展之后）。用于 widget、装饰、命令、facet、悬停面板或自动补全源。

推荐的模块布局：

```text
src/syntax/<name>/
  index.ts       公共 `MossCustomSyntax` 导出
  markdown.ts    Lezer Markdown 扩展
  decoration.ts  CM6 StateField/ViewPlugin 装饰层
```

如果未来的块需要生成的 `.lezer` 解析器，请在块落地时添加该模块的生成脚本。当前核心包不运行语法构建步骤，因为还没有签入任何生成的语法。