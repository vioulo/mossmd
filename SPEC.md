# MossMD —— 详细规格说明

## 阶段 0：脚手架检查清单

### 包配置
- [ ] `package.json` —— 名称、版本、exports、peerDeps、脚本
- [ ] `tsconfig.json` —— 开发配置（noEmit，demo 用 paths）
- [ ] `tsconfig.build.json` —— 构建配置（declaration，outDir: dist）
- [ ] `vite.config.ts` —— demo 服务器 + 库别名
- [ ] `vitest.config.ts` —— bun 测试配置（含别名）
- [ ] `playwright.config.ts` —— 带 harness 的 E2E
- [ ] `bunfig.toml` —— bun 配置（可选）
- [ ] `.gitignore`、`.npmignore`、`LICENSE`、`README.md`

### 目录结构
```
mossmd/
├── src/
│   ├── index.ts                    # 公共导出
│   ├── editor.tsx                  # React 组件
│   ├── inline-preview.ts           # 核心装饰引擎
│   ├── theme/index.ts              # 主题 + 语法高亮
│   ├── core/
│   │   ├── code-languages.ts       # 精选语言注册表
│   │   ├── edit-helpers.ts         # 括号/强调配对
│   │   ├── read-only.ts            # 阅读模式 facet
│   │   └── tree-progress.ts        # 解析进度跟踪
│   ├── features/
│   │   ├── index.ts                # 用户功能聚合入口
│   │   ├── table/index.ts          # 所见即所得表格
│   │   ├── image/index.ts          # 图片块 widget
│   │   ├── wiki-links/index.ts     # Wiki 链接 + 自动补全
│   │   └── callout/index.ts        # Callout 视图扩展
│   ├── highlight.ts                # ==highlight== 扩展
│   ├── collab/
│   │   └── index.ts                # 协作接口
│   ├── syntax/
│   │   ├── index.ts                # registerMossSyntax()
│   │   ├── callout/
│   │   ├── mermaid/
│   │   └── kanban/
│   └── styles/
│       ├── tokens.css              # 共享主题令牌
│       ├── inline-preview.css      # 编辑器全部 CSS
│       └── content.css             # 渲染后 markdown 表面样式
├── demo/
│   ├── index.html
│   ├── main.tsx
│   ├── App.tsx                     # 带控制面板的完整 demo
│   ├── harness.html                # E2E 测试 harness
│   ├── harness.tsx                 # Harness React 应用
│   ├── harness.css
│   ├── sample-content.ts           # 示例 markdown 生成器
│   └── vite-env.d.ts
├── tests/
│   └── e2e/                        # Playwright 规格
├── scripts/
│   └── test-package.mjs            # 包冒烟测试
└── dist/                           # 构建输出（gitignore）
```

---

## 阶段 1：模块移植细节

### 1. 主题与 CSS（`theme/index.ts` + `styles/*.css`）
**来源**：atomic-editor/src/atomic-theme.ts + styles/inline-preview.css
**变更**：
- CSS 变量重命名：`--atomic-editor-*` → `--moss-*`
- 主题类名更新：`.cm-atomic-*` → `.cm-moss-*`
- 保留 Palenight 深色 / GitHub 浅色调色板
- 导出：`mossTheme`、`mossSyntax`

### 2. 编辑辅助（`core/edit-helpers.ts`）
**来源**：atomic-editor/src/edit-helpers.ts
**变更**：最小 —— 基本可移植
- `closeBrackets` 配置 markdown 分隔符
- `extendEmphasisPair` —— `*|*` → `**|**`
- `startAsteriskList` —— `*` 后加空格开始列表
- 全部导出

### 3. 只读（`core/read-only.ts`）
**来源**：atomic-editor/src/read-only.ts
**变更**：facet 重命名 `readOnlyFacet` → `mossReadOnlyFacet`，`readOnlyExtension` → `mossReadOnlyExtension`
- `mossReadOnlyFacet`（Facet\<boolean>）
- `mossReadOnlyExtension(readOnly: boolean)` → Extension

### 4. 高亮（`highlight.ts`）
**来源**：atomic-editor/src/highlight.ts
**变更**：可移植
- `mossHighlightMarkdown` —— 用于 `==highlight==` 的 Markdown 语言扩展
- Lezer 语法扩展 + 高亮样式

