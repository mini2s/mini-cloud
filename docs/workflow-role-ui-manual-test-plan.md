# 工作流角色功能 - UI 手动测试流程

> 分支：`feat/add-role-v1`
> 目的：在合并前完整验证角色功能的 UI 行为，覆盖 Settings→Roles、Node Config、画布显示、执行期、多语言、跨 workspace、Desktop 一致性等场景。
> 使用方式：逐条执行，每项打勾并记录证据。本文档描述当前实现，不把尚未实现的交互写成通过条件。

---

## 〇、前置准备

### 环境就绪

```bash
make dev   # 启动 backend + frontend
```

访问 `http://localhost:3000`，登录主账号。

### 测试数据准备

1. **创建测试 workspace**（如已有可跳过）：`/workspaces/new`
2. **邀请/添加 3 个成员**（Settings → Members）：
   - Sarah Chen（设为 Frontend Engineer 角色 — 通过成员的 job role 字段）
   - Marcus Lee（设为 Tech Lead）
   - John Smith（无角色，备用）
3. **创建 2 个 agent**（Settings → Agents）：
   - `Builder Agent`（runtime: cloud）
   - `Reviewer Agent`（runtime: cloud）
4. **创建 1 个 squad**（Settings → Squads）：包含 Sarah + Marcus

---

## 一、Settings → Roles Tab

### TC-1.1 进入 Roles Tab，验证页面可见

**步骤**：
1. 点击左侧栏 ⚙️ Settings
2. 观察顶部 Tab 列表

**期望**：
- [ ] 看到 `Members | Roles | Agents | Squads | ...` 顺序
- [ ] `Roles` Tab 存在且可点击
- [ ] 图标是 `UserRoundCog`

**实际**：

---

### TC-1.2 查看初始 Builtin 角色

**步骤**：
1. 点击 `Roles` Tab

**期望**：
- [ ] 看到 3 个内置角色：**Developer** / **QA** / **Tech Lead**
- [ ] 每个角色右上角有 `[Built-in]` 标签
- [ ] 名称和职责描述按当前语言本地化
- [ ] Builtin 角色没有编辑或删除按钮

**实际**：

---

### TC-1.3 创建自定义角色

**步骤**：
1. 在页面顶部的创建表单填写：
   - Name: `Frontend Engineer`
   - Description: `Builds React components and fixes UI bugs`
2. 点击 `Create Role`

**期望**：
- [ ] 列表立即出现 `Frontend Engineer`（无需手动刷新）
- [ ] 该行没有 `[Built-in]` 标签
- [ ] Toast 提示 "Role created" 或类似成功消息
- [ ] 创建表单清空

**实际**：

---

### TC-1.4 编辑自定义角色

**步骤**：
1. 点击 `Frontend Engineer` 行的编辑按钮（铅笔图标）
2. 该行切换为内联编辑表单
3. 修改 Name 为 `Frontend Engineer (Senior)`
4. 修改 Description 为 `Senior FE, mentors juniors`
5. 保存

**期望**：
- [ ] 列表立即更新名称和描述（无需刷新）
- [ ] Toast 成功提示
- [ ] 若该角色已被某节点引用，节点画布上的角色名同步更新（去验证 TC-3.4）

**实际**：

---

### TC-1.5 删除未被引用的自定义角色

**步骤**：
1. 创建一个新的临时角色 `Temp Role`
2. 点击删除按钮
3. 在确认对话框中确认删除

**期望**：
- [ ] 列表中 `Temp Role` 立即消失
- [ ] Toast 成功提示

**实际**：

---

### TC-1.6 【边界】删除被引用的角色（验证引用拦截）

**步骤**：
1. 先在工作流中给某节点指派 `Frontend Engineer`（参考 TC-2.3）
2. 回到 Settings → Roles Tab
3. 观察 `Frontend Engineer` 行的删除按钮和说明
4. 尝试点击删除按钮

