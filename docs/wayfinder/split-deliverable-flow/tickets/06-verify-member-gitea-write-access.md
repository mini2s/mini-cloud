---
wayfinder: ticket
title: 验证成员在 Gitea 的写权限与编辑路径
type: task
status: open
assignee: null
blocked_by: []
---

## Question

「人在 Gitea 的 PR 源分支（node 分支）上编辑 task.md」依赖工作区成员对 Gitea repo 的**写权限**。「Gitea 文档交付物流现状摸底」未能查清：成员经 `members:sync` 同步进 org 后落在哪个 team、对 repo 是 read 还是 write——发生在 costrict-web 侧，本仓库不可见。

需要验证（可用 verify-multica-e2e 技能起一个真实工作区）：

1. 普通成员账号在 Gitea 网页上能否编辑 node 分支上的文件（直接 commit 到 node 分支）
2. 若权限不足：costrict-web team-namespace 侧的调整点在哪（members:sync 的 team 配置），或备选——成员编辑改走「服务端代写」通道（仿 `UploadMemberDeliverable`：Multica 内编辑 → 服务端用 bot 身份写 node 分支）

本 ticket 不阻塞 spec 初稿（spec 将此记为已识别风险 + 备选通道），但阻塞实现开工。

## Resolution

（验证后记录：权限事实 + 结论「网页编辑可行」或「需服务端代写通道」）