### 5. 行内预览（`inline-preview.ts`）—— **核心**
**来源**：atomic-editor/src/inline-preview.ts
**主要变更**：
- 所有 `.cm-atomic-*` 类 → `.cm-moss-*`
- CSS 变量引用更新
- `InlinePreviewConfig` → `MossInlinePreviewConfig`
- `inlinePreview(config?)` → `mossInlinePreview(config?)`
- 冻结逻辑、行类、隐藏装饰、widget —— 架构相同
- 集成自定义语法装饰（阶段 2）

### 6. 图片块（`features/image/index.ts`）
**来源**：atomic-editor/src/image-blocks.ts
**变更**：
- 类名：`.cm-atomic-image` → `.cm-moss-image`
- 导出：`imageBlocks()` → `mossImageBlocks()`

### 7. 表格（`features/table/index.ts`）—— **复杂**
**来源**：atomic-editor/src/table-widget.ts
**变更**：
- 类名：`.cm-atomic-table*` → `.cm-moss-table*`
- `TablesConfig` → `MossTablesConfig`
- `tables(config?)` → `mossTables(config?)`
- 右键菜单：插入/删除行/列、对齐切换
- **新增**：列对齐持久化（`:---`、`---:`、`:---:`）

### 8. Wiki 链接（`features/wiki-links/index.ts`）
**来源**：atomic-editor/src/wiki-links.ts
**变更**：
- 类名：`.cm-atomic-wiki-link*` → `.cm-moss-wiki-link*`
- 类型：`WikiLinkStatus`、`WikiLinkSuggestion`、`WikiLinkResolvedTarget`、`MossWikiLinksConfig`
- `wikiLinks(config)` → `mossWikiLinks(config)`
- 保留异步 resolve/suggest/onOpen API

### 9. 代码语言（`core/code-languages.ts`）
**来源**：atomic-editor/src/code-languages.ts
**变更**：
- `ATOMIC_CODE_LANGUAGES` → `MOSS_CODE_LANGUAGES`
- 同样的 20 种语言，通过动态 import 懒加载
- 导出 `LanguageDescription[]`

### 10. 树进度（`core/tree-progress.ts`）
**来源**：atomic-editor/src/tree-progress.ts
**变更**：可移植
- `treeGrowthEffect`、`treeProgressPlugin`
- 供 inline-preview 与表格做解析覆盖率校验

### 11. 编辑器装配（`editor.tsx`）—— **主入口**
**来源**：atomic-editor/src/AtomicCodeMirrorEditor.tsx
**主要变更**：
- 组件名：`AtomicCodeMirrorEditor` → `MossEditor`
- Props 接口：`AtomicCodeMirrorEditorProps` → `MossEditorProps`
- Handle：`AtomicCodeMirrorEditorHandle` → `MossEditorHandle`
- 新 prop：`collabAdapter?: CollabAdapter`
- 新 prop：`customSyntax?: MossCustomSyntax[]`（阶段 2）
- 引入全部 `moss*` 模块
- read-only、collab、custom syntax 使用 Compartment
- 命令式 handle：新增 `setCollabAdapter(adapter)`

---

## 阶段 2：自定义语法框架

### 自定义语法模块方案

每个完整功能应放在本包 `src/features/<name>/`（属于本包时），或放在消费方包中（与应用相关时）：

```bash
index.ts               # MossCustomSyntax 导出
markdown.ts            # Lezer Markdown 扩展
decoration.ts          # CM6 装饰/widget/命令
```

只有确实需要生成解析器的块才添加 `.lezer` 语法与生成脚本。当前脚手架未运行语法构建步骤，因为仓库中没有签入任何生成的语法。

### 注册形态
```ts
import { mossCalloutSyntax } from 'mossmd/features/callout';

const calloutSyntax = mossCalloutSyntax();
```

`MossEditor` 通过 `customSyntax={[calloutSyntax]}` 接受它们。Markdown 扩展被转发进 `markdown({ extensions })`；CM6 扩展追加到编辑器扩展集合。

### 块规格

#### Callout（`> [!TYPE] Title\n> Content`）
- 状态：以可选的 `mossCalloutSyntax()` 实现
- Lezer：复用 Markdown blockquote 解析；暂无需生成语法
- 装饰：行样式与非激活态标记标签
- 类型：NOTE、TIP、IMPORTANT、WARNING、CAUTION、TODO

