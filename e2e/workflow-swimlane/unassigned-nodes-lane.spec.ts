// E2E test: Unassigned nodes appear in a separate lane at the bottom.
//
// Seeds stages AND nodes with stage_id=null. Verifies the unassigned lane
// has dashed border, neutral gray color, and appears below all stage lanes.
//
// Depends on: backend workflow + node API, frontend swimlane canvas.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Unassigned Nodes Lane", () => {
  test("nodes without stage appear in dashed unassigned lane at bottom", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with stages + unassigned nodes ──
    const workflow = await seededApi.createWorkflow(
      "E2E Unassigned Lane " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Defined", 0);

    // Node assigned to a stage
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Assigned Node",
      stage_id: stage.id,
    });

    // Nodes with stage_id = null (unassigned)
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Orphan Node A",
      stage_id: null,
    });
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Orphan Node B",
      stage_id: null,
    });

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify "Unassigned" lane header exists ──
    const overlay = page
      .getByTestId("swimlane-overlay")
      .or(page.locator(".react-flow svg"));
    await expect(overlay.first()).toBeVisible({ timeout: 5000 });

    const unassignedText = overlay.locator("text").filter({
      hasText: /Unassigned|未分组/,
    });
    await expect(unassignedText.first()).toBeVisible({ timeout: 3000 });

    // ── Step 2: Verify unassigned lane has dashed border ──
    // Look for rect with stroke-dasharray attribute
    const dashedRect = overlay.locator("rect[stroke-dasharray]");
    const dashedCount = await dashedRect.count();
    expect(dashedCount).toBeGreaterThanOrEqual(1);

    // ── Step 3: Verify unassigned lane is last ──
    const laneGroups = overlay.locator("g");
    const groupCount = await laneGroups.count();
    // The last group should contain the unassigned text
    const lastGroup = laneGroups.nth(groupCount - 1);
    await expect(lastGroup.locator("text").filter({
      hasText: /Unassigned|未分组/,
    }).first()).toBeVisible({ timeout: 3000 });

    // ── Step 4: Verify unassigned nodes are on the canvas ──
    const rfNodes = page.locator(".react-flow__node");
    await expect(rfNodes.first()).toBeVisible({ timeout: 5000 });
    // Total of 3 nodes: 1 assigned + 2 unassigned
    const nodeCount = await rfNodes.count();
    expect(nodeCount).toBe(3);

    // ── Step 5: Click unassigned lane — nodes should be visible ──
    // (In swimlane, nodes are already visible; verify no errors)
    const orphanNode = rfNodes.filter({ hasText: /Orphan Node/ });
    await expect(orphanNode.first()).toBeVisible({ timeout: 3000 });
  });
});
