# Dynamic Task Splitting Design — 前端 Spec (v2)

## 背景

Multica 当前 workflow 每个节点只能产出 0~1 个子 issue。当遇到"一个父任务需要拆分为 N 个子任务协同完成"的场景，用户只能手动逐个创建、逐个指派 workflow，无法在父任务中持续追踪整体进度。

本设计为 workflow 新增"任务拆分节点"（Split Node），由 Agent 根据上下文智能生成子任务列表，经人审核后批量创建子 issue，各自绑定独立 workflow 并行执行；父 workflow 能聚合展示所有子任务的实时进展。

**v2 修订要点**（相比 2026-07-12 版设计）：
- 审核面板简化为"预览列表 + NL 对话"，去掉手动编辑 UI 和 DAG 画布
- 全景图支持点击展开子节点，复用现有 runtime-node-card 样式
- 所有草案增删改统一通过 `/split/chat` + Agent draft API 完成

**本文定位**：前端审核面板、全景图子节点、组件变更的权威定义。后端 API 契约、数据模型、生命周期详见 `2026-07-14-dynamic-task-splitting-design-backend.md`。

## 目标

- 拆分节点在画布上以聚合徽章展示整体进度；点击展开为子节点群
- 审核面板复用现有 issue 详情的评论驱动任务模式，NL 指令 + Agent 响应
- 子节点复用现有 `RuntimeNodeCard` 样式和交互模型
- 依赖关系以 ASCII 字符图展示（审核面板）和连线展示（全景图展开态）

## 设计原则

- **审核面板只读预览 + NL 对话**：不走复杂编辑 UI 路线，任何增删改都通过 `/split/chat` 完成
- **复用现有基础设施**：CommentInput、InlineTranscriptPanel、RuntimeNodeCard、ExecutionDetailPanel 等
- **success-first**：前端不参与草案恢复逻辑，只管展示后端返回的草案和状态

## 架构概览（前端视角）

```
┌─────────────────────────────────────────────────┐
│  画布 (ReactFlow Canvas)                         │
│  ├─ 拆分节点卡片 (kind=split)                    │
│  │  ├─ 收起态: 聚合徽章 "3 done · 1 failed"      │
│  │  └─ 展开态: 子节点群 + 依赖连线               │
│  └─ 子节点复用 runtime-node-card 样式             │
├─────────────────────────────────────────────────┤
│  审核面板（ExecutionDetailPanel 抽屉）            │
│  ├─ 子任务预览列表（只读卡片）                    │
│  ├─ NL 对话区（复用 chat session 基础设施）       │
│  └─ Agent 转录（InlineTranscriptPanel）           │
├─────────────────────────────────────────────────┤
│  API 消费层                                       │
│  ├─ useSplitTasks() — GET /split/tasks           │
│  ├─ useSplitChat() — POST /split/chat            │
│  ├─ useSplitApprove() — POST /split/approve      │
│  ├─ useSplitGenerate() — POST /split/generate    │
│  ├─ useSplitCancel() — POST /split/cancel        │
│  └─ WS 事件: split tasks 失效 + chat message 推送 │
└─────────────────────────────────────────────────┘
```

## 审核面板设计

审核面板是本次设计的核心变化。不走"复杂编辑 UI"路线，而是复用现有 issue 详情的评论驱动任务模式。

**触发方式**：在全景图中点击 split 节点（复用现有 `ExecutionDetailPanel` 抽屉打开机制），面板内容根据节点状态展示审核视图或进度视图。

### 布局

```
┌─────────────────────────────────┐
│ 任务拆分审核                     │
│ 模式: barrier · 并发: 5          │
│ ─────────────────────────────── │
│                                 │
│ [子任务预览列表 — 只读]          │
│ ┌─────────────────────────┐    │
│ │ ☑ 1. 迁移 user-service  │    │
│ │    负责人: agent-3       │    │
│ │    依赖: 1               │    │
│ ├─────────────────────────┤    │
│ │ ☑ 2. 迁移 payment-svc   │    │
│ │    负责人: agent-5       │    │
│ │    依赖: 1               │    │
│ └─────────────────────────┘    │
│                                 │
│ [对话框]                        │
│ ┌─────────────────────────┐    │
│ │ > 把安全审计拆成独立任务  │    │
│ │ AI: 已拆分，列表已更新   │    │
│ └─────────────────────────┘    │
│ ─────────────────────────────── │
│ [✕ 取消]  [确认创建 (3个)]       │
└─────────────────────────────────┘
```

### 功能覆盖（复用 issue 详情已有能力）

