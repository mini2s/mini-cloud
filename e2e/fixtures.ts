/**
 * TestApiClient — lightweight API helper for E2E test data setup/teardown.
 *
 * Uses raw fetch so E2E tests have zero build-time coupling to the web app.
 */

import "./env";
import * as pg from "pg";

// `||` (not `??`) so an empty `NEXT_PUBLIC_API_URL=` in .env still falls
// back to localhost. dotenv sets unset-vs-empty both as "" — treating them
// the same matches user intent.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://multica:multica@localhost:5432/multica?sslmode=disable";

interface TestWorkspace {
  id: string;
  name: string;
  slug: string;
}

interface TestIssue {
  id: string;
  workspace_id: string;
  title: string;
  workflow_id: string | null;
  workflow_run_id: string | null;
}

interface TestWorkflow {
  id: string;
  title: string;
}

interface TestWorkflowNode {
  id: string;
  workflow_id: string;
  title: string;
}

interface TestWorkflowNodeRun {
  id: string;
  workflow_node_id: string;
  status: string;
}

interface TestWorkflowRun {
  id: string;
  workflow_id: string;
}

interface DynamicSplitScenario {
  parentIssue: TestIssue;
  parentWorkflow: TestWorkflow;
  splitNode: TestWorkflowNode;
  splitRun: TestWorkflowNodeRun;
  implementationWorkflow: TestWorkflow;
  testWorkflow: TestWorkflow;
}

export class TestApiClient {
  private static readonly DEFAULT_NODE_GRID_COLUMNS = 4;
  private static readonly DEFAULT_NODE_GRID_X_START = 120;
  private static readonly DEFAULT_NODE_GRID_Y_START = 80;
  private static readonly DEFAULT_NODE_GRID_X_GAP = 260;
  private static readonly DEFAULT_NODE_GRID_Y_GAP = 180;

  private token: string | null = null;
  private userId: string | null = null;
  private workspaceSlug: string | null = null;
  private workspaceId: string | null = null;
  private createdIssueIds: string[] = [];
  private createdWorkflowIds: string[] = [];
  private createdWorkflowStageIds: string[] = [];
  private createdAgentIds: string[] = [];
  private workflowNodeCounts = new Map<string, number>();

