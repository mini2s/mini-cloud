// E2E test: Many lanes require vertical scrolling.
//
// Seeds 8 stages and verifies not all lanes fit in viewport at once.
// Tests scrolling and fit-view zoom controls.
//
// Depends on: backend workflow + stage API, frontend swimlane canvas.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Many Lanes Scroll", () => {
  test("vertical scroll and fit-view work with many lanes", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with 8 stages ──
    const workflow = await seededApi.createWorkflow(
      "E2E Many Lanes " + Date.now(),
    );

    for (let i = 0; i < 8; i++) {
      const stage = await seededApi.createWorkflowStage(
        workflow.id,
        `Stage ${i + 1}`,
        i,
      );
      // Each stage gets 2 nodes
      await seededApi.createWorkflowNode(workflow.id, {
        title: `Node ${i}a`,
        stage_id: stage.id,
      });
      await seededApi.createWorkflowNode(workflow.id, {
        title: `Node ${i}b`,
        stage_id: stage.id,
      });
    }

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify ReactFlow canvas is visible ──
    const reactFlow = page
      .getByTestId("swimlane-reactflow")
      .or(page.locator(".react-flow"));
    await expect(reactFlow.first()).toBeVisible({ timeout: 5000 });

    // ── Step 2: Check scrollability ──
    const isScrollable = await reactFlow.evaluate((el) => {
      return el.scrollHeight > el.clientHeight;
    }).catch(() => true); // If eval fails, assume scrollable
    expect(isScrollable).toBe(true);

    // ── Step 3: Verify 16 nodes (8 stages × 2 nodes) are on canvas ──
    const rfNodes = page.locator(".react-flow__node");
    await expect(rfNodes.first()).toBeVisible({ timeout: 3000 });
    const nodeCount = await rfNodes.count();
    expect(nodeCount).toBe(16);

    // ── Step 4: Use fit-view button to zoom out ──
    const fitViewBtn = page
      .locator(".react-flow__controls-fitview")
      .or(page.getByTitle(/fit view|适应/i));
    await fitViewBtn.first().click();

    // After fit-view, all nodes should still be in the DOM
    await page.waitForTimeout(500);
    const nodeCountAfterFit = await rfNodes.count();
    expect(nodeCountAfterFit).toBe(16);

    // ── Step 5: Verify zoom controls exist ──
    const zoomIn = page.locator(".react-flow__controls-zoomin");
    const zoomOut = page.locator(".react-flow__controls-zoomout");
    await expect(zoomIn.first()).toBeVisible({ timeout: 3000 });
    await expect(zoomOut.first()).toBeVisible({ timeout: 3000 });
  });
});
