// E2E test: Swimlane page shell structure.
//
// Verifies the three-zone layout of the swimlane page:
//   top header (workflow name + view toggle),
//   main canvas (ReactFlow + lane overlay),
//   no detail panel initially.
//
// Depends on: backend workflow API, frontend swimlane page.
// Expected to fail until the swimlane implementation is built.

import { test, expect } from "../seed-workflow-swimlane";

test.describe("Swimlane Page Shell", () => {
  test("swimlane page shows header, canvas, and no detail panel initially", async ({
    page,
    slug,
    seededApi,
  }) => {
    // ── Setup: create a workflow with stages and nodes ──
    const workflow = await seededApi.createWorkflow(
      "E2E Swimlane Shell " + Date.now(),
    );

    const stage = await seededApi.createWorkflowStage(workflow.id, "Design", 1);
    await seededApi.createWorkflowNode(workflow.id, {
      title: "Architecture",
      stage_id: stage.id,
    });

    // ── Step 1: Navigate directly to workflow detail ──
    await page.goto(`/${slug}/workflows/${workflow.id}`);
    await page.waitForURL(`/${slug}/workflows/${workflow.id}`);

    // ── Step 2: Verify header zone ──
    // PageHeader should show workflow name
    const heading = page.getByRole("heading").or(page.locator("h1"));
    await expect(heading.first()).toBeVisible({ timeout: 5000 });

    // View toggle should be visible
    const viewToggle = page
      .getByTestId("view-toggle")
      .or(page.getByRole("button", { name: /view|视图/i }));
    await expect(viewToggle.first()).toBeVisible({ timeout: 3000 });

    // ── Step 3: Verify canvas zone ──
    // ReactFlow container with lane overlay
    const reactFlow = page
      .getByTestId("swimlane-reactflow")
      .or(page.locator(".react-flow"));
    await expect(reactFlow.first()).toBeVisible({ timeout: 5000 });

    // Zoom controls present
    const controls = page
      .locator(".react-flow__controls")
      .or(page.getByTestId("rf-controls"));
    await expect(controls.first()).toBeVisible({ timeout: 3000 });

    // Lane overlay SVG present
    const laneOverlay = page
      .getByTestId("swimlane-overlay")
      .or(page.locator(".react-flow svg"));
    await expect(laneOverlay.first()).toBeVisible({ timeout: 3000 });

    // ── Step 4: Verify no detail panel is shown initially ──
    const detailPanel = page
      .getByTestId("node-detail-panel")
      .or(page.getByRole("dialog"))
      .or(page.getByRole("complementary"));
    await expect(detailPanel).not.toBeVisible();
  });
});