#### Mermaid（````mermaid\ncode\n```）
- Lezer：带 `mermaid` info 字符串的围栏代码
- Widget：懒加载 mermaid.js，挂载/更新时渲染 SVG
- 代码变更时防抖重渲染

#### Kanban（`:::kanban\n- col1\n  - card\n:::`）
- Lezer：自定义块容器
- Widget：拖拽列/卡片（HTML5 DnD 或 @dnd-kit）
- 变更时序列化回 markdown

---

## 阶段 3：协作接口

```ts
// src/collab/index.ts
export interface CollabAdapter {
  attach(view: EditorView): Promise<void>;
  detach(): void;
  onRemoteChange(cb: (doc: string) => void): () => void;
  getAwareness?(): Awareness; // 用于光标位置
}

export const noopCollabAdapter: CollabAdapter = {
  attach: async () => {},
  detach: () => {},
  onRemoteChange: () => () => {},
};
```

编辑器 prop：
```ts
interface MossEditorProps {
  // ... 现有
  collabAdapter?: CollabAdapter;
}
```

Handle 方法：
```ts
interface MossEditorHandle {
  // ... 现有
  setCollabAdapter(adapter: CollabAdapter): Promise<void>;
}
```

---

## 测试要求

### 单元测试（bun test）
- `src/__tests__/edit-helpers.test.ts`
- `src/__tests__/table-widget.test.ts`
- `src/__tests__/wiki-links.test.tsx`
- `src/__tests__/read-only.test.tsx`
- `src/__tests__/inline-preview.test.tsx`
- `src/__tests__/markdown-contracts.test.tsx`（共享 fixtures）

### E2E 测试（Playwright）
- `tests/e2e/mount.spec.ts` —— 基本挂载、渲染
- `tests/e2e/editing.spec.ts` —— 输入、markdown 同步
- `tests/e2e/inline-preview.spec.ts` —— 激活/非激活行渲染
- `tests/e2e/tables.spec.ts` —— 单元格编辑、右键菜单、对齐
- `tests/e2e/wiki-links.spec.ts` —— 自动补全、resolve、点击
- `tests/e2e/read-only.spec.ts` —— 切换、链接点击、复选框
- `tests/e2e/custom-syntax.spec.ts` —— Callout、mermaid、kanban
- `tests/e2e/search.spec.ts` —— 搜索面板、reveal
- `tests/e2e/collab-interface.spec.ts` —— Adapter attach/detach

### 共享 Fixtures
- `src/__tests__/fixtures/markdown-contracts.ts` —— 单元与 E2E 共用的输入/期望配对

---

## 演示应用（`demo/App.tsx`）

### 展示功能
1. **主题切换** —— 通过 `data-theme` 深/浅色
2. **只读切换** —— 通过 prop + handle
3. **示例规模选择** —— 1 页 / 10 页 / 100 页（压力测试）
4. **内容开关** —— 图片、表格、列表、代码块
5. **聚光跳转** —— 滚动到特性并淡出高亮
6. **自定义块面板** —— 切换 callout/mermaid/kanban
7. **命令面板** —— Ctrl+P（阶段 1.5）
8. **移动工具条** —— 响应式（阶段 1.5）
9. **实时 markdown 输出** —— 复制/下载按钮
10. **性能计量** —— 渲染行数 / 总行数

### Harness（`demo/harness.tsx`）
- 极简编辑器，无多余界面
- `window.mossHarness` API：`load(md, opts?)`、`focus()`、`getMarkdown()`、`getOpenedUrls()`
- 供 Playwright 做确定性测试

---

## 构建与发布

### 包导出
```json
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./code-languages": { "types": "./dist/code-languages.d.ts", "default": "./dist/code-languages.js" },
    "./styles.css": "./dist/styles/inline-preview.css",
    "./collab": { "types": "./dist/collab/index.d.ts", "default": "./dist/collab/index.js" },
    "./syntax": { "types": "./dist/syntax/index.d.ts", "default": "./dist/syntax/index.js" }
  }
}
```

### 发布文件
- `dist/`
- `README.md`
- `LICENSE`
- `CHANGELOG.md`

