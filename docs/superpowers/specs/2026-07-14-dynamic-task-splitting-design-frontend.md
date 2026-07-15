# Dynamic Task Splitting Design — 前端 Spec (v2)

## 背景

Multica 当前 workflow 每个节点只能产出 0~1 个子 issue。当遇到"一个父 issue 需要拆分为 N 个子 issue 协同完成"的场景，用户只能手动逐个创建、逐个指派 workflow，无法在父 issue 中持续追踪整体进度。

本设计为 workflow 新增"任务拆分节点"（Split Node）：由智能体根据上下文生成子 issue 草案，经用户审核后批量创建子 issue，各自绑定独立 workflow 并行执行；父 workflow 聚合展示所有子 issue 的实时进展。

**v2 修订要点**（相比 2026-07-12 版设计）：

- 审核面板简化为"只读预览 + 对话调整"，移除手动编辑表单和审核期 DAG 画布。
- 全景图支持展开子 issue 节点，复用现有 `RuntimeNodeCard` / `SplitNodeCard` 的卡片语言。
- 草案增删改统一通过 `/split/chat` 和智能体 draft API 完成，前端只展示后端返回的最新草案。
- UI/UX 明确对齐当前工作流画布、节点详情抽屉、issue 评论输入和执行转录体验。

**本文定位**：定义前端审核面板、全景图子节点、组件变更、视觉与交互约束。后端 API 契约、数据模型、生命周期详见 `2026-07-14-dynamic-task-splitting-design-backend.md`。

## 目标

- 拆分节点在画布上以紧凑卡片和聚合徽章展示整体进度；点击后可展开子 issue 节点群。
- 审核面板复用现有 issue 详情的评论驱动任务模式：用户提交自然语言指令，智能体返回更新后的草案。
- 子 issue 节点复用现有 `RuntimeNodeCard` 的尺寸、状态、操作和连线模型，降低学习成本。
- 依赖关系在审核面板中用轻量文本图和标签展示，在全景图展开态用 ReactFlow 连线展示。
- 交互必须在桌面和较窄面板下保持可读：长标题截断、内容区域滚动、底部操作固定、状态清晰。

## 非目标

- 不在审核面板提供逐字段表单编辑、拖拽排序、DAG 编辑或多选批量操作。
- 不为审核期依赖图引入额外绘图库；全景图已有 ReactFlow 能力时才使用连线。
- 不在前端实现草案恢复、依赖重算或冲突解决算法；这些由后端和智能体负责。
- 不创建独立视觉体系；必须使用现有 shadcn/Base UI 组件、语义 token 和工作流节点布局。

## 设计校准（frontend-design）

**具体主题**：AI-native 团队在 workflow 运行中审核一次"拆分计划"。用户真正要做的不是编辑图，而是回答三个问题：

1. 这批子 issue 是否覆盖了父 issue 的目标？
2. 依赖和负责人是否会让执行卡住？
3. 现在能不能放心确认创建？

**视觉方向**：审核面板应像一个"任务分诊台"，不是表单编辑器。第一屏给出可执行结论，中段让用户快速扫完整个草案，底部保留自然语言修正和确认操作。界面要安静、清晰、有层次，不做装饰型卡片堆叠。

**Token 使用**：

- 颜色只使用语义 token：`bg-background`、`bg-card`、`bg-muted/20`、`text-foreground`、`text-muted-foreground`、`border-border`、`text-destructive`、`text-primary`、`ring-ring`。
- 状态色沿用现有约定：失败使用 `destructive`，运行/等待使用 muted/foreground 层级，完成沿用现有 success 变量或 `SplitProgressBadge` 的实现。
- 圆角遵循现有组件：面板和 section 使用 `rounded-lg`，按钮使用 shadcn 默认圆角，不引入更大的装饰性圆角。
- 阴影仅用于 overlay 抽屉和画布卡片已有层级，不新增大面积投影。

**字体与密度**：

