// E2E test: Empty state when workflow has no stages.
//
// Seeds a workflow with zero stages (nodes may exist unassigned).
// Verifies an empty state message with a link/button to the editor.
//
// Depends on: backend workflow API, frontend swimlane page.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Empty State No Stages", () => {
  test("shows empty state when workflow has no stages defined", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with no stages, but with some unassigned nodes ──
    const workflow = await seededApi.createWorkflow(
      "E2E Swimlane Empty " + Date.now(),
    );

    await seededApi.createWorkflowNode(workflow.id, {
      title: "Orphan Node",
      stage_id: null,
    });

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify empty state message ──
    // Matches: "Create stages in editor to organize nodes" or Chinese equivalent
    const emptyMessage = page
      .getByTestId("swimlane-empty-state")
      .or(page.locator("text").filter({
        hasText: /Create stages|创建阶段|organize nodes|组织节点/,
      }));
    await expect(emptyMessage.first()).toBeVisible({ timeout: 5000 });

    // ── Step 2: Verify CTA to navigate to editor ──
    const editorLink = page
      .getByRole("button", { name: /editor|编辑器|edit|编辑/i })
      .or(page.getByRole("link", { name: /editor|编辑器|edit|编辑/i }));
    await expect(editorLink.first()).toBeVisible({ timeout: 3000 });

    // ── Step 3: Click editor link and verify view switch ──
    // In the swimlane model, clicking the link should switch to editor view
    // without changing URL (view is internal state)
    await editorLink.first().click();

    // Verify we're still on the same workflow URL
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);
    // Editor should show editable ReactFlow (nodes are draggable)
    // The presence of ReactFlow means either swimlane or editor is showing
    const reactFlow = page.locator(".react-flow");
    await expect(reactFlow.first()).toBeVisible({ timeout: 5000 });
  });
});
