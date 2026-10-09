# 文件上传实现

本文档记录 MossMD 当前的文件上传边界和实现约定。它描述已经存在的 API，不是待执行的开发计划。

## 输入与结果

`fileUpload` 统一处理文件选择、粘贴、拖拽和批量输入。每个输入都是浏览器 `File`，默认按 MIME 类型分流：

- `image/*` 生成 `![name](url)`，完成后进入图片块。
- 其他文件生成 `[name](url)`，完成后进入文件块。

通过 `resolveKind` 可以覆盖默认分类。普通文件和图片共用同一个 `MossUploader`，上传器只负责把文件转换为 URL：

```ts
type MossUploader = (
  file: File,
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
) => Promise<{ url: string; kind?: 'image' | 'file' }>;
```

## 配置

```tsx
<MossMD
  markdownSource={markdown}
  fileUpload={{
    uploader,
    maxFiles: 20,
    maxFileSize: 20 * 1024 * 1024,
    maxConcurrency: 3,
    accept: ['image/*', '.pdf'],
  }}
/>
```

`MossFileUploadConfig` 支持：

- `resolveKind`：自定义图片/文件分类。
- `maxFiles`、`maxFileSize`、`maxTotalSize`：输入限制。
- `maxConcurrency`：并发上传数，默认值为 3。
- `accept`：MIME 类型或文件扩展名过滤。
- `onRejected`：输入被限制时接收文件和拒绝原因。
- `icons`、`iconMap`：覆盖上传状态块的图标。

Slash command 上传继续通过 `mossUploadCommands(uploader)` 提供；它与 `fileUpload` 共用上传器类型，但两者是独立的触发入口。

## 生命周期与约束

- 上传中的条目只存在于 CodeMirror 状态和运行时队列，不写入 Markdown。
- 进度、失败、重试和取消按条目维护；取消使用 `AbortSignal` 传给上传器。
- 同一批次按输入顺序插入最终 Markdown，不受网络完成顺序影响。
- 有选区时替换选区，没有选区时从光标处插入；每个文件生成独立的 Markdown 块。
- 只读模式不启动文件上传；纯文本粘贴仍交给 CodeMirror。
- 表格单元格的专用粘贴行为优先，不会被通用文件上传覆盖。
- 编辑器销毁时清理上传队列和本地预览 URL。

## 测试位置

上传解析、过滤、并发、顺序、取消、重试和只读行为位于 `src/__tests__/upload.test.tsx`。真实拖拽、粘贴和浏览器权限相关行为应补充到 `tests/e2e`，发布前同时运行：

```bash
bun run typecheck
bun run test
bun run build
bun run test:e2e
```