- 沿用当前应用字体，不新增字体。
- 面板标题使用 `text-sm font-medium`，section 标题使用 `text-sm`，元信息使用 `text-[11px]` 或 `text-xs`。
- 草案行高以扫描效率为先：每个子 issue 预览 56~72px，最多两行正文摘要，长文本必须 `truncate` 或 `line-clamp-2`。

**签名交互**：拆分节点的特色是"可确认的草案清单"。每个子 issue 以稳定编号、标题、负责人、依赖、风险标记呈现；自然语言对话只改变清单内容，不把用户带入第二套编辑模式。

## 设计原则

- **只读预览 + 对话调整**：审核面板不出现标题输入框、描述 textarea、依赖 checkbox 或删除按钮。任何增删改都通过 `/split/chat` 完成。
- **先判断，后操作**：打开面板后，用户首先看到状态摘要和可创建数量，其次看到子 issue 草案，最后才是对话和确认操作。
- **复用现有基础设施**：优先使用 `WorkflowNodeDetailPanelShell`、`NodeDetailSection`、`CommentInput`、`InlineTranscriptPanel`、`TaskTranscriptTimeline`、`RuntimeNodeCard`、`SplitNodeCard`、`SplitProgressBadge`。
- **画布一致性**：全景图里的 split 节点和子节点必须使用现有工作流节点尺寸、边、handle、focus ring、hover 行为。
- **success-first**：前端展示后端返回的草案、状态和进度；失败时提供重试/取消入口，但不在本地修补草案。
- **低干扰反馈**：状态变化优先在 badge、toast 和 section 状态位中体现，不用大面积警告块打断审核流程，除非确认创建会产生不可逆影响。

## 架构概览（前端视角）

```
┌──────────────────────────────────────────────────────┐
│  画布（ReactFlow Canvas）                             │
│  ├─ SplitNodeCard（kind=split）                       │
│  │  ├─ 收起态：标题 + 模式/进度 badge                 │
│  │  └─ 展开态：子 issue RuntimeNodeCard + 依赖连线    │
│  └─ 子 issue 节点复用 runtime-node-card 样式           │
├──────────────────────────────────────────────────────┤
│  审核面板（WorkflowNodeDetailPanelShell overlay）      │
│  ├─ Header：节点标题、状态 badge、SplitProgressBadge   │
│  ├─ Verdict：是否可创建、风险摘要、关键数字            │
│  ├─ Draft plan：只读子 issue 草案列表                  │
│  ├─ Dependencies：轻量文本依赖图 + 标签                │
│  ├─ Ask agent：CommentInput + 对话历史                 │
│  ├─ Transcript：InlineTranscriptPanel                 │
│  └─ Sticky footer：取消 / 确认创建                     │
├──────────────────────────────────────────────────────┤
│  API 消费层                                           │
│  ├─ useSplitTasks() — GET /split/tasks                │
│  ├─ useSplitChat() — POST /split/chat                 │
│  ├─ useSplitApprove() — POST /split/approve           │
│  ├─ useSplitGenerate() — POST /split/generate         │
│  ├─ useSplitCancel() — POST /split/cancel             │
│  └─ WS：split tasks query 失效 + chat/transcript 推送  │
└──────────────────────────────────────────────────────┘
```

## 审核面板设计

审核面板是本次设计的核心变化。它应从用户视角重新组织：先给判断，再给证据，最后给修正和确认。用户打开面板时不需要先理解 split node 的内部机制，而是立刻知道"这份草案是否可创建"。

**触发方式**：在全景图或运行视图中点击 split 节点，复用现有 `WorkflowNodeDetailPanelShell` overlay 打开机制。面板根据 `nodeRun.status` 展示待审核、生成中、运行中、失败或完成状态。

### 用户任务

面板围绕 5 个连续动作设计：

1. **看结论**：草案是否 ready、会创建几个子 issue、是否有阻塞风险。
2. **扫清单**：每个子 issue 做什么、谁负责、依赖谁。
3. **查依赖**：是否有串行链路过长、循环依赖、缺失上游。
4. **说修改**：用自然语言让智能体调整，不手动改字段。
5. **确认创建**：确认后批量创建子 issue 并启动对应 workflow。

