// E2E test: Detail panel opens on node click in swimlane view.
//
// Clicks a node in the swimlane canvas and verifies the detail panel
// slide-out drawer appears with correct sections.
//
// Depends on: backend workflow + node API, frontend swimlane canvas + NodeDetailPanel.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Detail Panel Open", () => {
  test("clicking a node opens detail panel with correct sections", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with configured node ──
    const workflow = await seededApi.createWorkflow(
      "E2E Detail Panel " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Main", 0);
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Configured Node",
      stage_id: stage.id,
      worker_type: "agent",
      critic_type: "human",
    });

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Click a node in the swimlane canvas ──
    const rfNode = page.locator(".react-flow__node").first();
    await expect(rfNode).toBeVisible({ timeout: 5000 });
    await rfNode.click();

    // ── Step 2: Verify detail panel opens ──
    const detailPanel = page
      .getByTestId("node-detail-panel")
      .or(page.getByRole("dialog"))
      .or(page.getByRole("complementary"));
    await expect(detailPanel.first()).toBeVisible({ timeout: 3000 });

    // ── Step 3: Verify panel shows node title ──
    await expect(detailPanel.first()).toContainText("Configured Node");

    // ── Step 4: Verify key sections are present ──
    // Worker section
    await expect(
      detailPanel.first().locator("text").filter({ hasText: /Worker/i }).first()
    ).toBeVisible({ timeout: 2000 });

    // Critic section
    await expect(
      detailPanel.first().locator("text").filter({ hasText: /Critic/i }).first()
    ).toBeVisible({ timeout: 2000 });

    // The panel should have configuration content
    const panelText = await detailPanel.first().innerText();
    expect(panelText.length).toBeGreaterThan(20);
  });
});
