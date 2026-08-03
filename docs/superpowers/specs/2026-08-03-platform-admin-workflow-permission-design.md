# 设计：workflow 管理权限接入 costrict-web 平台管理员

日期：2026-08-03
状态：已批准（用户确认）

## 背景与目标

multica 目前用 `multica_user.can_manage_workflows` 布尔字段（migration 117）控制一组全局管理操作：内置 agent 管理、agent promote/demote、workflow 模板切换、workflow 管理员名单管理。这是一套与 workspace role 平行的自留权限体系，需要通过 SQL 脚本或专门 UI 单独授予。

目标：在 costrict 集成部署中，改用 **costrict-web 的平台管理员**（`user_system_roles.role='platform_admin'`，旧体系/主力体系）作为这些操作的唯一权限来源；独立部署（无 costrict）保留现有 `can_manage_workflows` 作为 fallback。

### 已确认的关键事实

- costrict-web 旧体系 `user_system_roles` 表是实际承载平台管理后台的体系；`user_id` 列存的是 **subject_id**（bootstrap 用 universal_id 匹配 allowlist，但 `GrantRole(u.SubjectID, ...)` 写入；`/api/auth/me` 用 `ListRoles(user.SubjectID)` 读取）。见 costrict-web `server/internal/user/bootstrap.go:116`、`server/internal/handlers/handlers.go:323`。
- 软删除：撤销角色是 `deleted_at` 软删，查询必须带 `deleted_at IS NULL`。
- 部署事实（deploy-costrict values）：multica（workflow-values.yaml）与 costrict-web 主 server（api-values.yaml）连同一个数据库 `costrict_web`；cs-user 用独立的 `cs_user` 库。因此 multica 可以**直读同库的 `user_system_roles` 表**，无需新增 HTTP 端点（用户已确认选择直读方案）。
- multica 已有直读外部表的先例：`server/pkg/db/schema_external.sql` 为 cs-user 的 `user_auth_identities` 建 sqlc stub。
- multica 不持久化 universal_id（migration 147 已删除该列），但持久化 `multica_user.subject_id`（migration 113），与 costrict 主 server `users.subject_id` 同源（均来自 cs-user/cloud-api）。

## 权限判定规则

```
effective_can_manage_workflows(user):
    if 表 user_system_roles 在当前数据库存在:
        return EXISTS(SELECT 1 FROM user_system_roles
                      WHERE user_id = user.subject_id
                        AND role = 'platform_admin'
                        AND deleted_at IS NULL)
    else:
        return user.can_manage_workflows   -- 现有 fallback
```

- 用户无 `subject_id`（本地邮箱/Google 账号、未接 Casdoor）→ EXISTS 为 false → 若表存在则无权限（集成部署下正确）；表不存在时走 fallback。
- 表存在性在进程启动时探测一次并缓存；探测失败（如建表前的窗口期）按"表不存在"处理并记 warn 日志。不提供运行时切换。
- 不加时间缓存：每次判定一次轻量 indexed EXISTS 查询；管理操作低频，`/api/me` 每次请求多一次 EXISTS 可接受。

## 改动清单

### 后端（multica）

1. **`server/pkg/db/schema_external.sql`**：新增 `user_system_roles` stub（user_id, role, deleted_at 三列子集），注释说明属主是 costrict-web 主 server、需与其 GORM 迁移保持同步。
2. **`server/pkg/db/queries/`**：新增查询：
   - `CheckPlatformAdminTableExists` — `SELECT to_regclass('public.user_system_roles') IS NOT NULL`
   - `IsPlatformAdminBySubjectID` — 上述 EXISTS 查询
   - 运行 `make sqlc` 重新生成。
3. **`server/internal/service/platformadmin/checker.go`**（新）：
   - `Checker` 接口：`CanManageWorkflows(ctx, user MulticaUser) (bool, error)`
   - 启动时探测表存在性 → 选择 DB 模式或 fallback 模式；fallback 模式直接返回 `user.CanManageWorkflows`。
4. **替换所有门控点**（当前都是 `GetUser` 后直读 `CanManageWorkflows` 字段）：
   - `server/internal/handler/workflow.go:1823-1839`（ToggleWorkflowTemplate）
   - `server/internal/handler/workflow.go:1914-1923`（UpdateWorkflowAdmins）
   - `server/internal/handler/agent.go:889-916`（canManageAgent 内置 agent 分支）
   - `server/internal/handler/agent.go:1444-1459`（PromoteAgentToBuiltin）
   - `server/internal/handler/agent.go:1488-1503`（DemoteAgentFromBuiltin）
   - `server/internal/handler/agent.go:563-574`（GetAgent 内置 agent 脱敏判断）
   - `server/internal/handler/agent_cloud_skill.go`（SetAgentCloudSkills，经 canManageAgent）
   - 统一改为调用 Checker；403 文案改为 "only platform admins can ..."。
