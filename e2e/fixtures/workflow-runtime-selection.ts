import { randomUUID } from "node:crypto";
import * as pg from "pg";

import "../env";
import type { TestApiClient } from "../fixtures";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://multica:multica@localhost:5432/multica?sslmode=disable";

export interface SeedRuntimeOptions {
  name: string;
  ownerId?: string | null;
  status?: "online" | "offline";
  visibility?: "private" | "public";
  lastSeenSecondsAgo?: number;
}

export interface RuntimeAssignmentRow {
  run_id: string;
  run_status: string;
  manual_runtime_id: string | null;
  source_issue_id: string | null;
  responsible_user_id: string | null;
  node_run_id: string;
  node_status: string;
  actual_runtime_id: string | null;
  runtime_selection_reason: string | null;
  failure_reason: string | null;
  task_id: string | null;
  task_runtime_id: string | null;
  task_status: string | null;
}

interface SuspendedRuntime {
  id: string;
  status: "online" | "offline";
  last_seen_at: Date | null;
}

/**
 * Database-backed fixture for states that the public API cannot create
 * deterministically (runtime heartbeat, visibility, and active load).
 * Workflows and tasks under test still enter through public HTTP APIs.
 */
export class WorkflowRuntimeSelectionFixture {
  private readonly client = new pg.Client(DATABASE_URL);
  private readonly runtimeIds: string[] = [];
  private readonly taskIds: string[] = [];
  private suspendedRuntimes: SuspendedRuntime[] = [];

  constructor(
    private readonly api: TestApiClient,
    private readonly caseId: string,
  ) {}

  async connect() {
    await this.client.connect();
  }

  async cleanupResiduals() {
    const marker = JSON.stringify({ e2e_suite: "workflow_runtime_selection" });
    await this.client.query(
      `DELETE FROM multica_agent_task_queue
       WHERE runtime_id IN (
         SELECT id FROM multica_agent_runtime WHERE metadata @> $1::jsonb
       )`,
      [marker],
    );
    await this.client.query(
      `DELETE FROM multica_agent
       WHERE runtime_id IN (
         SELECT id FROM multica_agent_runtime WHERE metadata @> $1::jsonb
       )`,
      [marker],
    );
    await this.client.query(
      "DELETE FROM multica_agent_runtime WHERE metadata @> $1::jsonb",
      [marker],
    );
  }

