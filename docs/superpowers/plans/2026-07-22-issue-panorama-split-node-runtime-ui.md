# Issue Panorama Split Node Runtime UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Project instructions require inline execution and disable subagent-driven-development and executing-plans by default.

**Goal:** Reuse the workflow editor node type badge in Issue panorama split nodes while keeping runtime status placement identical to other Issue panorama cards.

**Architecture:** Extract only the neutral type badge into `packages/views/common`. Keep runtime status, split mode, progress, and child expansion inside `RuntimeNodeCard`.

**Tech Stack:** React, TypeScript, Tailwind CSS, i18next selector API, Vitest, Testing Library, React Flow.

## Global Constraints

- Preserve node dimensions, canvas layout, selection, keyboard access, and child issue expansion.
- Keep split mode visible as secondary text.
- Do not move runtime business logic into the shared badge.
- Run related module tests only.

---

### Task 1: Share the Node Type Badge

**Files:**
- Create: `packages/views/common/workflow-node-type-badge.tsx`
- Modify: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx`
- Test: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`

- [ ] Add a failing consumer assertion for the shared badge marker.
- [ ] Run the compact worker test and verify RED.
- [ ] Extract the existing badge classes into `WorkflowNodeTypeBadge` and migrate the editor consumer.
- [ ] Run the compact worker test and verify GREEN.

### Task 2: Restructure the Runtime Split Card

**Files:**
- Modify: `packages/views/issues/components/execution/runtime-node-card.tsx`
- Modify: `packages/views/issues/components/execution/runtime-node-card.test.tsx`
- Modify: `packages/views/locales/en/issues.json`
- Modify: `packages/views/locales/zh-Hans/issues.json`

- [ ] Add failing assertions for the split badge, status row, secondary mode, and the absence of the branch icon in reviewing, in-progress, and completed states.
- [ ] Run the runtime node card test and verify RED.
- [ ] Keep title and runtime status in the standard card header, then render the shared badge and muted mode in a secondary context row.
- [ ] Preserve progress and child expansion content beneath the status row.
- [ ] Run the runtime node card test and verify GREEN.
- [ ] Run both focused test files, `@multica/views` typecheck, and `git diff --check`.
- [ ] Inspect the workflow editor and Issue panorama at desktop size with Playwright.
