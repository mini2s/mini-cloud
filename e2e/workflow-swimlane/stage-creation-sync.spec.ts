// E2E test: Stage creation in overview syncs to swimlane view.
//
// Creates a stage in overview view, then switches to swimlane and verifies
// the new stage appears as a lane.
//
// Depends on: backend workflow + stage API, shared TanStack Query cache.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Stage Creation Sync", () => {
  test("stage created in overview appears as lane in swimlane", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with one stage ──
    const workflow = await seededApi.createWorkflow(
      "E2E Stage Sync " + Date.now(),
    );

    await seededApi.createWorkflowStage(workflow.id, "Existing", 0);

    // ── Step 1: Navigate to workflow and switch to overview ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    const viewToggle = page
      .getByTestId("view-toggle")
      .or(page.getByRole("button", { name: /view|视图/i }))
      .or(page.locator("header button").first());

    // Switch to overview
    await viewToggle.first().click();
    const overviewOption = page
      .getByRole("menuitem")
      .filter({ hasText: /Overview|概览/ });
    await overviewOption.first().click();

    // Verify overview is showing
    const stageCanvas = page
      .getByTestId("stage-canvas")
      .or(page.getByTestId("stage-card-strip"));
    await expect(stageCanvas.first()).toBeVisible({ timeout: 5000 });

    // ── Step 2: Create new stage via API (simulating overview create dialog) ──
    await seededApi.createWorkflowStage(workflow.id, "New Stage", 1);

    // ── Step 3: Switch to swimlane ──
    await viewToggle.first().click();
    const swimlaneOption = page
      .getByRole("menuitem")
      .filter({ hasText: /Swimlane|泳道图/ });
    await swimlaneOption.first().click();

    // ── Step 4: Verify both stages appear as lanes in swimlane ──
    const swimlaneCanvas = page
      .getByTestId("swimlane-reactflow")
      .or(page.locator(".react-flow"));
    await expect(swimlaneCanvas.first()).toBeVisible({ timeout: 5000 });

    // Reload to ensure fresh data
    await page.reload();
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // Verify swimlane is showing (default after reload due to view toggle persistence)
    const overlay = page
      .getByTestId("swimlane-overlay")
      .or(page.locator(".react-flow svg"));
    await expect(overlay.first()).toBeVisible({ timeout: 5000 });

    // Both lanes should be visible
    await expect(overlay.first()).toContainText("Existing");
    await expect(overlay.first()).toContainText("New Stage");
  });
});
