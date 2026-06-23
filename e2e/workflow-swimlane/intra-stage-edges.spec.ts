// E2E test: Intra-stage edges rendered within the same lane.
//
// Seeds 3 nodes connected sequentially within one stage. Verifies edges
// use the lane's palette border color (not neutral gray) and have arrows.
//
// Depends on: backend workflow + node + edge API, frontend swimlane canvas.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Intra-Stage Edges", () => {
  test("edges within same lane use lane color and have arrow markers", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with 1 stage, 3 connected nodes ──
    const workflow = await seededApi.createWorkflow(
      "E2E Intra-Stage Edges " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Pipeline", 0);

    const nodeA = await seededApi.createWorkflowNode(workflow.id, {
      title: "Input",
      stage_id: stage.id,
    });
    const nodeB = await seededApi.createWorkflowNode(workflow.id, {
      title: "Process",
      stage_id: stage.id,
    });
    const nodeC = await seededApi.createWorkflowNode(workflow.id, {
      title: "Output",
      stage_id: stage.id,
    });

    // Connect A→B and B→C
    await seededApi.createWorkflowEdge(workflow.id, nodeA.id, nodeB.id);
    await seededApi.createWorkflowEdge(workflow.id, nodeB.id, nodeC.id);

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify edges are visible ──
    const edges = page.locator(".react-flow__edge");
    await expect(edges.first()).toBeVisible({ timeout: 5000 });

    // ── Step 2: Verify 2 edges exist ──
    const edgeCount = await edges.count();
    expect(edgeCount).toBe(2);

    // ── Step 3: Verify edges have color (not invisible) ──
    const edgePath = edges.first().locator("path");
    const stroke = await edgePath.first().getAttribute("stroke");
    // Should have a stroke color (not "none" or missing)
    expect(stroke).toBeTruthy();
    expect(stroke).not.toBe("none");

    // ── Step 4: Verify edges have arrow markers ──
    // ReactFlow edges with arrows have marker-end on the path
    const markerEnd = await edgePath.first().getAttribute("marker-end");
    const hasMarker = await edges.first().locator("[marker-end]").count();
    // At least one of: marker-end attribute or marker element
    const hasArrow = markerEnd !== null || hasMarker > 0;
    expect(hasArrow).toBe(true);

    // ── Step 5: Intra-stage edges should NOT be neutral gray ──
    // They should use the lane's palette color (not #94A3B8 = slate-400)
    if (stroke) {
      expect(stroke.toLowerCase()).not.toBe("#94a3b8");
    }
  });
});