### 推荐布局

```
┌────────────────────────────────────────────┐
│ Split review                         [x]   │
│ 任务拆分 · 迁移支付链路                     │
│ [awaiting_review] [barrier] [3 ready]      │
├────────────────────────────────────────────┤
│ Ready to create                            │
│ 3 个子 issue · 2 个智能体 · 1 条依赖链       │
│ No blocking risk                           │
│ [查看运行设置]                              │
├────────────────────────────────────────────┤
│ Draft plan                                 │
│ 01 迁移 user-service        agent-3  ready │
│    API 与 schema 迁移                       │
│    依赖：无                                │
│ 02 迁移 payment-svc         agent-5  ready │
│    支付回调和账单逻辑                       │
│    依赖：01                                │
│ 03 安全审计                 agent-7  ready │
│    覆盖迁移后的权限和日志                   │
│    依赖：01, 02                            │
├────────────────────────────────────────────┤
│ Dependencies                               │
│ 01 ──┬── 02                                │
│      └── 03                                │
│ Critical path: 01 → 02                     │
├────────────────────────────────────────────┤
│ Ask agent to adjust                        │
│ "把安全审计拆成权限和日志两个 issue"         │
│ [输入调整要求...]                    [send] │
│ [Agent transcript v]                       │
├────────────────────────────────────────────┤
│ [取消拆分]                    [确认创建 3] │
└────────────────────────────────────────────┘
```

### 1. Header：定位当前审核对象

- `eyebrow` 使用英文实体语境：`Split review`、`Split progress`、`Split failed`。
- 主标题使用节点标题，单行截断。
- Header badges 按顺序展示：`nodeRun.status`、`SplitProgressBadge`、可选 `Mode: barrier/pipeline`。
- 关闭按钮使用现有 `X` icon button 和 `closeLabel`，不新增文字按钮。
- Header 不承担主要解释职责；解释放到下方结论区，避免顶部拥挤。

### 2. Verdict section：第一屏结论

这是审核面板的第一视觉焦点，回答"能不能创建"。

内容：

- 主结论：`Ready to create`、`Needs adjustment`、`Generating draft`、`Split failed`、`Running child issues`。
- 摘要数字：子 issue 数、智能体/成员数量、依赖链数量、阻塞风险数量。
- 一句解释：例如 `No blocking risk`、`2 个 issue 缺少负责人`、`Agent 正在调整草案...`。
- 次要入口：`查看运行设置`，展开显示 mode、concurrency、max failures；默认不占第一屏空间。

视觉：

- 结论区应比普通 section 更醒目，但不做营销式 hero。使用 `rounded-lg border bg-muted/20 px-3 py-3`。
- 主结论用 `text-sm font-semibold`，摘要数字用 `tabular-nums`。
- 风险为 0 时用安静的 muted 文案；有风险时使用 `Alert` 或 destructive 文案，列出最多 3 条，剩余折叠为 `+N more`。
- 不使用大面积绿色背景；"可创建"是工作状态，不是庆祝场景。

### 3. Draft plan：主工作区

这是用户真正审阅的内容，替代当前 `SplitTaskList` 的表单编辑体验。它应该像清单，不像表格，也不像卡片墙。

每个子 issue 行包含：

- 稳定编号：`01`、`02`、`03`，使用 tabular nums。
- 标题：单行截断，hover/title 可显示完整标题。
- 描述摘要：最多两行；没有描述时不显示占位文案。
- 负责人：成员或智能体名称；未知时显示 `--`。
- 状态 badge：`draft`、`ready`、`created`、`running`、`done`、`failed`、`cancelled`。
- 依赖标签：`依赖：01, 02`；无依赖显示 `依赖：无`。
- 风险标记：缺负责人、依赖异常、标题过短等后端校验结果。
- 子 issue 链接：创建后显示 issue identifier，点击通过 `AppLink` 进入详情。

行级视觉约束：

