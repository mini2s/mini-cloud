// E2E test: Editor node changes sync to swimlane view.
//
// Creates a node in editor view, switches to swimlane, and verifies
// the node appears in the correct lane.
//
// Depends on: backend workflow + node API, shared TanStack Query cache.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Editor Node Sync", () => {
  test("node added in editor appears in correct swimlane lane", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with initial data ──
    const workflow = await seededApi.createWorkflow(
      "E2E Editor Sync " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Target", 0);

    // ── Step 1: Add a node (simulating editor save) ──
    const newNode = await seededApi.createWorkflowNode(workflow.id, {
      title: "Editor-Added Node",
      stage_id: stage.id,
    });

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 2: Verify the new node is visible in swimlane ──
    const rfNodes = page.locator(".react-flow__node");
    await expect(rfNodes.first()).toBeVisible({ timeout: 5000 });

    // Node count should include the new node
    const nodeCount = await rfNodes.count();
    expect(nodeCount).toBe(1);

    // ── Step 3: Verify node title is visible ──
    const newNodeEl = rfNodes.filter({ hasText: "Editor-Added Node" });
    await expect(newNodeEl.first()).toBeVisible({ timeout: 3000 });

    // ── Step 4: Verify node is in the correct lane ──
    // "Target" lane should be visible
    const overlay = page
      .getByTestId("swimlane-overlay")
      .or(page.locator(".react-flow svg"));
    await expect(overlay.first()).toBeVisible();
    await expect(overlay.first()).toContainText("Target");

    // ── Step 5: Add a second node and verify sync without reload ──
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Second Node",
      stage_id: stage.id,
    });

    // Reload to see the change (TanStack Query cache invalidation)
    await page.reload();
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    const updatedCount = await page.locator(".react-flow__node").count();
    expect(updatedCount).toBe(2);
  });
});
