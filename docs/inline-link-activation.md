# 行内链接激活协议

普通 Markdown 链接和 Wiki 链接虽然使用不同的解析来源，但必须共享同一套编辑态显隐规则。普通链接来自 Lezer Markdown 的 `Link` 节点，Wiki 链接来自 feature 自己的源码扫描；解析方式可以不同，激活语义不能各自维护。

## 状态规则

行内链接是否显示完整源码，只由以下条件决定：

1. 编辑器拥有焦点。
2. 当前不是阅读模式。
3. 光标或非空选区与链接源码范围相交。

空光标使用包含边界的判断：`from <= cursor <= to`。非空选区使用范围相交判断：`selection.from <= to && selection.to >= from`。因此光标位于链接源码的开头或结尾时，也显示完整源码，保证下一次输入会作用于预期链接。

普通链接和 Wiki 链接都通过 `core/preview-activity.ts` 的 `isPreviewRangeActive()` 实现这套判断。feature 不应重新实现一套“接近链接”或“位于链接内部”的正则逻辑。

## 冻结规则

鼠标 `pointerdown` 到释放尾部期间，装饰保持旧状态，避免源码令牌在鼠标下突然出现导致坐标漂移。

- `previewFrozenField` 是唯一冻结状态。
- 普通链接和 Wiki 链接都读取同一个冻结状态。
- 冻结期间的选区变化只映射旧装饰，不重建显隐结果。
- 解冻事务必须触发一次重建。
- 文档编辑即使发生在冻结期间也必须重建，避免装饰范围落后于新文档。

Wiki 链接自己的点击处理器只负责打开目标和阻止错误的光标移动，不再拥有第二套视觉冻结状态。

## 解析边界

Wiki 链接仍然可以由 feature 扫描，因为它不是 CommonMark 标准节点。扫描器必须继续排除：

- fenced code
- inline code
- 未闭合的 `[[...`
- 空 target

解析来源不同不代表激活规则不同。普通链接的 Lezer 范围和 Wiki 链接的 `ParsedWikiLink.from/to` 都是源码范围，不能使用屏幕距离或 Widget 的视觉宽度代替。

## 行为示例

对于：

```md
查看 [文档](https://example.com) 和 [[project|项目]]。
```

光标位于普通正文时，两个链接都显示为预览文本；进入任一链接或停在其源码边界时，只展开对应链接。两个相邻链接不能因为视觉位置接近而同时展开。

阅读模式或编辑器失焦后，两个链接都保持预览。行内代码中的 `[[project]]` 保持原文，不创建 Wiki 装饰。

| 状态 | 普通链接 | Wiki 链接 |
|---|---|---|
| 阅读模式 | 显示预览 | 显示预览 |
| 编辑器失焦 | 显示预览 | 显示预览 |
| 光标在链接外 | 隐藏 Markdown 语法 | 隐藏 `[[ ]]` |
| 光标在链接内部 | 显示完整源码 | 显示完整源码 |
| 光标位于边界 | 显示完整源码 | 显示完整源码 |
| 非空选区跨过链接 | 显示完整源码 | 显示完整源码 |
| pointerdown 短暂冻结 | 保持旧装饰 | 保持旧装饰 |
| 行内代码中的 Wiki 文本 | 不适用 | 不解析 |

## 改动约束

新增行内链接类语法时，必须：

- 使用 `isPreviewRangeActive()`，不新增同义 helper。
- 接入 `previewFrozenField`，不创建 feature 私有冻结状态。
- 为焦点、边界、非空选区、失焦、阅读模式和冻结期间选区变化添加测试。
- 保证 `state.doc` 始终保留原始 Markdown。

## 测试异常情况 - 暂存

这两个失败都不是你手动操作时看到的视觉问题，主要是测试环境和 CodeMirror 更新时序造成的。

第一个失败发生在阅读模式切换测试：

```ts
view.dispatch({
  effects: readOnly.reconfigure(readOnlyExtension(true)),
});
```

此时编辑器已经 `focus()`，Happy DOM 内部还保留着浏览器选区。CodeMirror 正在处理阅读模式重配置和装饰更新时，Happy DOM 又同步触发了 `selectionchange`，导致 DOMObserver 试图再次调用 `EditorView.update()`，于是抛出：

```text
Calls to EditorView.update are not allowed while an update is in progress
```

调用链大致是：

```text
readOnly reconfigure
  -> WikiLink decoration rebuild
  -> Happy DOM selectionchange
  -> CodeMirror DOMObserver.flush
  -> EditorView.update()
  -> nested update error
```

真实浏览器通常不会以完全相同的同步时序触发这个错误，所以你手动操作没有看到异常。但测试仍然应该避免这种不稳定的 DOM 选区状态，或者把阅读模式切换放到下一轮任务中验证。

第二个失败发生在 resolver 测试。`wikiLinks()` 创建 ViewPlugin 时，会立即调用：

```ts
this.resolveVisibleLinks();
```

也就是 [src/features/wiki-links/index.ts:118](/home/k-k/Documents/kk/mossmd/src/features/wiki-links/index.ts:118)。

测试想验证“光标在链接内部时不调用 resolve”，但 `makeView()` 创建插件时，测试环境中的 `view.hasFocus`、初始 DOM 焦点和选区同步并不稳定。resolver 在测试显式调用 `view.focus()` 之前就可能已经执行了，因此后面的：

```ts
expect(resolve).not.toHaveBeenCalled();
```

失败。

这不是解析接口本身的问题，而是测试把“编辑器初始未聚焦”和“插件创建后的第一次解析”绑定在了一起。更稳定的测法应该是：

1. 创建编辑器后明确让它失焦；
2. 等待初始化任务完成；
3. 清空 mock；
4. 再 focus 并设置光标；
5. 验证光标在链接中时不解析，移出后才解析。

所以目前可以这样理解：

- 渲染交互本身没有发现新的视觉问题。
- 第一个是 Happy DOM 的选区同步与 CodeMirror 更新重入。
- 第二个是 resolver 初始化时机与测试焦点状态不确定。
- 这两个失败需要修测试时序，不能简单当作 Wiki 渲染逻辑错误。
