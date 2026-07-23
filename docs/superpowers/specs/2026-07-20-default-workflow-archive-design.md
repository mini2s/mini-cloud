# 默认 Workflow：非 workflow Issue 的产物归档

| 日期 | 2026-07-20 |
|---|---|
| 分支 | `feat/deliverable-git-storage`（延续交付物 git-storage 专题，PR #88） |
| 上游设计 | `E:\Projects\design-docs\企业AI编程协作平台\multica基于git server实现交付物管理的设计方案.md` §七（待定项："非 workflow 的 ad-hoc 交付物"） |
| 状态 | 设计已确认，待写实施计划 |

## 一、背景与问题

交付物归档今天**只对 `assignee_type=workflow` 的 Issue 生效**：建 workflow run → 脚手架 Gitea org/repo/inst 分支 → agent 任务带 `WorkflowNodeRunID` → 下发 Gitea 上下文 → agent `cs-workflow gitea submit` 开 PR → 评审 → 合并到 inst（归档）。

而指派给 **agent / member / squad** 的 Issue 完全没有归档路径：
- `agent`：只建裸 agent 任务（`EnqueueTaskForIssue`），`WorkflowNodeRunID` 为空 → `buildGiteaDeliverableContext` 返回 nil → agent 无处推交付物。
- `member`：连任务都不建，纯 DB 行。
- `squad`：只给 leader 派任务，同 agent。

Gitea 拓扑 `repo = wf-<workflow.id[:8]>` 锁死在 workflow.id 上——没有 workflow 就没有 repo 名，无 fallback。

上游设计文档 §七 把"非 workflow 的 ad-hoc 交付物放哪"列为待定。本设计给出落地：**每个 workspace 自动一个系统级"默认 workflow"**，让 agent/member/squad 的 Issue 跑它的一次 run，整套已有 Gitea 机制几乎零改动地复用。

## 二、已确认决策

| 决策 | 结论 |
|---|---|
| 归档对象范围 | agent + member + squad（全部非 workflow 派单） |
| member 产出方式 | "人上传→git" UI 路径：人在网页上传，服务端代写进 Gitea + 开 PR |
| 归档形态 | 评审 + 合并（与 workflow 完全对称） |
| critic（评审者） | Issue 创建者；复用现有 ReviewNodeRun/评审派发，**不加新字段、不加新 UI、不改权限模型**；创建者==assignee（自派自）不做特例 |
| 粒度 | 每 workspace 一个默认 workflow（系统、隐藏、单节点） |
| worker | run 创建时动态 = Issue 的 assignee |
| dormant | 仅 Gitea 已配置时启用；未配置时 agent/member/squad 派单行为与今天完全一致 |

被否决备选：① 每 Issue 合成 workflow（repo 爆炸）；② 个人命名空间临时仓库（要 per-member Gitea 用户机制，与 workspace 共享 PAT 通道冲突）。

## 三、设计

### 3.1 数据模型

- 新增列 `multica_workflow.is_default BOOLEAN NOT NULL DEFAULT FALSE`（migration）。
- 每个 workspace **get-or-create 一个默认 workflow**（懒创建、幂等）：`status='active'`、`is_default=true`、单节点，节点上挂 1 个 `kind=document` 交付物。节点 worker/critic 存占位值，真实值在 run 创建时按 Issue 动态写入 node-run。
- `ListWorkflows`（用户侧列表查询）过滤 `is_default=true`：默认 workflow **对用户不可见、不可被选为 `assignee_type=workflow`**（防误绑）。

### 3.2 触发与派发（核心新路径）

CreateIssue / UpdateIssue 改派后：若 `assignee ∈ {agent, member, squad}` **且 `isGiteaConfigured()`** → 调新 service 方法 `StartDefaultRunForIssue(issue)`：

1. get-or-create 该 workspace 的默认 workflow。
2. `StartRun` 建 run + 单 node-run。
3. **覆写 node-run**：`worker_type/worker_id = Issue.assignee`，`critic_type/critic_id = Issue.created_by`。
4. `ScaffoldRunDeliverables`（复用）建 org/repo/inst 分支。
5. 派发：
   - `agent/squad`：现有 `DispatchAgentTask` 派 agent 任务**带 `WorkflowNodeRunID`**（替代今天的裸 `EnqueueTaskForIssue`）→ `buildGiteaDeliverableContext` 自动生效 → agent `cs-workflow gitea submit` 走老路。
   - `member`：不派 agent 任务（人是 producer），node-run 就位、交付物槽就绪，等 member 上传。

约束：
- **不建子 Issue**（ad-hoc 下原 Issue 即工作本身）。用 `StartRunForIssue` 的一个 ad-hoc 变体跳过子 Issue 创建。
- 改派（非 workflow 类型之间）：**复用同一 run，换 node-run 的 worker**，避免 inst 分支增殖。
- 默认 workflow 不可删、不可绑为 `issue.assignee_type`。

### 3.3 member 上传 → git（新服务端能力）

今天服务端只做脚手架 + 合并，从不写交付物内容。member 上传需新增"服务端代写交付物 + 开 PR"能力：

