// E2E test: Switch from swimlane to overview view via toggle.
//
// Verifies view switches to overview (stage cards + single-stage DAG)
// and persists across page reload.
//
// Depends on: frontend WorkflowDetailShell, overview page, view store persist.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("View Toggle to Overview", () => {
  test("switching to overview shows stage cards and persists after reload", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with stages ──
    const workflow = await seededApi.createWorkflow(
      "E2E Toggle Overview " + Date.now(),
    );

    await seededApi.createWorkflowStage(workflow.id, "Phase 1", 0);
    await seededApi.createWorkflowStage(workflow.id, "Phase 2", 1);

    // ── Navigate to swimlane view (default) ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify we start in swimlane ──
    const swimlaneCanvas = page
      .getByTestId("swimlane-reactflow")
      .or(page.locator(".react-flow"));
    await expect(swimlaneCanvas.first()).toBeVisible({ timeout: 5000 });

    // ── Step 2: Open view toggle and click Overview ──
    const viewToggle = page
      .getByTestId("view-toggle")
      .or(page.getByRole("button", { name: /view|视图/i }))
      .or(page.locator("header button").first());
    await viewToggle.first().click();

    const overviewOption = page
      .getByRole("menuitem")
      .filter({ hasText: /Overview|概览/ });
    await expect(overviewOption.first()).toBeVisible({ timeout: 2000 });
    await overviewOption.first().click();

    // ── Step 3: Verify view switched to overview ──
    // Stage canvas area (horizontal card strip) should be visible
    const stageCanvas = page
      .getByTestId("stage-canvas")
      .or(page.getByTestId("stage-card-strip"))
      .or(page.locator('[class*="stage-card"]'));
    await expect(stageCanvas.first()).toBeVisible({ timeout: 5000 });

    // URL should still be /{slug}/workflows/{id} (no suffix)
    const urlPattern = new RegExp(`/${slug}/workflows/${workflow.id}$`);
    await expect(page).toHaveURL(urlPattern);

    // ── Step 4: Reload and verify overview persists ──
    await page.reload();
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // Overview should still be the active view
    const stageCanvasAfterReload = page
      .getByTestId("stage-canvas")
      .or(page.getByTestId("stage-card-strip"))
      .or(page.locator('[class*="stage-card"]'));
    await expect(stageCanvasAfterReload.first()).toBeVisible({ timeout: 5000 });
  });
});