- 使用连续列表行，不使用输入框、checkbox、删除按钮。
- 每行 `rounded-md border bg-background px-3 py-2.5`，行间距 `gap-2`，不要把每行做成重投影卡片。
- 标题和描述必须 `min-w-0`，避免长标题撑破面板。
- 状态和负责人靠右或置于第二列，在 520px 面板内不得挤压标题。
- 在窄屏下改为单列：标题、描述、meta chips 纵向排列。
- 当前正在被智能体修改的草案行可用 `opacity` 或小型 spinner 表示 pending，不移动行位置。

空态：

- 未生成草案：显示紧凑空态，文案为"还没有生成子 issue 草案。"，主操作为"生成草案"。
- 智能体生成中：保留 skeleton 行，不闪烁替换整个面板。
- 草案全被删除或后端返回空列表：显示空态，并允许继续通过对话调整或取消。

### 4. Dependencies：只解释，不编辑

审核面板只做理解辅助，不做图编辑。

- 依赖关系以 monospace 文本图展示，放在 `Dependencies` section 顶部。
- 文本图来自后端或前端纯展示转换；不得引入审核期 ReactFlow 画布。
- 图下方补充依赖标签，确保屏幕阅读器和窄屏用户不依赖 ASCII 图理解关系。
- 当依赖超过 8 个节点或图过宽时，展示可横向滚动的 code block，并保留列表标签。
- 依赖 section 默认展示摘要；如果没有依赖，显示"这些子 issue 可以并行开始。"，不展示空 code block。
- 依赖异常由 Verdict section 提前暴露，Dependencies section 给出具体证据。

示例：

```text
01 ──┬── 02 ── 03
     └── 04
```

### 5. Ask agent：自然语言修正入口

对话区承接所有草案修改。

- 输入复用 issue 详情现有 `CommentInput` 能力，包括附件上传。
- 提交后禁用 composer，直到本轮 `/split/chat` 返回或进入可取消状态。
- 对话历史按时间顺序展示用户指令和智能体回复；智能体回复应总结变更结果，不渲染成第二套可编辑列表。
- placeholder 使用动作导向文案，例如"输入调整要求..."。
- 可提供 2~3 个轻量 suggestion chip，但只在没有历史消息时展示；chip 文案必须是动作，不写教程式说明。
- 对话区默认位于草案与依赖之后。用户先审阅，再调整；不要让输入框抢占第一屏。
- 当用户提交调整后，Verdict section 切换为 `Generating draft`，Draft plan 保留上一版并标注"正在更新"。

建议覆盖的自然语言能力：

- 添加："添加一个安全审计子 issue"
- 删除："删除第 3 个子 issue"
- 修改："把第 1 个标题改成 \"迁移核心数据库\""
- 合并："合并第 2 个和第 3 个"
- 拆分："把支付模块拆成前端和后端两个子 issue"
- 依赖："第 4 个依赖第 2 个和第 3 个完成后再开始"
- 恢复："恢复到最初生成的草案"

### 6. Agent transcript：辅助证据

- 使用 `InlineTranscriptPanel` + `TaskTranscriptTimeline` 展示智能体执行过程。
- 默认折叠；当本轮对话正在运行或失败时自动展开。
- 不把 transcript 作为主要审核入口，避免挤占草案列表。

### 7. Sticky footer：最终操作

底部操作始终可见，避免长草案列表滚动后找不到确认按钮。

- 左侧：`取消拆分`，destructive 变体，仅在 nodeRun 可取消时展示。
- 右侧：`确认创建 {{count}}`，default 变体，仅在 `awaiting_split_review` 且有可创建草案时启用。
- 确认创建必须弹出二次确认，说明会创建子 issue 并启动对应 workflow。
- 创建中按钮显示 spinner 和"创建中..."，禁止重复提交。
- 如果 Verdict 是 `Needs adjustment`，确认按钮禁用，并在按钮旁以短句说明原因，例如"先补全 2 个负责人"。

## 状态与反馈

### Awaiting review

- 展示 Verdict、Draft plan、Dependencies、Ask agent、Transcript、Sticky footer。
- 可提交 `/split/chat`，可确认创建，可取消。
- 不显示任何手动编辑控件。

### Chat running

