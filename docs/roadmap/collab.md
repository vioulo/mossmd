# MossMD 实时协同与分布式数据同步架构演进 (Collab Roadmap)

本文档系统性梳理 MossMD 在**多人实时协作 (Real-time Collaboration)** 与 **多端分布式同步 (Multi-device Sync)** 维度的长期技术演进方向，作为未来拓展团队协作或局域网共享编辑时的架构储备资产。

---

## 一、 背景与定位分析

### 1. 个人知识管理优先 (PKM-First)
MossMD 的核心定位是面向个人知识库与单人沉浸式写作的 Obsidian 风格 Markdown 编辑器：
- 绝大多数核心场景为个人本地笔记、静态站点博客撰写、单人多端云盘同步（如 iCloud、Git、Syncthing、自建 WebDAV / S3）。
- 在单人使用场景下，文档的写冲突概率极低，主要关注的是**渲染流畅度、大文档输入性能、键盘导航手感与移动端触控体验**。

### 2. 当前协同实现（快照边界）
当前 `src/collab/index.ts` 提供了极简的整文档快照适配接口：
```ts
export interface CollabAdapter {
  attach(view: EditorView): Promise<void>;
  detach(): void | Promise<void>;
  onRemoteChange(cb: (doc: string) => void): () => void;
  getAwareness?(): unknown;
}
```
该接口已能满足“外部文件修改通知”、“多标签页快照同步”或“云端文件拉取刷新”等低频单向同步需求。

---

## 二、 未来协同演进技术路线储备

若未来 MossMD 拓展多人在线评审、团队实时共创或协同画布场景，可循序演进以下三种方案：

```text
┌───────────────────────────────────────────────────────────────┐
│                     MossMD 协同演进路线图                      │
├───────────────────────────────┬───────────────────────────────┤
│ 阶段一：快照同步（当前实现）     │ 阶段二：CM6 Changeset 中心同步 │
│ 适合：个人文件外部变动刷新     │ 适合：轻量私有服务端中继协作  │
│ 特点：整篇替换，低频单向       │ 特点：体积极小，中心化 Rebase │
├───────────────────────────────┴───────────────────────────────┤
│ 阶段三：Yjs / Automerge CRDT 去中心协同 (P2P / 毫秒级多人协作)  │
│ 适合：多人富交互共创、光标广播、离线合并                      │
│ 特点：强一致性，支持 Y.Text 与 Awareness 广播                 │
└───────────────────────────────────────────────────────────────┘
```

### 方案 A：基于 CodeMirror 6 官方 `@codemirror/collab` 的轻量中心协同

#### 1. 适用场景
团队内部搭建小型中继服务器，多人在同一局域网或云端服务上协作，无需引入庞大的 CRDT 运行时。

#### 2. 技术机制
- 利用 CM6 原生内置的 `ChangeSet`（变更向量集）与版本号 `version` 进行 OT（操作转换 / Rebase）：
  ```ts
  import { collab, receiveUpdates, sendableUpdates } from '@codemirror/collab';

  interface CentralCollabAdapter {
    attach(view: EditorView): Promise<void>;
    sendUpdates(version: number, updates: readonly ChangeSet[]): Promise<boolean>;
    receiveUpdates(version: number, updates: readonly ChangeSet[]): void;
  }
  ```
- 优势：零额外第三方重量级依赖，包体积几乎零增加；完美贴合 CM6 内部事务机制。

---

### 方案 B：基于 Yjs CRDT 的去中心/点对点协同 (P2P & Local-First)

#### 1. 适用场景
多人实时头脑风暴、分布式离线再合并、以及需要广播多人光标位置与头像浮标（Awareness）的场景。

#### 2. 技术机制
- 核心依赖：`yjs` + `y-codemirror.next` + 传输提供者（`y-websocket` 或 `y-webrtc`）：
  ```ts
  import * as Y from 'yjs';
  import { yCollab } from 'y-codemirror.next';

  export class YjsCollabAdapter implements CollabAdapter {
    private ydoc = new Y.Doc();
    private ytext = this.ydoc.getText('mossmd');
    private provider: any;

    async attach(view: EditorView) {
      // 挂载 yCollab extension 到 view
    }
  }
  ```
- **光标广播 (Awareness)**：利用 Yjs 的 `awareness` 协议广播远程协作者的光标选区（`selection`）与用户信息（用户名、颜色、头像），通过 CM6 浮层装饰绘制远程光标。
- **冲突自愈**：利用 CRDT 状态向量数学模型保证并发打字时无需中心锁即可实现强最终一致性。

---

## 三、 架构防御边界与不变量原则

无论未来采用何种协同方案，必须严格恪守以下防御红线：

1. **外挂式架构，核心解耦**：
   协同逻辑必须严格封装在独立适配器中，**严禁将 `yjs`、`automerge` 或中心化网络通信代码强行捆绑进 `mossmd` 主包**。消费方只有在显式传入 `collabAdapter` 时才按需加载对应模块。
2. **原始 Markdown 唯一信源不变**：
   CRDT 数据结构（如 `Y.Doc`）仅作为网络传输与合并通道；编辑器落盘、剪贴板导出与生命周期快照**永远以纯文本 Markdown 为唯一物理事实**。
3. **自定义结构事务隔离**：
   对于表格（Table）、数学公式（Math）、图片（Image）等 Block Widget，协同同步必须维持行级语义边界，防止远端细粒度字符插入破坏表格的 Markdown 分隔线或数学公式定界符。

---

## 四、 当前决策与实施排期

- **当前状态**：**已独立归档储备，暂不实施代码变动**。
- **激活条件**：当产品路线出现明确的多人实时协同、共享编辑室或团队知识库需求时，启动该方案评估与接入。

