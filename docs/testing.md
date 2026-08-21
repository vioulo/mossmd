# 测试

测试 harness 有四层。每一层捕获一类不同的回归，CI 会跑全部四层。

## 快速集成测试

`bun test` 在 Happy DOM 上运行测试。这一层用于解析、装饰、编辑器状态和不依赖真实浏览器布局的渲染契约。

与浏览器套件共享的 Markdown 边界情形位于 `src/__tests__/fixtures/markdown-contracts.ts`。当同一输入/输出规则应该在两个环境中都被强制时，在那里添加用例。

## 确定性浏览器测试

`bun run test:e2e` 针对 `demo/harness.html` 运行 `tests/e2e` 下的规格。该 fixture 刻意排除了交互式 demo 的控制项和示例数据，给每个测试一个固定的视口、隔离的编辑器以及明确的 load/focus/source API。

Chromium 运行每个规格。Firefox 和 WebKit 运行标记为 `@smoke` 的测试，覆盖挂载、渲染、编辑和只读行为。失败会保留 trace、video 和截图（`test-results`）以及 HTML 报告（`playwright-report`）。

使用 `bun run test:e2e:headed` 交互式调试 Chromium 套件。

## Legacy 浏览器探针

（可选）针对长文档与时序敏感行为的宽泛探针套件，包括布局漂移、滚动、点击冻结、块装饰、原始 markdown 复制和解析进度。

## 发布包冒烟测试

`bun run test:package` 会创建真实的 npm tarball，在干净的临时消费方中安装它，导入文档化的入口点与样式表，并用 Vite 构建该消费方。这能在发布前捕获缺失文件、损坏的导出映射和仅限包内的模块解析失败。

CI 还会运行 `bun audit --audit-level=moderate`。Dependabot 每周检查 npm 与 GitHub Actions 依赖。

## 添加回归测试

对每个 bug 修复，选择能复现失败的最低层：

1. 为逻辑、状态和 DOM 契约添加 `bun test` 用例。
2. 如果它也是可见的浏览器渲染契约，把输入加入共享 Markdown 语料。
3. 为焦点、键盘、几何、无障碍媒体或浏览器特定行为添加确定性 Playwright 规格。
4. 仅在涉及公共 tarball 或导出时添加包冒烟断言。

回归应在有 bug 的实现上失败、在修复后通过。保持所有 Markdown 源码断言精确，这样视觉上的改进就不会掩盖往返数据变更。