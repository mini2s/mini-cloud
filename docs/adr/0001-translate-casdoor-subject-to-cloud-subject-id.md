# ADR-0001:在鉴权层将 Casdoor subject 翻译为 cloud-api subject id

- **状态**:Accepted
- **日期**:2026-07-29
- **服务**:`server`(multica 后端)
- **相关组件**:`internal/middleware`(鉴权)、`internal/cloudidentity`(新增)、cloud-api `/api/auth/me`、cs-cloud daemon

## 背景

同一个自然人(一个手机号账户)在三套系统里有**三个不同的标识**,而 multica
之前解析到了错误的那个:

| 系统 | 该账户在此系统的标识 | 来源 |
|------|--------------------|------|
| Casdoor(SSO 签发方) | `aadbc069-2855-4a51-aaeb-b19eef6edfa1` | JWT 的 `sub` / `universal_id` 声明 |
| cloud-api | `usr_48b35a2c-3981-4c87-a825-dc1cd757e797` | `GET /cloud-api/api/auth/me` → `user.subjectId` |
| multica 用户表 | 以 `subject_id = usr_48b35a2c…` 为键的那一行 | `users.subject_id` 列 |

### 现象

cs-cloud daemon 携带的是**原始 Casdoor JWT**(`sub = aadbc069…`、
`universal_id = aadbc069…`)连到 multica,但它的 runtime 始终不注册,云端
仪表盘显示该设备运行时离线。daemon 本身是健康的(隧道已连接、本地 API
正常、workflow 驱动已启用),也不报任何错误。

### 根因

`cmd/server/main.go` 中的 `subjectResolver`(即同时接到 `CasdoorAuth` 和
`DaemonAuth` 的 `middleware.SubjectResolver`)按如下方式把 token 解析成
multica 用户:

```go
if universalID != "" {
    user, err = queries.GetUserByCasdoorUniversalID(ctx, universalID) // "aadbc069…"
}
if universalID == "" || err != nil {
    user, err = queries.GetUserBySubjectID(ctx, subjectID)            // "aadbc069…"
}
if err != nil {
    // 自动建档占位用户:name="casdoor-<sub>"、email="<sub>@casdoor.local"
    user, err = queries.CreateUser(...)
}
```

两次查找都 miss,因为**真正的** multica 用户(拥有 workspace 的那个)是以
`subject_id = usr_48b35a2c…` 为键,既不挂 `subject_id = aadbc069…`,也不挂
`casdoor_universal_id = aadbc069…`。于是 resolver 落入自动建档分支,创建了
一个全新的**占位用户**(`c5e47c0f-…`、`email = aadbc069…@casdoor.local`、
`onboarded_at = NULL`),该用户**没有任何 workspace 成员关系**。

再往下游,cs-cloud 侧的 `Driver.maintainRegistrations` 调
`GET /api/workspaces`,该请求走 `CasdoorAuth`,被解析到这个空的占位用户,
因此响应是 `[]`,驱动随之静默返回(`workflowrunner/driver.go:591` 在
workspace 列表为空时直接 `return nil` —— 不报错、不打日志)。结果就是:
runtime 不注册、无报错、对用户不可见。

resolver 的代码其实**早已预见到**这类问题 —— 注释里写着"a cs-user token
的 `sub` 是 cs-user 自己的用户 id……但 `universal_id` 标识的是同一个人"。
缺口在于:daemon 实际携带的是一个**原始 Casdoor JWT**,其 `sub` 是 Casdoor
用户 id,token 里没有任何声明能映射到"multica 用户所键入的 cloud-api
subject id"。

## 决策

在 multica 内引入一个 **cloud-api 身份翻译器**,把 Casdoor access token
转换成 cloud-api 稳定的 subject id,并在鉴权层、subject 解析**之前**调用它。
翻译结果按 **universal_id** 缓存(universal_id 跨 token 轮换稳定)。

具体内容:

1. **新增包 `internal/cloudidentity`。** `Client.ResolveSubjectID(ctx,
   universalID, accessToken)` 执行 `GET {CLOUD_API_BASE_URL}/api/auth/me`,带
   `Authorization: Bearer <token>`,返回 `response.user.subjectId`(例如
   `usr_48b35a2c…`)。结果**按 universal_id 在内存中缓存**
   `CLOUD_API_SUBJECT_CACHE_TTL`(默认 2 分钟)—— 缓存键用 JWT 里稳定的
   `universal_id`,而非会轮换的 access token,因此用户 token 刷新后仍命中缓存。
   当 `CLOUD_API_BASE_URL` 未设置时该 client **禁用**(返回 error),因此该特性是 opt-in 的。

2. **解析前先翻译。** `CasdoorAuth`(面向用户的请求,如 `GET /api/workspaces`)
   和 `DaemonAuth` 的 Casdoor-JWT 分支(`/api/daemon/*`,如 daemon 注册)
   现在都接收一个 `CloudSubjectTranslator`,在解析 JWT 之后把
   调 cloud-api 把 token 翻译成 cloudSubjectId(按 universal_id 缓存),再把翻译后的 id 作为 `subjectID`
   传给既有的 `SubjectResolver`;后者的 `GetUserBySubjectID("usr_48b35a2c…")`
   保持不变,从而解析到**真正的**用户。