**期望**：
- [ ] 页面显示角色正在被引用、无法删除的说明
- [ ] 删除按钮处于禁用状态
- [ ] 不存在强制删除入口
- [ ] 通过 API 直接删除该角色返回冲突响应，节点引用保持不变

**实际**：

---

### TC-1.7 【边界】创建重名角色

**步骤**：
1. 尝试创建名为 `Developer` 的角色（与 builtin 重名）

**期望**：
- [ ] 表单验证报错 "Name already exists" 或后端 400 错误
- [ ] 不能创建成功

**实际**：

---

## 二、Workflow Node Config Panel（角色配置）

### TC-2.1 进入工作流编辑器

**步骤**：
1. 侧边栏点击 🔧 Workflows
2. 选择一个已有工作流（或新建一个 `Release Pipeline`）
3. 进入画布编辑模式
4. 点击任意一个 worker 节点

**期望**：
- [ ] 右侧打开 Node Inspector 面板
- [ ] Primary / Worker / Critic 三个 section 可见
- [ ] Worker 区块显示 `Direct` 与 `Role` 两种互斥模式

**实际**：

---

### TC-2.2 给 Worker 指派角色（清空原 Assignee）

**步骤**：
1. 当前 Worker 是 `Builder Agent`（assignee_type=agent）
2. 切换到 `Role` 模式
3. 在角色下拉中选择 `Frontend Engineer`

**期望**：
- [ ] Worker role 下拉显示 `Frontend Engineer`
- [ ] 具体 Assignee 选择器不再显示，保存请求中的 `worker_id` 被清空
- [ ] 节点画布上的小卡片立即更新（橙色圆点 + "Role · Frontend Engineer"）—— 参考 TC-3.3
- [ ] Inspector 顶部出现 "Unsaved changes" 状态
- [ ] **未点 Save 前**，刷新页面应回到原状态（agent 模式）

**实际**：

---

### TC-2.3 保存角色配置

**步骤**：
1. 在 TC-2.2 状态下点击 `Save changes` 按钮

**期望**：
- [ ] Toast "Workflow saved"
- [ ] 画布上的节点保持 "Role · Frontend Engineer" 显示
- [ ] 刷新页面后，节点仍然是 role 模式

**实际**：

---

### TC-2.4 给 Critic 指派角色

**步骤**：
1. 在同一个节点，找到 Critic section
2. 当前 Critic 是 `Reviewer Agent`
3. 切换到 `Role` 模式并选择 `Tech Lead`

**期望**：
- [ ] Critic role 显示 `Tech Lead`
- [ ] 具体 Reviewer 选择器不再显示，保存请求中的 `critic_id` 被清空
- [ ] 画布上下方 critic badge 更新为 `Tech Lead`（虚线下方）
- [ ] Save 后持久化

**实际**：

---

### TC-2.5 验证 "Manage roles" 跳转

**步骤**：
1. Role 模式下点击 `Manage roles` 链接
2. 观察页面跳转

**期望**：
- [ ] 跳转到当前工作区的 Settings 页面并带有 `tab=roles`
- [ ] Roles Tab 自动激活（不需要再手动点 Tab）
- [ ] 浏览器返回按钮能回到工作流编辑器

**实际**：

---

### TC-2.6 【边界】切换 Worker type 后保留 role

**步骤**：
1. Worker 已设为 `Frontend Engineer` 角色
2. 切换到 `Direct` 模式并选择 `Builder Agent`
3. 再切回 `Role` 模式，选择 `QA`

**期望**：
- [ ] 每次切换都是原子操作，状态一致
- [ ] 不会出现 `worker_role_id` 和 `worker_id` 同时非空的混合状态

**实际**：

---

### TC-2.7 【边界】Critic 设为 API URL 模式

**步骤**：
1. Critic 区块点击 `API` 选项（不是 role）
2. 填入 `https://example.com/review`
3. Save

