import { test, expect } from "@playwright/test";
import { loginAsDefault, createTestApi } from "./helpers";
import type { TestApiClient } from "./fixtures";

test.describe("Issues", () => {
  let api: TestApiClient;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    api = await createTestApi();
    workspaceSlug = await loginAsDefault(page);
  });

  test.afterEach(async () => {
    if (api) {
      await api.cleanup();
    }
  });

  test("issues page loads with board view", async ({ page }) => {
    await api.createIssue("E2E Board View " + Date.now());
    await page.reload();

    // Board columns should be visible
    await expect(page.locator("text=Backlog")).toBeVisible();
    await expect(page.locator("text=Todo")).toBeVisible();
    await expect(page.locator("text=In Progress")).toBeVisible();
  });

  test("can switch from board to list view", async ({ page }) => {
    const title = "E2E List Switch " + Date.now();
    await api.createIssue(title);
    await page.reload();
    await expect(page.locator("text=Backlog")).toBeVisible();

    // Switch to list view
    await page.click("text=List");
    await expect(page.getByText(title)).toBeVisible();
  });

  test("can create a new issue", async ({ page }) => {
    const newIssueButton = page.getByRole("button", { name: "New Issue" });
    await expect(newIssueButton).toBeVisible();
    await newIssueButton.click();

    const title = "E2E Created " + Date.now();
    const titleInput = page.getByRole("textbox", { name: "Issue title" });
    await expect(titleInput).toBeVisible();
    await titleInput.fill(title);
    await page.getByRole("button", { name: "Create Issue" }).click();

    await expect(page.getByText("Issue created")).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("region", { name: /Notifications/ }).getByText(title),
    ).toBeVisible();

    await page.getByRole("button", { name: "View issue" }).click();
    await page.waitForURL(/\/issues\/[\w-]+/);
    await expect(page.locator("text=Properties")).toBeVisible();
  });

  test("can navigate to issue detail page", async ({ page }) => {
    // Create a known issue via API so the test controls its own fixture
    const issue = await api.createIssue("E2E Detail Test " + Date.now());

    // Reload to see the new issue
    await page.reload();

    // Navigate to the issue detail. Use a suffix match so the selector works
    // whether the href is legacy `/issues/{id}` or URL-refactored
    // `/{slug}/issues/{id}`.
    const issueLink = page.locator(`a[href$="/issues/${issue.id}"]`);
    await expect(issueLink).toBeVisible({ timeout: 5000 });
    await issueLink.click();

    await page.waitForURL(/\/issues\/[\w-]+/);

    // Should show Properties panel
    await expect(page.locator("text=Properties")).toBeVisible();
    // Should show breadcrumb link back to Issues
    await expect(
      page.locator("a", { hasText: "Issues" }).first(),
    ).toBeVisible();
  });

  test("can dismiss issue creation", async ({ page }) => {
    await page.getByRole("button", { name: "New Issue" }).click();

    const titleInput = page.getByRole("textbox", { name: "Issue title" });
    await expect(titleInput).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(titleInput).not.toBeVisible();
    await expect(page.getByRole("button", { name: "New Issue" })).toBeVisible();
  });

  test("dynamic split starts child issues with each draft workflow", async ({ page }) => {
    const {
      parentIssue,
      splitNode,
      implementationWorkflow,
      testWorkflow,
    } = await api.createDynamicSplitScenario({ draftCount: 3 });

    await page.goto(`/${workspaceSlug}/issues/${parentIssue.id}`);
    await expect(page.getByTestId("execution-panorama")).toBeVisible({ timeout: 10000 });

    await page.getByTestId(`runtime-node-card-${splitNode.id}`).click();
    await expect(page.getByText("Split review")).toBeVisible();

    const secondTaskWorkflow = page.getByLabel("Execution workflow for Child task 2");
    await secondTaskWorkflow.selectOption(testWorkflow.id);
    await expect(secondTaskWorkflow).toHaveValue(testWorkflow.id);

    await page.getByRole("button", { name: /confirm create 3/i }).click();
    await page.getByRole("button", { name: /^confirm create$/i }).click();

    await expect(page.getByTestId("split-node-status")).toHaveText("split_active", {
      timeout: 10000,
    });

    const children = await api.listChildIssues(parentIssue.id);
    expect(children).toHaveLength(3);
    expect(children.map((issue) => issue.workflow_id)).toEqual([
      implementationWorkflow.id,
      testWorkflow.id,
      implementationWorkflow.id,
    ]);

    const runs = await api.listWorkflowRunsForIssues(children.map((issue) => issue.id));
    expect(runs.map((run) => run.workflow_id)).toEqual([
      implementationWorkflow.id,
      testWorkflow.id,
      implementationWorkflow.id,
    ]);
  });
});
