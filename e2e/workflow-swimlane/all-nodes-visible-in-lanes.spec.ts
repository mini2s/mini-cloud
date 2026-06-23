// E2E test: All nodes from all stages visible simultaneously.
//
// Unlike the overview view (click stage card → see one stage's nodes),
// the swimlane shows ALL nodes from ALL stages at once.
//
// Depends on: backend workflow + node API, frontend swimlane canvas.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("All Nodes Visible", () => {
  test("nodes from all stages are visible without clicking stage cards", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with 2 stages, each with 2 nodes ──
    const workflow = await seededApi.createWorkflow(
      "E2E All Nodes " + Date.now(),
    );

    const stage1 = await seededApi.createWorkflowStage(workflow.id, "Backend", 0);
    const stage2 = await seededApi.createWorkflowStage(workflow.id, "Frontend", 1);

    await seededApi.createWorkflowNode(workflow.id, {
      title: "API Design",
      stage_id: stage1.id,
    });
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Database Schema",
      stage_id: stage1.id,
    });
    await seededApi.createWorkflowNode(workflow.id, {
      title: "UI Components",
      stage_id: stage2.id,
    });
    await seededApi.createWorkflowNode(workflow.id, {
      title: "State Management",
      stage_id: stage2.id,
    });

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify all 4 ReactFlow nodes are visible ──
    const rfNodes = page.locator(".react-flow__node");
    await expect(rfNodes.first()).toBeVisible({ timeout: 5000 });
    const nodeCount = await rfNodes.count();
    expect(nodeCount).toBe(4);

    // ── Step 2: Verify nodes are spread across lanes ──
    // Nodes in stage 1 (Backend) should have lower Y than nodes in stage 2 (Frontend)
    const nodePositions = await rfNodes.evaluateAll((nodes) =>
      nodes.map((n) => {
        const style = (n as HTMLElement).style.transform || "";
        const match = style.match(/translate\((\d+)px,\s*(\d+)px\)/);
        const text = n.textContent || "";
        return {
          y: match ? parseInt(match[2], 10) : 0,
          text,
        };
      }),
    );

    // At least one node should have Y in a different range from others
    const yValues = nodePositions.map((p) => p.y);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    // Nodes across 2 lanes should have significant Y spread
    expect(maxY - minY).toBeGreaterThan(50);

    // ── Step 3: Verify no click interaction needed to see nodes ──
    // All nodes should already be visible without clicking any stage card
    for (const expectedTitle of [
      "API Design",
      "Database Schema",
      "UI Components",
      "State Management",
    ]) {
      const nodeWithTitle = rfNodes.filter({ hasText: expectedTitle });
      await expect(nodeWithTitle.first()).toBeVisible({ timeout: 3000 });
    }
  });
});
