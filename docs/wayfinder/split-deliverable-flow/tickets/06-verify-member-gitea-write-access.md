---
wayfinder: ticket
title: 验证成员在 Gitea 的写权限与编辑路径
type: task
status: closed
assignee: null
blocked_by: []
resolved: 2026-08-03
---

## Question

「人在 Gitea 的 PR 源分支（node 分支）上编辑 task.md」依赖工作区成员对 Gitea repo 的**写权限**。「Gitea 文档交付物流现状摸底」未能查清：成员经 `members:sync` 同步进 org 后落在哪个 team、对 repo 是 read 还是 write——发生在 costrict-web 侧，本仓库不可见。

需要验证（可用 verify-multica-e2e 技能起一个真实工作区）：

1. 普通成员账号在 Gitea 网页上能否编辑 node 分支上的文件（直接 commit 到 node 分支）
2. 若权限不足：costrict-web team-namespace 侧的调整点在哪（members:sync 的 team 配置），或备选——成员编辑改走「服务端代写」通道（仿 `UploadMemberDeliverable`：Multica 内编辑 → 服务端用 bot 身份写 node 分支）

本 ticket 不阻塞 spec 初稿（spec 将此记为已识别风险 + 备选通道），但阻塞实现开工。

## Resolution

已确认：工作区下的全部成员同步到 Gitea 后都具有对应 repo 的 write 权限，可以直接修改 workflow node 分支。由此锁定：

1. 「从 node→inst PR 进入 Gitea，在 PR 源分支上编辑 task.md」的权限前提成立；
2. 不需要调整 costrict-web `members:sync` 的 team/repo 权限；
3. 不需要为本期增加「Multica 内编辑 + 服务端用 bot 身份代写 node branch」通道；
4. ticket 关闭，不再阻塞 review surface 集成或上线。

此处记录的是已经确认的外部权限事实；实际「编辑 → commit → 原 PR diff 更新 → Multica approve 读取新 head」流程仍由设计 spec §9 的端到端验收覆盖，不重复作为权限门禁。
