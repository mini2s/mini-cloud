import { expect, test } from "@playwright/test";
import * as pg from "pg";

import "./env";
import { TestApiClient } from "./fixtures";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://multica:multica@localhost:5432/multica?sslmode=disable";
const WORKSPACE_SLUG = process.env.E2E_REAL_WORKSPACE_SLUG ?? "";
const EXPECTED_RUNTIME_IDS = [
  process.env.E2E_REAL_RUNTIME_1 ?? "",
  process.env.E2E_REAL_RUNTIME_2 ?? "",
].filter(Boolean);
const TERMINAL_TIMEOUT_MS = Number(process.env.E2E_REAL_TERMINAL_TIMEOUT_MS ?? "900000");

interface RealRuntimeRow {
  id: string;
  daemon_id: string | null;
  name: string;
  provider: string;
  status: string;
  last_seen_at: Date | null;
  active_task_count: string;
}

interface RealTaskRow {
  task_id: string;
  node_run_id: string;
  runtime_id: string;
  status: string;
  dispatched_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  session_id: string | null;
  work_dir: string | null;
}

test("REAL-CON-01: two independent daemons claim, start, and complete separate parallel tasks", async () => {
  test.setTimeout(Math.max(TERMINAL_TIMEOUT_MS + 60_000, 120_000));
  test.skip(
    !WORKSPACE_SLUG || EXPECTED_RUNTIME_IDS.length !== 2,
    "set E2E_REAL_WORKSPACE_SLUG and two distinct E2E_REAL_RUNTIME_* values",
  );
  expect(new Set(EXPECTED_RUNTIME_IDS).size, "runtime IDs must be distinct").toBe(2);

  const api = new TestApiClient();
  const db = new pg.Client(DATABASE_URL);
  let workflowId = "";
  let runId = "";

  await db.connect();

  try {
    const operatorResult = await db.query<{ email: string }>(
      `SELECT user_account.email
       FROM multica_workspace workspace
       JOIN multica_member member ON member.workspace_id = workspace.id
       JOIN multica_user user_account ON user_account.id = member.user_id
       WHERE workspace.slug = $1
         AND member.role IN ('owner', 'admin')
         AND member.status = 'active'
         AND user_account.email IS NOT NULL
       ORDER BY CASE member.role WHEN 'owner' THEN 0 ELSE 1 END, member.created_at
       LIMIT 1`,
      [WORKSPACE_SLUG],
    );
    expect(operatorResult.rows, `workspace ${WORKSPACE_SLUG} needs an active owner/admin`).toHaveLength(
      1,
    );

    await api.login(operatorResult.rows[0].email, "");
    const workspace = (await api.getWorkspaces()).find((item) => item.slug === WORKSPACE_SLUG);
    expect(workspace, `workspace ${WORKSPACE_SLUG} must be accessible`).toBeTruthy();
    api.setWorkspaceId(workspace!.id);
    api.setWorkspaceSlug(workspace!.slug);

    const runtimeResult = await db.query<RealRuntimeRow>(
      `SELECT
         runtime.id::text,
         runtime.daemon_id,
         runtime.name,
         runtime.provider,
         runtime.status,
         runtime.last_seen_at,
         count(task.id)::text AS active_task_count
       FROM multica_agent_runtime runtime
       LEFT JOIN multica_agent_task_queue task
         ON task.runtime_id = runtime.id
        AND task.status IN ('queued', 'dispatched', 'running')
       WHERE runtime.workspace_id = $1
         AND runtime.id = ANY($2::uuid[])
       GROUP BY runtime.id
       ORDER BY runtime.id`,
      [workspace!.id, EXPECTED_RUNTIME_IDS],
    );
    expect(runtimeResult.rows).toHaveLength(2);
    expect(new Set(runtimeResult.rows.map((runtime) => runtime.id))).toEqual(
      new Set(EXPECTED_RUNTIME_IDS),
    );
    expect(
      new Set(runtimeResult.rows.map((runtime) => runtime.daemon_id)).size,
      "each runtime must belong to a different daemon/device",
    ).toBe(2);
    for (const runtime of runtimeResult.rows) {
      expect(runtime.daemon_id).toBeTruthy();
      expect(runtime.status).toBe("online");
      expect(runtime.last_seen_at).toBeTruthy();
      expect(Date.now() - runtime.last_seen_at!.getTime()).toBeLessThan(90_000);
      expect(Number(runtime.active_task_count)).toBe(0);
    }

    const eligibleResult = await db.query<{ id: string }>(
      `SELECT id::text
       FROM multica_agent_runtime
       WHERE workspace_id = $1
         AND status = 'online'
         AND last_seen_at >= now() - interval '90 seconds'
       ORDER BY id`,
      [workspace!.id],
    );
    expect(
      new Set(eligibleResult.rows.map((runtime) => runtime.id)),
      "fixture must expose exactly the two expected healthy runtimes",
    ).toEqual(new Set(EXPECTED_RUNTIME_IDS));

    const rawAgents = await api.listAgents();
    const agents = Array.isArray(rawAgents) ? rawAgents : rawAgents.agents ?? [];
    const builtin = agents.find((agent: { is_builtin?: boolean }) => agent.is_builtin === true);
    expect(builtin?.id, "a built-in Agent is required").toBeTruthy();

    const workflow = await api.createWorkflow(`E2E real two-device closure ${Date.now()}`);
    workflowId = workflow.id;
    for (let index = 0; index < 2; index += 1) {
      await api.createWorkflowNode(workflowId, {
        title: `Real device root ${index + 1}`,
        worker_type: "agent",
        worker_id: builtin.id,
        critic_type: "human",
      });
    }
    await api.updateWorkflow(workflowId, { status: "active" });

    const run = await api.startWorkflowRun(workflowId);
    runId = run.id;

    const readTasks = async () => {
      const result = await db.query<RealTaskRow>(
        `SELECT
           task.id::text AS task_id,
           node_run.id::text AS node_run_id,
           task.runtime_id::text AS runtime_id,
           task.status,
           task.dispatched_at,
           task.started_at,
           task.completed_at,
           task.session_id,
           task.work_dir
         FROM multica_workflow_node_run node_run
         JOIN multica_agent_task_queue task
           ON task.id = node_run.worker_agent_task_id
         WHERE node_run.workflow_run_id = $1
         ORDER BY node_run.created_at`,
        [runId],
      );
      return result.rows;
    };

    await expect.poll(async () => (await readTasks()).length, { timeout: 10_000 }).toBe(2);
    const assigned = await readTasks();
    expect(new Set(assigned.map((task) => task.runtime_id))).toEqual(
      new Set(EXPECTED_RUNTIME_IDS),
    );

    await expect
      .poll(
        async () => (await readTasks()).map((task) => task.status).sort().join(","),
        { timeout: TERMINAL_TIMEOUT_MS, intervals: [500, 1_000, 2_000, 5_000] },
      )
      .toBe("completed,completed");

    const terminal = await readTasks();
    for (const task of terminal) {
      expect(task.dispatched_at, `${task.task_id} was never claimed/dispatched`).toBeTruthy();
      expect(task.started_at, `${task.task_id} was never started`).toBeTruthy();
      expect(task.completed_at, `${task.task_id} never reached terminal success`).toBeTruthy();
      expect(task.session_id, `${task.task_id} has no runtime session`).toBeTruthy();
      expect(task.work_dir, `${task.task_id} has no runtime workdir`).toBeTruthy();
    }

    console.log(
      JSON.stringify({
        case_id: "REAL-CON-01",
        workspace_id: workspace!.id,
        workflow_id: workflowId,
        run_id: runId,
        runtimes: runtimeResult.rows.map(({ id, daemon_id, name, provider }) => ({
          id,
          daemon_id,
          name,
          provider,
        })),
        tasks: terminal,
      }),
    );
  } finally {
    if (workflowId && runId) {
      await api.cancelWorkflowRun(workflowId, runId).catch(() => undefined);
    }
    await api.cleanup();
    await db.end();
  }
});