### CI 流水线
1. `bun install`
2. `bun run typecheck`
3. `bun test`
4. `bun run build`
5. `bun run test:package`
6. `bun run test:e2e`（Chromium）
7. 打 tag 后发布到 npm

---

## 迁移说明（来自 atomic-editor）

### 查找与替换模式
| 查找 | 替换 |
|------|------|
| `@atomic-editor/editor` | `mossmd` |
| `atomic-editor` | `mossmd` |
| `AtomicCodeMirrorEditor` | `MossEditor` |
| `AtomicCodeMirrorEditorHandle` | `MossEditorHandle` |
| `AtomicCodeMirrorEditorProps` | `MossEditorProps` |
| `atomicEditorTheme` | `mossTheme` |
| `atomicMarkdownSyntax` | `mossSyntax` |
| `inlinePreview` | `mossInlinePreview` |
| `imageBlocks` | `mossImageBlocks` |
| `tables` | `mossTables` |
| `wikiLinks` | `mossWikiLinks` |
| `readOnlyFacet` | `mossReadOnlyFacet` |
| `readOnlyExtension` | `mossReadOnlyExtension` |
| `ATOMIC_CODE_LANGUAGES` | `MOSS_CODE_LANGUAGES` |
| `cm-atomic-` | `cm-moss-` |
| `--atomic-editor-` | `--moss-` |
| `atomicHarness` | `mossHarness` |

### 需调整的文件（不能直接复制）
- `editor.tsx` —— 新 props、协作集成、自定义语法
- `inline-preview.ts` —— 自定义语法装饰集成
- `table-widget.ts` —— 列对齐特性
- `theme/index.ts` —— CSS 变量前缀变更
- 全部测试文件 —— 导入路径、类名

---

## 依赖

### 对等依赖（与 atomic-editor 完全相同）
```json
{
  "@codemirror/autocomplete": "^6.0.0",
  "@codemirror/commands": "^6.0.0",
  "@codemirror/lang-markdown": "^6.0.0",
  "@codemirror/language": "^6.0.0",
  "@codemirror/search": "^6.0.0",
  "@codemirror/state": "^6.0.0",
  "@codemirror/view": "^6.0.0",
  "@lezer/common": "^1.0.0",
  "@lezer/highlight": "^1.0.0",
  "@lezer/markdown": "^1.0.0",
  "react": "^18.0.0 || ^19.0.0",
  "react-dom": "^18.0.0 || ^19.0.0",
  "@codemirror/lang-cpp": "^6.0.0",
  "@codemirror/lang-css": "^6.0.0",
  "@codemirror/lang-go": "^6.0.0",
  "@codemirror/lang-html": "^6.0.0",
  "@codemirror/lang-java": "^6.0.0",
  "@codemirror/lang-javascript": "^6.0.0",
  "@codemirror/lang-json": "^6.0.0",
  "@codemirror/lang-php": "^6.0.0",
  "@codemirror/lang-python": "^6.0.0",
  "@codemirror/lang-rust": "^6.0.0",
  "@codemirror/lang-sql": "^6.0.0",
  "@codemirror/lang-xml": "^6.0.0",
  "@codemirror/lang-yaml": "^6.0.0",
  "@codemirror/legacy-modes": "^6.0.0"
}
```

### 开发依赖
```json
{
  "@codemirror/*": "与对等依赖同版本",
  "@lezer/*": "与对等依赖同版本",
  "@playwright/test": "^1.40.0",
  "@types/react": "^19.0.0",
  "@types/react-dom": "^19.0.0",
  "@vitejs/plugin-react": "^4.0.0",
  "happy-dom": "^12.0.0",
  "lezer-generator": "^1.6.0",
  "playwright": "^1.40.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "typescript": "^5.0.0",
  "vite": "^5.0.0",
  "vitest": "^1.0.0"
}
```

---

## 时间线估算

| 阶段 | 时长 | 累计 |
|-------|------|------|
| 阶段 0：脚手架 | 0.5 天 | 0.5 天 |
| 阶段 1：核心移植 | 10 天 | 10.5 天 |
| 阶段 2：自定义语法 | 5 天 | 15.5 天 |
| 阶段 3：协作接口 | 0.5 天 | 16 天 |
| 阶段 4：测试 + 发布 | 5 天 | 21 天 |
| **合计** | **约 3 周** | **21 个工作日** |
