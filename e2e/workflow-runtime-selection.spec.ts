import { expect, test, type Page } from "@playwright/test";

import { TestApiClient } from "./fixtures";
import { WorkflowRuntimeSelectionFixture } from "./fixtures/workflow-runtime-selection";
import { createTestApi, loginWithToken } from "./helpers";

const ARTIFACT_DIR = "artifacts/e2e/workflow-runtime-selection-20260722";

type Workflow = { id: string; title: string };
type Agent = { id: string; name: string };

let api: TestApiClient;
let fixture: WorkflowRuntimeSelectionFixture;

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  api = await createTestApi();
  fixture = new WorkflowRuntimeSelectionFixture(
    api,
    `${testInfo.title.replace(/[^a-zA-Z0-9]+/g, "-")}-${Date.now()}`,
  );
  await fixture.connect();
  await fixture.cleanupResiduals();
  await fixture.suspendExistingRuntimes();
});

test.afterEach(async () => {
  try {
    await fixture.cleanupTasks();
    await api.cleanup();
  } finally {
    await fixture.cleanupRuntimesAndRestore();
  }
});

function workflowPath(workflowId: string) {
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  return `${basePath}/${api.getWorkspaceSlug()}/workflows/${workflowId}`;
}

async function createWorkflowWithAgentRoots(agent: Agent, rootCount = 1): Promise<Workflow> {
  const workflow = await api.createWorkflow(`E2E runtime selection ${Date.now()}`);
  for (let index = 0; index < rootCount; index += 1) {
    await api.createWorkflowNode(workflow.id, {
      title: `Agent root ${index + 1}`,
      worker_type: "agent",
      worker_id: agent.id,
      critic_type: "human",
    });
  }
  await api.updateWorkflow(workflow.id, { status: "active" });
  return workflow;
}

async function createHumanWorkflow(): Promise<Workflow> {
  const workflow = await api.createWorkflow(`E2E runtime UI ${Date.now()}`);
  await api.createWorkflowNode(workflow.id, {
    title: "Human root",
    worker_type: "human",
    critic_type: "human",
  });
  await api.updateWorkflow(workflow.id, { status: "active" });
  return workflow;
}

async function authenticateAndOpen(page: Page, workflow: Workflow) {
  const token = api.getToken();
  const slug = api.getWorkspaceSlug();
  if (!token || !slug) throw new Error("E2E login did not produce token/workspace");
  await loginWithToken(page, token, slug, api.getCsrfToken());
  await page.goto(workflowPath(workflow.id));
  await expect(testRunButton(page)).toBeVisible({ timeout: 15_000 });
}

function testRunButton(page: Page) {
  return page
    .locator("button:has-text('Test run'), button:has-text('测试运行')")
    .first();
}

async function openRuntimeDialog(page: Page) {
  await testRunButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio").first()).toBeVisible();
  return dialog;
}

async function confirmRuntimeDialog(page: Page) {
  await page.getByRole("dialog").getByRole("button").last().click();
}

async function waitForAssignments(runId: string, count: number) {
  await expect
    .poll(async () => (await fixture.readAssignments(runId)).filter((row) => row.task_id).length, {
      timeout: 5_000,
    })
    .toBe(count);
  return fixture.readAssignments(runId);
}

test("UI-01/UI-04/UI-05/UI-09: zero runtime still shows Auto and close creates no run", async ({
  page,
}) => {
  const workflow = await createHumanWorkflow();
  await authenticateAndOpen(page, workflow);

  const dialog = await openRuntimeDialog(page);
  await expect(dialog.getByRole("radio")).toHaveCount(1);
  expect(await fixture.countWorkflowRuns(workflow.id)).toBe(0);

  await page.screenshot({ path: `${ARTIFACT_DIR}/ui/ui-zero-runtime.png`, fullPage: true });
  await dialog.getByRole("button").first().click();
  await expect(dialog).toBeHidden();
  expect(await fixture.countWorkflowRuns(workflow.id)).toBe(0);
});

