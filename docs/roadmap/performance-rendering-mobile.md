# MossMD 性能、渲染、架构统一与移动端体验调优规划

本文档系统性梳理 MossMD 在**性能伸缩性**、**渲染稳定性**、**架构与生命周期统一**以及 **PC 与移动端交互差异**四大维度的运行期风险，并制定可落地的架构演进路线与防御方案。

---

## 一、 核心痛点与风险概览

基于对代码库运行期探针、测试套件（189 项测试）及 CodeMirror 6 底层机制的审计，当前项目存在若干影响大规模长文编辑和移动端体验的核心瓶颈：

| 领域 | 核心风险 | 影响等级 | 影响场景 | 涉及模块 |
|---|---|:---:|---|---|
| **移动端体验** | `freezeMousePlugin` 调用 `preventDefault` 导致 Scroller 边缘触控无法原生滚动 | **P0 (阻断级)** | 移动端手指滑动/触屏翻页 | `src/core/preview-activity.ts` |
| **移动端体验** | 链接点击跳转热区仅 1.25em（~16px），违背移动端人机工效学（HIG 44px） | **P0 (严重体验)** | 手机端触屏点击外链 | `src/core/preview-activity.ts` |
| **移动端体验** | 侧边 `+` 按钮在移动端因宽度不足恒为 `hidden`，且依赖 `mousedown`，移动端无快捷插入入口 | **P0 (严重体验)** | 移动端命令面板与块插入 | `src/features/slash-commands/index.ts` |
| **移动端体验** | 缺少移动端视口（`visualViewport`）感知，软键盘弹出遮挡搜索面板与浮动控件 | **P1 (核心体验)** | 手机端查找替换、图片编辑 | `src/features/search/`、`image/` |
| **性能** | 每次光标移动触发多插件全文档 `tree.iterate`，随文档长度呈现 $O(N)$ 线性开销 | **P1 (核心体验)** | 大文档（数千行）方向键导航 | `inline-preview.ts`、`callout/`、`math/` |
| **性能** | KaTeX 缺乏公式渲染缓存；表格单个字符输入触发整表 DOM 重构与全量 Markdown 生成 | **P1 (核心体验)** | 频繁编辑公式、大表格打字 | `math/widget.ts`、`table/index.ts` |
| **渲染** | 光标移入标题/加粗行时标记展开，导致文本水平跳动 (Horizontal Shift) | **P1 (核心体验)** | 键盘连续跨行上下导航 | `inline-preview.ts`、`preview-activity.ts` |
| **渲染** | 异步图片加载缺乏宽高比占位，导致 CodeMirror Heightmap 测量突变与视口跳动 | **P1 (核心体验)** | 含网图文档首屏渲染与滚动 | `src/features/image/` |
| **架构统一** | ViewPlugin 与多个独立 StateField 调度分散，缺乏中央装饰分发机制 | **P2 (架构治理)** | 多 Feature 并发装配与维护 | `src/editor.tsx`、`features/` |
| **架构统一** | 协作适配器（`CollabAdapter`）全量替换文档，重置光标与解析状态，无法支持真实协作 | **P2 (架构治理)** | 多人协同与云端同步 | `src/collab/`、`src/editor.tsx` |

---

## 二、 移动端与 PC 交互差异 (Mobile vs PC) 改造规范

### 1. 触屏手势阻断与原生滚动恢复 (P0)

#### 现状分析与技术根因
在 `src/core/preview-activity.ts` 中，`freezeMousePlugin` 为防止点击空白处时光标闪烁，在 `scrollDOM` 捕获到 Pointer 事件时执行：
```ts
private selectFromScrollerSpace(event: PointerEvent) {
  ...
  event.preventDefault(); // 阻止了默认行为
  this.freezeDuringPointer();
  this.view.focus();
  this.view.dispatch({ selection: { anchor: pos }, userEvent: 'select.pointer' });
}
```
在移动设备上，用户在编辑器边距滑动浏览时，该事件为 `pointerType === 'touch'`。调用 `event.preventDefault()` 会强行截断浏览器的**原生触控惯性滚动 (Kinetic Touch Scrolling)**，造成手势冻结、滑不动屏幕的严重故障。

#### 改造方案
1. **触控事件放行**：检测 `event.pointerType === 'touch'`。对于触摸设备，在未发生点击抬起确认前，绝不调用 `event.preventDefault()`。
2. **手势判定分流**：区分单纯轻触（Tap）与触摸移动（Touchmove / Pan）。只有判定为确切的轻触时，才触发光标定位，滚动滑动手势交还浏览器原生 Scroller 处理。

---

### 2. 移动端触控热区人机工程学对齐 (P0)

