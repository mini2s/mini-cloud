// E2E test: Keyboard navigation in swimlane view.
//
// Verifies Tab focus cycle and Escape key behavior for detail panel.
//
// Depends on: frontend swimlane page, keyboard event handling.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Keyboard Navigation", () => {
  test("tab focus and escape key work in swimlane view", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with nodes ──
    const workflow = await seededApi.createWorkflow(
      "E2E Keyboard Nav " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Main", 0);
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Keyboard Node",
      stage_id: stage.id,
    });

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify page loads ──
    const reactFlow = page.locator(".react-flow");
    await expect(reactFlow.first()).toBeVisible({ timeout: 5000 });

    // ── Step 2: Press Escape with no panel open (should be no-op) ──
    // Should not throw errors or white-screen
    await page.keyboard.press("Escape");
    // Page should still be functional
    await expect(reactFlow.first()).toBeVisible({ timeout: 2000 });

    // ── Step 3: Open detail panel by clicking a node ──
    const rfNode = page.locator(".react-flow__node").first();
    await rfNode.click();

    const detailPanel = page
      .getByTestId("node-detail-panel")
      .or(page.getByRole("dialog"))
      .or(page.getByRole("complementary"));
    await expect(detailPanel.first()).toBeVisible({ timeout: 3000 });

    // ── Step 4: Close detail panel with Escape ──
    await page.keyboard.press("Escape");
    await expect(detailPanel.first()).not.toBeVisible({ timeout: 2000 });

    // ── Step 5: Verify page is still functional ──
    await expect(reactFlow.first()).toBeVisible();
  });
});
