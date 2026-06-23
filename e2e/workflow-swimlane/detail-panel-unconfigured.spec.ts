// E2E test: Detail panel shows unconfigured state gracefully.
//
// Seeds a bare node (no worker, no critic, no schema). Verifies the
// detail panel shows "Not configured" / "未配置" for each section.
//
// Depends on: backend workflow + node API, frontend NodeDetailPanel.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Detail Panel Unconfigured", () => {
  test("unconfigured node shows 'Not configured' placeholders", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with unconfigured node ──
    const workflow = await seededApi.createWorkflow(
      "E2E Detail Unconfigured " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Main", 0);
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Bare Node",
      stage_id: stage.id,
      worker_type: undefined as unknown as string,
      critic_type: undefined as unknown as string,
    });

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Click node to open detail panel ──
    const rfNode = page.locator(".react-flow__node").first();
    await expect(rfNode).toBeVisible({ timeout: 5000 });
    await rfNode.click();

    // ── Step 2: Verify detail panel opens ──
    const detailPanel = page
      .getByTestId("node-detail-panel")
      .or(page.getByRole("dialog"))
      .or(page.getByRole("complementary"));
    await expect(detailPanel.first()).toBeVisible({ timeout: 3000 });

    // ── Step 3: Verify "Not configured" or equivalent text ──
    // English: "Not configured", Chinese: "未配置"
    const notConfigured = detailPanel.first().locator("text").filter({
      hasText: /Not configured|未配置|not set|未设置/i,
    });
    // At least one "not configured" indicator should be present
    const count = await notConfigured.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // ── Step 4: Content should not be empty ──
    // Even unconfigured, the panel should render section headers
    const panelText = await detailPanel.first().innerText();
    expect(panelText.length).toBeGreaterThan(10);
  });
});
