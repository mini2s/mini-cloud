// E2E test: Workflow not found shows error state.
//
// Navigates to a non-existent workflow ID and verifies the error state
// renders without white-screening or infinite loading.
//
// Depends on: backend workflow API, frontend error handling.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Workflow Not Found", () => {
  test("non-existent workflow shows error with back button, no white-screen", async ({
    page,
    slug,
  }) => {
    // ── Step 1: Navigate to non-existent workflow ──
    const fakeId = "00000000-0000-0000-0000-000000000000";
    await page.goto(`/${slug}/workflows/${fakeId}`);

    // ── Step 2: Verify error state is displayed ──
    // Should show error alert, not white-screen, not loading forever
    const errorAlert = page
      .getByRole("alert")
      .or(page.locator('[class*="destructive"]'))
      .or(page.locator("text").filter({ hasText: /not found|404|not exist|不存在|未找到/i }));

    await expect(errorAlert.first()).toBeVisible({ timeout: 10000 });

    // ── Step 3: Verify "Back to workflows" button exists ──
    const backBtn = page
      .getByRole("button", { name: /back|返回/i })
      .or(page.getByRole("link", { name: /workflows|工作流/i }));
    await expect(backBtn.first()).toBeVisible({ timeout: 3000 });

    // ── Step 4: Verify no swimlane canvas (no leaked UI) ──
    const reactFlow = page.locator(".react-flow");
    await expect(reactFlow).not.toBeVisible();

    // ── Step 5: Verify not white-screen ──
    // The page should have meaningful content
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(10);
  });
});