3. **优雅回退。** 当翻译器为 nil、被禁用,或调用失败(cloud-api 不可达、
   非 200、响应体畸形)时,中间件回退到原始 JWT `sub`,行为与之前**完全
   一致**。

4. **配置。** `CLOUD_API_BASE_URL` 开启该特性;可选 `CLOUD_API_TIMEOUT`
   (5s)与 `CLOUD_API_SUBJECT_CACHE_TTL`(2m)做调优。client 在 `main.go`
   中构造一次,经 `RouterOptions.CloudSubjectTranslator` 透传下去。

```
请求 ──► CasdoorAuth / DaemonAuth
          ├─ ParseCasdoorJWT  → {sub: aadbc069…, universal_id: aadbc069…}
          ├─ cloudidentity.ResolveSubjectID(universal_id, token)  ← 按 universal_id 缓存,失败回退到 sub
          │      GET {CLOUD_API_BASE_URL}/api/auth/me → {user.subjectId: usr_48b35a2c…}
          └─ SubjectResolver(subjectID = usr_48b35a2c…)
                 └─ GetUserBySubjectID → 真正的 multica 用户(拥有 workspace)
```

cs-cloud daemon **无需任何改动** —— 它本来就在发用户 access token,本次修复
完全在服务端。

## 影响

**正面**

- 原始 Casdoor token 也能正确解析到用户:`GET /api/workspaces` 返回真实的
  workspace,daemon 注册其 runtime,仪表盘看到设备上线。
- **向后兼容。** 不设 `CLOUD_API_BASE_URL` 时行为与之前完全一致(回退到
  JWT `sub`),可安全部署、按环境逐步开启。
- 翻译结果按 universal_id 缓存(带 TTL);universal_id 跨 token 轮换稳定,
  所以稳态下每个用户每个缓存窗口只产生一次 cloud-api 调用,而非每次请求都调,
  且 token 刷新不会令缓存失效。
- 逻辑集中在一个包、在一个中间件切面应用,用户态与 daemon 两条鉴权路径
  同等受益。

**负面**

- 每个用户(universal_id)的**首**次请求新增了对 cloud-api 可用性的运行时依赖。通过
  缓存与 JWT-`sub` 回退缓解(请求仍能成功,只是在 cloud-api 恢复前解析到
  旧的身份)。
- universal_id 作为内存 cache key,会保留一个 TTL 窗口;它不是机密值(不像
  access token),不会被记录日志、不会落盘。
- 已经创建的**历史占位用户**(如 `c5e47c0f`)仍留在库里。本次改动只是让
  它们不再被命中,**并不**清理或合并已存在的占位用户 —— 那是另一项数据
  治理工作。

**中性**

- `CasdoorAuth` 和 `DaemonAuth` 多了一个参数(`CloudSubjectTranslator`),
  在测试中、以及该特性未启用时传 `nil`。
- `realtime` 的 websocket hub 使用另一套平行的 `realtime.SubjectResolver`
  类型,**本次有意未覆盖**;若 realtime 鉴权出现同样症状,可后续再补。

## 备选方案

- **A. 把 cloud subject id 直接写进 Casdoor JWT 声明。** 让 cloud-api /
  Casdoor 签发 `sub`(或专用声明)就是 `usr_48b35a2c…` 的 token。
  *否决:*需要身份提供方与 cloud-api 协同改动,且要为所有用户重新签发
  token,对已部署的 token 也无能为力。而 multica 侧翻译是本地的、可回退的、
  对现有 token 立即生效。

- **B. 用 `casdoor_universal_id` 来匹配,而非翻译。** *否决:*在这个 token
  里 `universal_id == sub == aadbc069…`,而真正的 multica 用户这两个值都
  不挂,所以 `GetUserByCasdoorUniversalID` 会因同样的原因 miss。
  universal id 并不能桥接到 multica 用户建档所用的 `usr_…` 键。

- **C. 只做数据修复:把占位用户合并进真实用户 / 把 workspace 改挂过去。**
  *否决作为主方案:*只能修好一个账户,但流程没变,下次原始 Casdoor token
  登录又会重建占位用户。它适合作为本次改动的**补充**清理工作。

- **D. 在 cs-cloud(客户端)做翻译。** *否决:*会让客户端耦合 multica
  内部的用户键方案,要求每个客户端各自实现映射,而且 web(cookie)路径
  仍然是坏的。鉴权身份解析理应在服务端完成。

## 参考

- `server/internal/cloudidentity/client.go` —— 翻译器 + 缓存
- `server/internal/middleware/auth_casdoor.go` —— `CasdoorAuth` 中的翻译
- `server/internal/middleware/daemon_auth.go` —— `DaemonAuth` Casdoor-JWT 分支中的翻译
- `server/cmd/server/main.go` —— client 构造 + `RouterOptions` 装配
- cloud-api 端点:`GET {CLOUD_API_BASE_URL}/api/auth/me` → `{ user: { subjectId } }`
