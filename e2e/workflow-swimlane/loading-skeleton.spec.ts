// E2E test: Loading skeleton displayed during API fetch.
//
// Intercepts the workflow API requests with a delay. Verifies skeleton
// lanes appear during loading and are replaced by real lanes afterward.
//
// Depends on: backend workflow API, frontend swimlane page.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Loading Skeleton", () => {
  test("skeleton lanes display during fetch and disappear after data loads", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create a workflow with stages ──
    const workflow = await seededApi.createWorkflow(
      "E2E Swimlane Skeleton " + Date.now(),
    );

    await seededApi.createWorkflowStage(workflow.id, "Phase 1", 0);
    await seededApi.createWorkflowStage(workflow.id, "Phase 2", 1);
    await seededApi.createWorkflowStage(workflow.id, "Phase 3", 2);

    // ── Step 1: Intercept workflow API with 2-second delay ──
    await page.route("**/api/workflows/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    // ── Step 2: Navigate to the swimlane page ──
    const navigationPromise = page.goto(
      `/${slug}/workflows/${workflow.id}`,
    );

    // ── Step 3: Wait briefly for skeleton to render ──
    await page.waitForTimeout(300);

    // Verify skeleton elements are visible during loading
    const skeleton = page
      .getByTestId("swimlane-skeleton")
      .or(page.locator(".animate-pulse"))
      .or(page.locator('[class*="skeleton"]'));

    await expect(skeleton.first()).toBeVisible({ timeout: 2000 });

    // ── Step 4: Wait for API response ──
    await navigationPromise;
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 5: Verify skeleton disappeared ──
    await expect(skeleton.first()).not.toBeVisible({ timeout: 3000 });

    // ── Step 6: Verify real lanes appeared ──
    const swimlaneCanvas = page
      .getByTestId("swimlane-reactflow")
      .or(page.locator(".react-flow"));
    await expect(swimlaneCanvas.first()).toBeVisible({ timeout: 5000 });

    // ── Step 7: Verify no error state shown ──
    const errorElements = page
      .getByRole("alert")
      .or(page.locator('[class*="destructive"]'));
    await expect(errorElements).not.toBeVisible();

    // Clean up route interception
    await page.unroute("**/api/workflows/**");
  });
});