5. **`GET /api/me`**（`server/internal/handler/auth.go` `UserResponse`）：新增 `can_manage_workflows` 字段，值为 Checker 计算的有效权限。前端改从这里读，不再拉管理员名单。
6. **fallback 模式的名单管理**：
   - `UpdateWorkflowAdmins` / `InviteWorkflowAdmin` / `ListWorkflowAdmins` 仅在 fallback 模式（表不存在）可用；DB 模式下 `UpdateWorkflowAdmins`/`InviteWorkflowAdmin` 返回 403 "workflow admins are managed by costrict platform admin"，`ListWorkflowAdmins` 仍可调用（前端旧逻辑兼容）。
   - 顺带修复已知漏洞：`InviteWorkflowAdmin` 当前不校验调用者身份，任何登录用户可授权 → 加上"调用者本身必须具备有效权限"的校验。
7. **`service.CanManageWorkflows`**（`server/internal/service/workflow.go:2470-2478`，生产无调用方）：改为委托 Checker 或删除（优先删除，避免两套口径）。

### 前端

8. **`packages/core/api/schemas.ts` + `types`**：`/api/me` 响应 schema 增加 `can_manage_workflows: z.boolean().default(false)`（遵循 API Response Compatibility 规则：parseWithFallback + 默认值，老服务端无此字段时降级为 false）。
9. **UI 门控改数据源**（当前都是 `useWorkflowAdmins()` 名单比对）：
   - `packages/views/settings/components/settings-page.tsx` — workflow-admins 标签页显隐
   - `packages/views/settings/components/workflow-admins-tab.tsx` — 管理界面
   - `packages/views/agents/components/agent-detail-page.tsx` — 内置 agent 只读/promote/demote 入口
   - 改为读取 `/api/me` 的 `can_manage_workflows`。
10. **workflow-admins 设置标签页**：仅 fallback 模式显示。模式判定由后端下发：`/api/me` 增加 `workflow_admin_source: "platform" | "local"` 字段（"platform" = 直读 user_system_roles 生效，"local" = fallback），前端据此显隐，不自行猜测。
11. **`packages/core/permissions/rules.ts`**：`canPromoteAgent`/`canDemoteBuiltinAgent` 的入参语义不变（仍是布尔），调用方改为传入新的有效权限值；403 文案同步更新。

### 数据库迁移

- 不删除 `multica_user.can_manage_workflows` 列（fallback 需要）。无新迁移。
- 顺带修复 `server/migrations/scripts/set-first-workflow-admin.sql` 的过时表名（`"user"` → `multica_user`），该脚本仅在 fallback 部署手动使用。

## 不做什么（YAGNI）

- 不接 costrict-web 新体系 `platform_admins` 表（cs-user 库，不同库且非主力体系）。
- 不引入 `business_admin` 或其他角色映射；只认 `platform_admin`。
- 不做权限变更的实时推送/失效广播（直读 DB 天然实时）。
- 不为独立部署提供 workspace owner 降级（用户选择保留原 fallback 语义）。

## 测试

- Go：
  - Checker 单测：表存在/不存在两种模式下，有/无 platform_admin 记录、软删记录、无 subject_id 用户的判定。
  - handler 层：DB 模式下非平台管理员操作内置 agent/promote/template 返回 403；平台管理员放行。
  - `InviteWorkflowAdmin` 新增校验的测试（fallback 模式非管理员调用返回 403）。
  - `/api/me` 返回 `can_manage_workflows` 的测试。
  - 数据库-backed 测试按 CLAUDE.md 用隔离 Docker 测试库运行；注意测试库中 `user_system_roles` 表不存在 → 需在测试 fixture 里按场景建表/删表。
- TS：
  - `/api/me` schema 对缺失 `can_manage_workflows` 字段的老响应解析为 false（malformed/missing field 测试，符合 API Response Compatibility 规则）。
  - agent-detail-page / settings-page 基于 `can_manage_workflows` 的显隐测试（替换原 useWorkflowAdmins mock）。

## 风险与备注

- **schema 漂移**：`user_system_roles` 属主是 costrict-web 主 server（GORM AutoMigrate 管理，无版本化迁移对齐）。若 costrict-web 改表结构（重命名列/表），multica 查询会报错。缓解：查询只依赖 user_id/role/deleted_at 三列；Checker 查询出错时记 error 日志并**拒绝**（fail closed），不崩溃。
- **多部署形态**：本地 `make dev` 无此表 → 自动 fallback，行为与现状完全一致。
- **subject_id 一致性**：假设 multica_user.subject_id 与 costrict 主 server users.subject_id 同源（均 cs-user 签发）。部署验证时发现不匹配的话，备选方案是 join costrict `users` 表按 email 匹配——实施第一步先在 zgsmtest 库上人工验证 `SELECT subject_id FROM multica_user ... ∩ user_system_roles.user_id`。