- 草案列表保留上一版内容，顶部状态显示"正在调整草案..."。
- Composer 禁用，取消按钮可用。
- 本轮返回后用后端草案整体替换列表，并保留滚动位置接近当前位置。

### Split active

- 面板切换为进度视图：Verdict + 子 issue 列表 + Transcript。
- 子 issue 行展示真实 issue 链接、状态和失败原因摘要。
- 不再显示确认创建按钮；可取消未完成的子任务。

### Failed

- Header badge 使用 destructive 状态。
- Verdict 中展示失败原因。
- 可操作项：`重试生成`、`恢复已有输出`、`取消拆分`，按后端能力启用。
- 如果后端提供可恢复草案，Draft plan 仍以只读方式展示。

### Completed

- 展示最终聚合进度和子 issue 列表。
- 操作区只保留跳转子 issue、查看 transcript，不保留确认/取消。

## 全景图设计

### 收起态

split 节点默认显示紧凑卡片，使用 `SplitNodeCard`：

```text
┌──────────────────────────────────────┐
│ ⎇ 任务拆分                            │
│ Review 3 tasks                        │
│ 或 5 issues · 1 running · 4 ready ›   │
└──────────────────────────────────────┘
```

约束：

- 卡片宽高沿用 `RuntimeNodeCard` 容器：`WORKER_WIDTH` 和 `RUNTIME_NODE_HEIGHT`。
- icon 使用 lucide `GitBranch`，不要手绘 SVG。
- 进度使用 `SplitProgressBadge`，长文本通过 `title` 暴露完整内容。
- 当 split 有可展开的子 issue 时，子 issue 数量与 progress 摘要合并为同一个 summary control，例如 `5 issues · 1 running · 4 ready ›`；不要同时渲染右上角独立 `N issues` 按钮和下方 progress badge，避免重复信息。
- hover、active、focus-visible 行为与现有节点卡一致。

### 展开态

点击展开按钮或双击 split 节点后，子 issue 节点以二级节点形式在父 split 节点右侧就近展开，形成一组局部子流程。交互参考 n8n / Dify 的"展开当前步骤上下文"体验：用户应感觉自己正在查看该 split 的局部分支，而不是被带到画布远端。

- 子节点使用 `RuntimeNodeCard` 的视觉语言：固定尺寸、边框、状态 icon、负责人信息、操作按钮。
- 依赖关系使用现有 ReactFlow edge 类型，避免新增并行连线样式。
- 子节点状态通过 WS 和 React Query 更新，保持当前展开/收起状态。
- 展开态不进入编辑模式；拖拽、连线编辑、删除节点在运行视图中禁用。
- 子节点群应有轻量分组语义：通过局部边界、背景或稳定的视觉聚合方式，让用户知道这些节点属于同一个 split child cluster，而不是主 workflow 的原生节点。

布局规则：

- 默认从父 split 节点右侧贴近展开，横向按依赖深度分列：无依赖任务在第 1 列，依赖它们的任务进入后续列。
- 同一依赖层级内按 `sort_order` 垂直堆叠，并围绕父 split 节点垂直居中。不要为了避让主 workflow 节点把 child cluster 直接放到全图最右侧。
- 当 child cluster 与右侧主 workflow 节点发生水平重叠时，仅将同一行或相邻右侧节点在渲染层临时右移，让出 cluster 所需空间；不修改真实 workflow node position。
- 子节点数量较少（1~8 个）时优先保持父子贴近和局部让位；超过 8 个时，保留紧凑局部分支，并提供后续"聚焦查看"入口作为增强，不作为第一期默认形态。
- 展开后画布应轻微 pan/fit 到父 split 与 child cluster 的联合区域，保持当前缩放附近的阅读尺度，不强制重置整个 workflow 视图。
- 收起后保留用户当前 viewport，不自动跳回展开前位置，避免打断用户继续查看下游节点。
- 父 split 节点保持可见，避免用户失去上下文。

交互：

