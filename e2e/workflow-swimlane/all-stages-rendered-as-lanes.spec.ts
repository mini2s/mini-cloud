// E2E test: All stages rendered as horizontal color-coded lanes.
//
// Seeds 3 stages and verifies each appears as a lane with colored header
// and correct name, stacked vertically in sort_order.
//
// Depends on: backend workflow + stage API, frontend swimlane canvas.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("All Stages as Lanes", () => {
  test("stages render as colored lanes with names in sort_order", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with 3 stages ──
    const workflow = await seededApi.createWorkflow(
      "E2E Stages as Lanes " + Date.now(),
    );

    const stage1 = await seededApi.createWorkflowStage(workflow.id, "需求", 0);
    const stage2 = await seededApi.createWorkflowStage(workflow.id, "设计", 1);
    const stage3 = await seededApi.createWorkflowStage(workflow.id, "编码", 2);

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify lane overlay is visible ──
    const overlay = page
      .getByTestId("swimlane-overlay")
      .or(page.locator(".react-flow svg"));
    await expect(overlay.first()).toBeVisible({ timeout: 5000 });

    // ── Step 2: Verify 3 lane groups ──
    // Each lane is an SVG <g> with a <rect> background and <text> header
    const laneGroups = overlay.locator("g");
    // Should have at least 3 lane groups (one per stage)
    await expect(laneGroups.first()).toBeVisible({ timeout: 3000 });

    // ── Step 3: Verify lane header texts ──
    const laneTexts = overlay.locator("text");
    await expect(laneTexts.filter({ hasText: /需求/ }).first()).toBeVisible({
      timeout: 3000,
    });
    await expect(laneTexts.filter({ hasText: /设计/ }).first()).toBeVisible({
      timeout: 3000,
    });
    await expect(laneTexts.filter({ hasText: /编码/ }).first()).toBeVisible({
      timeout: 3000,
    });

    // ── Step 4: Verify lanes have colored backgrounds ──
    // Each lane should have a <rect> with a fill color (rgba with 8% opacity)
    const laneRects = overlay.locator("rect");
    const rectCount = await laneRects.count();
    expect(rectCount).toBeGreaterThanOrEqual(3);

    // Check that at least some rects have fill with rgba
    const firstRectFill = await laneRects.first().getAttribute("fill");
    expect(firstRectFill).toBeTruthy();

    // ── Step 5: Verify lane ordering by sort_order ──
    // "需求" (sort_order 0) text should appear before "编码" (sort_order 2) in DOM
    const allText = await overlay.innerText();
    const demandIndex = allText.indexOf("需求");
    const designIndex = allText.indexOf("设计");
    const codeIndex = allText.indexOf("编码");
    expect(demandIndex).toBeLessThan(designIndex);
    expect(designIndex).toBeLessThan(codeIndex);
  });
});
