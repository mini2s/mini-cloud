// E2E test: Lanes are color-coded by 8-color palette (sort_order % 8).
//
// Seeds 3 stages and verifies each lane gets a distinct color from the
// palette (indigo/cyan/emerald at indices 0/1/2).
//
// Depends on: backend workflow + stage API, frontend swimlane canvas.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Lane Color Coding", () => {
  test("lanes use distinct palette colors cycled by sort_order", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with 3 stages ──
    const workflow = await seededApi.createWorkflow(
      "E2E Lane Colors " + Date.now(),
    );

    await seededApi.createWorkflowStage(workflow.id, "Stage A", 0);
    await seededApi.createWorkflowStage(workflow.id, "Stage B", 1);
    await seededApi.createWorkflowStage(workflow.id, "Stage C", 2);

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify lane overlay has rects with fill colors ──
    const overlay = page
      .getByTestId("swimlane-overlay")
      .or(page.locator(".react-flow svg"));
    await expect(overlay.first()).toBeVisible({ timeout: 5000 });

    // ── Step 2: Collect rect fill colors ──
    const rectFills = await overlay.locator("rect").evaluateAll((rects) =>
      rects.map((r) => r.getAttribute("fill") ?? "")
    );

    // Filter to rgba fills (lane backgrounds) vs other rects (header bars)
    const laneBgs = rectFills.filter((f) => f.startsWith("rgba"));
    expect(laneBgs.length).toBeGreaterThanOrEqual(3);

    // ── Step 3: Lanes should have distinct colors ──
    // Different sort_order → different palette color
    const uniqueColors = new Set(laneBgs.slice(0, 3));
    expect(uniqueColors.size).toBe(3);

    // ── Step 4: Verify color cycling — sort_order 8 wraps to palette index 0 ──
    // Create stages at index 0 and 8, they should share same color
    const workflow2 = await seededApi.createWorkflow(
      "E2E Lane Color Cycle " + Date.now(),
    );
    await seededApi.createWorkflowStage(workflow2.id, "Index 0", 0);
    await seededApi.createWorkflowStage(workflow2.id, "Index 8", 8);

    await page.goto(`/${slug}/workflows/${workflow2.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow2.id}`);

    const overlay2 = page
      .getByTestId("swimlane-overlay")
      .or(page.locator(".react-flow svg"));
    await expect(overlay2.first()).toBeVisible({ timeout: 5000 });

    const fills2 = await overlay2.locator("rect").evaluateAll((rects) =>
      rects.map((r) => r.getAttribute("fill") ?? "")
    );
    const laneBgs2 = fills2.filter((f) => f.startsWith("rgba"));
    if (laneBgs2.length >= 2) {
      // sort_order 0 and sort_order 8 should have same color
      expect(laneBgs2[0]).toBe(laneBgs2[1]);
    }
  });
});
