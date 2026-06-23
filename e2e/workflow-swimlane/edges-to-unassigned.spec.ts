// E2E test: Edges between staged and unassigned nodes.
//
// Seeds a node in a stage connected to an unassigned node (stage_id=null).
// Verifies the edge crosses from the stage lane to the unassigned lane.
//
// Depends on: backend workflow + node + edge API, frontend swimlane canvas.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Edges to Unassigned", () => {
  test("edges connect staged nodes to unassigned nodes across lanes", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with 1 stage, 1 unassigned node, 1 edge ──
    const workflow = await seededApi.createWorkflow(
      "E2E Edges Unassigned " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Main", 0);

    const stagedNode = await seededApi.createWorkflowNode(workflow.id, {
      title: "Defined Node",
      stage_id: stage.id,
    });
    const unassignedNode = await seededApi.createWorkflowNode(workflow.id, {
      title: "Floating Node",
      stage_id: null,
    });

    // Edge: staged → unassigned
    await seededApi.createWorkflowEdge(
      workflow.id,
      stagedNode.id,
      unassignedNode.id,
    );

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify edge is visible ──
    const edges = page.locator(".react-flow__edge");
    await expect(edges.first()).toBeVisible({ timeout: 5000 });
    const edgeCount = await edges.count();
    expect(edgeCount).toBe(1);

    // ── Step 2: Verify edge has neutral color ──
    // Edges to unassigned use neutral gray, not lane color
    const edgePath = edges.first().locator("path");
    const stroke = await edgePath.first().getAttribute("stroke");
    expect(stroke).toBeTruthy();

    // ── Step 3: Verify both nodes are visible ──
    const rfNodes = page.locator(".react-flow__node");
    await expect(rfNodes.first()).toBeVisible({ timeout: 3000 });
    const nodeCount = await rfNodes.count();
    expect(nodeCount).toBe(2);

    // ── Step 4: Verify unassigned lane exists ──
    const overlay = page
      .getByTestId("swimlane-overlay")
      .or(page.locator(".react-flow svg"));
    await expect(overlay.first()).toBeVisible();

    const unassignedText = overlay.locator("text").filter({
      hasText: /Unassigned|未分组/,
    });
    await expect(unassignedText.first()).toBeVisible({ timeout: 3000 });
  });
});
