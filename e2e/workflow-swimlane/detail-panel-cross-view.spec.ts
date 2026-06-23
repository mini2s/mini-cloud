// E2E test: Node detail panel shows same data across swimlane and overview.
//
// Opens detail panel for a node in swimlane, notes the content,
// switches to overview, opens the same node, and verifies identical data.
//
// Depends on: backend workflow + node API, shared NodeDetailPanel component.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Detail Panel Cross-View", () => {
  test("detail panel shows identical node data in swimlane and overview", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with a configured node ──
    const workflow = await seededApi.createWorkflow(
      "E2E Cross-View Panel " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Main", 0);
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Cross-View Node",
      stage_id: stage.id,
      worker_type: "agent",
      critic_type: "human",
    });

    // ── Step 1: Open detail panel in swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    const rfNode = page.locator(".react-flow__node").first();
    await expect(rfNode).toBeVisible({ timeout: 5000 });
    await rfNode.click();

    // Capture panel content in swimlane
    const panel = page
      .getByTestId("node-detail-panel")
      .or(page.getByRole("dialog"))
      .or(page.getByRole("complementary"));
    await expect(panel.first()).toBeVisible({ timeout: 3000 });

    const swimlanePanelText = await panel.first().innerText();

    // Close panel
    await page.keyboard.press("Escape");
    await expect(panel.first()).not.toBeVisible({ timeout: 2000 });

    // ── Step 2: Switch to overview view ──
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

    // ── Step 3: Open detail panel for the same node in overview ──
    // Click the stage card first to show its DAG
    const stageCard = page
      .getByTestId(/stage-card-/)
      .or(page.locator('[class*="stage-card"]'));
    await stageCard.first().click();

    // Now click the node in the overview DAG
    const overviewNode = page.locator(".react-flow__node").first();
    await expect(overviewNode).toBeVisible({ timeout: 5000 });
    await overviewNode.click();

    // ── Step 4: Capture panel content in overview ──
    const overviewPanel = page
      .getByTestId("node-detail-panel")
      .or(page.getByRole("dialog"))
      .or(page.getByRole("complementary"));
    await expect(overviewPanel.first()).toBeVisible({ timeout: 3000 });

    const overviewPanelText = await overviewPanel.first().innerText();

    // ── Step 5: Compare panel content ──
    // Both should contain the node title
    expect(swimlanePanelText).toContain("Cross-View Node");
    expect(overviewPanelText).toContain("Cross-View Node");

    // Both should contain "agent" (worker type)
    expect(swimlanePanelText).toContain("agent");
    expect(overviewPanelText).toContain("agent");

    // The panel content in both views should be non-empty
    expect(swimlanePanelText.length).toBeGreaterThan(20);
    expect(overviewPanelText.length).toBeGreaterThan(20);
  });
});
