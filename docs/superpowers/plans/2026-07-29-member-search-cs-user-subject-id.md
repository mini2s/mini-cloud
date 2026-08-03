# 成员搜索改走 cs-user + 身份模型统一 subject_id — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 成员搜索改走 cs-user（name 模糊、上限 3），身份关联键统一为 cs-user subject_id，彻底不存 universal_id，移除激活逻辑，成员增删触发 Gitea，停用独立 OAuth。

**Architecture:** 仅 multica 侧改动（cs-user / costrict-web / costrict-dept-sync 不改）。采用 expand/contract 迁移：迁移 146 加 `multica_member.subject_id`（保留旧 universal_id 列）；各消费方切换到 subject_id；迁移 147 删 universal_id 列。`universal_id` 不落库，仅作运行期令牌从 Casdoor JWT / cs-user 取，调 dept-sync 现有 `?type=universal` 取组织身份。

**Tech Stack:** Go (Chi + sqlc)、PostgreSQL 迁移、Next.js + TanStack Query + zod（前端）。

**设计依据：** `docs/superpowers/specs/2026-07-29-member-search-cs-user-subject-id-design.md`

**全局约定：** 每个任务结束 `git add` 相关文件并原子提交（conventional commit）。Go 改动后按需 `make sqlc`。全部完成后 `make check`。

---

## File Structure

**新增**
- `server/internal/csuser/client.go` + `_test.go` — cs-user HTTP 客户端（SearchUsers / GetUser）。
- `server/migrations/146_member_subject_id_key.up.sql` (+`.down`) — 加 `multica_member.subject_id` + 唯一索引。
- `server/migrations/147_drop_universal_id_columns.up.sql` (+`.down`) — 删 universal_id 相关列与索引。
- `scripts/migrate-member-subject-id.<sql|sh>` — 一次性数据迁移（回填 + 清理），幂等。

**改动（Go）**
- `server/internal/handler/dept.go` — `SearchDeptUsers` 改走 cs-user；删 `SearchDepartments`/`ListDeptDepartmentUsers`。
- `server/internal/handler/workspace_dept.go` — `BatchAddDeptMembers`：resolve-or-create + subject_id 键 + active + SyncMembers。
- `server/internal/handler/workspace.go` / `workspace_revoke.go` — Create/Delete/revoke 接 SyncMembers。
- `server/internal/handler/me_dept_association.go` — `LinkDeptIdentity` 用运行期 universal_id；删激活调用；`linkDeptMembersOnLogin` 收敛。
- `server/internal/handler/casdoor_oauth.go` — 停用独立 OAuth。
- `server/internal/handler/handler.go` — `workspaceDeptClient` 接口收敛（删 SearchDepartments/ListDepartmentUsers/GetUserDepartmentsByUniversalID 中的部门方法；保留 cs-user + org 身份）。
- `server/cmd/server/main.go` — SubjectResolver 按 subject_id 解析；cs-user client 装配 + env。
- `server/cmd/server/router.go` — 路由清理。
- `server/internal/deptsync/client.go` — 删部门方法，保留 `GetUserDepartmentsByUniversalID`。
- `server/internal/teamnamespace/client.go` — `UserRef` 收敛 `user_id=subject_id`。
- `server/internal/service/workspace_member.go` — 删 `MemberStatusPendingActivation`。
- `server/pkg/db/queries/user.sql` / `member.sql` — 改键、删 universal_id/激活查询。

**改动（前端）**
- `packages/views/settings/components/members-tab.tsx` — 单一姓名搜索框、删部门 UI、加成员只发 subject_id。
- `packages/core/api/client.ts` / `schemas.ts` / `types/api.ts` — cs-user 搜索 DTO、添加请求改 subject_id、删部门相关。
- `packages/views/locales/{en,zh-Hans}/settings.json` — 删部门/待激活文案、改搜索占位符。

---

## Task 1: cs-user 客户端

**Files:**
- Create: `server/internal/csuser/client.go`
- Test: `server/internal/csuser/client_test.go`

- [ ] **Step 1: 写失败测试**

`server/internal/csuser/client_test.go`:
```go
package csuser

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSearchUsersParsesEnvelopeAndSendsToken(t *testing.T) {
	var gotAuth, gotKw, gotLimit string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("X-Internal-Token")
		gotKw = r.URL.Query().Get("keyword")
		gotLimit = r.URL.Query().Get("limit")
		_, _ = w.Write([]byte(`{"users":[{"subject_id":"usr_1","username":"29219","display_name":"Alice","email":"a@x.com","casdoor_universal_id":"uni-1"}]}`))
	}))
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "secret"})
	users, err := c.SearchUsers(context.Background(), "ali", 3)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if gotAuth != "secret" || gotKw != "ali" || gotLimit != "3" {
		t.Fatalf("auth=%q kw=%q limit=%q", gotAuth, gotKw, gotLimit)
	}
	if len(users) != 1 || users[0].SubjectID != "usr_1" || users[0].Name() != "Alice" || users[0].UniversalID() != "uni-1" {
		t.Fatalf("users=%+v", users)
	}
}

func TestGetUserParsesBareObject(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/internal/users/usr_9" {
			t.Fatalf("path=%s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"subject_id":"usr_9","username":"bob","display_name":"Bob"}`))
	}))
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "t"})
	u, err := c.GetUser(context.Background(), "usr_9")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if u.SubjectID != "usr_9" || u.Name() != "Bob" || u.UniversalID() != "" {
		t.Fatalf("user=%+v", u)
	}
}

