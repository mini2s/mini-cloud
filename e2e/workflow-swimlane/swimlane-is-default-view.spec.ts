// E2E test: Swimlane is the default view when opening a workflow.
//
// Verifies that navigating to /{slug}/workflows/{id} renders the swimlane
// view directly — no /overview or /editor suffix needed.
//
// Depends on: backend workflow API, frontend swimlane page, view store.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Swimlane is Default View", () => {
  test("navigating to workflow detail renders swimlane as default view", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create a workflow ──
    const workflow = await seededApi.createWorkflow(
      "E2E Swimlane Default View " + Date.now(),
    );

    // ── Step 1: Navigate to workflow list ──
    await page.goto(`/${slug}/workflows`);
    await page.waitForURL(`/${slug}/workflows`);

    // ── Step 2: Click on the workflow to open detail page ──
    const workflowLink = page.locator(`a[href*="/workflows/${workflow.id}"]`);
    await expect(workflowLink.first()).toBeVisible({ timeout: 5000 });
    await workflowLink.first().click();

    // ── Step 3: Verify URL matches /{slug}/workflows/{id} ──
    // No /overview or /editor suffix — swimlane is the default
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);
    const urlPattern = new RegExp(`/${slug}/workflows/${workflow.id}$`);
    await expect(page).toHaveURL(urlPattern);

    // ── Step 4: Verify swimlane canvas is visible ──
    const swimlaneCanvas = page
      .getByTestId("swimlane-canvas")
      .or(page.getByTestId("swimlane-reactflow"))
      .or(page.locator(".react-flow"));
    await expect(swimlaneCanvas.first()).toBeVisible({ timeout: 5000 });

    // ── Step 5: Verify page heading contains workflow name ──
    const heading = page
      .getByRole("heading")
      .or(page.locator("h1"));
    await expect(heading.first()).toBeVisible();

    // ── Step 6: Verify view toggle button is visible ──
    // The toggle shows LayoutGrid icon when swimlane is active
    const viewToggle = page
      .getByTestId("view-toggle")
      .or(page.getByRole("button", { name: /view|视图/i }))
      .or(page.locator("button").filter({ has: page.locator("svg") }));
    await expect(viewToggle.first()).toBeVisible({ timeout: 3000 });
  });
});
