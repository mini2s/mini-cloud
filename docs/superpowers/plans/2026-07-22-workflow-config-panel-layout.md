# Workflow Config Panel Layout Implementation Plan

> **For agentic workers:** Execute this plan inline in the current session. Repository instructions override the generic subagent/executing-plans recommendation; do not use subagents and do not create commits.

**Goal:** Rework the Workflow editor node configuration panel into a restrained two-column layout that distinguishes configuration groups without card stacking, keeps primary actions visible, and reduces scrolling.

**Architecture:** Extend the shared detail panel shell with an optional fixed footer while preserving its current default behavior. Recompose `NodeConfigPanel` into a responsive grid using existing state and callbacks, keep delete visible as a low-emphasis destructive action, and keep node-type-specific sections conditional.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Base UI/shadcn components, Zustand, React Query, Vitest, Testing Library.

## Global Constraints

- Do not commit any files.
- Do not modify unrelated user changes already present in the worktree.
- Use semantic design tokens; do not add hardcoded colors.
- Use spacing, alignment, and typography for grouping; do not introduce nested cards or colored section backgrounds.
- At viewport widths of at least 1280px, use an 800px two-column editor panel; below 1280px, use a single-column panel.
- Keep the header and action footer fixed while only the configuration body scrolls.
- Preserve all existing node draft, save, stage creation, deletion, assignment, and trial-run behavior.
- Run only relevant `@multica/views` tests and typecheck, not the full repository test suite.

---

### Task 1: Add an optional fixed footer to the shared panel shell

**Files:**
- Modify: `packages/views/common/workflow-node-detail-panel-shell.tsx`
- Test: `packages/views/common/workflow-node-detail-panel-shell.test.tsx`

**Interfaces:**
- Consumes: existing `WorkflowNodeDetailPanelShellProps`.
- Produces: optional `footer?: ReactNode`, rendered after the scrollable content; existing callers without `footer` remain unchanged.

- [ ] **Step 1: Write the failing footer test**

Add a test that renders body and footer content, then asserts the body is inside `node-detail-panel-content` and the footer is inside `node-detail-panel-footer` but outside the scrolling element:

```tsx
it("renders an optional footer outside the scrolling content", () => {
  render(
    <WorkflowNodeDetailPanelShell
      mode="edit"
      title="Node settings"
      closeLabel="Close"
      onClose={vi.fn()}
      footer={<button type="button">Save changes</button>}
    >
      <div>Body</div>
    </WorkflowNodeDetailPanelShell>,
  );

  const content = screen.getByTestId("node-detail-panel-content");
  const footer = screen.getByTestId("node-detail-panel-footer");
  expect(content).toContainElement(screen.getByText("Body"));
  expect(content).not.toContainElement(screen.getByRole("button", { name: "Save changes" }));
  expect(footer).toContainElement(screen.getByRole("button", { name: "Save changes" }));
});
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
pnpm --filter @multica/views test -- workflow-node-detail-panel-shell.test.tsx
```

Expected: FAIL because `footer` and the new test IDs do not exist.

- [ ] **Step 3: Implement the shell footer**

Add `footer?: ReactNode` to the props, add `data-testid="node-detail-panel-content"` to the scroll container, and render this block after it:

```tsx
{footer ? (
  <div
    data-testid="node-detail-panel-footer"
    className="shrink-0 border-t border-border/60 bg-background px-4 py-3"
  >
    {footer}
  </div>
) : null}
```

Do not change the default width in this task; the editor supplies its own responsive width in Task 2.

- [ ] **Step 4: Verify shared shell tests pass**

Run:

```bash
pnpm --filter @multica/views test -- workflow-node-detail-panel-shell.test.tsx
```

Expected: all tests in the file PASS.

---

### Task 2: Recompose the node configuration panel

**Files:**
- Modify: `packages/views/workflows/components/node-config-panel.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`
- Test: `packages/views/workflows/components/node-config-panel.test.tsx`

**Interfaces:**
- Consumes: the `footer` prop from Task 1 and existing `NodeConfigPanelProps` callbacks.
- Produces: `data-testid="node-config-grid"`, `data-testid="node-config-primary-column"`, `data-testid="node-config-participants-column"`, and visible footer actions in `node-detail-panel-footer`.

- [ ] **Step 1: Write failing layout and action tests**

Update the normal-node section-order expectation to `primary`, `worker-critic`; actions are no longer a body section. Add assertions:

```tsx
it("uses a responsive two-column configuration grid with fixed actions", () => {
  renderPanel();

  const grid = screen.getByTestId("node-config-grid");
  expect(grid).toHaveClass("grid-cols-1", "min-[1280px]:grid-cols-2");
  expect(screen.getByTestId("node-config-primary-column")).toContainElement(
    screen.getByRole("heading", { name: "Basic information" }),
  );
  expect(screen.getByTestId("node-config-participants-column")).toContainElement(
    screen.getByRole("heading", { name: "Executor and reviewer" }),
  );
  expect(screen.getByTestId("node-detail-panel-footer")).toContainElement(
    screen.getByRole("button", { name: "Save changes" }),
  );
  expect(screen.queryByTestId("node-detail-section")).not.toHaveAttribute("data-section", "actions");
});

it("keeps delete visible in the fixed action footer", () => {
  renderPanel();

  const footer = screen.getByTestId("node-detail-panel-footer");
  expect(footer).toContainElement(screen.getByRole("button", { name: "Delete Node" }));
});
```

