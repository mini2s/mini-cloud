# Workflow Editor UX Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundant workflow editor UI, restore readable node spacing, align actor metadata, and localize the existing Worker/Critic card labels.

**Architecture:** Keep split configuration and assignment behavior unchanged. Put deterministic spacing in the shared canvas model so editor and runtime surfaces use one rule, and keep visual-only card changes in their existing shared view components.

**Tech Stack:** React, TypeScript, Vitest, React Testing Library, Tailwind CSS, React Flow, JSON i18n locales.

## Global Constraints

- Do not change workflow execution semantics, API payloads, or stored node references.
- Keep the visible terms `Worker` and `Critic`; source them through i18n.
- Preserve stored positions and intentional gaps; only shift nodes that violate the 80 px minimum gap.
- Do not run the full test suite.
- Do not use subagents or `executing-plans` for this repository task.

---

### Task 1: Remove Redundant Detail Panel Content

**Files:**
- Modify: `packages/views/workflows/components/split/split-config-panel.test.tsx`
- Modify: `packages/views/workflows/components/split/split-config-panel.tsx`
- Modify: `packages/views/workflows/components/node-config-panel.test.tsx`
- Modify: `packages/views/workflows/components/node-config-panel.tsx`

**Interfaces:**
- `SplitConfigPanel` keeps its current props and behavior.
- `NodeDetailSection` remains the sole split-section heading.

- [ ] Add assertions that `SplitConfigPanel` does not render `split_title` or `split_subtitle`, and that `NodeConfigPanel` renders one split heading and no actor-assignee hint.
- [ ] Run the two focused tests and confirm they fail because duplicate content exists.
- [ ] Remove the inner split heading/card wrapper and remove all redundant `ActorSummary` rendering and its unused component.
- [ ] Re-run the focused tests and confirm they pass.
- [ ] Commit as `fix(workflows): remove redundant node configuration copy`.

### Task 2: Normalize Canvas Node Spacing

**Files:**
- Modify: `packages/views/workflows/components/canvas/workflow-canvas-model.test.ts`
- Modify: `packages/views/workflows/components/canvas/workflow-canvas-model.ts`

**Interfaces:**
- Add `MIN_NODE_HORIZONTAL_GAP = 80`.
- Add an internal position map that groups nodes by `stage_id`, sorts by stored x position, preserves the first x, and applies `max(storedX, previousX + nodeWidth + gap)`.
- `workflowNodesToReactFlowNodes` consumes the normalized map for both editor and runtime node types.
- `workflowEdgesToReactFlowEdges` uses the same normalized x values when selecting handles.

- [ ] Add tests for close nodes, preserved large gaps, and independent stage lanes.
- [ ] Run the canvas-model test and confirm spacing assertions fail with raw stored positions.
- [ ] Implement shared spacing normalization with stable tie-breaking by `sort_order` and `id`.
- [ ] Re-run the canvas-model test and confirm it passes.
- [ ] Commit as `fix(workflows): enforce readable canvas node spacing`.

### Task 3: Align Actor Metadata And Localize Card Labels

**Files:**
- Modify: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`
- Modify: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx`
- Modify: `packages/views/issues/components/execution/runtime-node-card.test.tsx`
- Modify: `packages/views/issues/components/execution/runtime-node-card.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Add workflow locale keys `panorama.card.worker_label` and `panorama.card.critic_label`, both retaining the visible Worker/Critic terminology.
- Editor `RoleSlot` and runtime `ActorSlot` use fixed label/value rows and top-aligned value content.

- [ ] Add editor assertions for locale-backed labels and fixed row classes; add runtime assertions for aligned actor-slot rows.
- [ ] Run both card tests and confirm the new assertions fail.
- [ ] Read card labels through `useT("workflows")` and apply the fixed two-row layouts.
- [ ] Re-run both card tests and confirm they pass.
- [ ] Commit as `fix(workflows): align and localize card roles`.

### Task 4: Focused Verification

**Files:**
- No source changes expected.

- [ ] Run the five affected Vitest files together.
- [ ] Run `pnpm --filter @multica/views typecheck`.
- [ ] Open both reported surfaces and verify spacing, alignment, split copy, and Worker/Critic labels.
- [ ] Run `git diff --check` and inspect `git status --short` without adding the user screenshots or prior untracked plan.
