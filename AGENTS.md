# MossMD —— 开发代理指南

## 项目概览

**MossMD** —— 基于 CodeMirror 6 的 Obsidian 风格 Markdown 编辑器，支持自定义块语法扩展。

- **包名**：`mossmd`
- **包管理器**：Bun
- **目标**：React 18+ / 19+
- **核心理念**：以原始 markdown 为唯一数据源、零布局漂移、可扩展的块架构

---

## 架构决策

### 核心不变量（来自 atomic-editor）
1. **原始 markdown 是唯一数据源** —— 所有装饰只读
2. **无布局漂移** —— 行高通过 CSS 类决定，而非令牌可见性
3. **鼠标冻结** —— pointerdown 后约 100ms 暂停装饰重建
4. **窄失效范围** —— 只重建变更行的装饰

### 扩展点
- `mossInlinePreview()` —— 主装饰引擎
- `mossTables()` —— 所见即所得表格 widget
- `mossImageBlocks()` —— 渲染后的图片块
- `mossWikiLinks()` —— `[[wiki-link]]` 支持
- `mossTheme` —— CSS 变量主题
- `mossReadOnlyExtension()` —— 通过 Compartment 实现阅读模式
- **新**：`defineMossSyntax()` / `registerMossSyntax()` —— 自定义块的 Lezer 语法扩展

### 自定义块语法策略
- 在 `src/syntax/<block>/grammar.lezer` 编写 `.lezer` 语法文件
- 构建时用 `lezer-generator` 预编译
- 通过 `markdownLanguage.configure({ extensions: [customSyntax] })` 注册
- 通过 ViewPlugin/StateField 做装饰（类似 `inline-preview.ts`）

### 协作接口（面向未来）
```ts
// src/collab/index.ts
interface CollabAdapter {
  attach(view: EditorView): Promise<void>;
  detach(): void;
  onRemoteChange(cb: (doc: string) => void): () => void;
}
export const noopCollabAdapter: CollabAdapter = { ... };
```
- 编辑器接受 `collabAdapter?: CollabAdapter` prop
- 默认 noop 实现，之后可替换为 yjs

---

## 开发工作流

### 命令
```bash
bun run dev          # Vite 开发服务器 localhost:5173（demo/）
bun run build        # tsc -> dist/ + .d.ts
bun test             # 单元测试（bun test runner）
bun run test:e2e     # Playwright E2E 测试
bun run test:package # 打包 + 干净安装验证
bun run typecheck    # tsc --noEmit
```

### Demo 与 Harness
| | Demo（`demo/App.tsx`） | Harness（`demo/harness.tsx`） |
|--|--|--|
| 用途 | 功能展示、手工测试 | 确定性 E2E 测试 |
| UI | 完整控制项、示例数据 | 极简、无多余界面 |
| API | 交互式 | `window.mossHarness.load(md)` 等 |

### 测试层次
1. **bun test** —— 逻辑、状态、DOM 契约（happy-dom）
2. **Playwright** —— Chromium 全量，Firefox/WebKit 冒烟
3. **Legacy probes** —— 时序敏感行为（可选）
4. **包冒烟** —— tarball → 干净安装 → 消费方构建

---

## 实现阶段

### 阶段 0：脚手架（0.5 天）✅ 当前
- [ ] 带 bun 配置的 Package.json
- [ ] TypeScript 配置（开发 + 构建）
- [ ] Vite 配置（demo + 库别名）
- [ ] Vitest/bun test 配置
- [ ] Playwright 配置 + harness
- [ ] 目录骨架
- [ ] 验证 `bun run dev` 可运行

### 阶段 1：核心编辑器移植（1-2 周）
从 atomic-editor 逐模块移植，每个模块在 demo 中验证：

| 顺序 | 模块 | 关键文件 | Demo 验证 |
|-------|--------|-----------|-----------|
| 1 | 主题 + CSS | `theme/index.ts`、`styles/*.css` | 深/浅色切换 |
| 2 | 编辑辅助 | `core/edit-helpers.ts` | 单元测试通过 |
| 3 | 只读 | `core/read-only.ts` | `readOnly` prop 切换 |
| 4 | 高亮 | `highlight.ts` | `==text==` 渲染 |
| 5 | 行内预览 | `inline-preview.ts` | 实时预览可用 |
| 6 | 图片块 | `features/image/index.ts` | 图片在源码下方渲染 |
| 7 | 表格 | `features/table/index.ts` | 编辑单元格、右键菜单 |
| 8 | Wiki 链接 | `features/wiki-links/index.ts` | `[[link]]` 自动补全 |
| 9 | 代码语言 | `core/code-languages.ts` | 围栏代码高亮 |
| 10 | 编辑器装配 | `editor.tsx` | 完整 demo 可用 |

### 阶段 2：自定义语法框架（1 周）
```
src/syntax/
├── index.ts              # registerMossSyntax()
├── callout/              # > [!NOTE] 提示
│   ├── grammar.lezer
│   ├── parser.ts
│   └── decoration.ts
├── mermaid/              # ```mermaid 渲染
└── kanban/               # :::kanban 看板
```

### 阶段 3：协作接口（0.5 天）
- 定义 `CollabAdapter` 接口
- 编辑器增加 `collabAdapter` prop
- 提供 noop 默认实现

### 阶段 4：测试加固与发布（1 周）
- 从 atomic-editor 移植/适配单元测试
- 每个特性的 E2E 规格
- `test:package` 验证
- CI 流水线（GitHub Actions + bun）
- 文档 + demo 部署

---

## 与 atomic-editor 的关键差异

| 方面 | atomic-editor | mossmd |
|--------|---------------|--------|
| 包管理器 | npm | **bun** |
| 构建 | tsc + vite | **bun build**（或 tsc） |
| 测试 runner | vitest | **bun test** |
| 自定义块 | 无 | **Lezer 语法扩展** |
| 协作 | 不包含 | **接口就绪** |
| 主题包 | 无规划 | **规划为独立包** |

---

## 文件约定

- **除非要求，否则不加注释**
- **TypeScript 严格模式** —— 禁用 `any`、无未使用局部变量/参数
- **仅 ESM** —— package.json 中 `type: "module"`
- **所有主题均用 CSS 变量**（`--moss-*`）
- **CodeMirror/React 包全部为对等依赖**
- **副作用仅限 CSS 文件**

---

## 参考

- 原 atomic-editor：`/home/k-k/Documents/kk/atomic-editor`
- CodeMirror 6 文档：https://codemirror.net/docs/guide/
- Lezer 语法指南：https://lezer.codemirror.net/docs/guide/
- yjs + CodeMirror：https://github.com/yjs/y-codemirror
