// E2E test: Switching nodes updates detail panel content seamlessly.
//
// Opens panel for node A, then clicks node B (in a different lane).
// Verifies panel content updates without closing and reopening.
//
// Depends on: backend workflow + node API, frontend NodeDetailPanel.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Detail Panel Switch Node", () => {
  test("clicking different node updates panel content, not close-reopen", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with 2 nodes in different stages ──
    const workflow = await seededApi.createWorkflow(
      "E2E Panel Switch " + Date.now(),
    );

    const stage1 = await seededApi.createWorkflowStage(workflow.id, "Stage 1", 0);
    const stage2 = await seededApi.createWorkflowStage(workflow.id, "Stage 2", 1);

    await seededApi.createWorkflowNode(workflow.id, {
      title: "Alpha Node",
      stage_id: stage1.id,
      worker_type: "agent",
    });
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Beta Node",
      stage_id: stage2.id,
      worker_type: "human",
    });

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Click first node → panel opens with "Alpha Node" ──
    const rfNodes = page.locator(".react-flow__node");
    await expect(rfNodes.first()).toBeVisible({ timeout: 5000 });

    const firstNode = rfNodes.nth(0);
    await firstNode.click();

    const detailPanel = page
      .getByTestId("node-detail-panel")
      .or(page.getByRole("dialog"))
      .or(page.getByRole("complementary"));
    await expect(detailPanel.first()).toBeVisible({ timeout: 3000 });
    await expect(detailPanel.first()).toContainText("Alpha Node");

    // ── Step 2: Click second node → panel should update to "Beta Node" ──
    const secondNode = rfNodes.nth(1);
    await secondNode.click();

    // Panel should still be visible (not closed-reopened)
    await expect(detailPanel.first()).toBeVisible({ timeout: 3000 });

    // Content should now show Beta Node, not Alpha Node
    await expect(detailPanel.first()).toContainText("Beta Node");
    // Alpha should no longer be the title
    const panelText = await detailPanel.first().innerText();
    expect(panelText).not.toContain("Alpha Node");

    // ── Step 3: Verify panel container persisted ──
    // The panel should still be present in the DOM (seamless content swap)
    const panelCount = await detailPanel.count();
    expect(panelCount).toBe(1);
  });
});