  async login(email: string, name: string) {
    const devCode = process.env.MULTICA_DEV_VERIFICATION_CODE;

    // When MULTICA_DEV_VERIFICATION_CODE is set, the backend uses a fixed
    // verification code and does not write to the verification_code table.
    if (devCode) {
      // With a fixed dev code, we can skip send-code entirely and
      // verify directly — avoids rate limiting on /auth/send-code.
      const verifyRes = await fetch(`${API_BASE}/auth/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: devCode }),
      });
      if (!verifyRes.ok) {
        throw new Error(`verify-code failed: ${verifyRes.status}`);
      }
      const data = await verifyRes.json();

      this.token = data.token;
      this.userId = data.user?.id ?? null;

      if (name && data.user?.name !== name) {
        await this.authedFetch("/api/me", {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
      }

      return data;
    }

    // Production path: use database-backed verification_code table
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      await client.query("DELETE FROM verification_code WHERE email = $1", [email]);

      const sendRes = await fetch(`${API_BASE}/auth/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!sendRes.ok) {
        throw new Error(`send-code failed: ${sendRes.status}`);
      }

      const result = await client.query(
        "SELECT code FROM verification_code WHERE email = $1 AND used = FALSE AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
        [email],
      );
      if (result.rows.length === 0) {
        throw new Error(`No verification code found for ${email}`);
      }

      const verifyRes = await fetch(`${API_BASE}/auth/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: result.rows[0].code }),
      });
      if (!verifyRes.ok) {
        throw new Error(`verify-code failed: ${verifyRes.status}`);
      }
      const data = await verifyRes.json();

      this.token = data.token;
      this.userId = data.user?.id ?? null;

      if (name && data.user?.name !== name) {
        await this.authedFetch("/api/me", {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
      }

      await client.query("DELETE FROM verification_code WHERE email = $1", [email]);

      return data;
    } finally {
      await client.end();
    }
  }

  async getWorkspaces(): Promise<TestWorkspace[]> {
    const res = await this.authedFetch("/api/workspaces");
    return res.json();
  }

  setWorkspaceId(id: string) {
    this.workspaceId = id;
  }

  setWorkspaceSlug(slug: string) {
    this.workspaceSlug = slug;
  }

  async ensureWorkspace(name = "E2E Workspace", slug = "e2e-workspace") {
    const workspaces = await this.getWorkspaces();
    const workspace = workspaces.find((item) => item.slug === slug) ?? workspaces[0];
    if (workspace) {
      this.workspaceId = workspace.id;
      this.workspaceSlug = workspace.slug;
      return workspace;
    }

    const res = await this.authedFetch("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name, slug }),
    });
    if (res.ok) {
      const created = (await res.json()) as TestWorkspace;
      this.workspaceId = created.id;
      return created;
    }

    const refreshed = await this.getWorkspaces();
    const created = refreshed.find((item) => item.slug === slug) ?? refreshed[0];
    if (created) {
      this.workspaceId = created.id;
      return created;
    }

    throw new Error(`Failed to ensure workspace ${slug}: ${res.status} ${res.statusText}`);
  }

  async createIssue(title: string, opts?: Record<string, unknown>) {
    const res = await this.authedFetch("/api/issues", {
      method: "POST",
      body: JSON.stringify({ title, ...opts }),
    });
    const issue = await res.json();
    this.createdIssueIds.push(issue.id);
    return issue;
  }

  async createDynamicSplitScenario(opts: { draftCount?: number } = {}): Promise<DynamicSplitScenario> {
    if (!this.workspaceId) {
      await this.ensureWorkspace();
    }
    const draftCount = opts.draftCount ?? 3;
    const suffix = Date.now();
    const implementationWorkflow = await this.createWorkflow(`E2E implementation ${suffix}`);
    await this.createWorkflowNode(implementationWorkflow.id, {
      title: "Implement",
      worker_type: "human",
      critic_type: "human",
      format_schema: {
        type: "object",
        properties: { summary: { type: "string" } },
      },
    });
    await this.updateWorkflow(implementationWorkflow.id, { status: "active" });

    const testWorkflow = await this.createWorkflow(`E2E test ${suffix}`);
    await this.createWorkflowNode(testWorkflow.id, {
      title: "Test",
      worker_type: "human",
      critic_type: "human",
      format_schema: {
        type: "object",
        properties: { result: { type: "string" } },
      },
    });
    await this.updateWorkflow(testWorkflow.id, { status: "active" });

    const parentWorkflow = await this.createWorkflow(`E2E dynamic split ${suffix}`);
    const reviewerId = await this.currentMemberUserId();
    const splitNode = await this.createWorkflowNode(parentWorkflow.id, {
      title: "Split work",
      worker_type: "human",
      worker_id: reviewerId,
      critic_type: "human",
      critic_id: reviewerId,
      format_schema: {
        type: "split",
        split_config: {
          default_issue_workflow_id: implementationWorkflow.id,
          mode: "barrier",
          max_concurrency: 5,
          max_failures: 0,
        },
      },
    });
    await this.updateWorkflow(parentWorkflow.id, { status: "active" });

    const parentIssue = await this.createIssue(`E2E dynamic split parent ${suffix}`, {
      assignee_type: "workflow",
      assignee_id: parentWorkflow.id,
      allow_duplicate: true,
    }) as TestIssue;
    if (!parentIssue.workflow_run_id) {
      throw new Error("dynamic split parent issue did not start a workflow run");
    }

    const nodeRuns = await this.listWorkflowNodeRuns(parentWorkflow.id, parentIssue.workflow_run_id);
    const splitRun = nodeRuns.find((nodeRun) => nodeRun.workflow_node_id === splitNode.id);
    if (!splitRun) {
      throw new Error("dynamic split workflow did not create a split node run");
    }

    await this.seedSplitReviewDrafts({
      splitNodeRunId: splitRun.id,
      workflowId: implementationWorkflow.id,
      draftCount,
    });

    return {
      parentIssue,
      parentWorkflow,
      splitNode,
      splitRun: { ...splitRun, status: "awaiting_split_review" },
      implementationWorkflow,
      testWorkflow,
    };
  }

  async createWorkflow(title: string) {
    const res = await this.authedFetch("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    const workflow = await res.json();
    this.createdWorkflowIds.push(workflow.id);
    this.workflowNodeCounts.set(workflow.id, 0);
    return workflow;
  }

  async updateWorkflow(id: string, data: Record<string, unknown>) {
    const res = await this.authedFetch(`/api/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`update workflow failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async listWorkflows(workspaceId?: string) {
    const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
    const res = await this.authedFetch(`/api/workflows${query}`);
    return res.json();
  }

  async getWorkflow(id: string) {
    const res = await this.authedFetch(`/api/workflows/${id}`);
    return res.json();
  }

  async listWorkflowNodes(workflowId: string) {
    const res = await this.authedFetch(`/api/workflows/${workflowId}/nodes`);
    return res.json();
  }

  async listWorkflowNodeRuns(workflowId: string, runId: string): Promise<TestWorkflowNodeRun[]> {
    const res = await this.authedFetch(`/api/workflows/${workflowId}/runs/${runId}/node-runs`);
    const body = await res.json();
    return body.node_runs ?? [];
  }

  async listWorkflowEdges(workflowId: string) {
    const res = await this.authedFetch(`/api/workflows/${workflowId}/edges`);
    return res.json();
  }

  async createWorkflowStage(workflowId: string, name: string, sortOrder: number) {
    const res = await this.authedFetch(`/api/workflows/${workflowId}/stages`, {
      method: "POST",
      body: JSON.stringify({ name, sort_order: sortOrder }),
    });
    const stage = await res.json();
    this.createdWorkflowStageIds.push(stage.id);
    return stage;
  }

  async createWorkflowNode(workflowId: string, data: {
    title: string;
    description?: string;
    position_x?: number;
    position_y?: number;
    worker_type?: string;
    worker_id?: string | null;
    critic_type?: string;
    critic_id?: string | null;
    stage_id?: string | null;
    format_schema?: unknown;
    critic_api_url?: string | null;
  }) {
    const defaultPosition = this.getDefaultNodePosition(workflowId);
    const body: Record<string, unknown> = {
      title: data.title,
      description: data.description ?? "",
      position_x: data.position_x ?? defaultPosition.x,
      position_y: data.position_y ?? defaultPosition.y,
      worker_type: data.worker_type ?? "agent",
      critic_type: data.critic_type ?? "human",
    };
    if (data.worker_id !== undefined) body.worker_id = data.worker_id;
    if (data.critic_id !== undefined) body.critic_id = data.critic_id;
    if (data.format_schema !== undefined) body.format_schema = data.format_schema;
    if (data.critic_api_url !== undefined) body.critic_api_url = data.critic_api_url;

    const res = await this.authedFetch(`/api/workflows/${workflowId}/nodes`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const node = await res.json();
    this.incrementWorkflowNodeCount(workflowId);

    // If stage_id is provided, assign the node to the stage
    if (data.stage_id !== undefined) {
      await this.assignNodeToStage(workflowId, node.id, data.stage_id);
    }

    return node;
  }

  async createWorkflowEdge(
    workflowId: string,
    sourceNodeId: string,
    targetNodeId: string
  ) {
    const res = await this.authedFetch(
      `/api/workflows/${workflowId}/edges`,
      {
        method: "POST",
        body: JSON.stringify({
          source_node_id: sourceNodeId,
          target_node_id: targetNodeId,
        }),
      }
    );
    if (!res.ok) {
      throw new Error(`create workflow edge failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async assignNodeToStage(workflowId: string, nodeId: string, stageId: string | null) {
    const res = await this.authedFetch(`/api/workflows/${workflowId}/nodes/${nodeId}/stage`, {
      method: "PUT",
      body: JSON.stringify({ stage_id: stageId }),
    });
    return res.json();
  }

  async listChildIssues(parentIssueId: string): Promise<TestIssue[]> {
    const res = await this.authedFetch(`/api/issues/${parentIssueId}/children`);
    return res.json();
  }

  async listWorkflowRunsForIssues(issueIds: string[]): Promise<TestWorkflowRun[]> {
    if (issueIds.length === 0) return [];
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      const result = await client.query(
        `
        SELECT wr.id, wr.workflow_id
        FROM multica_issue i
        JOIN multica_workflow_run wr ON wr.id = i.workflow_run_id
        WHERE i.id = ANY($1::uuid[])
        ORDER BY i.position ASC, i.created_at DESC
        `,
        [issueIds],
      );
      return result.rows.map((row) => ({
        id: row.id,
        workflow_id: row.workflow_id,
      }));
    } finally {
      await client.end();
    }
  }

  // ── Agent / Runtime / Plugin methods ──

  async listRuntimes(params?: { owner?: string }) {
    const query = new URLSearchParams();
    if (params?.owner) query.set("owner", params.owner);
    const qs = query.toString();
    const res = await this.authedFetch(`/api/runtimes${qs ? `?${qs}` : ""}`);
    return res.json();
  }

  async createAgent(data: {
    name: string;
    description?: string;
    instructions?: string;
    runtime_id: string;
    runtime_mode?: string;
    visibility?: string;
    model?: string;
    thinking_level?: string;
    max_concurrent_tasks?: number;
    plugin_id?: string;
  }) {
    const res = await this.authedFetch("/api/agents", {
      method: "POST",
      body: JSON.stringify(data),
    });
    const agent = await res.json();
    this.createdAgentIds.push(agent.id);
    return agent;
  }

  async deleteAgent(id: string) {
    await this.authedFetch(`/api/agents/${id}`, { method: "DELETE" });
  }

  async getAgent(id: string) {
    const res = await this.authedFetch(`/api/agents/${id}`);
    return res.json();
  }

  async listAgents(params?: { include_archived?: boolean }) {
    const query = new URLSearchParams();
    if (params?.include_archived) query.set("include_archived", "true");
    const qs = query.toString();
    const res = await this.authedFetch(`/api/agents${qs ? `?${qs}` : ""}`);
    return res.json();
  }

  async listBuiltinPlugins() {
    const res = await this.authedFetch("/api/plugins/builtin");
    return res.json();
  }

  // ── Workflow node update (for setting worker_id on existing nodes) ──

  async updateWorkflowNode(workflowId: string, nodeId: string, data: {
    title?: string;
    description?: string;
    worker_type?: string;
    worker_id?: string | null;
    critic_type?: string;
    critic_id?: string | null;
    stage_id?: string | null;
    format_schema?: unknown;
    position_x?: number;
    position_y?: number;
  }) {
    const res = await this.authedFetch(`/api/workflows/${workflowId}/nodes/${nodeId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async deleteIssue(id: string) {
    await this.authedFetch(`/api/issues/${id}`, { method: "DELETE" });
  }

  // ── Cleanup helpers ──

  async deleteWorkflow(id: string) {
    await this.authedFetch(`/api/workflows/${id}`, { method: "DELETE" });
  }

  /** Clean up all issues, workflows, agents created during this test.
   *  Workflow cascade deletion handles associated stages and nodes. */
  async cleanup() {
    for (const id of this.createdWorkflowIds) {
      try {
        await this.deleteWorkflow(id);
      } catch {
        /* ignore — may already be deleted */
      }
    }
    this.createdWorkflowIds = [];
    this.createdWorkflowStageIds = [];
    this.workflowNodeCounts.clear();

    for (const id of this.createdAgentIds) {
      try {
        await this.deleteAgent(id);
      } catch {
        /* ignore — may already be deleted */
      }
    }
    this.createdAgentIds = [];

    for (const id of this.createdIssueIds) {
      try {
        await this.deleteIssue(id);
      } catch {
        /* ignore — may already be deleted */
      }
    }
    this.createdIssueIds = [];
  }

  getToken() {
    return this.token;
  }

  private async authedFetch(path: string, init?: RequestInit) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (this.workspaceSlug) headers["X-Workspace-Slug"] = this.workspaceSlug;
    else if (this.workspaceId) headers["X-Workspace-ID"] = this.workspaceId;
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  }

  private getDefaultNodePosition(workflowId: string) {
    const index = this.workflowNodeCounts.get(workflowId) ?? 0;
    const column = index % TestApiClient.DEFAULT_NODE_GRID_COLUMNS;
    const row = Math.floor(index / TestApiClient.DEFAULT_NODE_GRID_COLUMNS);
    return {
      x: TestApiClient.DEFAULT_NODE_GRID_X_START + column * TestApiClient.DEFAULT_NODE_GRID_X_GAP,
      y: TestApiClient.DEFAULT_NODE_GRID_Y_START + row * TestApiClient.DEFAULT_NODE_GRID_Y_GAP,
    };
  }

  private incrementWorkflowNodeCount(workflowId: string) {
    const nextCount = (this.workflowNodeCounts.get(workflowId) ?? 0) + 1;
    this.workflowNodeCounts.set(workflowId, nextCount);
  }

  private async seedSplitReviewDrafts({
    splitNodeRunId,
    workflowId,
    draftCount,
  }: {
    splitNodeRunId: string;
    workflowId: string;
    draftCount: number;
  }) {
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      await client.query("BEGIN");
      const nodeRun = await client.query<{ workspace_id: string }>(
        `
        SELECT wr.workspace_id
        FROM multica_workflow_node_run wnr
        JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
        WHERE wnr.id = $1
        `,
        [splitNodeRunId],
      );
      const workspaceId = nodeRun.rows[0]?.workspace_id;
      if (!workspaceId) {
        throw new Error(`split node run not found: ${splitNodeRunId}`);
      }

      await client.query(
        `
        UPDATE multica_workflow_node_run
        SET status = 'awaiting_split_review',
            worker_output = NULL,
            critic_output = NULL,
            updated_at = now()
        WHERE id = $1
        `,
        [splitNodeRunId],
      );
      await client.query(
        "DELETE FROM multica_agent_task_queue WHERE workflow_node_run_id = $1",
        [splitNodeRunId],
      );
      await client.query(
        "DELETE FROM multica_workflow_split_task WHERE node_run_id = $1",
        [splitNodeRunId],
      );

      for (let index = 0; index < draftCount; index += 1) {
        await client.query(
          `
          INSERT INTO multica_workflow_split_task (
            node_run_id, workspace_id, draft_key, title, description,
            workflow_id, depends_on, sort_order, status, draft_source
          )
          VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, $7, 'draft', 'agent')
          `,
          [
            splitNodeRunId,
            workspaceId,
            `child-${index + 1}`,
            `Child task ${index + 1}`,
            `Child task ${index + 1} description`,
            workflowId,
            index,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
    }
  }

  private async currentMemberUserId(): Promise<string> {
    if (this.userId) return this.userId;
    if (!this.workspaceId) {
      await this.ensureWorkspace();
    }
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      const result = await client.query<{ user_id: string }>(
        `
        SELECT m.user_id
        FROM multica_member m
        JOIN multica_user u ON u.id = m.user_id
        WHERE m.workspace_id = $1
        ORDER BY m.created_at ASC
        LIMIT 1
        `,
        [this.workspaceId],
      );
      const userId = result.rows[0]?.user_id;
      if (!userId) {
        throw new Error("workspace member not found for dynamic split scenario");
      }
      this.userId = userId;
      return userId;
    } finally {
      await client.end();
    }
  }
}
