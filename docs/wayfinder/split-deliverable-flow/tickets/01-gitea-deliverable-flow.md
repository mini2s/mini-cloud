---
wayfinder: ticket
title: Gitea 文档交付物流现状摸底
type: research
status: closed
assignee: charting-session
blocked_by: []
resolved: 2026-01-27
---

## Question

现有 document deliverable 的 Gitea 存储流是什么形态，task.md 交付物如何复用它？需要摸清：

1. **存储结构**：文档交付物在 Gitea 的哪个 repo/命名空间下？目录约定（如 `nodes/<NN>-<nodeTitle>-<nodeRunShort>/...`）是什么？（锚点：`server/internal/service/workflow_deliverable_repo.go` 的 Gitea 归档逻辑、`UploadIssueDeliverable`、`HandleGetIssueGiteaDeliverables`、router 里的 `/ns/upload`、`/issues/{issue}/gitea-ns` 路由）
2. **写入路径**：agent 侧怎么把文档上传到 Gitea（CLI 命令？API？凭据从哪来——`Repository credential for the cs-workflow CLI document-n flow` 路由）？拆分 agent 生成 task.md 后应走哪条上传路径？
3. **读取路径**：服务端按 node run 取回文档内容/commit SHA 的 API 或 Gitea client 调用是什么？approve 时刻「拉最新内容 + 记录 SHA」应调用什么？
4. **人的编辑面**：Gitea web 上编辑该文件的 URL 怎么拼（前端跳转链接生成处）？权限模型（工作区成员对 Gitea repo 的访问）如何？
5. **与 deliverable submission 表的关系**：Gitea 文档与 `multica_workflow_node_deliverable_submission`（content/attachment_id/status）如何对应？拆分节点的 task.md 应该注册为节点 deliverable definition + submission，还是另走轻量路径？

产出：findings 写入 `docs/wayfinder/split-deliverable-flow/assets/research-gitea-deliverable-flow.md`，每条结论标注源码锚点（文件:行号）。

## Resolution

Findings：[research-gitea-deliverable-flow.md](../assets/research-gitea-deliverable-flow.md)（含完整锚点表）。关键结论：

1. **拓扑**：org `t-<ws8>` / repo `wf-<wf8>`（默认 `wf-deliverable-archive`）；每 run 一条 `inst-<run8>` 归档分支，每 node run 一条 `node/<NN>-<short>` 分支，文档经 node→inst PR 评审、approve 时服务端 merge。联结 DB 的只有 `submission.pull_request_url`。
2. **写入**：agent 侧靠仓库外二进制 `cs-cloud workflow deliverable submit`（env 注入凭据与预算路径）；人侧有 `POST /api/issues/{id}/deliverables/upload` 服务端代写；服务端归档类写入走 `UpsertFile` 直写 inst（如 `ArchiveSubIssueAddress`）。
3. **读取是空白**：无公开「读文件内容 / 记 commit SHA」API（已核实：client 只有 GetOrg/GetRepo/GetBranch 元数据读 + 私有 getFileSHA）；approve 只 merge 不回读。→「approve 即快照」需新建读取能力。
4. **前端无 Gitea 文件级 URL 拼接**，跳转原料（owner/repo/branch/path）未对浏览器暴露；现状只渲染 submission 的 PR URL。
5. 两路写入目录不一致（agent 流 `DeliverablePath` vs 成员上传 `deliverables/<id8>/`）；接入路径选择孵化出新 ticket「task.md 交付物接入路径与快照读取」。