#### 现状分析与技术根因
`src/core/preview-activity.ts` 中，编辑模式下点击链接仅在命中末尾图标时跳转：
```ts
const emSize = parseFloat(window.getComputedStyle(linkEl).fontSize);
const iconZone = emSize * 1.25; // 约 16px - 20px
```
Apple iOS HIG 与 Android Material Design 明确规定触控目标尺寸最低为 **44×44px** / **48×48px**。在手机屏上，用手指命中 16px 的微小区域极易脱靶，频繁被识别为在正文中定位光标并呼出软键盘，导致用户无法正常打开链接。

#### 改造方案
1. **媒体查询动态热区**：利用 `@media (pointer: coarse)`，将移动端链接的伪元素点击热区（Hit Target）扩充至至少 44px。
2. **移动端交互双模态**：在触屏环境下，支持长按呼出外链预览气泡/菜单，或在阅读模式（`readOnly`）下全链接点击直接触发 `onLinkClick`。

---

### 3. 移动端块命令（Slash Commands）呼出体验重塑 (P0)

#### 现状分析与技术根因
`src/features/slash-commands/index.ts` 中的 `sidePlusButtonPlugin`：
```ts
coords.left - hostRect.left >= buttonRect.width + 8
  ? coords.left - hostRect.left - buttonRect.width - 8
  : null
```
在小屏移动端（宽 375~390px），编辑器边距通常在 16~24px，`buttonRect.width + 8` 约为 32px，计算结果恒为 `null`，导致 `measure.button.hidden = true`。移动端用户无法通过点击 `+` 插入块，且手机输入法没有物理快捷键，很难便捷输入 `/`。此外该按钮还监听了 `mousedown` 事件，在触屏环境易引发焦点抢夺。

#### 改造方案
1. **移动端专用触发入口**：针对移动端屏幕宽度，当空行获得焦点时，提供紧贴视口底部、吸附在软键盘上方的**移动端快捷动作栏 (Mobile Action Bar)**，或将 `+` 按钮呈现为行内弱化的灰色占位符。
2. **事件迁移至 Pointer/Touch**：统一改用 `pointerdown` / `click` 合成逻辑，并在触控时调用 `event.preventDefault()` 防止失焦，保证虚拟键盘保持展开。

---

### 4. 虚拟视口（Visual Viewport）与软键盘避让机制 (P1)

#### 现状分析与技术根因
移动端虚拟键盘弹起时，屏幕可用高度骤减（通常只剩 300~400px）。`src/features/search/`（搜索面板）与 `src/features/image/`（浮动图片工具栏）均依赖固定的 CSS 定位，一旦键盘弹起，搜索面板或浮动编辑框常被键盘顶出屏幕或直接遮挡。

#### 改造方案
1. **接入 `window.visualViewport` 监听**：编辑器顶层或 Floating 浮层监听 `visualViewport.resize` 和 `visualViewport.scroll` 事件。
2. **键盘避让布局**：搜索面板在移动端自动下沉吸附或上浮，确保在虚拟键盘可视范围内居中可见；光标所在行自动 `scrollIntoView`，预留合理的键盘缓冲高度（Keyboard Offset）。

---

### 5. 移动端 E2E 自动化测试矩阵补全 (P1)

#### 现状分析
`playwright.config.ts` 当前仅覆盖 `Desktop Chrome`、`Desktop Firefox` 和 `Desktop Safari`，缺失触屏模拟和移动端测试。

#### 改造方案
在 Playwright 配置中引入移动端设备模拟矩阵：
```ts
{
  name: 'mobile-webkit',
  use: { ...devices['iPhone 14'] },
},
{
  name: 'mobile-chrome',
  use: { ...devices['Pixel 7'] },
}
```
针对触屏滚动、链接点击热区、`+` 按钮可见性、长按选区编写专门的移动端交互端到端回归断言。

---

## 三、 性能与伸缩性维度 (Performance) 改造规范

### 1. 局部选区更新与装饰窄失效机制 (P1)

#### 现状分析与技术根因
在 `src/core/inline-preview.ts` 中：
```ts
if (
  forceRefresh || justUnfroze || update.docChanged ||
  update.selectionSet || update.focusChanged || treeGrew || readOnlyChanged
) {
  this.decorations = buildInlineDecorations(update.view);
}
```
当文档达到数千行时，用户按一下方向键（`selectionSet: true` 且 `docChanged: false`），系统都会重新遍历全文档语法树 `tree.iterate`。此外，`callout`（逐行正则）和 `math`（StateField 遍历语法树）同样每次选区变动全量重算。

#### 改造方案
1. **区分编辑与导航**：
   - 当仅发生选区移动（`update.selectionSet && !update.docChanged`）时，**仅重算前一次激活行与当前激活行**的行内隐藏/显示装饰。
   - 文档未改动时，其他行的折叠状态和行级类完全保持既有 `DecorationSet`，利用 `RangeSet` 的增量拼接或差异比对，避免 $O(N)$ 遍历全树。
