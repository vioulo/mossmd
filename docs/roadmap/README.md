# MossMD 功能规划与架构演进 (Roadmap)

本文档索引 MossMD 的重点功能落地路线、架构设计思考与生命周期状态。所有功能规划在实施前后均在此归档，作为长期架构资产沉淀。

---

## 核心设计不变量

无论任何新增扩展，均须遵守 MossMD 核心不变量：

1. **`state.doc` 是唯一真实数据源**：所有高级语法预览均为只读装饰（Decorations & Widgets），不产生影子 DOM 数据。
2. **零核心重度绑定**：体积庞大或场景专用的三方排版引擎（如 KaTeX、Mermaid 等）采用适配器或按需注入，保持主包轻量。
3. **输入法（IME）与光标优先**：光标进入目标范围时展开源码，移出恢复预览；行内排版保持文本流连贯，避免破坏输入法合成。
4. **冻结机制防漂移**：鼠标交互过程中利用短暂冻结机制保护视图，消除点击瞬间源码显露带来的光标位置漂移。

---

## 规划与落地状态总览

| 功能模块 | 目标与范围 | 状态 | 规范文档 |
| --- | --- | :---: | --- |
| **数学公式 (LaTeX)** | 行内 `$...$` 与块级 `$$...$$` 预览、排除定界符全选、块级预览卡片对照、可插拔渲染器适配 | ✅ **已落地 (v0.10.0)** | [math.md](./math.md) |
| **架构调优与内核重构** | 图标/语言模块对齐、高亮收归 Core 内置、List 瘦身与 CM6 原生 atomicRanges 演进、Editor 装配解耦（`inline-preview.ts` 拆分已评估否决） | ⏳ **规划中** | [architecture-refactor.md](./architecture-refactor.md) |
| **性能、渲染与移动端调优** | 触屏手势放行与 44px 热区对齐、移动端 Slash Commands 重塑、大文档窄失效与 KaTeX 缓存、展开水平跳动治理、中央装饰管线演进 | ⏳ **规划中** | [performance-rendering-mobile.md](./performance-rendering-mobile.md) |
| **HTML 安全渲染** | 行内 `<mark>`, `<u>`, `<kbd>` 与块级 `<details>` 等 Obsidian 风格标签支持，严格 Allowlist 白名单 | ⏳ **规划中** | [html.md](./html.md) |

---

## 模块文档索引

- [性能、渲染、架构统一与移动端体验调优规划](./performance-rendering-mobile.md)
- [架构调优与内核重构规划](./architecture-refactor.md)
- [数学公式（LaTeX）Roadmap 与架构规范](./math.md)
- [HTML 安全渲染 Roadmap 与安全规范](./html.md)