  async suspendExistingRuntimes() {
    const workspaceId = this.requireWorkspaceId();
    const result = await this.client.query<SuspendedRuntime>(
      `SELECT id, status, last_seen_at
       FROM multica_agent_runtime
       WHERE workspace_id = $1
         AND NOT (metadata @> $2::jsonb)`,
      [workspaceId, JSON.stringify({ e2e_suite: "workflow_runtime_selection" })],
    );
    this.suspendedRuntimes = result.rows;
    if (result.rows.length > 0) {
      await this.client.query(
        `UPDATE multica_agent_runtime
         SET status = 'offline', last_seen_at = NULL, updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [result.rows.map((row) => row.id)],
      );
    }
  }

  async seedRuntime(options: SeedRuntimeOptions) {
    const id = randomUUID();
    const status = options.status ?? "online";
    const lastSeenSecondsAgo = options.lastSeenSecondsAgo ?? 0;
    const result = await this.client.query<{ id: string; name: string }>(
      `INSERT INTO multica_agent_runtime (
         id, workspace_id, daemon_id, name, runtime_mode, provider, status,
         device_info, metadata, last_seen_at, owner_id, visibility
       )
       VALUES (
         $1, $2, $3, $4, 'local', $5, $6,
         $7, $8::jsonb,
         CASE WHEN $6 = 'online' THEN now() - make_interval(secs => $9::double precision) ELSE NULL END,
         $10, $11
       )
       RETURNING id, name`,
      [
        id,
        this.requireWorkspaceId(),
        `e2e-device-${this.caseId}-${id}`,
        options.name,
        `e2e-provider-${this.caseId}-${id}`,
        status,
        `E2E device ${options.name}`,
        JSON.stringify({ e2e_suite: "workflow_runtime_selection", case_id: this.caseId }),
        lastSeenSecondsAgo,
        options.ownerId ?? null,
        options.visibility ?? "public",
      ],
    );
    this.runtimeIds.push(id);
    return result.rows[0]!;
  }

  async setRuntimeState(
    runtimeId: string,
    status: "online" | "offline",
    lastSeenSecondsAgo = 0,
  ) {
    await this.client.query(
      `UPDATE multica_agent_runtime
       SET status = $2,
           last_seen_at = CASE WHEN $2 = 'online'
             THEN now() - make_interval(secs => $3::double precision)
             ELSE NULL
           END,
           updated_at = now()
       WHERE id = $1`,
      [runtimeId, status, lastSeenSecondsAgo],
    );
  }

  async getBuiltinAgent() {
    const raw = await this.api.listAgents();
    const agents = Array.isArray(raw) ? raw : raw.agents ?? [];
    const agent = agents.find((item: { is_builtin?: boolean }) => item.is_builtin === true);
    if (!agent?.id) {
      throw new Error("no built-in agent is visible to the E2E workspace");
    }
    return agent as { id: string; name: string };
  }

  async seedActiveTask(agentId: string, runtimeId: string, status = "queued") {
    const result = await this.client.query<{ id: string }>(
      `INSERT INTO multica_agent_task_queue (
         agent_id, runtime_id, status, priority, context
       )
       VALUES ($1, $2, $3, 0, $4::jsonb)
       RETURNING id`,
      [
        agentId,
        runtimeId,
        status,
        JSON.stringify({ e2e_suite: "workflow_runtime_selection", case_id: this.caseId }),
      ],
    );
    const id = result.rows[0]!.id;
    this.taskIds.push(id);
    return id;
  }

  async readAssignments(runId: string): Promise<RuntimeAssignmentRow[]> {
    const result = await this.client.query<RuntimeAssignmentRow>(
      `SELECT
         wr.id::text AS run_id,
         wr.status AS run_status,
         wr.runtime_id::text AS manual_runtime_id,
         wr.source_issue_id::text AS source_issue_id,
         wr.responsible_user_id::text AS responsible_user_id,
         wnr.id::text AS node_run_id,
         wnr.status AS node_status,
         wnr.runtime_id::text AS actual_runtime_id,
         wnr.runtime_selection_reason,
         wnr.failure_reason,
         task.id::text AS task_id,
         task.runtime_id::text AS task_runtime_id,
         task.status AS task_status
       FROM multica_workflow_run wr
       JOIN multica_workflow_node_run wnr ON wnr.workflow_run_id = wr.id
       LEFT JOIN multica_agent_task_queue task
         ON task.id IN (wnr.worker_agent_task_id, wnr.critic_agent_task_id)
       WHERE wr.id = $1
       ORDER BY wnr.created_at, task.created_at`,
      [runId],
    );
    return result.rows;
  }

  async countWorkflowRuns(workflowId: string) {
    const result = await this.client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM multica_workflow_run WHERE workflow_id = $1",
      [workflowId],
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async cleanupTasks() {
    if (this.taskIds.length > 0) {
      await this.client.query(
        "DELETE FROM multica_agent_task_queue WHERE id = ANY($1::uuid[])",
        [this.taskIds],
      );
      this.taskIds.length = 0;
    }
    if (this.runtimeIds.length > 0) {
      await this.client.query(
        `DELETE FROM multica_agent_task_queue
         WHERE runtime_id = ANY($1::uuid[])
           AND context->>'e2e_suite' = 'workflow_runtime_selection'`,
        [this.runtimeIds],
      );
    }
  }

  async cleanupRuntimesAndRestore() {
    if (this.runtimeIds.length > 0) {
      await this.client.query(
        "DELETE FROM multica_agent WHERE runtime_id = ANY($1::uuid[])",
        [this.runtimeIds],
      );
      await this.client.query(
        "DELETE FROM multica_agent_runtime WHERE id = ANY($1::uuid[])",
        [this.runtimeIds],
      );
      this.runtimeIds.length = 0;
    }
    for (const runtime of this.suspendedRuntimes) {
      await this.client.query(
        `UPDATE multica_agent_runtime
         SET status = $2, last_seen_at = $3, updated_at = now()
         WHERE id = $1`,
        [runtime.id, runtime.status, runtime.last_seen_at],
      );
    }
    this.suspendedRuntimes = [];
    await this.client.end();
  }

  private requireWorkspaceId() {
    const workspaceId = this.api.getWorkspaceId();
    if (!workspaceId) throw new Error("E2E workspace is not initialized");
    return workspaceId;
  }
}
