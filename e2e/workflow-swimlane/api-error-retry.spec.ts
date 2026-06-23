// E2E test: API error with retry button.
//
// Intercepts the workflow API to return 500, verifies error alert with
// Retry button, then removes interception and verifies recovery.
//
// Depends on: backend workflow API, frontend error + retry handling.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("API Error with Retry", () => {
  test("shows error on API failure and recovers on retry", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow ──
    const workflow = await seededApi.createWorkflow(
      "E2E API Error " + Date.now(),
    );

    // ── Step 1: Intercept workflow API to return 500 ──
    await page.route("**/api/workflows/**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal Server Error" }),
      });
    });

    // ── Step 2: Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);

    // ── Step 3: Verify error alert is visible ──
    const errorAlert = page
      .getByRole("alert")
      .or(page.locator('[class*="destructive"]'));
    await expect(errorAlert.first()).toBeVisible({ timeout: 10000 });

    // ── Step 4: Verify "Retry" button present ──
    const retryBtn = page.getByRole("button", { name: /retry|重试/i });
    await expect(retryBtn.first()).toBeVisible({ timeout: 3000 });

    // ── Step 5: Remove API interception ──
    await page.unroute("**/api/workflows/**");

    // ── Step 6: Click Retry ──
    await retryBtn.first().click();

    // ── Step 7: Verify data loads successfully ──
    const swimlaneCanvas = page
      .getByTestId("swimlane-reactflow")
      .or(page.locator(".react-flow"));
    await expect(swimlaneCanvas.first()).toBeVisible({ timeout: 10000 });

    // Error alert should be gone
    await expect(errorAlert.first()).not.toBeVisible({ timeout: 3000 });
  });
});
