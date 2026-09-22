# 文件拖拽、粘贴与批量上传执行方案

## 1. 目标

在不破坏 MossMD 原始 Markdown 数据源、表格编辑、IME 和只读模式的前提下，补齐图片与普通文件的：

- 拖拽上传
- 粘贴上传
- 批量上传

已有的 Slash / `+` 单文件上传继续可用，并复用新的上传队列和插入逻辑。

## 2. 核心决策：输入统一，语义分流

图片和普通文件在输入层统一视为浏览器 `File`：

```text
选择器 / 剪贴板 / 拖拽
        -> File[]
        -> 校验与过滤
        -> MossUploadItem[]
        -> 统一上传队列
        -> 依据 kind 生成 Markdown
```

上传器不区分图片和文件，继续使用一个 `MossUploader`。这样可以统一处理进度、失败、重试、取消、并发和批量顺序。

在语义和展示层保留两种类型：

```ts
type MossUploadKind = 'image' | 'file';

interface MossUploadItem {
  file: File;
  kind?: MossUploadKind;
}
```

原因是最终结果不同：

- `image` 生成 `![name](url)`，进入图片块预览和图片编辑能力。
- `file` 生成 `[name](url)`，进入文件块卡片和下载能力。

默认分类规则为 `file.type.startsWith('image/')` 归为 `image`，其余归为 `file`。配置应允许消费者覆盖分类，以便把 SVG、特殊媒体类型或后端返回的资源按业务需要处理。

## 3. 用户行为约定

第一版采用以下规则：

1. 粘贴或拖拽到编辑器时，只拦截确实包含文件的事件；纯文本粘贴和纯文本拖拽保持 CodeMirror 默认行为。
2. 文件插入点使用当前选区。存在选区时替换选区；没有选区时从光标处插入。
3. 每个文件生成一个独立 Markdown block，避免图片或文件链接与用户原有段落粘连。
4. 同一批次按输入顺序插入，即使网络完成顺序不同，也不能改变文档中的文件顺序。
5. 多文件上传显示独立进度、失败和重试状态；取消单个项目不会影响同批次其他项目。
6. 只读模式不触发文件上传，也不阻止已有的普通文本阅读行为。
7. 表格单元格的专用粘贴逻辑优先；在表格单元格内不启动文件上传。
8. 默认不处理拖入的外部 URL、HTML `<img>` 或文件夹。后续可作为独立增强项加入。

## 4. 分阶段执行

### P0：重构上传基础设施

目标：让现有单文件上传具备承载粘贴、拖拽和批量的基础。

- 将“完成后替换整行”改为“在稳定插入范围插入最终 Markdown”。
- 统一处理插入前后的换行，保证每个结果是独立 block。
- 为上传条目增加批次 ID、序号、插入范围和状态。
- 批量项目采用输入顺序提交；网络结果先缓存，按序落文档。
- 给 `MossUploader` 增加可选取消信号，优先使用 `AbortController`。
- 上传成功前校验 `url` 非空，并对文件名和 URL 做 Markdown 安全处理。
- 编辑器销毁、文档切换、取消和成功时都释放运行时状态与 `Object URL`。
- 保证已有 Slash / `+` 上传行为不回归。

建议的兼容接口形态：

```ts
type MossUploader = (
  file: File,
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
) => Promise<MossUploadResult>;
```

第三个参数可选，现有上传器无需立即修改即可继续工作。

### P1：单文件粘贴与拖拽

新增统一的文件输入扩展或 controller，接入：

```ts
EditorView.domEventHandlers({
  paste(event, view) {},
  dragover(event, view) {},
  drop(event, view) {},
});
```

实现要求：

- 同时读取 `dataTransfer.files` 和 `dataTransfer.items` 的 `getAsFile()`。
- 剪贴板截图等没有文件名的内容生成稳定的默认名称。
- `dragover` 只有在存在可处理文件时才 `preventDefault()`。
- `drop` 计算文档位置并提交给统一上传队列。
- `paste` 先检查 `event.defaultPrevented`，不覆盖表格单元格逻辑。
- 检查 `readOnly` facet，禁止只读模式启动上传。
- 无文件的文本粘贴、文本拖拽继续交给 CodeMirror。

### P2：批量上传

- 文件选择器增加 `multiple`，并通过同一队列处理选择、粘贴和拖拽得到的 `File[]`。
- 增加最大文件数、单文件大小、总大小和 MIME 白名单配置。
- 增加并发上限，默认建议为 3。
- 已开始项目支持取消；未开始项目取消时不发起请求。
- 每个项目保留自己的进度、错误、重试和取消状态。
- 所有项目最终按原始输入顺序插入。
- 批次全部失败或部分失败时保留明确状态，不丢失成功项目。

## 5. 建议的公开配置

可以在现有 `MossMDProps` 增加一个独立配置，避免消费者手工拼装扩展：

```ts
interface MossFileUploadConfig {
  uploader: MossUploader;
  resolveKind?: (file: File) => MossUploadKind;
  maxFiles?: number;
  maxFileSize?: number;
  maxTotalSize?: number;
  maxConcurrency?: number;
  accept?: string | readonly string[];
}
```

```ts
interface MossMDProps {
  fileUpload?: MossFileUploadConfig;
}
```

`slashCommandsConfig` 中的 `mossUploadCommands(uploader)` 保留，用于需要自定义命令面板的消费者；底层队列和 Markdown 插入逻辑必须共用。

## 6. 不建议第一版做的内容

- 文件夹拖拽和目录递归读取。
- 外部图片 URL 拖入后的自动下载上传。
- HTML 剪贴板中的 `<img src>` 抓取。
- 上传队列跨页面刷新恢复。
- 为图片和普通文件分别设计两套 uploader API。
- 把 pending 上传状态写入 Markdown。pending 仍应只存在于 CodeMirror 状态中。

## 7. 测试矩阵

### 单元与 DOM 测试

- `File[]` 提取：`dataTransfer.files`、`dataTransfer.items`、剪贴板截图。
- 图片和普通文件的默认分类及自定义分类。
- 文件名特殊字符、空文件名、空 URL 和非法 URL。
- 选区替换、光标中间插入、段首和段尾插入。
- 多文件输入顺序与异步完成顺序不同的情况。
- 单个失败、重试、取消和批次部分成功。
- 并发上限和未开始任务取消。
- 表格单元格粘贴不被通用上传处理覆盖。
- 只读模式不上传，纯文本粘贴仍正常。
- 编辑器销毁后没有残留 runtime 或 Object URL。

### E2E 测试

- 浏览器真实拖入图片并生成图片 Markdown。
- 浏览器真实拖入普通文件并生成文件 Markdown。
- 粘贴截图生成图片块。
- 一次拖入或选择多个文件，验证顺序和进度状态。
- 上传中编辑文档，验证结果不会覆盖相邻用户文本。

## 8. 完成标准

- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run test:e2e`
- 现有 Slash / `+` 上传测试全部通过。
- 原始 `state.doc` 只包含最终 Markdown，不包含 pending 标记或 widget 文本。
- 图片仍进入图片块能力，普通文件仍进入文件块能力。
- 纯文本粘贴、表格粘贴、IME 输入和只读模式行为不回归。
