import { expect, test } from "@playwright/test";
import * as pg from "pg";
import { randomUUID } from "crypto";
import { TestApiClient } from "./fixtures";
import { loginWithToken } from "./helpers";

type AuthedUser = {
  api: TestApiClient;
  token: string;
  userId: string;
};

type InboxItem = {
  id: string;
  type: string;
  title: string;
  issue_id: string | null;
};

type WorkflowNodeRun = {
  id: string;
  node_title: string;
  status: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://multica:multica@localhost:5432/multica?sslmode=disable";

test.describe("notification matrix", () => {
  const workspaceSlug = `notify-e2e-${Date.now()}`;
  const createdIssueIds: string[] = [];
  const createdWorkflowIds: string[] = [];
  let client: pg.Client;
  let workspaceId: string;
  let owner: AuthedUser;
  let actor: AuthedUser;
  let responsible: AuthedUser;
  let assignee: AuthedUser;
  let workflowWorker: AuthedUser;
  let workflowReviewer: AuthedUser;
  let subscriber: AuthedUser;
  let mentioned: AuthedUser;
  let uiResponsible: AuthedUser;

  test.beforeAll(async () => {
    client = new pg.Client(DATABASE_URL);
    await client.connect();

    owner = await login(`notify-owner-${randomUUID()}@multica.ai`, "Notify Owner");
    actor = await login(`notify-actor-${randomUUID()}@multica.ai`, "Notify Actor");
    responsible = await login(`notify-responsible-${randomUUID()}@multica.ai`, "Notify Responsible");
    assignee = await login(`notify-assignee-${randomUUID()}@multica.ai`, "Notify Assignee");
    workflowWorker = await login(`notify-worker-${randomUUID()}@multica.ai`, "Notify Worker");
    workflowReviewer = await login(`notify-reviewer-${randomUUID()}@multica.ai`, "Notify Reviewer");
    subscriber = await login(`notify-subscriber-${randomUUID()}@multica.ai`, "Notify Subscriber");
    mentioned = await login(`notify-mentioned-${randomUUID()}@multica.ai`, "Notify Mentioned");
    uiResponsible = await login(`notify-ui-responsible-${randomUUID()}@multica.ai`, "Notify UI Responsible");

    const workspace = await owner.api.ensureWorkspace("Notification E2E", workspaceSlug);
    workspaceId = workspace.id;

    await addMember(actor.userId, "admin");
    await addMember(responsible.userId, "member");
    await addMember(assignee.userId, "member");
    await addMember(workflowWorker.userId, "member");
    await addMember(workflowReviewer.userId, "member");
    await addMember(subscriber.userId, "member");
    await addMember(mentioned.userId, "member");
    await addMember(uiResponsible.userId, "member");
  });

  test.afterAll(async () => {
    for (const id of createdIssueIds.reverse()) {
      await request(owner, `/api/issues/${id}`, { method: "DELETE" }).catch(() => undefined);
    }
    for (const id of createdWorkflowIds.reverse()) {
      await request(owner, `/api/workflows/${id}`, { method: "DELETE" }).catch(() => undefined);
    }
    if (client) {
      await client.query("DELETE FROM multica_workspace WHERE slug = $1", [workspaceSlug]).catch(() => undefined);
      await client.end();
    }
  });

  test("delivers issue, workflow, subscription, mention, and preference-controlled notifications", async () => {
    const assignmentIssue = await createIssue(actor, {
      title: `Notification assignment ${Date.now()}`,
      responsible_user_id: responsible.userId,
      assignee_type: "member",
      assignee_id: assignee.userId,
      allow_duplicate: true,
    });

    await expectInbox(responsible, "responsible_assigned", assignmentIssue.id);
    await expectInbox(assignee, "issue_assigned", assignmentIssue.id);

    await updateIssue(actor, assignmentIssue.id, { status: "in_progress" });
    await expectInbox(responsible, "status_changed", assignmentIssue.id);
    await expectInbox(assignee, "status_changed", assignmentIssue.id);

    await request(subscriber, `/api/issues/${assignmentIssue.id}/subscribe`, { method: "POST", body: JSON.stringify({}) });
    await updateIssue(actor, assignmentIssue.id, { status: "blocked" });
    await expectInbox(subscriber, "status_changed", assignmentIssue.id);

    await request(actor, `/api/issues/${assignmentIssue.id}/comments`, {
      method: "POST",
      body: JSON.stringify({
        content: `Please review [@Mentioned](mention://member/${mentioned.userId})`,
      }),
    });
    await expectInbox(mentioned, "mentioned", assignmentIssue.id);

    const mutedIssue = await createIssue(actor, {
      title: `Notification muted assignment ${Date.now()}`,
      responsible_user_id: responsible.userId,
      assignee_type: "member",
      assignee_id: assignee.userId,
      allow_duplicate: true,
    }, { preferences: { assignments: "muted" }, user: responsible });
    await expectNoInbox(responsible, "responsible_assigned", mutedIssue.id);

    const workflow = await createWorkflowWithHumanNode();
    const workflowIssue = await createIssue(actor, {
      title: `Notification workflow ${Date.now()}`,
      responsible_user_id: responsible.userId,
      assignee_type: "workflow",
      assignee_id: workflow.id,
      allow_duplicate: true,
    });

    const startedWorkflowIssue = await updateIssue(actor, workflowIssue.id, { status: "in_progress" });
    await expectInbox(workflowWorker, "workflow_executor_assigned", workflowIssue.id);
    if (!startedWorkflowIssue.workflow_run_id) {
      throw new Error("workflow issue did not start a workflow run");
    }
    const nodeRun = await expectWorkflowNodeRun(workflow.id, startedWorkflowIssue.workflow_run_id, "Human notification node");
    await request(workflowWorker, `/api/node-runs/${nodeRun.id}/submit`, {
      method: "POST",
      body: JSON.stringify({ output: { summary: "ready for review" } }),
    });
    await expectInbox(workflowReviewer, "workflow_reviewer_assigned", workflowIssue.id);
    await updateIssue(actor, workflowIssue.id, { status: "blocked" });
    await expectWorkflowStatusNotification(workflowWorker);
    await expectWorkflowStatusNotification(workflowReviewer);
  });

  test("renders new notification types in the browser inbox", async ({ page }) => {
    const issue = await createIssue(actor, {
      title: `Notification inbox UI ${Date.now()}`,
      responsible_user_id: uiResponsible.userId,
      allow_duplicate: true,
    });
    await expectInbox(uiResponsible, "responsible_assigned", issue.id);

    if (!uiResponsible.token) throw new Error("ui responsible token missing");
    await loginWithToken(page, uiResponsible.token, workspaceSlug);
    await page.goto(`/${workspaceSlug}/inbox`);
    await page.waitForURL(`**/${workspaceSlug}/inbox`);

    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByText(issue.title)).toBeVisible();
    await expect(page.getByText("Responsible assigned")).toBeVisible();
    await expect(page.getByText("responsible_assigned")).toHaveCount(0);
  });

  test("shows workflow notification preference groups in settings", async ({ page }) => {
    if (!uiResponsible.token) throw new Error("ui responsible token missing");
    await loginWithToken(page, uiResponsible.token, workspaceSlug);
    await page.goto(`/${workspaceSlug}/settings?tab=notifications`);
    await page.waitForURL(`**/${workspaceSlug}/settings?tab=notifications`);

    await expect(page.getByRole("heading", { name: "Inbox Notifications" })).toBeVisible();
    await expect(page.getByText("Assignments")).toBeVisible();
    await expect(page.getByText("Workflow roles")).toBeVisible();
    await expect(page.getByText("Workflow node status")).toBeVisible();
    await expect(page.getByText("Status changes")).toBeVisible();
  });

  async function login(email: string, name: string): Promise<AuthedUser> {
    const api = new TestApiClient();
    await api.login(email, name);
    const token = api.getToken();
    const userId = api.getUserId();
    if (!token || !userId) throw new Error(`login failed for ${email}`);
    return { api, token, userId };
  }

  async function addMember(userId: string, role: string) {
    const result = await client.query<{ id: string }>(
      `
      INSERT INTO multica_member (workspace_id, user_id, role, status)
      VALUES ($1, $2, $3, 'active')
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'
      RETURNING id
      `,
      [workspaceId, userId, role],
    );
    return result.rows[0].id;
  }

  async function request(user: AuthedUser, path: string, init: RequestInit = {}) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.token}`,
      "X-Workspace-ID": workspaceId,
      ...((init.headers as Record<string, string>) ?? {}),
    };
    const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
    if (!response.ok) {
      throw new Error(`${init.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`);
    }
    return response;
  }

  async function createIssue(user: AuthedUser, body: Record<string, unknown>, options?: {
    preferences?: Record<string, string>;
    user?: AuthedUser;
  }) {
    if (options?.preferences && options.user) {
      await request(options.user, "/api/notification-preferences", {
        method: "PUT",
        body: JSON.stringify({ preferences: options.preferences }),
      });
    }
    const response = await request(user, "/api/issues", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const issue = await response.json();
    createdIssueIds.push(issue.id);
    return issue;
  }

  async function updateIssue(user: AuthedUser, issueId: string, body: Record<string, unknown>) {
    const response = await request(user, `/api/issues/${issueId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return response.json();
  }

  async function listWorkflowNodeRuns(workflowId: string, runId: string): Promise<WorkflowNodeRun[]> {
    const response = await request(actor, `/api/workflows/${workflowId}/runs/${runId}/node-runs`);
    const body = await response.json();
    return body.node_runs ?? [];
  }

  async function expectWorkflowNodeRun(workflowId: string, runId: string, nodeTitle: string): Promise<WorkflowNodeRun> {
    let matched: WorkflowNodeRun | undefined;
    await expect.poll(async () => {
      const nodeRuns = await listWorkflowNodeRuns(workflowId, runId);
      matched = nodeRuns.find((item) => item.node_title === nodeTitle);
      return matched?.status === "worker_assigned" || matched?.status === "working";
    }, { timeout: 10_000 }).toBe(true);
    if (!matched) throw new Error(`workflow node run not found: ${nodeTitle}`);
    return matched;
  }

  async function listInbox(user: AuthedUser): Promise<InboxItem[]> {
    const response = await request(user, "/api/inbox");
    return response.json();
  }

  async function expectInbox(user: AuthedUser, type: string, issueId: string) {
    await expect.poll(async () => {
      const items = await listInbox(user);
      return items.some((item) => item.type === type && item.issue_id === issueId);
    }, { timeout: 10_000 }).toBe(true);
  }

  async function expectNoInbox(user: AuthedUser, type: string, issueId: string) {
    await expect.poll(async () => {
      const items = await listInbox(user);
      return items.some((item) => item.type === type && item.issue_id === issueId);
    }, { timeout: 2_000 }).toBe(false);
  }

  async function createWorkflowWithHumanNode() {
    const workflowRes = await request(actor, "/api/workflows", {
      method: "POST",
      body: JSON.stringify({ title: `Notification workflow ${Date.now()}` }),
    });
    const workflow = await workflowRes.json();
    createdWorkflowIds.push(workflow.id);

    const existingNodesRes = await request(actor, `/api/workflows/${workflow.id}/nodes`);
    const existingNodes = (await existingNodesRes.json()).nodes as Array<{ id: string; title: string; format_schema?: unknown }>;
    const start = existingNodes.find((item) => item.title === "Start");
    const end = existingNodes.find((item) => item.title === "End");
    if (!start || !end) {
      throw new Error("new workflow did not include boundary Start/End nodes");
    }
    const node = await createWorkflowNode(workflow.id, {
      title: "Human notification node",
      worker_type: "human",
      worker_id: workflowWorker.userId,
      critic_type: "human",
      critic_id: workflowReviewer.userId,
      format_schema: { type: "object", properties: { summary: { type: "string" } } },
    });
    await createWorkflowEdge(workflow.id, start.id, node.id);
    await createWorkflowEdge(workflow.id, node.id, end.id);
    await request(actor, `/api/workflows/${workflow.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "active" }),
    });
    return workflow;
  }

  async function createWorkflowNode(workflowId: string, body: Record<string, unknown>) {
    const response = await request(actor, `/api/workflows/${workflowId}/nodes`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return response.json();
  }

  async function createWorkflowEdge(workflowId: string, sourceNodeId: string, targetNodeId: string) {
    await request(actor, `/api/workflows/${workflowId}/edges`, {
      method: "POST",
      body: JSON.stringify({ source_node_id: sourceNodeId, target_node_id: targetNodeId }),
    });
  }

  async function expectWorkflowStatusNotification(user: AuthedUser) {
    await expect.poll(async () => {
      const items = await listInbox(user);
      return items.some((item) => item.type === "workflow_node_status_changed");
    }, { timeout: 10_000 }).toBe(true);
  }
});
