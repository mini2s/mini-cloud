# 成员搜索改走 cs-user + 身份模型统一 subject_id — 设计

日期：2026-07-29

**仅 multica 侧改动**（含一次性迁移脚本）。cs-user、costrict-web、costrict-dept-sync 三个外部服务均**无需改动**——所需接口均已存在。

## 背景

当前成员搜索/添加链路对接 `costrict-dept-sync`，身份关联键是 `universal_id`/`user_id`（HR 工号），并有一套「pending_activation → 登录激活」的中间态机。本次重构把它改成：

- 搜索只对接 `costrict-web` 的 **cs-user**，按 **name** 模糊搜索、上限 3 条；
- 身份关联键统一为 **cs-user 的 subject_id**（`usr_<uuid>`），彻底不存 `universal_id`；
- 移除激活逻辑（搜索到的用户都已登录过平台，必有 multica 账号）；
- 登录与搜索命中后仍回 dept-sync 取组织身份，填充 multica。

### 关键事实（已核实）

1. **嵌入式 SSO 的 JWT `sub` 就是 cs-user subject_id**。[main.go:385](../../../server/cmd/server/main.go#L385) 注释：「a cs-user token's sub is cs-user's own user id」；[auth/casdoor.go:13](../../../server/internal/auth/casdoor.go#L13) `SubjectID` = JWT `sub`，`UniversalID` = JWT `universal_id`。故 multica 在登录路径上**已直接拿到 cs-user subject_id**。
2. **cs-user 与 dept-sync 唯一可靠对齐字段是 `universal_id`**：cs-user `casdoor_universal_id` == dept-sync `universal_id`。dept-sync 不认 subject_id、无 employee_number；cs-user `username` = Casdoor `name`（非工号），工号在 cs-user `employment_identities.employee_number`（搜索接口不返回）。
3. cs-user 搜索接口 `GET /api/internal/users/search?keyword=&limit=`（`X-Internal-Token`）返回 `{"users":[models.User]}`，含 `subject_id`、`username`、`display_name`、`email`、`casdoor_universal_id`。
4. costrict-web `UserRef{user_id}` 按 cs-user **subject_id** 解析（`GetUserByID`）。multica 现有 `teamnamespace.SyncMembers` → `POST /api/internal/teams/{teamID}/members:sync`。

## 决策摘要（已逐条与用户确认）

1. **身份关联键 = cs-user subject_id**。复用现有 `multica_user.subject_id` 列（嵌入式 SSO 下其值本就是 cs-user subject_id，UNIQUE、有索引、登录解析器已在用），**不新增列**。
2. **彻底不存 `universal_id`**：删 `multica_user.casdoor_universal_id`；登录从 Casdoor JWT、搜索/添加从 cs-user 取 `casdoor_universal_id`，**仅当运行期令牌**调 dept-sync 现有 `GET /user/{universal_id}/departments?type=universal` 取组织身份，用完即弃。
3. **搜索改走 cs-user**，只按 name 模糊、硬上限 3。移除部门搜索 / 列部门成员（前后端）。
4. **移除 pending_activation 中间态**：添加成员时按 `subject_id` 解析 multica 用户；**若无账号则立即创建并关联**（name/email 取自 cs-user，绑 `subject_id`），成员直接 `status=active` + 绑定 `user_id`。即不再「假设搜索到的用户都有账号」，而是**保证**有。
5. **组织身份字段留在 `multica_member`**（每工作区一行），登录 + 添加时填充。
6. **成员增删 → Gitea**：multica 调 costrict-web `SyncMembers`，`UserRef.user_id = cs-user subject_id` 触发 Gitea 账号 add/remove org；移除登录激活时的触发链。
7. **停用独立 Casdoor OAuth 路径**（`casdoor_oauth.go`），登录只走嵌入式 SSO。
8. **Casdoor-sub 遗留账号通过迁移脚本清理、重建**（下次登录按 cs-user subject_id 干净重建）。

## 范围

**In scope — multica**

- 新增 cs-user 客户端 + 搜索 handler 改造。
- 身份模型：复用 `subject_id`、删 `casdoor_universal_id`；member 关联键改 `subject_id`。
- 移除部门搜索/列部门成员（handler + deptsync client + 前端 UI）。
- 移除 pending_activation（SQL + handler 分支 + 常量 + 前端徽标）。
- 登录解析器改按 `subject_id`；`LinkDeptIdentity` 用运行期 universal_id 取组织身份。
- 成员增删接 `SyncMembers(UserRef.user_id=subject_id)`；移除登录激活触发。
- 停用独立 OAuth callback。
- schema 迁移 + 一次性数据迁移脚本（遗留账号清理）。

**Out of scope（三个外部服务均不改）**

- cs-user：搜索 / get-by-id 接口已存在。
- costrict-web：`SyncMembers` + `UserRef.user_id`(=subject_id) 解析已支持。
- costrict-dept-sync：`/user/{universal_id}/departments?type=universal` 已存在。

## 设计细节

### 1. 身份模型

| 表 | 改动 |
|---|---|
| `multica_user` | 复用 `subject_id` 作 cs-user subject_id 正典键；**删 `casdoor_universal_id`** 列及索引 |
| `multica_member` | 新增 `subject_id` 列 + 唯一索引 `(workspace_id, subject_id) WHERE subject_id IS NOT NULL`；**删 `external_universal_id`、`external_user_id`** 及旧索引；保留 `employee_id` + 组织快照列 |

- 登录解析器（`main.go` SubjectResolver）：**按 `subject_id` 解析** multica 用户（嵌入式 SSO 的 JWT `sub` = cs-user subject_id）；移除 `universal_id` 解析分支与 `SetUserCasdoorUniversalID` 写入。
- `universal_id` 不落库：登录侧从 JWT claim、搜索/添加侧从 cs-user `casdoor_universal_id` 取，仅用于本次 dept-sync 查询。

### 2. 搜索（cs-user）

- 新增 `server/internal/csuser` 客户端：`Config{BaseURL, Token(X-Internal-Token), Timeout}`，env `CS_USER_API_BASE_URL` / `CS_USER_INTERNAL_TOKEN` / `CS_USER_API_TIMEOUT`。
- `SearchUsers(ctx, keyword, limit)` → `GET {BaseURL}/api/internal/users/search?keyword=&limit=`，header `X-Internal-Token`，解析 `{"users":[…]}`。
- handler `SearchDeptUsers`（路由 `GET /api/dept/users/search` 保留）改调 cs-user，`limit` 硬编码 3。
- 返回前端精简 DTO：`{subject_id, name(display_name‖username), email}`。**不含 universal_id**（前端永不接触）。
- 移除：`SearchDepartments`、`ListDeptDepartmentUsers` handler + 路由；deptsync client 的 `SearchDepartments`/`ListDepartmentUsers`/`GetDepartment`/`listDepartmentTree` 等部门相关方法；前端 members-tab 部门搜索/列部门 UI（合并输入框 → 单一姓名搜索框）。

### 3. 登录填充组织身份（需求 5）

- `LinkDeptIdentity` 仍接收 `universalID` 参数（来自 JWT claim），但**不再落库**——它只作为运行期令牌使用。
- 仍调 dept-sync `GetUserDepartmentsByUniversalID(universal_id)` → `pickMainActiveDepartment` → 填充该用户所有 `multica_member` 行的组织快照 + `SetUserName`。
- 移除其中 `ActivatePendingDeptMembersByUniversalID` / `DeleteOrphanPendingDeptMembers` 调用（见 §4）。
- `linkDeptMembersOnLogin` 收敛：保留「登录时调 `LinkDeptIdentity` 刷组织身份」；移除其中的「激活 pending 成员」与「per 已激活工作区触发 `syncWorkspaceGiteaMembers`」两段（激活态已删，Gitea 改到成员增删时触发）。

### 4. 移除激活 + 添加时按需建号（需求 4 + 补充）

加成员流程（前端只发 `subject_id` 列表，后端权威解析）：

1. 对每个 `subject_id`：cs-user `GET /users/{subject_id}` 取 `name`/`email`/`casdoor_universal_id`（可 `POST /users/by-ids` 批量）。
2. 按 `subject_id` 解析 multica 用户（`GetUserBySubjectID`）。**找不到则当场建号**：`CreateUser(name,email)` + `SetUserSubjectID(subject_id)`，复用登录解析器的建号/email-adopt 逻辑；email 缺失用占位、email 冲突按现有 adopt 规则处理。
3. 用 `casdoor_universal_id`（运行期令牌）调 dept-sync 取组织身份 → 填 member 组织快照；`casdoor_universal_id` 为空则组织字段留空，待该用户登录时由 `LinkDeptIdentity` 补。
4. `UpsertDeptMember`：`status=active` + 绑定 `user_id` + `subject_id` 键。
5. `SyncMembers(add, UserRef{user_id:subject_id})` → Gitea（见 §5）。

> 该用户日后走嵌入式 SSO 登录时，解析器按 `subject_id` 命中此处建好的账号，仅刷新组织身份，**不重复建号**。

- `BatchAddDeptMembers`：去掉 `status = pending_activation` 分支。
- 删除 SQL：`ActivatePendingDeptMembersByUniversalID`、`DeleteOrphanPendingDeptMembers`。
- 删除常量 `MemberStatusPendingActivation`；`member.sql` 相关 CHECK/状态收敛到 `active`/`inactive`。
- 前端：移除「待激活」徽标与 `pending_activation` 状态文案。

### 5. 成员增删 → Gitea（取代 91b8b6b4a 与 96eda2883）

- `teamnamespace.UserRef` 收敛为只填 `UserID = <cs-user subject_id>`（移除 `UniversalID`/`EmployeeNumber` 字段或停止使用）。
- 成员添加 → `SyncMembers(teamID, {Mode:"delta", AddMembers:[{UserID:subject_id}]})`；移除/吊销 → `RemoveMembers`。接线点：`BatchAddDeptMembers`、`CreateMember`/`DeleteMember`、`revokeAndRemoveMember`。
- 移除 `linkDeptMembersOnLogin` 里的 `syncWorkspaceGiteaMembers` 触发（激活链已删）。
- costrict-web 侧无改动：`user_id` 本就按 cs-user subject_id 解析 → git binding → AddOrgMember/RemoveOrgMember。

### 6. 停用独立 OAuth

- 停用 `casdoor_oauth.go` 的 `CasdoorCallback` 路由（登录只走嵌入式 SSO 的 `zgsmAdminToken` cookie + JWKS）。
- 其内 `findOrCreateCasdoorUser` 等仅此路径使用的逻辑一并清理。

### 7. 迁移（schema + 数据脚本）

**schema 迁移**（新建，编号先 grep 现有最大值 +1，勿与既有 137/138 重复）：

- `multica_member`：`ADD subject_id TEXT`；建部分唯一索引 `(workspace_id, subject_id) WHERE subject_id IS NOT NULL AND subject_id <> ''`；`DROP external_universal_id`、`external_user_id` 及旧唯一索引。
- `multica_user`：`DROP casdoor_universal_id` 列及 `idx_multica_user_casdoor_universal_id`。
- `subject_id` 列已存在（迁移 113），不动。

**一次性数据迁移脚本**（幂等、可重跑；按下列顺序执行）：

1. **回填 `multica_member.subject_id`**：`UPDATE multica_member m SET subject_id = u.subject_id FROM multica_user u WHERE m.user_id = u.id AND u.subject_id LIKE 'usr_%'`；对仅靠 `external_universal_id` 关联、无 `user_id` 的行，按 `external_universal_id = u.casdoor_universal_id` join 回填（仅当对应 user 是 `usr_` 账号）。
2. **清理无 `subject_id` 的 `pending_activation` 成员行**（激活态已移除）。
3. **清理 Casdoor-sub 遗留账号**：先删这些账号的 `multica_member` 行（避免 FK 阻塞），再 `DELETE FROM multica_user WHERE subject_id IS NULL OR subject_id NOT LIKE 'usr_%'`（本地 Casdoor sub 建号、未切到 cs-user token 的账号），下次登录按 cs-user subject_id 重建。**破坏性**：被删账号的历史成员资格/issue 归属会孤立——用户已确认接受（视为遗留/休眠账号）。

> 顺序约束：回填（1）须在删遗留账号（3）之前，否则 join 不到 `usr_` user 的行无法回填。

## 数据契约（multica 侧）

- **cs-user 搜索响应**：`{"users":[{subject_id, username, display_name, email, casdoor_universal_id, organization, …}]}`。multica 只取 `subject_id`/`display_name`/`username`/`email`（前端 DTO）+ `casdoor_universal_id`（服务端运行期取组织身份，不外泄/不落库）。
- **添加成员请求**（前端→后端）：`{users:[{subject_id}]}`（仅 subject_id；组织身份由后端从 cs-user→dept-sync 富集）。
- **SyncMembers UserRef**：`{user_id: <cs-user subject_id>}`（costrict-web 按 subject_id 解析）。

## 风险 / 取舍

- **遗留账号清理是破坏性的**：被删账号的历史成员资格/issue 归属孤立。用户已确认（遗留/休眠账号，重建即可）。
- **dept-sync 仍依赖 universal_id 作运行期令牌**：universal_id 不落库但每次组织身份富集需从 cs-user 取一次（可 `POST /users/by-ids` 批量取）。dept-sync 不可用时组织身份降级为空，不阻断加成员。
- **subject_id 仅对嵌入式 SSO 成立**：停用独立 OAuth 后，所有用户统一走 cs-user token，`subject_id` 全局一致为 cs-user subject_id。
- 取代既有方案：2026-07-28 provisioning 设计的「保留 universal_id / 发 employee_number」决策（其决策 6、commit 96eda2883）与本设计冲突，**以本设计为准**；Gitea 账号仍按 cs-user subject_id 唯一锚定（不变），仅触发点由「登录激活」改为「成员增删」。
- **添加时建 multica 账号 ≠ 添加时建 Gitea 账号**：本设计在成员添加时按需创建的是 **multica 用户账号**（身份层，绑 subject_id）；Gitea 账号生命周期仍归 costrict-web、在用户**登录**时创建（2026-07-28 设计的「不分叉」原则不变）。两层不混淆，故不重新引入 Gitea 建号分叉。

## 涉及文件清单（multica）

**后端**
- `server/internal/csuser/`（新增）— cs-user 客户端。
- `server/internal/handler/dept.go` — `SearchDeptUsers` 改走 cs-user、删部门 handler。
- `server/internal/handler/workspace_dept.go` — `BatchAddDeptMembers` 去 pending、改 subject_id 键、接 SyncMembers。
- `server/internal/handler/workspace.go` / `workspace_revoke.go` — `CreateMember`/`DeleteMember`/`revokeAndRemoveMember` 接 SyncMembers(UserRef.user_id)。
- `server/internal/handler/me_dept_association.go` — `LinkDeptIdentity` 用运行期 universal_id、删激活调用。
- `server/internal/handler/casdoor_oauth.go` — 停用独立 OAuth。
- `server/cmd/server/main.go` — SubjectResolver 改按 subject_id 解析；cs-user client 装配 + env。
- `server/cmd/server/router.go` — 路由清理（部门、独立 OAuth）。
- `server/internal/deptsync/client.go` — 删部门搜索/列部门方法（保留 `GetUserDepartmentsByUniversalID` 供组织身份富集）。
- `server/internal/teamnamespace/client.go` — `UserRef` 收敛 user_id=subject_id。
- `server/internal/service/workspace_member.go` — 删 pending_activation 常量。
- `server/pkg/db/queries/user.sql` / `member.sql` + `make sqlc` — 删 universal_id / 激活查询，加 member.subject_id 查询。
- `server/migrations/<N>_<...>.up.sql` (+down) — schema 迁移。
- 数据迁移脚本（一次性，仓库内独立脚本）。

**前端**
- `packages/views/settings/components/members-tab.tsx` — 单一姓名搜索框、删部门 UI、加成员只发 subject_id。
- `packages/core/api/client.ts` / `schemas.ts` / `types/api.ts` — cs-user 搜索 DTO、添加请求改 subject_id、删部门相关。
- `packages/views/locales/{en,zh-Hans}/settings.json` — 删部门/待激活文案、改搜索占位符。

**测试**：cs-user client、搜索 handler（limit 3）、BatchAddDeptMembers（active 直绑、SyncMembers 调用）、迁移脚本幂等性。
