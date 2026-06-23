// E2E test: Nodes are read-only in swimlane view.
//
// Verifies nodes cannot be dragged, no connection handles appear,
// and Delete key does not remove nodes.
//
// Depends on: backend workflow + node API, frontend swimlane canvas.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Nodes Read-Only", () => {
  test("nodes are not draggable, have no handles, and cannot be deleted", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with a node ──
    const workflow = await seededApi.createWorkflow(
      "E2E Read-Only " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Stage", 0);
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Test Node",
      stage_id: stage.id,
    });

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Get initial node position ──
    const rfNode = page.locator(".react-flow__node").first();
    await expect(rfNode).toBeVisible({ timeout: 5000 });

    const initialTransform = await rfNode.evaluate((el) => {
      return (el as HTMLElement).style.transform || "";
    });

    // ── Step 2: Attempt to drag the node ──
    const box = await rfNode.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 100, { steps: 5 });
      await page.mouse.up();
    }

    // ── Step 3: Verify node position did NOT change ──
    const afterDragTransform = await rfNode.evaluate((el) => {
      return (el as HTMLElement).style.transform || "";
    });
    expect(afterDragTransform).toBe(initialTransform);

    // ── Step 4: Verify no connection handles ──
    const handles = page.locator(".react-flow__handle");
    const handleCount = await handles.count();
    // In read-only mode, handles should be absent or zero
    expect(handleCount).toBe(0);

    // ── Step 5: Press Delete — nothing should happen ──
    await rfNode.click();
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);

    // Node should still exist
    const nodeCount = await page.locator(".react-flow__node").count();
    expect(nodeCount).toBe(1);
  });
});
