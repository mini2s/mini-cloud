// E2E test: Detail panel can be closed via multiple methods.
//
// Tests close button (×), canvas background click, and Escape key.
//
// Depends on: backend workflow + node API, frontend NodeDetailPanel.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Detail Panel Close", () => {
  test("detail panel closes via close button, background click, and Escape", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with nodes ──
    const workflow = await seededApi.createWorkflow(
      "E2E Panel Close " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Main", 0);
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Node A",
      stage_id: stage.id,
    });
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Node B",
      stage_id: stage.id,
    });

    // ── Helper: open panel by clicking node ──
    async function openPanel() {
      await page.goto(`/${slug}/workflows/${workflow.id}`);
      await page.waitForURL(`/${slug}/workflows/${workflow.id}`);
      const node = page.locator(".react-flow__node").first();
      await expect(node).toBeVisible({ timeout: 5000 });
      await node.click();
    }

    async function getPanel() {
      return page
        .getByTestId("node-detail-panel")
        .or(page.getByRole("dialog"))
        .or(page.getByRole("complementary"));
    }

    // ── Test 1: Close via × button ──
    await openPanel();
    const panel = getPanel();
    await expect(panel.first()).toBeVisible({ timeout: 3000 });

    const closeBtn = page
      .getByTestId("node-detail-close")
      .or(page.getByRole("button", { name: /close|关闭/i }))
      .or(panel.first().locator("button").first());
    await closeBtn.first().click();

    await expect(panel.first()).not.toBeVisible({ timeout: 2000 });

    // ── Test 2: Close via canvas background click ──
    await openPanel();
    await expect(panel.first()).toBeVisible({ timeout: 3000 });

    // Click on the ReactFlow background (not on a node)
    const background = page
      .locator(".react-flow__background")
      .or(page.locator(".react-flow__pane"));
    await background.first().click({ position: { x: 50, y: 50 } });

    await expect(panel.first()).not.toBeVisible({ timeout: 2000 });

    // ── Test 3: Close via Escape key ──
    await openPanel();
    await expect(panel.first()).toBeVisible({ timeout: 3000 });

    await page.keyboard.press("Escape");

    await expect(panel.first()).not.toBeVisible({ timeout: 2000 });
  });
});