func TestNotConfigured(t *testing.T) {
	c := NewClient(Config{})
	if _, err := c.SearchUsers(context.Background(), "x", 3); err != ErrNotConfigured {
		t.Fatalf("err=%v", err)
	}
	if !c.Configured() {
		t.Fatal("Configured() should not matter here")
	}
	_ = strings.TrimSpace
}
```

- [ ] **Step 2: 跑测试确认失败**

`cd server && go test ./internal/csuser/ -run TestSearchUsers -v`
Expected: FAIL（包不存在 / 符号未定义）。

- [ ] **Step 3: 实现 `server/internal/csuser/client.go`**

```go
// Package csuser is a minimal client for the costrict-web cs-user internal API.
package csuser

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Config struct {
	BaseURL string
	Token   string // X-Internal-Token
	Timeout time.Duration
}

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func NewClient(cfg Config) *Client {
	if cfg.Timeout == 0 {
		cfg.Timeout = 10 * time.Second
	}
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		token:   strings.TrimSpace(cfg.Token),
		http:    &http.Client{Timeout: cfg.Timeout},
	}
}

func (c *Client) Configured() bool {
	return c != nil && c.baseURL != "" && c.token != ""
}

// User mirrors the subset of cs-user models.User that multica consumes.
type User struct {
	SubjectID          string  `json:"subject_id"`
	Username           string  `json:"username"`
	DisplayName        *string `json:"display_name"`
	Email              *string `json:"email"`
	CasdoorUniversalID *string `json:"casdoor_universal_id"`
	Organization       *string `json:"organization"`
}

// Name is the best display name (display_name, else username) for UI/provisioning.
func (u User) Name() string {
	if u.DisplayName != nil && strings.TrimSpace(*u.DisplayName) != "" {
		return *u.DisplayName
	}
	return u.Username
}

func (u User) EmailOrEmpty() string {
	if u.Email != nil {
		return *u.Email
	}
	return ""
}

// UniversalID is the transient dept-sync lookup token; never persisted by multica.
func (u User) UniversalID() string {
	if u.CasdoorUniversalID != nil {
		return *u.CasdoorUniversalID
	}
	return ""
}

var ErrNotConfigured = fmt.Errorf("cs-user client is not configured")

// SearchUsers calls GET /api/internal/users/search?keyword=&limit= (active users).
func (c *Client) SearchUsers(ctx context.Context, keyword string, limit int) ([]User, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	q := url.Values{}
	q.Set("keyword", keyword)
	if limit > 0 {
		q.Set("limit", fmt.Sprintf("%d", limit))
	}
	var wrapper struct {
		Users []User `json:"users"`
	}
	if err := c.get(ctx, "/api/internal/users/search?"+q.Encode(), &wrapper); err != nil {
		return nil, err
	}
	return wrapper.Users, nil
}

// GetUser calls GET /api/internal/users/:subject_id (bare User object).
func (c *Client) GetUser(ctx context.Context, subjectID string) (User, error) {
	if !c.Configured() {
		return User{}, ErrNotConfigured
	}
	var u User
	if err := c.get(ctx, "/api/internal/users/"+url.PathEscape(subjectID), &u); err != nil {
		return User{}, err
	}
	return u, nil
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Internal-Token", c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("cs-user %s: HTTP %d: %s", path, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.Unmarshal(body, out)
}
```

- [ ] **Step 4: 跑测试确认通过**

`cd server && go test ./internal/csuser/ -v`
Expected: PASS。

- [ ] **Step 5: 提交**

`git add server/internal/csuser/ && git commit -m "feat(csuser): add cs-user internal API client"`

---

## Task 2: 搜索 handler 改走 cs-user + 前端 DTO

**Files:**
- Modify: `server/internal/handler/handler.go`（Handler 加 `CsUser *csuser.Client` 字段；`workspaceDeptClient` 接口暂留）
- Modify: `server/cmd/server/main.go`（装配 cs-user client + env `CS_USER_API_BASE_URL`/`CS_USER_INTERNAL_TOKEN`/`CS_USER_API_TIMEOUT`，传入 handler opts）
- Modify: `server/cmd/server/router.go`（opts 透传 CsUser）
- Modify: `server/internal/handler/dept.go`（`SearchDeptUsers` 改走 cs-user）
- Modify: `packages/core/types/api.ts`、`packages/core/api/schemas.ts`、`packages/core/api/client.ts`（新 DTO）
- Test: `server/internal/handler/dept_test.go`（新增/扩展）

- [ ] **Step 1: 写失败测试 — SearchDeptUsers 调 cs-user、上限 3、返回精简 DTO**

`server/internal/handler/dept_test.go`（用现有 handler test 的 mock 注入模式；参考 `workspace_dept_test.go` 如何注入假的 DeptSync —— 此处注入 `h.CsUser` 为返回固定用户的假 client）。由于 `*csuser.Client` 是具体类型，把 handler 字段改为接口 `csUserSearcher`：

在 `handler.go` 加接口：
```go
type csUserSearcher interface {
	SearchUsers(ctx context.Context, keyword string, limit int) ([]csuser.User, error)
}
```
Handler 字段：`CsUser csUserSearcher`。

测试：
```go
type fakeCSUser struct{ users []csuser.User; gotLimit int }
func (f *fakeCSUser) SearchUsers(_ context.Context, _ string, limit int) ([]csuser.User, error) {
	f.gotLimit = limit
	return f.users, nil
}

