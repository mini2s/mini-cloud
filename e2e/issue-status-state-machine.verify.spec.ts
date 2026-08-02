import { expect, test, type Locator, type Page } from "@playwright/test";
import { createTestApi } from "./helpers";
import type { TestApiClient } from "./fixtures";
import { createHmac, randomBytes } from "crypto";
import * as pg from "pg";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://multica:multica@localhost:5432/multica?sslmode=disable";

type IssueRecord = {
  id: string;
  title: string;
  status: string;
  assignee_type: string | null;
  assignee_id: string | null;
  workflow_id: string | null;
  workflow_run_id: string | null;
};

async function authedFetch(api: TestApiClient, path: string, init?: RequestInit) {
  const token = api.getToken();
  const workspaceSlug = api.getWorkspaceSlug();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (workspaceSlug) headers["X-Workspace-Slug"] = workspaceSlug;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

async function createProject(api: TestApiClient, title: string) {
  const res = await authedFetch(api, "/api/projects", {
    method: "POST",
    body: JSON.stringify({
      title,
      resources: [
        {
          resource_type: "github_repo",
          resource_ref: { url: `https://github.com/multica-ai/e2e-${Date.now()}.git` },
          label: "E2E repository",
        },
      ],
    }),
  });
  return (await res.json()) as { id: string; title: string };
}

async function getIssue(api: TestApiClient, id: string): Promise<IssueRecord> {
  const res = await authedFetch(api, `/api/issues/${id}`);
  return (await res.json()) as IssueRecord;
}

async function updateIssue(api: TestApiClient, id: string, body: Record<string, unknown>) {
  return authedFetch(api, `/api/issues/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

async function deleteProject(api: TestApiClient, id: string) {
  await authedFetch(api, `/api/projects/${id}`, { method: "DELETE" });
}

async function connectStartToNodeToEnd(api: TestApiClient, workflowId: string, nodeId: string) {
  const body = await api.listWorkflowNodes(workflowId);
  const nodes = Array.isArray(body) ? body : body.nodes ?? [];
  const start = nodes.find((node: { title?: string }) => node.title === "Start");
  const end = nodes.find((node: { title?: string }) => node.title === "End");
  if (!start?.id || !end?.id) {
    throw new Error("workflow boundary nodes not found");
  }
  await api.createWorkflowEdge(workflowId, start.id, nodeId);
  await api.createWorkflowEdge(workflowId, nodeId, end.id);
}

async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function workflowRunStatus(runId: string) {
  return withDb(async (client) => {
    const result = await client.query<{ status: string }>(
      "SELECT status FROM multica_workflow_run WHERE id = $1",
      [runId],
    );
    return result.rows[0]?.status ?? null;
  });
}

async function workflowNodeRunStatuses(runId: string) {
  return withDb(async (client) => {
    const result = await client.query<{ status: string; failure_reason: string | null }>(
      `
      SELECT status, failure_reason
      FROM multica_workflow_node_run
      WHERE workflow_run_id = $1
      ORDER BY created_at ASC
      `,
      [runId],
    );
    return result.rows;
  });
}

function makeCsrfToken(authToken: string) {
  const nonce = randomBytes(16);
  const sig = createHmac("sha256", authToken).update(nonce).digest("hex");
  return `${nonce.toString("hex")}.${sig}`;
}

function statusColumn(page: Page, title: string): Locator {
  const status = title === "Backlog" ? "backlog" : title === "Todo" ? "todo" : title;
  return page.getByTestId(`board-column-status:${status}`);
}

async function dragCardToColumn(page: Page, cardText: string, columnTitle: string) {
  const source = page.locator("[data-testid^='board-card-']", { hasText: cardText }).first();
  const targetColumn = statusColumn(page, columnTitle).getByTestId(`board-column-droppable-status:${columnTitle === "Backlog" ? "backlog" : "todo"}`);
  await expect(source).toBeVisible();
  await expect(targetColumn).toBeVisible();

  const sourceBox = await source.boundingBox();
  const targetBox = await targetColumn.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Could not resolve drag coordinates");

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 140, { steps: 12 });
  await page.mouse.up();
}

test.describe("Issue status state machine", () => {
  let api: TestApiClient;
  let projectId: string | null = null;

  test.beforeEach(async ({ page }) => {
    api = await createTestApi();
    const token = api.getToken();
    const workspaceSlug = api.getWorkspaceSlug();
    if (!token || !workspaceSlug) throw new Error("E2E login did not produce a token/workspace");
    await page.context().addCookies([
      {
        name: "multica_auth",
        value: token,
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "multica_csrf",
        value: makeCsrfToken(token),
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
        sameSite: "Lax",
      },
      {
        name: "multica_logged_in",
        value: "1",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
        sameSite: "Lax",
      },
    ]);
    await page.goto(`/${workspaceSlug}/issues`);
    await page.waitForURL(`**/${workspaceSlug}/issues`, { timeout: 10000 });
  });

  test.afterEach(async () => {
    if (projectId) {
      await deleteProject(api, projectId).catch(() => {});
      projectId = null;
    }
    await api.cleanup();
  });

  test("routes unassigned tasks to backlog and blocks unassigned UI moves", async ({ page }) => {
    const memberId = api.getUserId();
    if (!memberId) throw new Error("E2E user id was not captured");

    const project = await createProject(api, `E2E 状态机项目 ${Date.now()}`);
    projectId = project.id;

    const unassignedTitle = `E2E 未分配待规划 ${Date.now()}`;

    const unassigned = await api.createIssue(unassignedTitle, {
      project_id: project.id,
      responsible_user_id: memberId,
      allow_duplicate: true,
    }) as IssueRecord;

    expect(unassigned.status).toBe("backlog");

    await page.reload();
    await expect(statusColumn(page, "Backlog").getByText(unassignedTitle)).toBeVisible();

    await dragCardToColumn(page, unassignedTitle, "Todo");
    await expect(page.getByText("Please assign the task first.")).toBeVisible({ timeout: 10000 });

    const blockedMove = await getIssue(api, unassigned.id);
    expect(blockedMove.status).toBe("backlog");
    expect(blockedMove.assignee_type).toBeNull();
    expect(blockedMove.assignee_id).toBeNull();
  });

  test("enforces backlog and todo transitions through the container API", async () => {
    const memberId = api.getUserId();
    if (!memberId) throw new Error("E2E user id was not captured");

    const unassigned = await api.createIssue(`E2E API 未分配 ${Date.now()}`, {
      responsible_user_id: memberId,
      allow_duplicate: true,
    }) as IssueRecord;
    expect(unassigned.status).toBe("backlog");

    const blockedRes = await fetch(`${API_BASE}/api/issues/${unassigned.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${api.getToken()}`,
        "X-Workspace-Slug": api.getWorkspaceSlug()!,
      },
      body: JSON.stringify({ status: "todo" }),
    });
    expect(blockedRes.status).toBe(400);
    expect(await blockedRes.text()).toContain("please assign the task first");

    const assigned = await api.createIssue(`E2E API 已分配 ${Date.now()}`, {
      responsible_user_id: memberId,
      assignee_type: "member",
      assignee_id: memberId,
      allow_duplicate: true,
    }) as IssueRecord;
    expect(assigned.status).toBe("todo");

    await updateIssue(api, assigned.id, { status: "backlog" });
    const movedBack = await getIssue(api, assigned.id);
    expect(movedBack.status).toBe("backlog");
    expect(movedBack.assignee_type).toBeNull();
    expect(movedBack.assignee_id).toBeNull();
  });

  test("starts workflow execution only from in_progress and stops it on todo blocked and done", async () => {
    const memberId = api.getUserId();
    if (!memberId) throw new Error("E2E user id was not captured");

    const workflow = await api.createWorkflow(`E2E 状态机工作流 ${Date.now()}`);
    const node = await api.createWorkflowNode(workflow.id, {
      title: "人工交付",
      worker_type: "human",
      worker_id: memberId,
      critic_type: "human",
      critic_id: memberId,
      format_schema: {
        type: "object",
        properties: { summary: { type: "string" } },
      },
    });
    await connectStartToNodeToEnd(api, workflow.id, node.id);
    await api.updateWorkflow(workflow.id, { status: "active" });

    const issue = await api.createIssue(`E2E 工作流执行 ${Date.now()}`, {
      responsible_user_id: memberId,
      assignee_type: "workflow",
      assignee_id: workflow.id,
      allow_duplicate: true,
    }) as IssueRecord;
    expect(issue.status).toBe("todo");
    expect(issue.workflow_run_id).toBeNull();

    await updateIssue(api, issue.id, { status: "in_progress" });
    const running = await getIssue(api, issue.id);
    expect(running.status).toBe("in_progress");
    expect(running.workflow_run_id).toBeTruthy();

    const firstRunId = running.workflow_run_id!;
    expect(await workflowRunStatus(firstRunId)).toBe("running");

    await updateIssue(api, issue.id, { status: "todo" });
    const backToTodo = await getIssue(api, issue.id);
    expect(backToTodo.status).toBe("todo");
    expect(backToTodo.assignee_type).toBe("workflow");
    expect(backToTodo.assignee_id).toBe(workflow.id);
    expect(await workflowRunStatus(firstRunId)).toBe("cancelled");
    expect((await workflowNodeRunStatuses(firstRunId)).map((row) => row.status)).toEqual(["cancelled"]);

    await updateIssue(api, issue.id, { status: "in_progress" });
    const restarted = await getIssue(api, issue.id);
    expect(restarted.workflow_run_id).toBeTruthy();
    expect(restarted.workflow_run_id).not.toBe(firstRunId);

    const blockedRunId = restarted.workflow_run_id!;
    await updateIssue(api, issue.id, { status: "blocked" });
    expect(await workflowRunStatus(blockedRunId)).toBe("cancelled");
    const blockedNodes = await workflowNodeRunStatuses(blockedRunId);
    expect(blockedNodes).toHaveLength(1);
    expect(blockedNodes[0]).toMatchObject({
      status: "blocked",
      failure_reason: "manual_terminated",
    });

    await updateIssue(api, issue.id, { status: "in_progress" });
    const finalRun = await getIssue(api, issue.id);
    expect(finalRun.workflow_run_id).toBeTruthy();
    expect(finalRun.workflow_run_id).not.toBe(blockedRunId);

    const doneRunId = finalRun.workflow_run_id!;
    await updateIssue(api, issue.id, { status: "done" });
    expect(await workflowRunStatus(doneRunId)).toBe("completed");
    const doneNodes = await workflowNodeRunStatuses(doneRunId);
    expect(doneNodes).toHaveLength(1);
    expect(doneNodes[0]).toMatchObject({
      status: "completed",
      failure_reason: "manual_completed",
    });
  });
});
