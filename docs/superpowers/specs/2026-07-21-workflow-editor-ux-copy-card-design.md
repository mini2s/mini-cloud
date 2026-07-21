# Workflow Editor UX, Copy, and Card Design

Date: 2026-07-21

## Goal

Improve the workflow editor and issue panorama workflow presentation with conservative, localized changes. The work should make the main editing area feel less cramped, make cards show more useful information, make workflow activation status understandable from the editor, simplify split planner choices, and replace technical visible copy with user-facing language.

This spec covers shared view-layer changes only. It does not change workflow execution semantics, database meaning, API payload shapes, or issue picker eligibility logic.

## Scope

In scope:

- Workflow editor layout and right-side node configuration panel.
- Workflow editor node cards.
- Issue panorama runtime workflow cards.
- Workflow editor activation status copy near the title area.
- Workflow-related visible copy in the editor, node configuration panel, split review panel, preflight bar, cards, empty states, and status labels.
- Built-in split planner visibility for new split-node selection.
- English and Simplified Chinese locale parity.

Out of scope:

- Replacing the right-side configuration panel with a bottom tray or floating overlay.
- Large workflow editor interaction redesigns.
- Changing the issue picker rule that only active workflows are selectable.
- Renaming internal schema fields or enum values such as `barrier`, `pipeline`, `worker`, `critic`, or `split`.
- Deleting historical agents or clearing existing workflow references.
- Full product-wide terminology cleanup outside workflow-related screens.

## Design Decisions

### Layout

Keep the current editor structure and right-side configuration panel. Increase the panel width from the current narrow default to approximately 600-640 px on desktop. The panel should have clearer separation from the canvas through a stronger border, subtle background contrast, or spacing treatment that matches existing UI tokens.

The goal is to increase usable form width without changing the mental model. Common node configuration should avoid unnecessary scrolling; complex split configuration may still scroll if content exceeds available height. The panel content should be simplified by removing repeated explanatory text and keeping labels direct.

### Card Density

Update workflow editor cards and issue panorama runtime cards together so the visual language stays consistent.

Recommended target dimensions:

- Workflow editor cards: approximately 288-300 px wide and 132-136 px high.
- Issue panorama runtime cards: approximately 288-300 px wide and about 144 px high.

Cards should show more complete information instead of relying heavily on truncation:

- Titles can wrap to two lines.
- Descriptions can wrap to two lines where present.
- Long names should use normal wrapping and `break-words` behavior rather than single-line truncation by default.
- Worker, critic, and split planner labels should preserve enough width to identify the actor.
- Split progress summaries should prefer a compact complete phrase over a truncated technical label.
- Connection handles and vertical alignment must be recalculated for the new card height.

Text must not overflow or overlap at desktop and common narrow widths.

### Activation Status

Clarify workflow availability where the user already looks: the top-left title/status area of the workflow editor.

The status copy should explain the issue-picker consequence directly:

- `已启用 · 可在 issue 中选择`
- `未启用 · issue 中暂不可选`
- `未启用 · 先保存再启用`
- `未启用 · 还有 {{count}} 个问题`
- `已停用 · issue 中暂不可选`

English equivalents:

- `Active · Available in issues`
- `Not active · Hidden from issue picker`
- `Not active · Save before activating`
- `Not active · {{count}} issue(s) left`
- `Paused · Hidden from issue picker`

Buttons should remain short and action-oriented:

- `启用`
- `先保存`
- `查看问题`
- `重新启用`

This does not change the issue picker behavior. It only makes the restriction visible before the user tries to select an inactive workflow from an issue.

### Visible Copy

Review workflow-related visible UI copy for technical or unclear wording. Internal identifiers remain unchanged, but user-facing labels should use task-oriented language.

Copy replacement direction:

- `Node inspector` -> `节点设置`
- `Readiness` -> `启用检查`
- `Node intent` -> `基本信息`
- `Worker` -> `执行者`
- `Critic` -> `审核者`
- `Planner` / `Planner agent` -> `拆分规划者`
- `Split behavior` -> `拆分规则`
- `Default issue workflow` -> `子 issue 默认 workflow`
- `Release downstream work` -> `何时继续下游`
- `After child issues finish` -> `子 issue 完成后继续`
- `After child issues are created` -> `子 issue 创建后继续`
- `Barrier` -> `等待子 issue 完成`
- `Pipeline` -> `创建后继续下游`
- `Failure policy` -> `允许失败数`
- `Concurrency` -> `同时运行数`
- `Trial run` -> `试运行`
- `Runtime` -> `运行状态`
- `Format Schema` -> `输出格式要求`
- `Gateway` / `Fork` / `Join` -> `分支节点` / `分支开始` / `汇合节点` where these are visible to normal users.