**期望**：
- [ ] Critic 区块显示 API URL 输入框
- [ ] 原 Critic role 被清空
- [ ] 画布 critic badge 显示为 `API`（或类似）

**实际**：

---

## 三、画布角色显示（Worker & Critic）

### TC-3.1 Builtin 角色显示（worker_role_id 路径）

**步骤**：
1. 给节点 Worker 选 builtin `Developer` 角色，Save

**期望**：
- [ ] 画布卡片显示：橙色圆点 + `Role · Developer`
- [ ] 文本是 i18n 本地化的（中文环境下显示"开发者"）

**实际**：

---

### TC-3.2 Custom 角色显示（worker_role_id 路径）

**步骤**：
1. 给节点 Worker 选 custom `Frontend Engineer` 角色，Save

**期望**：
- [ ] 画布卡片显示：橙色圆点 + `Role · Frontend Engineer`
- [ ] 直接使用 `role.name`（不经过 i18n）

**实际**：

---

### TC-3.3 角色显示在 Critic Badge

**步骤**：
1. 给节点 Critic 选 `Tech Lead`，Save

**期望**：
- [ ] Worker 节点下方出现虚线连接的 critic badge
- [ ] Badge 文字：`Tech Lead`（builtin 走 i18n）
- [ ] 虚线边框 + Critic 标签可见

**实际**：

---

### TC-3.4 修改角色名后画布同步

**步骤**：
1. 节点 Worker 引用了 `Frontend Engineer`
2. 跳到 Settings → Roles，把 `Frontend Engineer` 改名为 `FE Engineer`
3. 回到工作流画布

**期望**：
- [ ] 画布卡片显示更新为 `Role · FE Engineer`
- [ ] 无需手动刷新（React Query invalidation 触发）

**实际**：

---

### TC-3.5 【回归】Assignee 模式仍正常

**步骤**：
1. 给节点 Worker 选回 `Builder Agent`（具体 agent），Save

**期望**：
- [ ] 画布卡片显示：绿色圆点 + `Builder Agent`
- [ ] 不出现 "Role ·" 前缀

**实际**：

---

### TC-3.6 【回归】未配置节点显示

**步骤**：
1. 新建一个节点，不设 Worker 也不设 Role

**期望**：
- [ ] 画布卡片显示：灰色圆点 + `Agent · Not configured`

**实际**：

---

## 四、执行期（Run Workflow）

### TC-4.1 触发 Run

**步骤**：
1. 在工作流编辑器右上角点击 `Run` 或 `Publish & Run`
2. 跳转到 Run 详情页 `/workflows/runs/{run_id}`

**期望**：
- [ ] Run 页面加载，stage lane 显示运行中节点
- [ ] HTTP 202 启动时显示 `Resolving roles` 或 `Waiting for role assignment`
- [ ] 解析完成前，节点使用角色名称作为占位显示
- [ ] 解析完成后，运行画布显示实际成员名称

**实际**：

---

### TC-4.2 角色解析成功（有匹配成员）

**前置**：workspace 中有 Sarah 的 member 记录，其 role 字段为 `Frontend Engineer`

**步骤**：
1. 触发 Run
2. 观察 Build 阶段节点的 worker 字段

**期望**：
- [ ] 几秒内 worker 显示从 `Frontend Engineer (Resolving...)` 变为 `Sarah Chen`
- [ ] 角色解析列表显示槽位状态为 `resolved` 和实际成员
- [ ] 全部槽位解决后 Run 进入 `running`
- [ ] Sarah 收到执行通知；通知失败时工作流仍继续

**实际**：

---

### TC-4.3 【边界】角色解析失败（无匹配成员）

**前置**：临时改 workspace 让没有成员匹配 `Frontend Engineer`

**步骤**：
1. 触发 Run
2. 观察节点状态

