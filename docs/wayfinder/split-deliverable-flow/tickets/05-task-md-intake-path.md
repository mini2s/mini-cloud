---
wayfinder: ticket
title: task.md 交付物接入路径与快照读取
type: grilling
status: closed
assignee: wayfinder-session
blocked_by: []
resolved: 2026-01-27
---

## Question

task.md 以哪条路径接入 Gitea 交付物体系，approve 时刻的「拉最新内容 + 记录 SHA」怎么实现？

由 [Gitea 文档交付物流现状摸底](01-gitea-deliverable-flow.md) 孵化（该 ticket 的 Resolution 有完整事实）。候选路径：

**A. 正式 deliverable 流**：task.md 注册为拆分节点的 deliverable definition → agent 经 node 分支推送 + 开 node→inst PR + submission 记 PR URL → 人在 Gitea 上 review PR / 在 node 分支上编辑 → Multica approve = merge PR（merge commit 即天然快照点）+ 回读内容入库。
- 复用全链路（provisioning、分支、PR、评审权限门、前端 PR 链接跳转）；approve 语义与现有 deliverable approve 一致（现状 approve 本来就 merge PR）
- 但：读取内容/SHA 仍需新建 API；「人在 node 分支上编辑」依赖成员对 repo 的写权限（现状未查清，在 costrict-web 侧）

**B. 轻量直写流**：agent 会话内 git push（或服务端代写）把 task.md 直写 inst 分支（类 `ArchiveSubIssueAddress` 模式）→ 人在 Gitea 直接编辑 inst 分支文件 → Multica approve = 服务端用新建的 read API 拉 inst 最新内容 + HEAD SHA 入库。
- 无 PR、无 submission、不进评审门；人的编辑路径最短（Gitea `_edit` 链接直跳）
- approve 的「快照点」要靠新建 read API 自行定义；无 PR 评审门保护

无论哪条：**读取能力需新建**（扩展 `server/internal/gitea/client.go` 的 contents read / commits API，或 agent 侧 `git rev-parse` 上报——现状 agent 读内容就是 git CLI，`task_cscloud_push.go:716-717`）。

需要与人敲定：

1. A vs B（或混合：直写 inst + approve 时回读）
2. 前端「去 Gitea 编辑」按钮的链接形态（`_edit` 文件级 URL 需新建拼接口 + 对浏览器暴露拓扑原料）
3. 快照读取 API 的形态（服务端 contents read vs agent 上报 SHA）

## Resolution

1. **接入路径 = A：正式 deliverable PR 流**。task.md 注册为拆分节点的 deliverable → agent 经 cs-cloud 推 node 分支 + 开 node→inst PR + submission 记 PR URL → 人点 PR 链接去 Gitea 看 diff/在 PR 源分支编辑 → Multica approve 端点内：读 node 分支内容 → 校验 → 快照入库 → merge PR → enqueue 物化 job。理由：与其他节点交付方式一致（复用展示/提交/merge/归档全链路）；归档语义干净（node 分支=staging，inst=approved archive）；reject 重生有 PR diff 可审。
2. **「去 Gitea 编辑」入口 = 复用现有 PR 链接**，零新建。文件级 `_edit` 直跳后置为打磨项（见 map 的 Not yet specified）。
3. **快照读取 = 服务端 contents read**：`server/internal/gitea/client.go` 新增 ReadFile（contents API `?ref=<node分支>` 取 base64 内容 + blob SHA）；approve 时刻实时读取，天然包含人后来的网页编辑。快照行记录：内容 + node 分支 ref + blob SHA + 读取时间。agent 上报 SHA 方案因「人编辑后 SHA 过时」被否。
