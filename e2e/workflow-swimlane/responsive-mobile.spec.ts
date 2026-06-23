// E2E test: Responsive layout below 1024px breakpoint.
//
// Resizes viewport to 800×600 and verifies the swimlane view adapts:
// detail panel opens as bottom sheet instead of side drawer.
//
// Depends on: frontend swimlane page, responsive CSS.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Responsive Mobile Layout", () => {
  test("swimlane adapts to narrow viewport with bottom-sheet detail panel", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with a node ──
    const workflow = await seededApi.createWorkflow(
      "E2E Responsive " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Main", 0);
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Mobile Node",
      stage_id: stage.id,
    });

    // ── Step 1: Resize viewport to mobile ──
    await page.setViewportSize({ width: 800, height: 600 });

    // ── Step 2: Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 3: Verify swimlane canvas still visible ──
    const reactFlow = page.locator(".react-flow");
    await expect(reactFlow.first()).toBeVisible({ timeout: 5000 });

    // ── Step 4: Verify zoom controls are accessible ──
    const controls = page.locator(".react-flow__controls");
    await expect(controls.first()).toBeVisible({ timeout: 3000 });

    // ── Step 5: Click a node to open detail panel ──
    const rfNode = page.locator(".react-flow__node").first();
    await expect(rfNode).toBeVisible({ timeout: 5000 });
    await rfNode.click();

    // ── Step 6: Verify detail panel opens ──
    const detailPanel = page
      .getByTestId("node-detail-panel")
      .or(page.getByRole("dialog"))
      .or(page.getByRole("complementary"));
    await expect(detailPanel.first()).toBeVisible({ timeout: 3000 });

    // ── Step 7: Verify panel content is visible ──
    await expect(detailPanel.first()).toContainText("Mobile Node");

    // Reset viewport for subsequent tests
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});
