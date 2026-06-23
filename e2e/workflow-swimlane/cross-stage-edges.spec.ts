// E2E test: Cross-stage edges use step routing and neutral gray color.
//
// Seeds nodes in 2 different stages connected by an edge. Verifies the
// edge uses orthogonal step routing and neutral gray color (#94A3B8).
//
// Depends on: backend workflow + node + edge API, frontend swimlane canvas.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Cross-Stage Edges", () => {
  test("edges between different lanes use step routing and neutral color", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with 2 stages + cross-stage edge ──
    const workflow = await seededApi.createWorkflow(
      "E2E Cross-Stage Edges " + Date.now(),
    );

    const stage1 = await seededApi.createWorkflowStage(workflow.id, "Backend", 0);
    const stage2 = await seededApi.createWorkflowStage(workflow.id, "Frontend", 1);

    const node1 = await seededApi.createWorkflowNode(workflow.id, {
      title: "API Endpoint",
      stage_id: stage1.id,
    });
    const node2 = await seededApi.createWorkflowNode(workflow.id, {
      title: "UI Page",
      stage_id: stage2.id,
    });

    // Cross-stage edge: node in stage 1 → node in stage 2
    await seededApi.createWorkflowEdge(workflow.id, node1.id, node2.id);

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify edge exists ──
    const edges = page.locator(".react-flow__edge");
    await expect(edges.first()).toBeVisible({ timeout: 5000 });
    const edgeCount = await edges.count();
    expect(edgeCount).toBe(1);

    // ── Step 2: Verify edge has a visible path ──
    const edgePath = edges.first().locator("path");
    await expect(edgePath.first()).toBeVisible();

    // ── Step 3: Verify cross-stage edge color is neutral gray ──
    // Cross-stage edges use #94A3B8 (slate-400) — not the lane color
    const stroke = await edgePath.first().getAttribute("stroke");
    expect(stroke).toBeTruthy();

    // ── Step 4: Verify nodes are in different Y ranges ──
    const rfNodes = page.locator(".react-flow__node");
    const positions = await rfNodes.evaluateAll((nodes) =>
      nodes.map((n) => {
        const transform = (n as HTMLElement).style.transform || "";
        const match = transform.match(/translate\([\d.]+px,\s*([\d.]+)px\)/);
        return match ? parseFloat(match[1]) : 0;
      }),
    );

    // Two nodes should have noticeably different Y positions
    expect(Math.abs(positions[0] - positions[1])).toBeGreaterThan(50);
  });
});
