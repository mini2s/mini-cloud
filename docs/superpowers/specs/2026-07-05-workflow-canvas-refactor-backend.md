# Workflow 画布重构 — 后端相关内容提取

**来源:** `docs/superpowers/specs/2026-07-05-workflow-canvas-refactor-design.md`
**提取日期:** 2026-07-06
**范围:** 数据库字段、API 端点与合同、服务端校验、后端专项测试、后端风险与验收标准

---

## 1. 后端数据与 API 合同

### 1.1 当前已有后端字段

| Inspector 字段 | 当前持久化位置 | 说明 |
|----------------|----------------|------|
| 标题 / 描述 | `multica_workflow_node.title` / `description` | 节点卡片和配置面板共用 |
| Worker 类型 / ID | `worker_type` / `worker_id` | 当前类型：`human` / `agent` / `squad` |
| Critic 类型 / ID / API URL | `critic_type` / `critic_id` / `critic_api_url` | 当前类型：`human` / `agent` / `squad` / `api` |
| JSON Schema / Parameters | `format_schema` | 当前结构化约束字段 |
| Stage 归属 | `stage_id`，引用 `multica_workflow_stage.id` | Stage 删除时置空 |
| 画布位置 | `position_x` / `position_y` | 由画布移动事件写入 |

### 1.2 本设计新增/补齐的后端能力

| 能力 | 建议数据模型 | API / 校验要求 |
|------|--------------|----------------|
| 研发阶段 | 新增 `multica_workflow_development_stage`（workspace 级内置 + 自定义），并在 `multica_workflow_node` 增加 `development_stage_id` nullable FK | 列表接口按 workspace 返回；创建自定义阶段需 `can_manage_workflows`；节点保存时校验阶段属于同 workspace 或系统内置 |
| 交付物定义 | 新增 `multica_workflow_node_deliverable`（`node_id`、`type`、`name`、`requirements`、`sort_order`） | 节点详情 API 返回 deliverables；更新节点时支持原子替换或独立 CRUD；`type` 首期限定 `document` / `pull_request` |
| 智能体能力配置 | 在节点配置中保存 `agent_capability_config` JSONB，或拆分为 `plugin_id`、`skill_ids`、`runtime_id`、`model_id`、`fallback_runtime_enabled`、`fallback_model_enabled` | 保存时校验 Plugin/Skill/Runtime/Model 可见性、归属和可用性；运行时不可用不阻断保存，但发布 preflight 给出阻断或警告 |
| 指令配置 | `instructions` 文本字段或 `agent_capability_config.instructions` | 支持空值；后端只存储，不做模板渲染副作用 |
| 可见性 | 如果节点内创建/编辑智能体，写入 agent 资源自身 visibility；WorkflowNode 只保存引用 | 避免把 agent visibility 复制到 workflow node，展示时从 agent schema 读取 |
| 小队配置 | 小队名称、Leader、成员仍属于 squad 资源；WorkflowNode 只保存 `worker_type='squad'` + `worker_id` | 保存时必须校验 squad 未归档、leader 可用 |

### 1.3 API Shape 要求

- **`GET /api/workflows/:id/nodes`** 或节点详情响应必须返回节点基础字段、Stage、研发阶段、交付物、能力配置所需的最小 display data，避免前端为每张卡片串行请求。
- **`PATCH /api/workflows/:id/nodes/:nodeId`** 必须支持局部更新基础字段；交付物等集合字段若采用原子替换，需在请求体中明确 `deliverables` 的全量语义。
- API 响应必须走 `packages/core/api/schemas.ts` 的 zod schema + fallback；新增字段缺失时前端降级显示，不白屏。
- **所有引用校验必须 workspace-scoped**：成员、agent、squad、runtime、plugin、skill、model、development stage 都不能跨 workspace 泄露。
- **发布前 preflight 必须服务端和前端各有一份**：前端用于即时反馈，服务端作为最终发布阻断，避免绕过 UI 发布非法 Workflow。
- **`WorkflowRun` 快照落地时**，必须序列化节点配置相关字段，包括 Stage、研发阶段、交付物、Worker/Critic 引用、能力配置和 JSON Schema，保证 Issue 全景图不会受后续定义编辑影响。

---

## 2. 服务端发布前预检查（Preflight）

以下检查需在服务端实现一份，作为发布最终阻断；前端另有一份用于即时反馈。

| 检查项 | 阻断？ | 说明 |
|--------|--------|------|
| DAG 环检测 | 阻断 | 存在循环依赖无法发布 |
| 孤立节点 | 警告 | 有节点未连接到主流程 |
| 不可达节点 | 警告 | 节点无入边且非起始节点 |
| Worker 缺失 | 阻断 | 节点未分配 Worker |
| Critic 引用不存在 | 阻断 | 配置的 Critic ID 无效 |
| Stage 缺失 | 警告 | 节点未归属任何 Stage |
| Schema 必填字段缺失 | 阻断 | Worker 要求的关键字段未填写 |

---

## 3. 后端专项测试

### 3.1 API 持久化与校验测试

- 后端节点更新接口正确持久化 Worker/Critic、Stage、JSON Schema、研发阶段、交付物和能力配置字段。
- 后端拒绝跨 workspace 或已归档的 member / agent / squad / runtime / plugin / skill / model / development stage 引用。
- API schema 对新增节点配置字段使用 zod fallback；缺字段、错类型、未知枚举时前端降级显示。
- 服务端 preflight 阻断缺失 Worker、无效 Critic、无效 Stage、无效研发阶段、无效交付物定义和不可用关键能力配置。

### 3.2 业务逻辑测试

- 评审驳回后按执行者类型正确回流（人 → 通知重置；智能体 → 原会话继续）。
- 节点卡片正确展示处理者（评审中显示评审者，其他状态显示执行者）、交付物红绿灯和耗时。

### 3.3 E2E Smoke Tests

- 创建 Workflow，添加节点，连线，配置 Worker/Critic，保存。
- 发布前缺配置时出现预检查错误，配置完成后发布成功。
- Issue 分配 Workflow 后显示全景图。
- 在 Issue 全景图中完成一次审核或重试操作。

---

## 4. 后端风险

- **当前后端没有 `WorkflowRun` 快照字段**，Issue 全景图读取当前 Workflow 定义会受定义漂移影响。一旦快照能力落地，`CanvasModel` 必须优先消费快照。

---

## 5. 后端验收标准

- 节点配置面板和后端合同同时覆盖智能体配置项（插件/Skill、可见性、运行时/模型回退路由、指令）和小队配置（Leader Agent + 成员管理）；未落地后端字段的项必须显示为 disabled/coming-soon，不能伪保存。
- 节点定义支持研发阶段关联和交付物定义（文档/PR + 交付要求）；对应后端字段/API、workspace-scoped 引用校验、schema fallback 和服务端 preflight 均有明确实现路径。
- Issue 全景图运行态优先消费 WorkflowRun 快照，快照不可用时才使用当前定义 fallback。
- 人工评审者支持通过/驳回操作，驳回后按执行者类型正确回流。