**期望**：
- [ ] 状态变为 `Needs Human` 或类似
- [ ] Run 进入 `waiting_role_assignment`
- [ ] Starter、Owner 或 Admin 可以从有效成员中人工选择并继续
- [ ] 普通成员只能查看，不显示提交或重试操作

**实际**：

---

### TC-4.4 【边界】Worker 完成后 Critic 接力

**步骤**：
1. Sarah 完成 worker 任务，提交 deliverable
2. 观察 Critic 字段

**期望**：
- [ ] Critic 显示 `Marcus Lee`（解析到 Tech Lead）
- [ ] Marcus 收到 review 通知

**实际**：

---

## 五、多语言切换

### TC-5.1 切换到中文

**步骤**：
1. 用户菜单 → Switch language → 中文（zh-Hans）
2. 访问 Settings → Roles Tab

**期望**：
- [ ] Builtin 角色名本地化为中文：`开发者` / `QA` / `技术负责人`
- [ ] Custom 角色名保持英文：`Frontend Engineer`
- [ ] 工作流画布上 builtin 角色也显示中文名

**实际**：

---

### TC-5.2 切回英文

**步骤**：
1. 切换回 English

**期望**：
- [ ] 所有 builtin 角色名回到英文

**实际**：

---

## 六、跨工作台（Workspace）隔离

### TC-6.1 切换 workspace 后角色不串

**步骤**：
1. 在 workspace A 创建角色 `Role-A`
2. 切换到 workspace B
3. 访问 Settings → Roles Tab

**期望**：
- [ ] 看不到 `Role-A`
- [ ] 只看到 workspace B 自己的角色 + builtin（builtin 每个 workspace 独立 seed）

**实际**：

---

## 七、桌面端（Desktop App）一致性

### TC-7.1 桌面端打开相同页面

**步骤**：
1. 启动 desktop app（`pnpm dev:desktop`）
2. 登录同一 workspace
3. 重复 TC-1.3、TC-2.2、TC-3.2

**期望**：
- [ ] 行为与 web 完全一致（共享 `@multica/views` 代码）
- [ ] 跳转 Settings→Roles 用 desktop 的 tab 路由（不是浏览器 URL）

**实际**：

---

## 八、回归 — 旧 legacy 路径（StageLane）

> StageLane 在某些 mode 下还会被渲染（runtime mode / template mode），需要确认角色显示对齐

### TC-8.1 触发 StageLane 渲染

**步骤**：
1. 找到一个仍用 StageLane 的入口（template preview 或 runtime mode）
2. 给节点指派 `Frontend Engineer` 角色

**期望**：
- [ ] CompactNodeCard 显示 `Role · Frontend Engineer`（不裸渲染 UUID）
- [ ] CriticBadge 显示 `Tech Lead`（不裸渲染 UUID）
- [ ] 与 ReactFlow 画布路径行为一致

**实际**：

---

## 九、测试通过判定清单

完成后，确认以下每项都 ✅：

- [ ] Settings → Roles Tab 可见，CRUD 正常
- [ ] 节点能选 role 作为 Worker / Critic
- [ ] 选 role 后 assignee 自动清空
- [ ] "Manage roles" 跳转正确
- [ ] 画布上 builtin/custom 角色都正确渲染（无裸 UUID）
- [ ] Critic badge 同步显示角色名
- [ ] 修改角色名后画布自动更新
- [ ] 中文环境下 builtin 角色名本地化
- [ ] 多 workspace 角色隔离
- [ ] Desktop app 行为一致
- [ ] Run 详情显示角色解析状态、实际成员和人工指派入口
- [ ] 被引用角色无法从 UI 或 API 删除
- [ ] 修改模板节点后，已经启动的运行快照保持不变

---

## 附：失败/异常快速记录表

| TC 编号 | 实际行为 | 是否阻塞 | 截图/录像链接 |
|--------|---------|---------|--------------|
|        |         |         |              |
|        |         |         |              |
|        |         |         |              |