2. **Callout 语法感知**：废弃 `callout/index.ts` 中的全文档逐行纯文本正则扫描，转为利用 Lezer Markdown 解析器中的 `Blockquote` 节点按需索引，或在文档变动时仅针对变更的行及其上下文块重跑解析。

---

### 2. 数学公式（LaTeX / KaTeX）LRU 渲染缓存 (P1)

#### 现状分析与技术根因
`src/features/math/widget.ts` 中的 `InlineMathWidget` 和 `BlockMathWidget` 在每次 `toDOM` 挂载时，无条件调用 `renderer.render(source, mode)`（同步执行 KaTeX 编译）。在长文档滚动或轻微编辑引发 widget 重建时，相同的 LaTeX 字符串被反复解析。

#### 改造方案
1. **引入内存级 LRU 渲染缓存**：
   ```ts
   const MATH_RENDER_CACHE = new Map<string, string>(); // source + mode -> html
   ```
2. 对 KaTeX 解析输出的静态 HTML 字符串进行缓存复用（上限 500~1000 条），widget 在 `toDOM` 时直接复用已编译的 HTML 字符串，使重复公式的挂载耗时从毫秒级降至微秒级。

---

### 3. 表格单元格输入批处理与增量事务 (P1)

#### 现状分析与技术根因
`src/features/table/index.ts` 中，每个单元格均为 `contenteditable="true"`，且普通打字时每敲一个字符触发一次 `commit()`，遍历所有单元格将整个表格重新序列化为 Markdown 并发送一次整块替换的 Transaction。这不仅开销巨大，还会破坏微观输入流。

#### 改造方案
1. **微任务事务合并 (Transaction Debounce / Batching)**：输入字符时先更新 DOM 与内部轻量内存数据结构，将全量 Markdown 序列化与 CM6 Transaction 派发合并在微任务（Microtask / rAF）后异步派发，避免高频打字导致的阻塞。
2. **保留末尾空格**：修正 `(source.textContent ?? '').replace(/\s+/g, ' ').trim()` 强行剥离末尾空格导致的英文多词输入截断问题。

---

### 4. React 受控模式下的身份标识解耦 (P2)

#### 现状分析与技术根因
`src/editor.tsx` 中：
```ts
const editorIdentity = documentId ?? markdownSource;
```
若使用者在外部按 `<MossMD markdownSource={text} onMarkdownChange={setText} />` 编写，每次打字父组件更新会导致 `editorIdentity` 漂移，进而触发 `view.destroy()` 和整机重装。

#### 改造方案
1. **默认使用内部稳定引用**：若未传入 `documentId`，则仅在组件初始挂载时消费 `markdownSource`，后续 `markdownSource` 的更新若与当前 `view.state.doc.toString()` 一致则忽略，若不一致且显式开启受控同步才通过最小事务更新内容，彻底避免静默卸载重载。

---

## 四、 渲染与排版一致性 (Rendering) 改造规范

### 1. 激活行展开与收起的水平文字跳动治理 (P1)

#### 现状分析与技术根因
当光标进入 `# 标题` 或带有加粗的行时，隐藏的 Markdown 标记立即从 `Decoration.replace` 折叠中复原，导致后面的文字被瞬间向右推挤；光标离开时瞬间向左拉回。

#### 改造方案
1. **柔性过渡与占位对齐评估**：
   - 探针验证：在标题等单字符标记（如 `# `）折叠时，保留幽灵占位或等宽缩进，使正文的绝对物理对齐位置在激活/非激活状态下保持一致。
   - 键盘延迟显露：将 `preview-activity.ts` 的冻结机制从单一的 Pointer 扩展到方向键导航（检测快速连续跨行跳动时延迟 80ms 展开源码，避免连续按上下键时光标沿折叠字符上下左右剧烈抖动）。

---

### 2. 原生 atomicRanges 全面替代手写方向键守卫 (P1)

#### 现状分析与技术根因
`list-navigation.ts` 手写了 296 行逻辑去拦截实体按键的左右方向，但无法约束鼠标拖选和触屏长按。

#### 改造方案
1. 依照 `docs/roadmap/architecture-refactor.md` 的既定规划，将结构性缩进与折叠字符统一注册到 **`EditorView.atomicRanges`** Facet。
2. 彻底由 CodeMirror 6 内核原生的 `skipAtomicRanges` 接管光标跨越逻辑，不仅消灭手写拦截胶水代码，同时自动对齐鼠标选区（Mouse Selection）和触控光标吸附。

---

### 3. 异步媒体资源宽高比占位与 Heightmap 稳定 (P1)

#### 现状分析与技术根因
图片未加载完成前，DOM 高度为 0 或占位符高度。图片异步下载完成后忽然撑开 400px，破坏了 CodeMirror 的视口高度估算（Heightmap），导致滚动条晃动或定位漂移。

