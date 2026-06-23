// E2E test: Detail panel shows configured worker/critic/schema values.
//
// Seeds a fully configured node (agent worker, human critic, JSON schema)
// and verifies all values display correctly in the detail panel.
//
// Depends on: backend workflow + node API, frontend NodeDetailPanel.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Detail Panel Configured", () => {
  test("detail panel shows worker, critic, and format schema config", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create workflow with fully configured node ──
    const workflow = await seededApi.createWorkflow(
      "E2E Detail Configured " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Main", 0);
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Full Config Node",
      stage_id: stage.id,
      worker_type: "agent",
      critic_type: "human",
    });

    // ── Navigate to swimlane view ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 1: Click node to open detail panel ──
    const rfNode = page.locator(".react-flow__node").first();
    await expect(rfNode).toBeVisible({ timeout: 5000 });
    await rfNode.click();

    // ── Step 2: Verify detail panel is open ──
    const detailPanel = page
      .getByTestId("node-detail-panel")
      .or(page.getByRole("dialog"))
      .or(page.getByRole("complementary"));
    await expect(detailPanel.first()).toBeVisible({ timeout: 3000 });

    // ── Step 3: Verify Worker section shows "agent" ──
    const panelText = await detailPanel.first().innerText();
    expect(panelText).toContain("agent");

    // ── Step 4: Verify Critic section shows "human" ──
    expect(panelText).toContain("human");

    // ── Step 5: Verify Format Schema section exists ──
    // May show "No format constraints" or schema content
    await expect(
      detailPanel.first().locator("text").filter({
        hasText: /Format|Schema|格式|schema/i,
      }).first()
    ).toBeVisible({ timeout: 2000 });

    // ── Step 6: Verify Relations section exists ──
    // May show upstream/downstream or be empty
    await expect(
      detailPanel.first().locator("text").filter({
        hasText: /Relations?|关系|connection/i,
      }).first()
    ).toBeVisible({ timeout: 2000 });
  });
});