func TestSearchDeptUsersCallsCSUserAndCapsAt3(t *testing.T) {
	h := &Handler{CsUser: &fakeCSUser{users: []csuser.User{
		{SubjectID: "usr_1", Username: "alice", DisplayName: pStr("Alice"), Email: pStr("a@x.com"), CasdoorUniversalID: pStr("uni-1")},
	}}}
	req := httptest.NewRequest(http.MethodGet, "/api/dept/users/search?q=ali", nil)
	req.Header.Set("X-User-ID", "u1")
	rec := httptest.NewRecorder()
	h.SearchDeptUsers(rec, req)
	if rec.Code != http.StatusOK { t.Fatalf("code=%d body=%s", rec.Code, rec.Body) }
	if h.CsUser.(*fakeCSUser).gotLimit != 3 { t.Fatalf("limit=%d", h.CsUser.(*fakeCSUser).gotLimit) }
	var got []map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if len(got) != 1 || got[0]["subject_id"] != "usr_1" || got[0]["name"] != "Alice" {
		t.Fatalf("body=%s", rec.Body)
	}
	if _, has := got[0]["casdoor_universal_id"]; has {
		t.Fatal("universal_id must NOT leak to frontend")
	}
}
```
（`pStr` = helper `func pStr(s string)*string{return &s}`；`requireUserID` 的 mock 按现有 test 模式处理。）

- [ ] **Step 2: 跑测试确认失败**

`cd server && go test ./internal/handler/ -run TestSearchDeptUsersCallsCSUser -v`
Expected: FAIL。

- [ ] **Step 3: 实现 handler**

`server/internal/handler/dept.go` 替换 `SearchDeptUsers`：
```go
const deptUserSearchLimit = 3

// deptUserSearchHit is the trimmed DTO returned to the frontend.
type deptUserSearchHit struct {
	SubjectID string `json:"subject_id"`
	Name      string `json:"name"`
	Email     string `json:"email,omitempty"`
}

func (h *Handler) SearchDeptUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUserID(w, r); !ok {
		return
	}
	if h.CsUser == nil {
		writeError(w, http.StatusServiceUnavailable, "cs-user is not configured")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	users, err := h.CsUser.SearchUsers(r.Context(), q, deptUserSearchLimit)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to search users")
		return
	}
	if len(users) > deptUserSearchLimit {
		users = users[:deptUserSearchLimit]
	}
	hits := make([]deptUserSearchHit, 0, len(users))
	for _, u := range users {
		hits = append(hits, deptUserSearchHit{SubjectID: u.SubjectID, Name: u.Name(), Email: u.EmailOrEmpty()})
	}
	writeJSON(w, http.StatusOK, hits)
}
```
装配：`main.go` 加
```go
csUserClient := csuser.NewClient(csuser.Config{
	BaseURL: strings.TrimRight(strings.TrimSpace(os.Getenv("CS_USER_API_BASE_URL")), "/"),
	Token:   os.Getenv("CS_USER_INTERNAL_TOKEN"),
	Timeout: envDuration("CS_USER_API_TIMEOUT", 10*time.Second),
})
```
handler opts 加 `CsUser: csUserClient`；`router.go` option 加 `CsUser *csuser.Client` 并透传到 `Handler{CsUser: opts.CsUser}`。

- [ ] **Step 4: 跑测试确认通过**

`cd server && go test ./internal/handler/ -run TestSearchDeptUsers -v` → PASS。

- [ ] **Step 5: 前端类型/schema/client 对齐**

`packages/core/types/api.ts`：把 `DeptUser` 改为（或新增 `CsUserSearchHit`）：
```ts
export interface CsUserSearchHit {
  subject_id: string;
  name: string;
  email?: string;
}
```
`packages/core/api/schemas.ts`：
```ts
export const CsUserSearchHitSchema = z.object({
  subject_id: z.string(),
  name: z.string(),
  email: z.string().optional(),
}).loose();
export const CsUserSearchHitListSchema = z.array(CsUserSearchHitSchema);
```
`packages/core/api/client.ts`：
```ts
async searchDeptUsers(query: string): Promise<CsUserSearchHit[]> {
  const raw = await this.fetch<unknown>(`/api/dept/users/search?q=${encodeURIComponent(query)}`);
  return parseWithFallback(raw, CsUserSearchHitListSchema, EMPTY_CS_USER_HITS, { url: "searchDeptUsers", query });
}
```
（`EMPTY_CS_USER_HITS = []`；删旧 `DeptUser*` schema 若无其它引用——部门 UI 移除在 Task 8。）

- [ ] **Step 6: typecheck**

`pnpm typecheck` → 通过（前端 members-tab 此刻仍引用旧 DeptUser，Task 8 一并改；若 typecheck 报错，保留旧 `DeptUser` 类型直至 Task 8）。

- [ ] **Step 7: 提交**

`git add -A && git commit -m "feat(handler): search members via cs-user by name (limit 3)"`

---

## Task 3: 迁移 146 — 加 multica_member.subject_id（expand）

**Files:**
- Create: `server/migrations/146_member_subject_id_key.up.sql` (+`.down`)
- Regenerate: sqlc

- [ ] **Step 1: 写迁移 `146_member_subject_id_key.up.sql`**
```sql
ALTER TABLE multica_member ADD COLUMN IF NOT EXISTS subject_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_multica_member_workspace_subject
  ON multica_member (workspace_id, subject_id)
  WHERE subject_id IS NOT NULL AND subject_id <> '';
