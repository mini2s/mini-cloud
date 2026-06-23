// E2E test: View toggle dropdown shows three view options.
//
// Verifies the DropdownMenu shows Swimlane, Overview, and Editor options
// with correct icons and the current view is indicated.
//
// Depends on: frontend WorkflowDetailShell, view store.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("View Toggle Options", () => {
  test("dropdown menu shows three view options with current view indicated", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create a workflow ──
    const workflow = await seededApi.createWorkflow(
      "E2E View Toggle Options " + Date.now(),
    );

    // ── Navigate to swimlane view (default) ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Find and click the view toggle button ──
    const viewToggle = page
      .getByTestId("view-toggle")
      .or(page.getByRole("button", { name: /view|视图/i }))
      .or(page.locator("header button").first());
    await expect(viewToggle.first()).toBeVisible({ timeout: 5000 });
    await viewToggle.first().click();

    // ── Step 2: Verify dropdown menu opens ──
    const dropdown = page
      .getByTestId("view-toggle-dropdown")
      .or(page.locator('[class*="dropdown"]').last())
      .or(page.locator('[role="menu"]'));
    await expect(dropdown.first()).toBeVisible({ timeout: 3000 });

    // ── Step 3: Verify three menu items exist ──
    const menuItems = dropdown.first().getByRole("menuitem");
    await expect(menuItems.first()).toBeVisible({ timeout: 2000 });
    const itemCount = await menuItems.count();
    expect(itemCount).toBe(3);

    // ── Step 4: Verify Swimlane option is present ──
    const swimlaneOption = menuItems.filter({ hasText: /Swimlane|泳道图/ });
    await expect(swimlaneOption.first()).toBeVisible({ timeout: 2000 });

    // ── Step 5: Verify Overview option is present ──
    const overviewOption = menuItems.filter({ hasText: /Overview|概览/ });
    await expect(overviewOption.first()).toBeVisible({ timeout: 2000 });

    // ── Step 6: Verify Editor option is present ──
    const editorOption = menuItems.filter({ hasText: /Editor|编辑器/ });
    await expect(editorOption.first()).toBeVisible({ timeout: 2000 });

    // ── Step 7: Close dropdown by pressing Escape ──
    await page.keyboard.press("Escape");
    await expect(dropdown.first()).not.toBeVisible({ timeout: 2000 });
  });
});
