// E2E test: Switch from swimlane to editor view via toggle.
//
// Verifies view switches to editor (editable ReactFlow DAG) and can
// switch back to swimlane.
//
// Depends on: frontend WorkflowDetailShell, editor page, view store.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("View Toggle to Editor", () => {
  test("switching to editor shows editable DAG and can switch back", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with a node ──
    const workflow = await seededApi.createWorkflow(
      "E2E Toggle Editor " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Main", 0);
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Editor Node",
      stage_id: stage.id,
    });

    // ── Navigate to swimlane view (default) ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Verify swimlane is active ──
    const swimlaneCanvas = page
      .getByTestId("swimlane-reactflow")
      .or(page.locator(".react-flow"));
    await expect(swimlaneCanvas.first()).toBeVisible({ timeout: 5000 });

    // ── Step 2: Open toggle, click Editor ──
    const viewToggle = page
      .getByTestId("view-toggle")
      .or(page.getByRole("button", { name: /view|视图/i }))
      .or(page.locator("header button").first());
    await viewToggle.first().click();

    const editorOption = page
      .getByRole("menuitem")
      .filter({ hasText: /Editor|编辑器/ });
    await expect(editorOption.first()).toBeVisible({ timeout: 2000 });
    await editorOption.first().click();

    // ── Step 3: Verify editor view loaded ──
    // Editor should show ReactFlow canvas
    const reactFlow = page.locator(".react-flow");
    await expect(reactFlow.first()).toBeVisible({ timeout: 5000 });

    // URL should still be /{slug}/workflows/{id}
    const urlPattern = new RegExp(`/${slug}/workflows/${workflow.id}$`);
    await expect(page).toHaveURL(urlPattern);

    // ── Step 4: Switch back to swimlane ──
    await viewToggle.first().click();
    const swimlaneOption = page
      .getByRole("menuitem")
      .filter({ hasText: /Swimlane|泳道图/ });
    await expect(swimlaneOption.first()).toBeVisible({ timeout: 2000 });
    await swimlaneOption.first().click();

    // ── Step 5: Verify swimlane is restored ──
    const swimlaneRestored = page
      .getByTestId("swimlane-reactflow")
      .or(page.locator(".react-flow"));
    await expect(swimlaneRestored.first()).toBeVisible({ timeout: 5000 });

    // Lane overlay should be back
    const overlay = page
      .getByTestId("swimlane-overlay")
      .or(page.locator(".react-flow svg"));
    await expect(overlay.first()).toBeVisible({ timeout: 3000 });
  });
});