- 新端点 `POST /api/issues/{id}/deliverables/upload`（写操作，cookie + CSRF）：
  - 服务端用 Gitea contents API 把文件写到 `DeliverablePath = nodes/<nodeRun[:8]>/<deliverable[:8]>.md`，分支 = `node/<nodeRun[:8]>`（base=inst）。
  - 开 PR（node→inst）+ 回写 `submission.pull_request_url`、`status=submitted`。
  - 凭据 = workspace bot PAT。
- 前端：Issue 执行面板（packages/views）加上传控件；提交后 `NodeRunCard` 照旧渲染 PR 链接。
- **与设计文档 §五.5"关闭上传入口"的张力**：仅为此 ad-hoc/member 场景**有限度重开上传入口**（且仅 Gitea 配置时）；workflow 交付物仍 cs-workflow-only，不变。

### 3.4 评审 + 合并（全复用）

agent 推 / member 上传 → 都开出 PR → critic（=创建者）经现有 ReviewNodeRun 收评审任务 → multica 上 approve → 现有 M2 merge 路径合并到 inst → node-run completed → 归档。**零新逻辑。**

### 3.5 dormant 与边界

- 全程 `isGiteaConfigured()` 门控；未配置时 agent/member/squad Issue 行为与今天完全一致（零变更，现网默认即未配置）。
- 默认 workflow 不可删 / 不可绑为 issue.assignee。
- agent 创建的 Issue：critic=agent（自审或 agent 评 agent），接受。
- 默认 workflow 由系统**直接以 `status='active'` 创建**（不走 `UpdateWorkflow` activation handler），故 `ProvisionWorkflowRepo` **不会**对它触发；repo 由 `ScaffoldRunDeliverables` 在首次 ad-hoc run 时 lazy 建（与正常 workflow run 的 scaffold 时机一致）。

## 四、改动清单（按层）

| 层 | 改动 |
|---|---|
| migration | `multica_workflow.is_default` 列 |
| query | `ListWorkflows` 过滤 `is_default`；默认 workflow get-or-create 查询 |
| service | `StartDefaultRunForIssue`；默认 workflow get-or-create；ad-hoc `StartRunForIssue` 变体（跳子 Issue + 覆写 worker/critic） |
| gitea | 新增"服务端代写交付物 + 开 PR"方法（contents API；复用 bot PAT） |
| handler | CreateIssue/UpdateIssue 改派分支接新路径；member 上传端点 |
| views | Issue 执行面板 member 上传控件 |
| tests | 单测 + 扩展 `e2e/deliverable-git-storage.spec.ts` |

## 五、里程碑

- **M1**：`is_default` + 默认 workflow get-or-create + `StartDefaultRunForIssue` + **agent 派单闭环**（复用 cs-workflow，全程跑通 scaffold→submit→review→merge→UI 链接）。
- **M2**：**member 上传**端点 + 服务端代写+开 PR + 前端上传控件（闭环：上传→PR→评审→合并→链接）。
- **M3**：squad 接入 + 改派复用 run + dormant 校验 + E2E 扩展。

## 六、测试

- **单测**：默认 workflow get-or-create 幂等；`StartDefaultRunForIssue` 正确覆写 worker/critic；member 上传→PR（mock Gitea contents/pulls API）；dormant 全 no-op；`ListWorkflows` 过滤 `is_default`。
- **E2E**（扩展现有 `e2e/deliverable-git-storage.spec.ts`，仅 Gitea 配置时跑）：① agent 派单 → 默认 run → PR → 合并 → 链接；② member 派单 → 上传 → PR → 合并 → 链接。
- **DB 测试**：沿用 `golang:1.26-alpine` join `multica_default` 连 `postgres:5432`（见相关 memory）。

## 七、待定 / 后续

- member 上传的文件类型范围（MVP：text/markdown → `.md`；附件后续）。
- 自派自（创建者==assignee）时的评审者回退策略——本期按"不做特例"处理，后续若成痛点再补。
- 改派跨类型（如 workflow → agent）时的 run 生命周期细节（cancel 旧 run + 起默认 run）。
- secret manager 加密 PAT（沿用上游待定项）。

## 八、关联

- 上游设计：`E:\Projects\design-docs\企业AI编程协作平台\multica基于git server实现交付物管理的设计方案.md`
- 现有实现 memory：`deliverable-git-storage-design`（M1-M3 已实现 + reviewed，dormant-by-default）
- 关键代码锚点：
  - 触发点：`server/internal/handler/issue.go`（CreateIssue / UpdateIssue 改派分支）
  - run 创建：`server/internal/service/workflow.go` `StartRunForIssue` / `StartRun`
  - 脚手架：`server/internal/service/workflow_gitea.go` `ScaffoldRunDeliverables`
  - Gitea 上下文：`server/internal/handler/daemon.go` `buildGiteaDeliverableContext`
  - 拓扑：`server/internal/gitea/topology.go`
  - workflow 模型：`server/pkg/db/generated/models.go` `MulticaWorkflow`