```
`146_member_subject_id_key.down.sql`：
```sql
DROP INDEX IF EXISTS idx_multica_member_workspace_subject;
ALTER TABLE multica_member DROP COLUMN IF EXISTS subject_id;
```

- [ ] **Step 2: 跑迁移**

`make migrate-up` → 成功。

- [ ] **Step 3: 提交**

`git add server/migrations/146_* && git commit -m "feat(db): add multica_member.subject_id column (expand)"`

---

## Task 4: BatchAddDeptMembers — resolve-or-create + subject_id 键 + active

**Files:**
- Modify: `server/pkg/db/queries/member.sql`（改 `UpsertDeptMember` 键为 subject_id；改 `ListDeptMemberSnapshots`；加 `GetMemberByWorkspaceAndSubject`）
- Modify: `server/internal/handler/workspace_dept.go`（请求体改 `subject_id`；resolve-or-create；active；填组织身份）
- Modify: `server/internal/service/workspace_member.go`（`WorkspaceDeptMemberSnapshot` 加 `SubjectID`，去 `ExternalUniversalID`/`ExternalUserID` 依赖）
- Regenerate: sqlc
- Test: `server/internal/handler/workspace_dept_test.go`

> 说明：本任务把 member 键切到 `subject_id`，但**先不删** `external_universal_id`/`external_user_id` 列（Task 10 删）。Upsert 的 ON CONFLICT 改用 `(workspace_id, subject_id)` 新索引；旧列留空。

- [ ] **Step 1: 改 SQL 查询**

`member.sql`：

把 `UpsertDeptMember` 改为按 subject_id upsert（保留旧列写入为 NULL/COALESCE，避免 Task 10 前编译断裂）：
```sql
-- name: UpsertDeptMember :one
INSERT INTO multica_member (
    workspace_id, user_id, role, source, status, subject_id,
    employee_id, org_display_name, dept_id, dept_name, dept_path,
    position, is_main_department, dept_user_status, last_synced_at
)
VALUES ($1, $2, 'member', 'dept', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
ON CONFLICT (workspace_id, subject_id) WHERE subject_id IS NOT NULL AND subject_id <> ''
DO UPDATE SET
    user_id = EXCLUDED.user_id,
    status = EXCLUDED.status,
    subject_id = EXCLUDED.subject_id,
    employee_id = EXCLUDED.employee_id,
    org_display_name = EXCLUDED.org_display_name,
    dept_id = EXCLUDED.dept_id,
    dept_name = EXCLUDED.dept_name,
    dept_path = EXCLUDED.dept_path,
    position = EXCLUDED.position,
    is_main_department = EXCLUDED.is_main_department,
    dept_user_status = EXCLUDED.dept_user_status,
    last_synced_at = NOW()
RETURNING *;
```
（参数顺序对应 `UpsertDeptMemberParams`；`make sqlc` 后核对生成的 struct 字段。）

新增：
```sql
-- name: GetMemberByWorkspaceAndSubject :one
SELECT * FROM multica_member
WHERE workspace_id = $1 AND subject_id = $2;
```
`ListDeptMemberSnapshots`：把 `WHERE external_universal_id = ANY(...)` 改为 `WHERE subject_id = ANY($2::text[])`（或保留两者直到 Task 10；此处切 subject_id）。

- [ ] **Step 2: `make sqlc` 并核对生成 struct**

- [ ] **Step 3: 写失败测试 — 添加已存在用户**

扩展 `workspace_dept_test.go`：构造一个已绑定 `subject_id` 的 multica user + 假 `csUserSearcher`/`deptOrgResolver`，POST `{users:[{subject_id:"usr_1"}]}`，断言：member 创建、status=active、user_id 绑定、未出现 pending_activation。

- [ ] **Step 4: 写失败测试 — 用户无账号时建号**

同上但 user 不存在；断言：调用 `CreateUser`+`SetUserSubjectID`，member 绑定新 user_id，status=active。

- [ ] **Step 5: 跑测试确认失败**

`cd server && go test ./internal/handler/ -run TestBatchAddDeptMembers -v` → FAIL。

- [ ] **Step 6: 重写 `BatchAddDeptMembers` 核心**

`workspace_dept.go`：请求体改为：
```go
type batchAddDeptMemberRef struct {
	SubjectID string `json:"subject_id"`
}
```
循环每个 ref：
1. `csUser.GetUser(ctx, ref.SubjectID)` → `csuser.User`（取 name/email/universal_id）。
2. 解析 multica 用户：`queries.GetUserBySubjectID(ctx, subjectID)`；若 `ErrNoRows` → `CreateUser(name,email)` + `SetUserSubjectID(subjectID)`（email 空用 `subjectID+"@csuser.local"`；email 唯一冲突按现有 adopt 逻辑：`GetUserByEmail` 后绑 subject_id）。
3. 组织身份：若 `csUser.UniversalID() != ""`，`deptSync.GetUserDepartmentsByUniversalID(ctx, universalID)` → `pickMainActiveDepartment` → 建 snapshot；否则 snapshot 组织字段留空。
4. `UpsertDeptMember`（status=`active`，subject_id 键，user_id 绑定）。
5. （SyncMembers 接线在 Task 7；本任务先留 TODO 钩子或直接接，见 Task 7。）

删除旧 `deptMemberSnapshotFromSubmittedRef` / `resolveDeptUserRef` / `deptMemberSnapshotFromDeptUser`（dept-sync 搜索路径已不用）。

- [ ] **Step 7: 跑测试确认通过**

`cd server && go test ./internal/handler/ -run TestBatchAddDeptMembers -v` → PASS。

- [ ] **Step 8: 提交**

`git add -A && git commit -m "feat(handler): add members by cs-user subject_id, provision multica user if missing"`

---

## Task 5: 登录解析器按 subject_id + LinkDeptIdentity 用运行期 universal_id

**Files:**
- Modify: `server/cmd/server/main.go`（SubjectResolver）
- Modify: `server/internal/handler/me_dept_association.go`（`LinkDeptIdentity` / `linkDeptMembersOnLogin`）
- Modify: `server/internal/handler/casdoor_oauth.go`（其 universal_id 写入路径——独立 OAuth 在 Task 9 停用，此处先去掉 universal_id 落库）
- Test: `server/internal/handler/me_dept_association_test.go`

- [ ] **Step 1: 写失败测试 — 解析器按 subject_id 命中、不写 universal_id**

`me_dept_association_test.go`：注入预置 user（subject_id=`usr_1`），调 `LinkDeptIdentity`，断言 member 组织快照被 dept-sync（假）填充、且**未**调用 `SetUserCasdoorUniversalID`（该 setter 在 Task 10 删；此处用 mock Queries 断言未触发）。

- [ ] **Step 2: 跑测试确认失败**

`cd server && go test ./internal/handler/ -run TestLinkDeptIdentity -v` → FAIL。

- [ ] **Step 3: 改 SubjectResolver（main.go:356-488）**

- 解析顺序改为：**先 `GetUserBySubjectID(subjectID)`**（subjectID = 嵌入式 SSO 的 JWT sub = cs-user subject_id）；命中即返回。
- 未命中 → 建号：`CreateUser` + `SetUserSubjectID(subjectID)`。**移除所有 `SetUserCasdoorUniversalID` 写入与 `GetUserByCasdoorUniversalID` 查询分支**。
- `universalID` 参数仍透传给后台 `LinkDeptIdentity`（运行期取组织身份用），但**不落库**。
- email-adopt 分支保留，但只绑 `subject_id`（不绑 universal_id）。

- [ ] **Step 4: 改 `LinkDeptIdentity`（me_dept_association.go）**

- 保留：`deptSync.GetUserDepartmentsByUniversalID(ctx, universalID)`（运行期 token）→ `pickMainActiveDepartment` → `RefreshUserMembershipDeptOrg`（按 user_id 刷组织快照）+ `SetUserName`。
- `RefreshUserMembershipDeptOrg` 的 SQL 去掉写 `external_universal_id`/`external_user_id`（见 member.sql Task 4 已改键；此处让其只刷组织字段 + subject_id）。
- **删除** `ActivatePendingDeptMembersByUniversalID` / `DeleteOrphanPendingDeptMembers` 调用（Task 6 删 SQL；此处先不调）。
- `linkDeptMembersOnLogin`：保留 `LinkDeptIdentity` 调用；**删除** per-workspace `syncWorkspaceGiteaMembers`（Task 7 把 Gitea 移到增删时）。

- [ ] **Step 5: 跑测试确认通过**

`cd server && go test ./internal/handler/ -run TestLinkDeptIdentity -v` → PASS。

- [ ] **Step 6: 提交**

`git add -A && git commit -m "refactor(auth): resolve login by cs-user subject_id; universal_id transient only"`

---

## Task 6: 移除 pending_activation

**Files:**
- Modify: `server/pkg/db/queries/member.sql`（删 `ActivatePendingDeptMembersByUniversalID`、`DeleteOrphanPendingDeptMembers`）
- Modify: `server/internal/service/workspace_member.go`（删 `MemberStatusPendingActivation` 常量）
- Modify: 迁移（CHECK 约束）：在 `147` 里收敛 status 枚举（见 Task 10），或新增迁移移除 `pending_activation` CHECK。本任务在 `147_drop_universal_id_columns` 一并处理 status CHECK（见 Task 10 Step）。
- Modify: `packages/core/types/workspace.ts`（`MemberStatus` 去 `pending_activation`）+ 前端徽标/文案（Task 8/12）
- Regenerate: sqlc

- [ ] **Step 1: 删 SQL 查询** `member.sql`：删 `ActivatePendingDeptMembersByUniversalID` 与 `DeleteOrphanPendingDeptMembers` 两段。

- [ ] **Step 2: `make sqlc`**

- [ ] **Step 3: 删常量** `service/workspace_member.go`：删 `MemberStatusPendingActivation = "pending_activation"`。

- [ ] **Step 4: 清理引用** `grep -rn "pending_activation\|PendingActivation\|ActivatePending\|DeleteOrphanPending" server/`，逐处删除（handler、service、test）。

- [ ] **Step 5: 前端类型** `packages/core/types/workspace.ts`：`MemberStatus = "active" | "inactive"`。

- [ ] **Step 6: 跑 Go 测试**

`cd server && go test ./... ` → 通过（修掉因删常量失败的 test）。

- [ ] **Step 7: 提交**

`git add -A && git commit -m "refactor(member): remove pending_activation state"`

---

## Task 7: 成员增删 → SyncMembers(UserRef.user_id=subject_id)

**Files:**
- Modify: `server/internal/teamnamespace/client.go`（`UserRef` 收敛）
- Modify: `server/internal/handler/workspace_dept.go`（BatchAdd 后 add）
- Modify: `server/internal/handler/workspace.go`（`CreateMember`/`DeleteMember`）
- Modify: `server/internal/handler/workspace_revoke.go`（`revokeAndRemoveMember`）
- Test: 相关 `*_test.go`

- [ ] **Step 1: 写失败测试 — BatchAdd 触发 SyncMembers add（user_id=subject_id）**

`workspace_dept_test.go`：注入假 `teamnamespace.Client`（记录 SyncMembers 请求），POST 加成员，断言 `AddMembers=[{user_id:"usr_1"}]`。

- [ ] **Step 2: 跑测试确认失败**

`cd server && go test ./internal/handler/ -run TestBatchAdd.*Gitea -v` → FAIL。

- [ ] **Step 3: 改 `UserRef`**

`teamnamespace/client.go`：
```go
type UserRef struct {
	UserID string `json:"user_id,omitempty"` // cs-user subject_id
}
```
删 `UniversalID`、`EmployeeNumber` 字段（若被 workflow_deliverable_repo.go 引用，改为填 `UserID` = 该处已有的 subject_id/universal_id 来源——核实后填 subject_id）。

- [ ] **Step 4: 接线 add/remove**

- `BatchAddDeptMembers` 成员落库后：`teamNS.SyncMembers(teamID, SyncMembersRequest{Mode:"delta", AddMembers:[{UserID:subject_id}]})`（best-effort，错误记日志不阻断；`teamNS.Configured()` 为 false 跳过）。
- `revokeAndRemoveMember` / `DeleteMember`：`RemoveMembers:[{UserID:subject_id}]`。
- `CreateMember`（手动加成员，若有 subject_id）：同 add。
- 删除 `linkDeptMembersOnLogin` 残留的 `syncWorkspaceGiteaMembers`（Task 5 已删，确认无残留）。

- [ ] **Step 5: 跑测试确认通过**

`cd server && go test ./internal/handler/ -run "TestBatchAdd|TestRevoke|TestDelete" -v` → PASS。

- [ ] **Step 6: 提交**

`git add -A && git commit -m "feat(handler): sync Gitea membership on member add/remove via subject_id"`

---

## Task 8: 移除部门搜索 / 列部门成员（前后端）+ 前端搜索/添加 UI

**Files:**
- Modify: `server/internal/handler/dept.go`（删 `SearchDepartments`、`ListDeptDepartmentUsers`）
- Modify: `server/cmd/server/router.go`（删部门路由）
- Modify: `server/internal/handler/handler.go`（`workspaceDeptClient` 删 `SearchDepartments`/`ListDepartmentUsers`）
- Modify: `server/internal/deptsync/client.go`（删 `SearchDepartments`/`ListDepartmentUsers`/`GetDepartment`/`listDepartmentTree`/`listDepartmentUsersRaw` 等；**保留 `GetUserDepartmentsByUniversalID`**）
- Modify: `packages/views/settings/components/members-tab.tsx`
- Modify: `packages/core/api/client.ts`（删 `searchDeptDepartments`/`listDeptDepartmentUsers`）
- Modify: `packages/core/api/schemas.ts` / `types/api.ts`（删 `DeptDepartment*`、旧 `DeptUser*`）
- Modify: `packages/views/locales/{en,zh-Hans}/settings.json`

- [ ] **Step 1: 删后端部门 handler/路由/接口方法/deptsync 方法**（保留 `SearchDeptUsers`、`GetUserDepartmentsByUniversalID`）。

- [ ] **Step 2: `cd server && go build ./... && go test ./...`** → 通过。

- [ ] **Step 3: 改前端 members-tab.tsx**

- 搜索输入框：单一姓名搜索（placeholder 改 `dept_member_search_placeholder`）；删部门结果区（`dept-department-results`）、select-all、back-to-departments、`handleSelectDepartment`、`handleBackToDepartments`。
- 搜索 effect 只调 `api.searchDeptUsers(query)`（不再并行 `searchDeptDepartments`）。
- 结果行：显示 `hit.name`（+ email 次行），key 用 `subject_id`。
- `deptUserToBatchSnapshot` → `(hit) => ({ subject_id: hit.subject_id })`。
- 已选/已加判断 key 改 `subject_id`（member.subject_id）。

- [ ] **Step 4: 改 api client / schemas / types** — 删 `searchDeptDepartments`、`listDeptDepartmentUsers`、`DeptDepartment*`、旧 `DeptUser*`；`batchAddDeptMembers` 请求体改 `{users:[{subject_id}]}`（`BatchAddDeptMemberSnapshot = { subject_id: string }`）。

- [ ] **Step 5: 改 locales** — 删 `dept_results_departments`/`dept_view_members`/`dept_select_all_members`/`dept_back_to_departments`/`dept_members_in_department`/`statuses.pending_activation`；搜索占位符用 `dept_member_search_placeholder`（"按姓名搜索"/"Search by name"）。

- [ ] **Step 6: typecheck + 前端测试**

`pnpm typecheck && pnpm --filter @multica/views exec vitest run settings/components/members-tab.test.tsx`
→ 修 members-tab.test.tsx（删部门相关用例，改搜索/添加用例为 subject_id）。

- [ ] **Step 7: 提交**

`git add -A && git commit -m "refactor(members): name-only cs-user search UI; remove department browse"`

---

## Task 9: 停用独立 Casdoor OAuth

**Files:**
- Modify: `server/cmd/server/router.go`（移除 OAuth callback 路由）
- Modify: `server/internal/handler/casdoor_oauth.go`（删除 `CasdoorCallback` 及仅其使用的 `findOrCreateCasdoorUser`/`exchangeCasdoorCode`/`fetchCasdoorUserInfo` 等；若被引用则保留）
- Test: 移除/调整相关 test

- [ ] **Step 1: grep 用法** `grep -rn "CasdoorCallback\|casdoor/oauth\|/oauth/callback" server/`，确认仅路由引用。

- [ ] **Step 2: 删路由 + handler**（保留 JWKS 中间件 `CasdoorAuth` —— 那是嵌入式 SSO 验签，不能删）。

- [ ] **Step 3: `cd server && go build ./... && go test ./...`** → 通过。

- [ ] **Step 4: 提交**

`git add -A && git commit -m "refactor(auth): disable standalone Casdoor OAuth, login via embedded SSO only"`

---

## Task 10: 迁移 147 — 删 universal_id 列（contract）+ 清理所有引用

**Files:**
- Create: `server/migrations/147_drop_universal_id_columns.up.sql` (+`.down`)
- Modify: `server/pkg/db/queries/user.sql`（删 `GetUserByCasdoorUniversalID`/`SetUserCasdoorUniversalID`）
- Modify: `server/pkg/db/queries/member.sql`（`ListMembersWithUser`/`ListActiveWorkflowRoleCandidateMembers` 去掉 `external_universal_id`/`external_user_id` 列；`UpsertDeptMember`/`RefreshUserMembershipDeptOrg` 已在 Task 4/5 改）
- Modify: 全仓清 `casdoor_universal_id`/`external_universal_id`/`external_user_id`/`CasdoorUniversalID`/`ExternalUniversalID`/`ExternalUserID` 残留
- Regenerate: sqlc

- [ ] **Step 1: 写迁移 `147_drop_universal_id_columns.up.sql`**
```sql
-- status 枚举收敛（移除 pending_activation）
ALTER TABLE multica_member DROP CONSTRAINT IF EXISTS multica_member_status_check;
ALTER TABLE multica_member
  ADD CONSTRAINT multica_member_status_check
  CHECK (status IN ('active', 'inactive'));

-- 删 universal_id / external 标识列
DROP INDEX IF EXISTS idx_multica_member_workspace_external_universal;
ALTER TABLE multica_member DROP COLUMN IF EXISTS external_universal_id;
ALTER TABLE multica_member DROP COLUMN IF EXISTS external_user_id;

DROP INDEX IF EXISTS idx_multica_user_casdoor_universal_id;
ALTER TABLE multica_user DROP COLUMN IF EXISTS casdoor_universal_id;
```
（约束/索引名以实际 DB 为准——`grep -rn "external_universal\|status_check\|casdoor_universal" server/migrations/`。）down 反向恢复。

- [ ] **Step 2: 删 user.sql 查询** — 删 `GetUserByCasdoorUniversalID`、`SetUserCasdoorUniversalID`。

- [ ] **Step 3: 改 member.sql SELECT 列** — `ListMembersWithUser` 与 `ListActiveWorkflowRoleCandidateMembers` 删 `m.external_universal_id`、`m.external_user_id`（及对应 RETURNING/SELECT）。

- [ ] **Step 4: `make sqlc`**

- [ ] **Step 5: 清残留** `grep -rn "CasdoorUniversalID\|ExternalUniversalID\|ExternalUserID\|casdoor_universal_id\|external_universal_id\|external_user_id\|GetUserByCasdoorUniversalID\|SetUserCasdoorUniversalID" server/` → 逐处删（handler、service、workflow_role_resolution.go、test）。`workflow_role_resolution.go` 用 `GetUserDepartmentsByUniversalID` 仍需 universal_id 作运行期入参——保留该调用，但 universal_id 来自运行期（登录态/调用方传入），不来自已删的列。

  > 注意：`workflow_role_resolution.go`（deptWorkflowRoleOrganizationProvider）当前可能从 member/user 列读 universal_id。改为其调用方传入运行期 universal_id（或按 subject_id→cs-user 取 universal_id 后再查 dept-sync）。核实并改。

- [ ] **Step 6: `make migrate-up && cd server && go build ./... && go test ./...`** → 通过。

- [ ] **Step 7: 提交**

`git add -A && git commit -m "refactor(db): drop universal_id columns, converge to subject_id (contract)"`

---

## Task 11: 一次性数据迁移脚本

**Files:**
- Create: `scripts/migrate-member-subject-id.sql`（幂等）

- [ ] **Step 1: 写脚本**（按 spec §7 顺序）
```sql
-- 1. 回填 multica_member.subject_id（仅能 join 到 usr_ 账号的行）
UPDATE multica_member m
SET subject_id = u.subject_id
FROM multica_user u
WHERE m.user_id = u.id
  AND u.subject_id LIKE 'usr\_%' ESCAPE '\'
  AND (m.subject_id IS NULL OR m.subject_id = '');

-- （迁移 147 已删 external_universal_id；若在 147 之前跑此脚本，补一段按
--   external_universal_id = u.casdoor_universal_id 的 join 回填。建议跑序：
--   146 → 本脚本 → 147。）

-- 2. 清理无 subject_id 的 pending/失效成员行（激活态已移除）
DELETE FROM multica_member
WHERE (subject_id IS NULL OR subject_id = '')
  AND status <> 'active';

-- 3. 清理 Casdoor-sub 遗留账号（先成员后用户，避免 FK 阻塞）
DELETE FROM multica_member
WHERE user_id IN (SELECT id FROM multica_user WHERE subject_id IS NULL OR subject_id NOT LIKE 'usr\_%' ESCAPE '\');
DELETE FROM multica_user
WHERE subject_id IS NULL OR subject_id NOT LIKE 'usr\_%' ESCAPE '\';
```

- [ ] **Step 2: 文档化跑序** — 脚本头部注释：`make migrate-up`（到 146）→ 跑本脚本 → `make migrate-up`（147）。或在 147 之前的手动窗口执行。

- [ ] **Step 3: 提交**

`git add scripts/migrate-member-subject-id.sql && git commit -m "chore(db): one-shot migration script for subject_id backfill + legacy cleanup"`

---

## Task 12: 端到端核对 + make check

- [ ] **Step 1: `make check`**（typecheck + TS 测试 + Go 测试 + e2e）。逐项修红。

- [ ] **Step 2: 手动核对关键路径**（本地 `make dev`）：管理员姓名搜索（≤3 条、无部门结果）→ 选成员添加 → 成员 active、组织身份填充 → Gitea org 成员新增；移除成员 → Gitea 移除；新用户（无 multica 账号）添加 → 自动建号。

- [ ] **Step 3: 最终提交（若有修复）**

`git add -A && git commit -m "test: fix fallout from member-search cs-user refactor"`

---

## Self-Review（计划完成后自查，已执行）

**Spec coverage：** 需求 1（Task 1/2）、2（Task 2/8）、3（Task 2 limit=3）、4（Task 4/6）、5（Task 4/5）、6（Task 3/4/5/10 + 身份键）、补充「无账号则建号」（Task 4 Step 3/6）、Gitea（Task 7）、停用 OAuth（Task 9）、迁移脚本（Task 11）—— 全覆盖。

**类型一致性：** `csuser.User`、`deptUserSearchHit{subject_id,name,email}`、`CsUserSearchHit`（前后端字段名一致 snake_case）、`UserRef.UserID`(subject_id)、`batchAddDeptMemberRef.SubjectID`、`UpsertDeptMember` 新参数序——跨任务命名已对齐。

**顺序/绿灯：** 146 加列 → 消费方切换（Task 4-9，旧列暂留）→ 147 删列。每任务 `go build`/`go test`/`pnpm typecheck` 通过后提交。