test("UI-02/UI-03/UI-06/UI-07/UI-08: two devices are visible, offline is hidden, manual choice persists", async ({
  page,
}) => {
  const ownerId = api.getUserId();
  const runtime1 = await fixture.seedRuntime({ name: "E2E Device One", ownerId });
  const runtime2 = await fixture.seedRuntime({ name: "E2E Device Two", ownerId });
  await fixture.seedRuntime({ name: "E2E Offline Device", ownerId, status: "offline" });
  const workflow = await createHumanWorkflow();
  await authenticateAndOpen(page, workflow);

  const dialog = await openRuntimeDialog(page);
  await expect(dialog.getByRole("radio")).toHaveCount(3);
  await expect(dialog.getByText(runtime1.name, { exact: true })).toBeVisible();
  await expect(dialog.getByText(runtime2.name, { exact: true })).toBeVisible();
  await expect(dialog.getByText("E2E Offline Device", { exact: true })).toHaveCount(0);
  await dialog.getByText(runtime2.name, { exact: true }).click();

  const requestPromise = page.waitForRequest(
    (request) => request.method() === "POST" && /\/api\/workflows\/[^/]+\/runs$/.test(request.url()),
  );
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/api\/workflows\/[^/]+\/runs$/.test(response.url()),
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/ui/ui-two-device-runtime-selector.png`, fullPage: true });
  await confirmRuntimeDialog(page);

  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({ runtime_id: runtime2.id });
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const run = (await response.json()) as { id: string; runtime_id: string | null };
  expect(run.runtime_id).toBe(runtime2.id);
  const rows = await fixture.readAssignments(run.id);
  expect(rows[0]?.manual_runtime_id).toBe(runtime2.id);
});

test("API-01: malformed runtime_id returns 400 and creates no run", async () => {
  const workflow = await createHumanWorkflow();
  const response = await api.requestStartWorkflowRun(workflow.id, "not-a-uuid");
  expect(response.status).toBe(400);
  expect(await fixture.countWorkflowRuns(workflow.id)).toBe(0);
});

test("SEL-01: a valid manual runtime wins even when busy", async () => {
  const builtin = await fixture.getBuiltinAgent();
  const manual = await fixture.seedRuntime({ name: "E2E Manual Busy", ownerId: api.getUserId() });
  await fixture.seedRuntime({ name: "E2E Idle Alternative", ownerId: api.getUserId() });
  await fixture.seedActiveTask(builtin.id, manual.id);
  const workflow = await createWorkflowWithAgentRoots(builtin);

  const run = await api.startWorkflowRun(workflow.id, manual.id);
  const rows = await waitForAssignments(run.id, 1);
  expect(rows[0]).toMatchObject({
    actual_runtime_id: manual.id,
    task_runtime_id: manual.id,
    runtime_selection_reason: "manual",
  });
});

test("CON-01/CON-03: two parallel root nodes spread across two device runtimes", async () => {
  const builtin = await fixture.getBuiltinAgent();
  const runtime1 = await fixture.seedRuntime({ name: "E2E Parallel Device 1", ownerId: api.getUserId() });
  const runtime2 = await fixture.seedRuntime({ name: "E2E Parallel Device 2", ownerId: api.getUserId() });
  const workflow = await createWorkflowWithAgentRoots(builtin, 2);

  const run = await api.startWorkflowRun(workflow.id);
  const rows = await waitForAssignments(run.id, 2);
  expect(new Set(rows.map((row) => row.actual_runtime_id))).toEqual(new Set([runtime1.id, runtime2.id]));
  for (const row of rows) {
    expect(row.runtime_selection_reason).toBe("idle");
    expect(row.actual_runtime_id).toBe(row.task_runtime_id);
  }
});

test("SEL-05/SNAP-01: issue creator runtime is used only after all runtimes are busy", async () => {
  const builtin = await fixture.getBuiltinAgent();
  const creatorRuntime = await fixture.seedRuntime({
    name: "E2E Creator Device",
    ownerId: api.getUserId(),
  });
  const otherRuntime = await fixture.seedRuntime({ name: "E2E Other Busy Device", ownerId: null });
  await fixture.seedActiveTask(builtin.id, creatorRuntime.id);
  await fixture.seedActiveTask(builtin.id, otherRuntime.id);
  const workflow = await createWorkflowWithAgentRoots(builtin);

  const issue = await api.createIssue(`E2E creator fallback ${Date.now()}`, {
    assignee_type: "workflow",
    assignee_id: workflow.id,
    allow_duplicate: true,
  });
  expect(issue.workflow_run_id).toBeTruthy();
  const rows = await waitForAssignments(issue.workflow_run_id, 1);
  expect(rows[0]).toMatchObject({
    actual_runtime_id: creatorRuntime.id,
    task_runtime_id: creatorRuntime.id,
    runtime_selection_reason: "issue_creator",
    responsible_user_id: api.getUserId(),
  });
  expect(rows[0]?.source_issue_id).toBe(issue.id);
});

test("FAIL-01/SEL-08: direct run with only busy runtimes fails fast", async () => {
  const builtin = await fixture.getBuiltinAgent();
  const busy = await fixture.seedRuntime({ name: "E2E Busy Non-owner", ownerId: null });
  await fixture.seedActiveTask(builtin.id, busy.id);
  const workflow = await createWorkflowWithAgentRoots(builtin);

  const run = await api.startWorkflowRun(workflow.id);
  await expect
    .poll(async () => (await fixture.readAssignments(run.id))[0]?.run_status, { timeout: 5_000 })
    .toBe("failed");
  const rows = await fixture.readAssignments(run.id);
  expect(rows[0]).toMatchObject({
    run_status: "failed",
    node_status: "failed",
    failure_reason: "runtime_unavailable",
    actual_runtime_id: null,
    task_id: null,
  });
});

test("SEL-10/UI-10: a normal Agent keeps its bound runtime instead of migrating", async () => {
  const boundRuntime = await fixture.seedRuntime({ name: "E2E Bound Device", ownerId: api.getUserId() });
  await fixture.seedRuntime({ name: "E2E Idle Dynamic Device", ownerId: api.getUserId() });
  const agent = await api.createAgent({
    name: `E2E Bound Agent ${Date.now()}`,
    runtime_id: boundRuntime.id,
  });
  await fixture.setRuntimeState(boundRuntime.id, "offline");
  const workflow = await createWorkflowWithAgentRoots(agent);

  const run = await api.startWorkflowRun(workflow.id);
  const rows = await waitForAssignments(run.id, 1);
  expect(rows[0]).toMatchObject({
    actual_runtime_id: boundRuntime.id,
    task_runtime_id: boundRuntime.id,
    runtime_selection_reason: "agent_binding",
  });
});