For a split node, assert `split-behavior` is in the primary column, `connections` is in the participants column, and `Test this split` is in the footer.

- [ ] **Step 2: Verify the new panel tests fail**

Run:

```bash
pnpm --filter @multica/views test -- node-config-panel.test.tsx
```

Expected: FAIL because the responsive grid, footer actions, and more-actions menu do not exist.

- [ ] **Step 3: Add restrained section primitives inside `node-config-panel.tsx`**

Replace the current icon-box-based `InspectorSection`/`AssignmentCard` presentation with one local structure that uses title, optional status, and content:

```tsx
function ConfigGroup({
  title,
  status,
  children,
}: {
  title: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {status}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
```

Render configured/optional/missing states as compact icon-plus-text treatments without bordered pills or colored backgrounds. Keep semantic error color only for invalid/missing required configuration.

- [ ] **Step 4: Build the responsive two-column body**

Pass `widthClassName="w-[min(800px,calc(100vw-2rem))]"` and a footer to `WorkflowNodeDetailPanelShell`. Replace the single section stack with:

```tsx
<div
  data-testid="node-config-grid"
  className="grid grid-cols-1 gap-6 min-[1280px]:grid-cols-2 min-[1280px]:gap-0"
>
  <div
    data-testid="node-config-primary-column"
    className="min-w-0 space-y-6 min-[1280px]:pr-6"
  >
    {/* Basic information, then annotation/gateway/split-specific rules. */}
  </div>
  <div
    data-testid="node-config-participants-column"
    className="min-w-0 space-y-6 min-[1280px]:border-l min-[1280px]:border-border/40 min-[1280px]:pl-6"
  >
    {/* Worker/critic configuration, then applicable connection summary. */}
  </div>
</div>
```

Use the existing inputs, selectors, state setters, mutation handlers, and `cacheNodeEdits` calls unchanged. Do not add tabs, accordions, or new React state.

- [ ] **Step 5: Move actions to the footer**

Render delete as a visible low-emphasis action on the left and primary actions on the right:

```tsx
<div className="flex items-center justify-between gap-3">
  <Button
    type="button"
    variant="ghost"
    size="sm"
    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
    onClick={handleNodeDelete}
    disabled={deleteMutation.isPending}
  >
    <Trash2 className="mr-1.5 size-3.5" />
    {deleteMutation.isPending ? t(($) => $.node.saving) : t(($) => $.node.delete)}
  </Button>
  <div className="flex items-center gap-2">
    {isSplit ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onTrialRun}
        disabled={!onTrialRun}
      >
        <Play className="mr-1.5 size-3.5" />
        {t(($) => $.detail_panel.trial_run)}
      </Button>
    ) : null}
    {onSaveNode ? (
      <Button
        type="button"
        size="sm"
        onClick={handleSaveAll}
        disabled={!hasUnsavedChanges}
      >
        <Save className="mr-1.5 size-3.5" />
        {t(($) => $.detail_panel.save_changes)}
      </Button>
    ) : null}
  </div>
</div>
```

`handleNodeDelete` must preserve the current `onDeleteNode` override and fallback to `handleDelete`. When `disabled` is true, render the existing disabled-action message in the footer instead of interactive actions.

- [ ] **Step 6: Reduce duplicated hints**

Stop passing the generic section descriptions for basic information, participants, connections, and actions. Retain field-level hints for API URL and split constraints. Do not remove locale keys still consumed by the run-detail panel or other components.

- [ ] **Step 7: Verify panel tests pass**

Run:

```bash
pnpm --filter @multica/views test -- node-config-panel.test.tsx workflow-node-detail-panel-shell.test.tsx
```

Expected: all tests in both files PASS.

---

### Task 3: Targeted regression and viewport verification

**Files:**
- Modify only files from Tasks 1-2 if verification exposes a defect.

**Interfaces:**
- Consumes: completed shell and panel implementations.
- Produces: verified responsive layout with no TypeScript regressions in `@multica/views`.

- [ ] **Step 1: Run the related workflow view tests**

Run:

```bash
pnpm --filter @multica/views test -- node-config-panel.test.tsx workflow-node-detail-panel-shell.test.tsx workflow-panorama-page.test.tsx
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run the package typecheck**

Run:

```bash
pnpm --filter @multica/views typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Start the existing development application**

Run `make dev` only if no development server is already available. Use the printed web URL and do not terminate an existing user-owned server.

- [ ] **Step 4: Inspect desktop and narrow layouts**

At 1440 x 900, verify the panel is 800px wide, both columns align, ordinary-node configuration needs no body scroll, and the footer remains visible. At 1024 x 768, verify the panel uses one column, has no horizontal overflow, and only the middle body scrolls.

- [ ] **Step 5: Inspect node-type variants**

Open an ordinary node, split node, gateway, and annotation. Verify each shows only relevant groups, worker/critic controls retain behavior, split trial run stays in the footer, and delete remains visible on the left.

- [ ] **Step 6: Review the final diff**

Run:

```bash
git diff -- packages/views/common/workflow-node-detail-panel-shell.tsx packages/views/common/workflow-node-detail-panel-shell.test.tsx packages/views/workflows/components/node-config-panel.tsx packages/views/workflows/components/node-config-panel.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
```

Expected: only the approved layout, copy, tests, and required behavior-preserving refactor are present; no unrelated user changes are reverted.
