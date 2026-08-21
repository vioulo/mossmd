# Moss 自定义语法

`mossmd/syntax` 提供的是自定义语法注册协议，不是具体功能实现。完整功能放在 `src/features/<name>/`，这里负责把语法模块描述成 `MossCustomSyntax`，再交给编辑器注册。

```ts
import { defineMossSyntax } from 'mossmd/syntax';

export const calloutSyntax = defineMossSyntax({
  name: 'callout',
  description: 'Callout 块',
  markdown: calloutMarkdown,
  extensions: calloutDecorations(),
});
```

然后传给编辑器：

```tsx
<MossEditor
  markdownSource={markdown}
  customSyntax={[calloutSyntax]}
/>
```

`markdown` 会转发给 `@codemirror/lang-markdown` 的 `markdown({ extensions })`，适合放 Lezer Markdown 扩展，比如 `defineNodes`、`parseInline`、`parseBlock`、`wrap` 等。

`extensions` 会追加到编辑器扩展集合之后，适合放装饰、widget、命令、facet、悬停面板、自动补全源等普通 CM6 扩展。

推荐的模块结构：

```text
src/features/<name>/
  index.ts
  markdown.ts
  decoration.ts
```

如果以后真的需要生成 `.lezer` 解析器，再给对应模块加生成脚本。当前仓库还没有签入任何生成语法，所以核心包里也没有语法构建步骤。
