# HTML 渲染 Roadmap 与安全规范

> **状态**：⏳ **规划中（待实施）**  
> **目标模块**：`src/features/html/`  
> **设计原则**：严格白名单（Allowlist）、零 XSS 容忍、与 CodeMirror 文本流安全集成

本文档记录 MossMD 后续支持 Obsidian 风格行内与块级 HTML 安全渲染的路线图与架构设计。

---

## 一、目标语法

### 1. 行内 HTML
支持 Obsidian 常见直接标记：

```html
<mark>高亮文本</mark>
<u>下划线内容</u>
<kbd>Ctrl</kbd> + <kbd>C</kbd>
E = mc<sup>2</sup>
H<sub>2</sub>O
<span class="custom-badge">标签</span>
```

### 2. 块级 HTML
支持基础的折叠结构：

```html
<details>
  <summary>点击展开说明</summary>
  这里是被折叠的内容描述。
</details>
```

---

## 二、安全红线（Sanitization Principles）

HTML 渲染具有直接注入风险，**严禁将未清洗的原始输入直接交给 `innerHTML`**。

### 1. 默认允许标签（Allowlist）
- 行内标签：`mark`, `u`, `kbd`, `sup`, `sub`, `br`, `span`
- 块级标签：`details`, `summary`

### 2. 默认允许属性
- `class`
- `title`
- `open`（用于 `details`）
- `dir`

### 3. 严格禁止（直接过滤或剥离）
- 脚本执行：`<script>`, `<style>`, `<link>`
- 嵌入对象：`<iframe>`, `<object>`, `<embed>`, `<applet>`
- 表单交互：`<form>`, `<input>`, `<button>`, `<textarea>`
- 事件处理器：所有 `on*` 属性（如 `onclick`, `onerror`, `onload` 等）
- 危险协议：`javascript:`, `vbscript:`, `data:` 等伪协议 URL
- 任意内联 CSS：默认禁止 `style` 属性以防止视觉劫持

### 4. 高级配置选项（Opt-in）
```ts
export interface MossHtmlConfig {
  enabled?: boolean;
  allowedTags?: readonly string[];
  allowedAttributes?: readonly string[];
  allowUnsafeHtml?: boolean; // 默认 false，并在文档显著位置注明安全风险
}
```

---

## 三、渲染策略与交互规则

### 1. 行内 HTML 策略（保持文本可编辑）
- **实现机制**：采用 `Decoration.mark` + `Decoration.replace`。
- **开闭标签**：对 `<mark>` 与 `</mark>` 添加 replace 装饰进行隐藏。
- **标签内文字**：文本内容保留在 CodeMirror 原始文本流中，直接附带 CSS 类名（如 `.cm-moss-html-mark`），不生成黑盒 Widget，以保证流畅的行内光标移动与原生输入法（IME）合成。
- **光标进入**：当光标移至标签定界符或选区重叠时，即时展开显露完整的 `<mark>` 开闭标签源码；移出后恢复渲染。

### 2. 块级 HTML 策略（Widget 优先）
- **实现机制**：通过 Lezer 解析完整的 `HTMLBlock` 节点，采用经过 Sanitizer 清洗的安全 DOM 构建 Block Widget 替换。
- **光标进入**：光标移动到该块覆盖行时，展开原始 HTML 源码供用户直接编辑；移出后恢复折叠预览。

---

## 四、建议目录划分

```text
src/features/html/
  ├── index.ts        # 对外导出（mossHtml, mossHtmlSyntax）
  ├── sanitizer.ts    # 轻量标签/属性白名单清洗器
  ├── inline.ts       # 行内 HTML 标记装饰构建
  ├── block.ts        # 块级 HTML 装饰与 AST 匹配
  └── widget.ts       # 块级 DOM 挂载组件（如 details 折叠）
```

---

## 五、测试与验收清单

功能落地时需满足以下最低自动化测试覆盖：

- [ ] `<mark>` 正常渲染并附带背景色。
- [ ] `<u>` 正常渲染并带下划线。
- [ ] `<kbd>` 正常渲染并带按键质感样式。
- [ ] `<sup>` 与 `<sub>` 上下标基线排版对齐。
- [ ] 光标移动到标签时完整显露 HTML 标签源码。
- [ ] 光标离开后自动恢复纯净渲染预览。
- [ ] `<details><summary>` 结构正确支持折叠/展开交互。
- [ ] `<script>` 标签与内嵌代码绝不执行。
- [ ] 所有 `on*` 事件属性被彻底清洗剥离。
- [ ] `javascript:` 等非法协议链接被拒绝。
- [ ] Fenced 代码块与行内代码中的 HTML 保持纯文本不解析。
- [ ] 只读模式下始终保留渲染态、不暴露源码。
- [ ] `getMarkdown()` 返回完整的原始 HTML 文本。