#### 改造方案
1. **宽高比元数据透传**：支持在 Markdown 图片扩展语法中解析宽度/高度参数（如 `![alt|300x200](url)`），在 Widget 渲染时预置 `aspect-ratio` 或固定 CSS `min-height`。
2. **Image onload 触发 CM6 尺寸重测**：图片节点完成 `onload` 时，若尺寸与初始估算不一致，主动通知视图重新测量当前行高，避免高度错位。

---

## 五、 统一结构与架构演进 (Architecture) 改造规范

### 1. 中央装饰分发管线 (Decoration Pipeline) (P2)

#### 现状分析
`inline-preview`、`math`、`image`、`table`、`callout` 分别持有自己的 Plugin 或 StateField，多套体系并发运行，状态更新时机不一，生命周期难以追踪。

#### 改造方案
建立统一的装饰管线架构：
```text
State Update (Doc / Selection / Viewport)
                   │
                   ▼
       [Moss Decoration Manager]
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
 [Block Pipeline]      [Inline Pipeline]
   - Tables (StateField)  - Syntax Marks (ViewPlugin)
   - Images (StateField)  - Math (ViewPlugin/StateField)
   - Uploads (StateField) - Callout (ViewPlugin)
```
- 一次事务统一获取语法树，根据节点范围分发给各个功能模块做装饰收集，最终一次性组装为 `RangeSet`，杜绝重复遍历。

---

### 2. 协作适配器（CollabAdapter）细粒度化演进 (P2)

#### 现状分析
当前协作接口以整篇文档纯文本快照为边界，远端变动执行 `[0, doc.length]` 全量覆写。

#### 改造方案
1. 升级 `CollabAdapter` 契约，支持基于 **Changeset（变更向量集）** 或 **Yjs Text CRDT** 的增量同步：
   ```ts
   interface IncrementalCollabAdapter {
     attach(view: EditorView): Promise<void>;
     detach(): void | Promise<void>;
     onRemoteChanges(cb: (changes: ChangeSet, origin?: string) => void): () => void;
     broadcastChanges(changes: ChangeSet): void;
   }
   ```
2. 保证远端协同时，本地未冲突的光标位置、正在聚焦的输入框与折叠状态不被强制销毁。

---

## 六、 实施路线图与落地阶段 (Phased Roadmap)

### 阶段一：移动端阻断级与严重交互缺陷修复 (P0)
- [x] **触屏滚动放行**：改造 `preview-activity.ts`，解除 `pointerType === 'touch'` 时对 Scroller 的 `preventDefault` 阻断，支持滑动与轻触分流判定。
- [x] **触控热区达标**：将移动端环境下的链接交互热区扩展至 44×44px（涵盖行内链接与表格链接）。
- [x] **移动端块插入支持**：由底部移动操作栏（`mossMobileToolbar`）的 `Block (+)` 按钮正式统一承载，侧边悬浮 `+` 按钮在移动端（`pointer: coarse` / 小屏）自动关闭并跳过几何测量，避免误触与空间挤压。
- [x] **虚拟视口与软键盘避让机制**：接入 `window.visualViewport` 动态感知软键盘高度，浮动工具栏与底部面板自适应避让，焦点行自动对齐。
- [x] **E2E 移动端基线**：在 `playwright.config.ts` 中加入 Mobile WebKit 与 Mobile Chrome 测试环境，建立首批移动端保护用例。

### 阶段二：长文性能调优与渲染防抖 (P1)
- [ ] **选区窄失效机制**：重构 `inline-preview.ts` 更新触发逻辑，选区移动时仅针对受影响的前后激活行重绘装饰，消除全篇 $O(N)$ 遍历。
- [x] **LaTeX 公式 LRU 缓存**：在 `features/math/` 中引入内存级 `MathRenderLruCache`（默认 800 条），复用已编译 HTML 字符串，长文滚动与公式挂载开销由毫秒级降至微秒级。
- [ ] **表格单字符输入合并**：对表格单元格输入实施微任务合并与末尾空白保护。
- [ ] **CodeMirror 原生 atomicRanges 落地**：废弃 `list-navigation.ts` 手写跳跃拦截，全量切换至 CM6 标准 atomicRanges。
- [ ] **图片占位与 Heightmap 保护**：实现异步图片的宽高比预占位与 onload 重新测量。

### 阶段三：架构统一与协作能力升级 (P2)
- [ ] **统一装饰调度层**：整合独立 Feature 的 StateField/ViewPlugin，消除并发多重语法树遍历。
- [ ] **增量协同接口升级**：重构 `collab/`，提供基于 Changeset 的非破坏性实时协同适配支持。
- [ ] **React 受控状态平滑接入**：解决 `markdownSource` 未传 `documentId` 时的编辑器误重载问题。