- 点击 split 节点：打开审核或进度面板。
- 点击 child summary control 或双击 split 节点：切换子节点展开态，不打开审核面板。
- 点击子 issue 节点：在当前全景图内打开右侧详情面板，保留画布 viewport、父 split 和 child cluster 上下文。
- 子 issue 详情面板内提供 `Open issue` / `View full issue` 显式入口；只有点击该入口时才通过 `NavigationAdapter` 跳转到子 issue 详情页。
- 失败子节点：显示重试入口。
- 运行中子节点：显示取消入口。
- 点击画布空白：收起面板，不强制收起子节点；展开状态由当前页面 session 保留。
- 键盘用户可 Tab 到 split 节点与 child summary control；Enter/Space 在 split 节点上打开面板，在 summary control 上切换 child cluster。

## 组件变更

### 删除或降级

以下审核期组件不再作为用户可见编辑入口：

- `split-task-list.tsx`：从可编辑表单降级为只读 `SplitDraftLedger`，或新建只读组件替代后删除旧组件。
- `split-task-dag.tsx`：审核面板中移除；全景图展开态使用现有 ReactFlow 画布和 edge。

迁移要求：

- 不再向 `/split/approve` 发送 `modifications`。
- `ApproveSplitRequest` 只发送后端接受的 `approved_task_ids` 或等价确认参数。
- 所有增删改、合并、拆分、依赖调整都由 `/split/chat` 完成。

### 保留/修改

- `split-review-panel.tsx`：改为 Verdict + Draft plan + Dependencies + Ask agent + Transcript + Sticky footer。
- `split-node-card.tsx`：保留，补齐 progress 区域的自定义 action slot、状态 title 和可访问名称；运行期 split 展开入口应与子 issue progress 摘要融合。
- `split-progress-badge.tsx`：保留，确保 `parts` 为空时展示总数，失败时使用 destructive 语义。
- `split-config-panel.tsx`：保留，用于配置 split 节点，不参与运行期审核。
- `runtime-node-card.tsx`：保留，split 子节点展开态复用其运行态样式和操作模型。

### 新增建议组件

- `split-verdict-summary.tsx`：面向用户的结论区，展示是否可创建、风险摘要和关键数字。
- `split-draft-ledger.tsx`：只读草案列表，替代编辑型 `SplitTaskList`。
- `split-dependency-note.tsx`：monospace 依赖图 + 可访问依赖摘要。
- `split-chat-review.tsx`：封装 split chat 历史、composer、pending 状态和附件。
- `split-review-footer.tsx`：固定底部取消/确认区域。

这些组件属于 `packages/views/workflows/components/split/`。若包含纯数据转换函数，放到 `packages/core/workflows/` 或当前组件目录的纯函数文件，并配套单元测试。

## API 与状态管理约束

- Split 草案、进度、chat 历史属于服务器状态，使用 React Query，不复制进 Zustand。
- 查询 key 必须包含 `wsId` 和 `nodeRunId`。
- WS 事件只做 query invalidation 或 `setQueryData` 的同源更新，不写 Zustand。
- API 响应必须走 zod schema + fallback，缺字段时 UI 降级展示，不白屏。
- 前端不得根据旧草案本地计算 modifications；本地只持有 composer draft、展开态和 dialog open 状态。

## 可访问性与响应式

- 所有 icon button 必须有 `aria-label`。
- 子 issue 行的点击目标与内部链接不能嵌套冲突；如果整行可点击，内部 issue 链接需阻止冒泡。
- `确认创建` 二次确认弹窗必须有明确 title、description、cancel、confirm。
- 面板宽度沿用 `WorkflowNodeDetailPanelShell` 默认 `w-[520px]`；小屏使用 `w-screen max-w-screen`。
- 内容区 `overflow-y-auto`，footer sticky；草案列表自身不嵌套独立滚动，除非列表超过 12 个。
- 支持键盘：Tab 顺序为关闭按钮、主要内容链接、composer、footer 操作。
- 动画使用现有 transition；尊重 reduced motion，不新增持续动画。

## 文案规范