| 现有能力 | 复用方式 |
|---------|---------|
| 评论驱动任务 | `CommentInput` 发 NL 指令 → `/split/chat` → agent dispatch |
| 任务状态实时更新 | `task:*` WS 事件 → `setQueryData` 驱动面板头部状态 |
| 执行转录 | `InlineTranscriptPanel` + `TaskTranscriptTimeline` 展示 agent thinking |
| 产物预览 | agent 输出 = 更新后的草案列表，预览区实时刷新 |
| 对话流 | NL 指令和 agent 回复形成多轮对话历史 |
| Agent 活动指示 | 面板头部状态条 "正在调整草案...""草案已更新" |
| 重试/取消 task | agent 处理中可取消（恢复上轮），失败后可重试 |
| 附件上传 | NL 指令可附带参考文件 |
| 确认防呆 | "确认创建"带二次确认对话框 |

### 编辑能力

通过 NL 指令覆盖以下场景：
- **增**: "为安全审计添加一个独立任务"
- **删**: "删除任务 3"
- **改**: "把任务 1 的标题改为『迁移核心数据库』""所有任务改成 agent-7 负责"
- **合**: "合并任务 2 和 3"
- **拆**: "把支付模块拆成前端和后端两个独立任务"
- **依赖**: "任务 4 依赖任务 2 和 3 完成后再开始"
- **恢复**: "恢复到 Agent 最初生成的草案"

### 依赖关系展示

依赖关系以 **ASCII 字符图**展示，内嵌在预览区域顶部（渲染为 Markdown 代码块 / monospace），无需引入额外绘图库：

```
任务 1 ──┬── 任务 3 ── 任务 4
         │
         └── 任务 2
```

每个子任务卡片中也以文字标签标注依赖（"依赖：任务 1、2"），ASCII 图和文字标签互补。依赖调整通过 NL 指令完成。

## 全景图设计

### 收起态

split 节点默认显示紧凑卡片 + 聚合徽章：
```
┌──────────────────────────┐
│ ⚡ 任务拆分              │
│ 3 done · 1 failed · 2 running │
│ [点击展开 ▼]             │
└──────────────────────────┘
```

### 展开态

点击展开后，子 issue 节点以**二级节点**形式出现在 split 节点周围：
- 子节点复用现有 `runtime-node-card` 样式和设计 token
- 依赖关系以连线展示（全景图天然是画布视图，连线是自然表达）
- 子节点状态通过 WS 实时更新（复用现有 `workflow:node_run_updated` 链路）

**子节点交互**（复用现有 `RuntimeNodeCard` 的操作模型）：
- 点击跳转到子 issue 详情页
- 悬停看摘要（标题、状态、负责人）
- 失败节点可直接重试
- 运行中节点可直接取消

**收起逻辑**：
- 点击 split 节点 / 画布空白 → 收起
- 切换页面再回来 → 默认收起
- 状态变更时保持当前展开/收起状态

## 组件变更

### 删除的前端组件

原设计中以下组件不再需要：
- `split-task-list.tsx` — 手动编辑控件
- `split-task-dag.tsx` — DAG 可视化画布

v2 迁移时需要删除或降级这些组件的审核期编辑入口。审核面板只能展示只读预览列表、依赖 ASCII 图、对话区和确认操作；任何增删改都必须经 `/split/chat` 完成。

### 保留/修改的前端组件

- `split-review-panel.tsx` → 改为预览列表 + 对话区
- `split-node-card.tsx` → 不变
- `split-progress-badge.tsx` → 不变
- `split-config-panel.tsx` → 不变

## 边界（不在第一期范围）

- 三层及以上嵌套
- 条件分支拆分（根据上游输出动态决定拆分数量）
- 拆分节点作为子模板的一部分
- 子任务间的数据传递（除上下文注入外）
- split_active 期间动态添加子任务
- 子任务的子任务（孙子层）

## 测试策略（前端）

### TypeScript 测试

- `packages/core/types/workflow.test.ts`: `parseNodeFormat` split 类型解析
- `packages/core/api/schemas.test.ts`: split API 响应 malformed fallback 测试
- `packages/views/`: 审核面板只读预览、NL 对话提交、split 节点卡片、展开/收起子节点
- 确认创建请求只发送 `approved_task_ids`，不发送 `modifications`

### E2E 测试

- 完整流程: 创建父 issue → Split 节点激活 → Agent 生成拆分 → NL 调整 → 确认创建 → barrier 完成
- pipeline 模式: 子任务创建即释放下游
- 审核 NL 调整: 增删合并子任务、调依赖、恢复原始草案，刷新页面后 chat 历史仍存在
- 全景图展开: 子节点可见、依赖连线、操作入口
- 取消级联: 父节点取消 → 子任务全部停止
