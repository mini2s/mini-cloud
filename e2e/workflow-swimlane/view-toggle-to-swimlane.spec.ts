// E2E test: Switch from overview to swimlane view via toggle.
//
// Starts with overview as persisted preference, then switches to swimlane.
// Verifies the reverse direction (non-default path) works correctly.
//
// Depends on: frontend WorkflowDetailShell, view store.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("View Toggle to Swimlane", () => {
  test("switching from overview to swimlane works and persists", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with stages ──
    const workflow = await seededApi.createWorkflow(
      "E2E Toggle Swimlane " + Date.now(),
    );

    await seededApi.createWorkflowStage(workflow.id, "Phase 1", 0);
    await seededApi.createWorkflowStage(workflow.id, "Phase 2", 1);

    // ── Step 1: Navigate and switch to overview first ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // Switch to overview
    const viewToggle = page
      .getByTestId("view-toggle")
      .or(page.getByRole("button", { name: /view|视图/i }))
      .or(page.locator("header button").first());
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

    // ── Step 2: Switch to swimlane ──
    await viewToggle.first().click();
    const swimlaneOption = page
      .getByRole("menuitem")
      .filter({ hasText: /Swimlane|泳道图/ });
    await expect(swimlaneOption.first()).toBeVisible({ timeout: 2000 });
    await swimlaneOption.first().click();

    // ── Step 3: Verify swimlane view is showing ──
    const swimlaneCanvas = page
      .getByTestId("swimlane-reactflow")
      .or(page.locator(".react-flow"));
    await expect(swimlaneCanvas.first()).toBeVisible({ timeout: 5000 });

    // Lane overlay with stage names
    const overlay = page
      .getByTestId("swimlane-overlay")
      .or(page.locator(".react-flow svg"));
    await expect(overlay.first()).toBeVisible({ timeout: 3000 });

    // Both stage names should be visible as lane headers
    await expect(overlay.first()).toContainText("Phase 1");
    await expect(overlay.first()).toContainText("Phase 2");

    // ── Step 4: Reload and verify swimlane persists ──
    await page.reload();
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    const swimlaneAfterReload = page
      .getByTestId("swimlane-reactflow")
      .or(page.locator(".react-flow"));
    await expect(swimlaneAfterReload.first()).toBeVisible({ timeout: 5000 });
  });
});