- 中文遵循 `apps/docs/content/docs/developers/conventions.zh.mdx`：`issue`、`task`、`workflow` 等实体按上下文保留英文。
- 按钮使用动词开头："生成草案"、"确认创建"、"取消拆分"、"重试生成"。
- 状态文案短句化："正在调整草案..."、"草案已更新"、"无法创建子 issue"。
- 错误文案说明原因和下一步，不道歉，不使用模糊提示。
- 不在 UI 中展示长段功能说明；需要指导时使用 placeholder、空态和具体操作文案。

## 边界（不在第一期范围）

- 三层及以上嵌套。
- 条件分支拆分（根据上游输出动态决定拆分数量）。
- 拆分节点作为子模板的一部分。
- 子 issue 间的数据传递（除上下文注入外）。
- `split_active` 期间动态添加新的子 issue。
- 子 issue 的子 issue（孙子层）。
- 审核面板中的可视化 DAG 编辑、拖拽排序、局部手动修改。

## 测试策略（前端）

### TypeScript / Vitest

- `packages/core/types/workflow.test.ts`：`parseNodeFormat` split 类型解析。
- `packages/core/api/schemas.test.ts`：split API 响应 malformed fallback 测试，包括缺失 progress、未知状态、空 tasks。
- `packages/views/workflows/components/split/split-review-panel.test.tsx`：
  - awaiting review 状态展示 Verdict、Draft plan、Ask agent、Footer。
  - 不渲染标题 input、描述 textarea、依赖 checkbox、删除按钮。
  - 提交自然语言指令调用 `/split/chat` mutation。
  - 确认创建只发送确认参数，不发送 `modifications`。
  - pending 状态禁用 composer，保留上一版草案。
  - failed/completed/active 状态分别展示正确操作。
- `split-draft-ledger.test.tsx`：长标题截断、空描述处理、依赖标签、子 issue 链接。
- `split-dependency-note.test.tsx`：宽图横向滚动、无依赖空态、可访问摘要。
- `runtime-node-card.test.tsx`：split 节点继续复用 `SplitNodeCard`，状态与 progress 正确传递。
- `execution-panorama-page.test.tsx`：
  - 展开 split child cluster 时，首列子节点贴近父 split，而不是放到全图最右侧。
  - child cluster 与右侧主 workflow 节点冲突时，右侧节点在渲染层临时让位，父 split 和 child cluster 仍保持贴近。
  - 子 issue 节点按依赖深度分列、同层按 `sort_order` 垂直堆叠。
  - 展开后触发局部视口聚焦，聚焦范围包含父 split 与 child cluster。
  - 点击子 issue 节点打开右侧详情面板，不直接离开全景图；面板内的显式跳转入口通过 `NavigationAdapter` 进入子 issue 详情。

### E2E

- 完整流程：创建父 issue → Split 节点激活 → 智能体生成草案 → 自然语言调整 → 确认创建 → barrier 完成。
- pipeline 模式：子 issue 创建即释放下游。
- 审核自然语言调整：增删合并子 issue、调整依赖、恢复原始草案，刷新页面后 chat 历史仍存在。
- 全景图展开：子节点就近可见、依赖连线存在、右侧主 workflow 节点局部让位、点击子节点打开详情面板，面板内可进入完整子 issue。
- 取消级联：父节点取消 → 未完成子 issue 停止，面板状态更新。
- 视觉回归：520px 面板、窄屏、长标题、8+ 子 issue、失败状态均无文本重叠。

## 验收清单

- 审核面板没有手动编辑表单和审核期 DAG 画布。
- 用户能通过自然语言完成草案增删改、依赖调整和恢复。
- 确认创建前能清楚看到子 issue 数量、负责人、依赖和风险。
- 全景图 split 节点与现有运行节点视觉一致，展开态子节点形成贴近父 split 的局部 child cluster，不被甩到全图远端，也不遮挡右侧主 workflow 节点。
- 所有状态都有清晰反馈：加载、生成中、待审核、运行中、失败、完成、空草案。
- 长文本、窄屏、键盘导航和屏幕阅读器场景可用。
- 前端不维护第二份服务器状态，不发送本地 modifications。
