# 创建 Issue 时强制关联项目 — 设计

日期：2026-07-23

## 背景

Multica 里 `Project` 早就是一等实体，`issue.project_id` 外键也已端到端打通（migration `034_projects.up.sql`，`ON DELETE SET NULL`）。创建 Issue 有两个前端入口：

- **手动创建**：`packages/views/modals/create-issue.tsx` — `ManualCreatePanel`。目前只有 `title` 必填，`ProjectPicker`（约第 514 行）可选。
- **Agent 快速创建**：`packages/views/modals/quick-create-issue.tsx` — `AgentCreatePanel`。约第 472 行有 project 选择器，可选，会按 workspace 记住上次选择。

后端 `CreateIssue` / `QuickCreateIssue` 都接受可选 `project_id`；子任务自动继承父 issue 的 project（`issue.go` 约第 1836-1838 行）。

**需求**：创建 Issue 时强制关联项目；workspace 没有项目时给用户一个简单提示。

## 决策摘要（已与用户逐条确认）

1. **强制层 = 仅前端两个创建面板**。后端 API、agent/程序化创建、CLI 不动。现有无项目的 issue 不受影响。
2. **必填行为**：创建面板里 project 必填，提交按钮在未选项目时禁用。
3. **0 项目提示**：workspace 0 项目时，project 字段附近显示一行纯文字提示，**不跳转、不开嵌套弹窗**。
4. **不做默认选中**：每次创建都手动选项目。
5. **编辑路径不变**：issue 详情页用同一个 `ProjectPicker` 改 project，仍可清空。

## 范围

**In scope**

- `ManualCreatePanel`（手动创建）：project 必填 + 0 项目提示。
- `AgentCreatePanel`（Agent 快速创建）：project 必填 + 0 项目提示。
- 中英文案。
- 两个面板的单元测试（写在 `packages/views/modals/`）。

**Out of scope**

- 后端 `CreateIssue` / `QuickCreateIssue` 的 `project_id` 强制（仍可选）。
- agent / CLI / 程序化创建路径。
- 已有 issue 的 project 清理或迁移。
- workspace 级配置开关。
- 创建项目弹窗（`CreateProjectModal`）的任何改动 —— 不嵌套、不跳转。

## 设计细节

### 1. 必填行为

手动创建 [create-issue.tsx](../../../packages/views/modals/create-issue.tsx)：

- 提交按钮的 `disabled` 条件，由当前「`!title.trim()`」（约第 669-680 行）改为「`!title.trim() || !projectId`」。`projectId` 是面板里已有的 project 选择状态。
- 视觉上让 project 触发器表明"必填"：未选时可加轻微强调样式（如占位文字 / 图标用更明显的 muted-foreground），与现有视觉风格一致。

Agent 快速创建 [quick-create-issue.tsx](../../../packages/views/modals/quick-create-issue.tsx)：

- 提交按钮 `disabled` 条件加入 `!projectId`（`submit()` 在约第 271 行；按钮 disabled 在组件底部）。

**注意**：`ProjectPicker` 组件本身不改。它仍接受 `null`、仍允许 remove（issue 详情编辑要用）。必填约束只活在两个创建面板各自的提交逻辑里 —— 这样不会误伤编辑场景。

### 2. 0 项目提示

`ProjectPicker` 内部已用 `useQuery(projectListOptions(wsId))` 拿到 projects（第 35 行）。当 `projects.length === 0` 时，在 project 字段附近显示一行纯文字提示：

- 中文：「还没有项目，请先到项目页创建一个。」
- 英文："No projects yet — create one on the Projects page first."

**实现方式：增强 `ProjectPicker` 现有的 `picker.empty`**（第 66-68 行）文案，让它更具引导性。只改一处，所有用到 picker 的地方（创建 + 详情编辑）都受益。详情编辑时也看到这句是可接受的 —— 它是纯信息性文字。纯文字，无按钮、无跳转。

### 3. 编辑路径不变

`ProjectPicker` 的 `onUpdate({ project_id: null })`（第 61 行，"remove" 项）保留。issue 详情里清空 project 的能力不动。

### 4. i18n

- `packages/views/locales/en/projects.json` 与 `packages/views/locales/zh-Hans/projects.json`：更新/新增 `picker.empty`（若选实现 a）。
- 遵循 [conventions.mdx](../../../apps/docs/content/docs/developers/conventions.mdx) 的翻译术语表与中文语感指南。

### 5. 测试

遵循「测试跟着代码走」原则 —— 共享组件测试在 `packages/views/`，mock `@multica/core`，不 mock `next/*` / `react-router-dom`：

- `packages/views/modals/create-issue.test.tsx`：
  - 0 项目 → 提交按钮禁用 + 提示文案出现。
  - 有项目但未选 → 提交禁用。
  - 选了项目 → 提交启用。
- `packages/views/modals/quick-create-issue.test.tsx`：同上三条，针对 Agent 快速创建。

## 风险 / 取舍

- **摩擦**：project 必填 + 不做默认 → 每次建 issue 多一次点击。用户已明确接受。
- **agent 绕过**：仅前端强制，agent 仍可经 API 创建无项目 issue。用户已明确接受；将来若要堵，再加后端强制。
- **0 项目时无法创建**：0 项目 + 必填 = 用户暂时建不了 issue，只能先去项目页建项目。预期行为，靠提示告知。

## 明确拒绝的方案（记录取舍）

- **后端强制 `project_id`**：影响面太大，波及 agent / 子任务 / CLI。
- **workspace 级配置开关**：过度设计，用户未要求。
- **嵌套创建项目弹窗 / 跳转项目页**：用户最终选择「只给文字提示」。

## 涉及文件清单

- `packages/views/modals/create-issue.tsx` — 必填 + 提示。
- `packages/views/modals/quick-create-issue.tsx` — 必填 + 提示。
- `packages/views/projects/components/project-picker.tsx` — 改 `picker.empty` 文案（实现方式已定为增强该文案）。
- `packages/views/locales/en/projects.json`、`packages/views/locales/zh-Hans/projects.json` — 文案。
- `packages/views/modals/create-issue.test.tsx`、`packages/views/modals/quick-create-issue.test.tsx` — 测试。
