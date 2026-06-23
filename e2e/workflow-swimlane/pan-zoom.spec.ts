// E2E test: Pan and zoom controls work in swimlane view.
//
// Verifies ReactFlow zoom controls (in/out/fit-view) and pan via drag.
//
// Depends on: backend workflow API, frontend swimlane canvas.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Pan and Zoom", () => {
  test("zoom controls and pan work on the swimlane canvas", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with multiple stages (enough content to zoom) ──
    const workflow = await seededApi.createWorkflow(
      "E2E Pan Zoom " + Date.now(),
    );

    for (let i = 0; i < 3; i++) {
      const stage = await seededApi.createWorkflowStage(
        workflow.id,
        `Stage ${i + 1}`,
        i,
      );
      await seededApi.createWorkflowNode(workflow.id, {
        title: `Node ${i}`,
        stage_id: stage.id,
      });
    }

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify ReactFlow canvas is present ──
    const reactFlow = page.locator(".react-flow");
    await expect(reactFlow.first()).toBeVisible({ timeout: 5000 });

    // ── Step 2: Verify zoom controls exist ──
    const zoomInBtn = page.locator(".react-flow__controls-zoomin");
    const zoomOutBtn = page.locator(".react-flow__controls-zoomout");
    const fitViewBtn = page.locator(".react-flow__controls-fitview");

    await expect(zoomInBtn.first()).toBeVisible({ timeout: 3000 });
    await expect(zoomOutBtn.first()).toBeVisible({ timeout: 3000 });
    await expect(fitViewBtn.first()).toBeVisible({ timeout: 3000 });

    // ── Step 3: Click zoom in and verify transform changes ──
    const viewport = page.locator(".react-flow__viewport");
    const initialTransform = await viewport.evaluate((el) => {
      return (el as HTMLElement).style.transform || "";
    });

    await zoomInBtn.first().click();
    await page.waitForTimeout(300);

    const zoomedTransform = await viewport.evaluate((el) => {
      return (el as HTMLElement).style.transform || "";
    });
    // Transform should have changed after zoom
    expect(zoomedTransform).not.toBe(initialTransform);

    // ── Step 4: Click fit-view ──
    await fitViewBtn.first().click();
    await page.waitForTimeout(500);

    // All nodes should still be present
    const nodeCount = await page.locator(".react-flow__node").count();
    expect(nodeCount).toBe(3);

    // ── Step 5: Pan by dragging the background ──
    // Click and drag on the ReactFlow pane (not on a node)
    const pane = page.locator(".react-flow__pane").or(reactFlow);
    const paneBox = await pane.first().boundingBox();
    if (paneBox) {
      await page.mouse.move(paneBox.x + 100, paneBox.y + 100);
      await page.mouse.down();
      await page.mouse.move(paneBox.x + 200, paneBox.y + 200, { steps: 5 });
      await page.mouse.up();
      // Pan should not throw errors
    }
  });
});
