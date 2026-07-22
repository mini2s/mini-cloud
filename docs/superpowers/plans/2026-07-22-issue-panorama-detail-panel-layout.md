# Issue Panorama Detail Panel Layout Implementation Plan

> **For agentic workers:** Execute inline in the current session. Do not use subagents, do not use executing-plans, and do not create commits.

**Goal:** Reuse the restrained wide-panel layout across Issue panorama runtime details while preserving a full-width workspace for Split review.

**Architecture:** `ExecutionDetailPanel` uses the shared shell footer and a responsive two-column grid. `SplitReviewPanel` uses the same 800px shell width and footer, with only its overview arranged in columns while draft editing and chat remain full width.

**Tech Stack:** React, TypeScript, Tailwind CSS, shared shadcn components, Vitest, Testing Library.

## Task 1: Ordinary runtime detail

- [ ] Add failing tests for the responsive grid, column ownership, 800px width, and fixed runtime actions.
- [ ] Move status/evidence to the primary column and child/participant/runtime facts to the context column.
- [ ] Move session, Issue, unblock, and retry actions to `WorkflowNodeDetailPanelShell.footer`.
- [ ] Remove the nested diagnostic surface while retaining errors and gateway semantics.
- [ ] Run `execution-detail-panel.test.tsx`.

## Task 2: Split parent review

- [ ] Add failing tests for the 800px width, overview grid, full-width ledger, and shared footer action bar.
- [ ] Pair verdict and dependency sections in the overview grid.
- [ ] Keep the draft ledger and chat sections full width.
- [ ] Move cancel and approval controls to `WorkflowNodeDetailPanelShell.footer`.
- [ ] Run `split-review-panel.test.tsx`.

## Task 3: Regression verification

- [ ] Run both detail panel tests and `execution-panorama-page.test.tsx` with one Vitest worker.
- [ ] Run `pnpm --filter @multica/views typecheck`.
- [ ] Inspect 1440 x 900 and 1024 x 768 layouts for ordinary, Split parent, and Split child nodes.