Keep product terms that are already part of the product language, such as `workflow`, `issue`, and `agent`, unless a local component already has a stronger Chinese convention.

Preflight and error text should be rewritten as direct instructions. Examples:

- `Assign an Agent to this split node` -> `为此拆分节点选择拆分规划者`
- `Split node needs a default issue workflow` -> `选择子 issue 默认 workflow`
- `Split default issue workflow must be active` -> `子 issue 默认 workflow 需要先启用`

### Split Planner Choices

The built-in split planner set currently includes:

- `Split Planner (General)`
- `Split Planner (Code)`
- `Split Planner (Design)`
- `Split Planner (Test)`

For the split node selection experience, show only `Split Planner (General)` as the built-in default choice. Do not force users to decide between code, design, and test variants before they understand the split flow.

Implementation should preserve compatibility:

- Do not delete existing agents that may already be referenced by saved workflows or node runs.
- Prefer hiding, archiving, or filtering non-General built-in split planners from new split-node selection.
- Existing workflows that reference Code, Design, or Test planners should continue to render and run with their saved reference.
- The visible label can remain `Split Planner (General)` in English. In Chinese UI, present it as `通用拆分规划者` or equivalent user-facing text if localization is available at the render point.

## Component Impact

Likely touched areas:

- `packages/views/workflows/components/overview/workflow-panorama-page.tsx`
- `packages/views/workflows/components/overview/workflow-editor-toolbar.tsx`
- `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx`
- `packages/views/workflows/components/overview/reactflow-nodes/runtime-node-card.tsx`
- `packages/views/workflows/components/node-config-panel.tsx`
- `packages/views/common/workflow-node-detail-panel-shell.tsx`
- `packages/views/workflows/components/overview/preflight-bar.tsx`
- `packages/views/workflows/components/split/*`
- `packages/views/issues/components/execution/*`
- `packages/views/locales/en/workflows.json`
- `packages/views/locales/zh-Hans/workflows.json`
- Split planner agent filtering or seed handling near `server/migrations/137_seed_split_planner_agents.up.sql` and related agent listing surfaces, depending on the existing data path.

The exact implementation plan should verify whether split planner filtering belongs in the backend query, frontend picker filtering, or agent metadata handling. The preferred behavior is conservative: filter from new user choices while preserving historical references.

## Data Flow

Layout, copy, and card changes stay in the view layer.

Workflow activation status continues to derive from existing workflow status, dirty state, and preflight issue count. The editor only changes the displayed message and button labels.

Issue workflow selection continues to use the active workflow list. The clearer editor status explains why inactive workflows do not appear there.

Split planner selection should continue to store an agent reference on the node. Only the set of built-in planner choices shown for new configuration is reduced.

## Error Handling

Preflight issues should remain structured and machine-readable. The user-visible summaries and details should become clearer instructions.

If a saved workflow references a hidden non-General split planner, the editor should still show its resolved name. It should not replace the planner silently. If the referenced planner is missing or unavailable, reuse the existing missing-agent behavior with clearer copy.

If a workflow cannot be enabled, the top-left status should show the blocking count and provide a clear route to inspect the issues.

## Testing

Do not run the full test suite by default.

Recommended verification:

- Run targeted TypeScript checks or focused tests for workflow and issue panorama components.
- Run locale consistency checks if available.
- Render the workflow editor and issue panorama locally.
- Verify desktop layout with the widened panel and larger cards.
- Verify long card titles, long descriptions, long actor names, and split progress text wrap without overlap.
- Verify inactive workflow status says it is hidden from issue selection.
- Verify split planner picker shows only `Split Planner (General)` for new selection while existing saved references still display.
- Verify no obvious technical labels remain in workflow-visible UI for the touched screens.

## Acceptance Criteria

- The workflow editor keeps its current structure but the right panel feels less cramped.
- Workflow editor cards and issue panorama runtime cards display more complete information with less truncation.
- The workflow editor status area clearly explains when a workflow can or cannot be selected in issues.
- User-visible workflow copy avoids unexplained technical terms.
- `barrier` and `pipeline` remain internal values but are shown as understandable behavior labels.
- New split planner selection exposes only `Split Planner (General)` as the built-in default.
- Existing workflow references to other split planner agents are preserved.
- English and Simplified Chinese workflow locale updates stay in sync.
