import { describe, expect, it } from "vitest";
import {
  DashboardAgentRunTimeListSchema,
  DashboardUsageByAgentListSchema,
  DashboardUsageDailyListSchema,
  DuplicateIssueErrorBodySchema,
  EMPTY_SPLIT_CHAT_RESPONSE,
  EMPTY_USER,
  EMPTY_SPLIT_PROGRESS,
  EMPTY_SPLIT_TASKS_RESPONSE,
  EMPTY_WORKFLOW_RUN_CANVAS_SUMMARY_RESPONSE,
  EMPTY_WORKFLOW_NODE_RUN,
  ListIssuesResponseSchema,
  RuntimeHourlyActivityListSchema,
  RuntimeUsageByAgentListSchema,
  RuntimeUsageByHourListSchema,
  RuntimeUsageListSchema,
  SplitProgressSchema,
  SplitChatResponseSchema,
  SplitTasksResponseSchema,
  UserSchema,
  WorkflowRunCanvasSummaryResponseSchema,
  WorkflowNodeRunSchema,
} from "./schemas";
import { parseWithFallback } from "./schema";

const baseIssue = {
  id: "11111111-1111-1111-1111-111111111111",
  workspace_id: "ws-1",
  number: 1,
  identifier: "MUL-1",
  title: "Test",
  description: null,
  status: "todo",
  priority: "medium",
  assignee_type: null,
  assignee_id: null,
  creator_type: "member",
  creator_id: "user-1",
  parent_issue_id: null,
  project_id: null,
  workflow_id: null,
  workflow_run_id: null,
  stage_id: null,
  position: 0,
  start_date: null,
  due_date: null,
  metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("IssueSchema (via ListIssuesResponseSchema)", () => {
  it("accepts a primitive metadata KV map", () => {
    const payload = {
      issues: [
        {
          ...baseIssue,
          metadata: { pipeline_status: "waiting", pr_number: 3, is_blocked: true },
        },
      ],
      total: 1,
    };
    const parsed = ListIssuesResponseSchema.parse(payload);
    expect(parsed.issues[0]?.metadata).toEqual({
      pipeline_status: "waiting",
      pr_number: 3,
      is_blocked: true,
    });
  });

  it("defaults metadata to {} when the server omits it (older backend)", () => {
    const { metadata: _omit, ...issueWithoutMetadata } = baseIssue;
    const payload = { issues: [issueWithoutMetadata], total: 1 };
    const parsed = ListIssuesResponseSchema.parse(payload);
    expect(parsed.issues[0]?.metadata).toEqual({});
  });

  it("defaults stage_id to null when the server omits it (older backend)", () => {
    const { stage_id: _omit, ...issueWithoutStage } = baseIssue;
    const payload = { issues: [issueWithoutStage], total: 1 };
    const parsed = ListIssuesResponseSchema.parse(payload);
    expect(parsed.issues[0]?.stage_id).toBeNull();
  });

  it("accepts a non-null stage_id", () => {
    const payload = { issues: [{ ...baseIssue, stage_id: "stage-1" }], total: 1 };
    const parsed = ListIssuesResponseSchema.parse(payload);
    expect(parsed.issues[0]?.stage_id).toBe("stage-1");
  });
});

describe("split API response schemas", () => {
  const validTask = {
    id: "task-1",
    node_run_id: "node-run-1",
    title: "Implement API",
    description: "Build split endpoints",
    workflow_id: "workflow-1",
    depends_on: ["task-0"],
    sort_order: 2,
    status: "running",
    issue_id: "issue-1",
    run_id: "run-1",
    version: 3,
    last_error: null,
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:01:00Z",
  };

  it("accepts split task lists and keeps unknown fields", () => {
    const parsed = SplitTasksResponseSchema.parse({
      tasks: [{ ...validTask, server_hint: "future" }],
      progress: { total: 1, created: 0, running: 1, done: 0, failed: 0, cancelled: 0, skipped: 0 },
    });
    expect(parsed.tasks[0]?.depends_on).toEqual(["task-0"]);
    expect((parsed.tasks[0] as Record<string, unknown>).server_hint).toBe("future");
  });

  it("defaults missing nullable split task fields", () => {
    const { workflow_id: _a, issue_id: _b, run_id: _c, depends_on: _d, last_error: _e, version: _f, ...partial } = validTask;
    const parsed = SplitTasksResponseSchema.parse({ tasks: [partial] });
    expect(parsed.tasks[0]?.workflow_id).toBeNull();
    expect(parsed.tasks[0]?.issue_id).toBeNull();
    expect(parsed.tasks[0]?.run_id).toBeNull();
    expect(parsed.tasks[0]?.depends_on).toEqual([]);
    expect(parsed.tasks[0]?.version).toBe(1);
    expect(parsed.tasks[0]?.last_error).toBeNull();
    expect(parsed.progress).toEqual(EMPTY_SPLIT_PROGRESS);
  });

  it("parses split task workflow version and last error", () => {
    const parsed = SplitTasksResponseSchema.parse({
      tasks: [{
        ...validTask,
        last_error: {
          code: "dispatch_failed",
          message: "workflow unavailable",
          child_issue_id: "issue-1",
          workflow_run_id: null,
          node_run_id: "node-run-1",
          occurred_at: "2026-07-12T00:02:00Z",
        },
      }],
    });

    expect(parsed.tasks[0]?.workflow_id).toBe("workflow-1");
    expect(parsed.tasks[0]?.version).toBe(3);
    expect(parsed.tasks[0]?.last_error?.code).toBe("dispatch_failed");
  });

  it("falls back when split task response has the wrong shape", () => {
    const parsed = parseWithFallback(
      { tasks: [{ ...validTask, depends_on: "task-0" }] },
      SplitTasksResponseSchema,
      EMPTY_SPLIT_TASKS_RESPONSE,
      { endpoint: "GET /api/node-runs/:id/split/tasks" },
    );
    expect(parsed).toBe(EMPTY_SPLIT_TASKS_RESPONSE);
  });

  it("flattens the nested split review chat response returned by the handler", () => {
    const parsed = SplitChatResponseSchema.parse({
      chat_session_id: "chat-1",
      task_id: "agent-task-1",
      tasks: {
        tasks: [{ ...validTask, title: "Security review" }],
        progress: { total: 1 },
      },
    });

    expect(parsed.chat_session_id).toBe("chat-1");
    expect(parsed.task_id).toBe("agent-task-1");
    expect(parsed.tasks[0]?.title).toBe("Security review");
    expect(parsed.progress).toEqual({
      total: 1,
      created: 0,
      running: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0,
    });
  });

  it("falls back when split review chat tasks have the wrong shape", () => {
    const parsed = parseWithFallback(
      {
        chat_session_id: "chat-1",
        task_id: "agent-task-1",
        tasks: { tasks: [{ ...validTask, depends_on: "task-0" }] },
      },
      SplitChatResponseSchema,
      EMPTY_SPLIT_CHAT_RESPONSE,
      { endpoint: "POST /api/node-runs/:id/split/chat" },
    );
    expect(parsed).toBe(EMPTY_SPLIT_CHAT_RESPONSE);
  });

  it("defaults missing split progress counts to zero", () => {
    const parsed = SplitProgressSchema.parse({ total: 3, running: 1 });
    expect(parsed).toEqual({ total: 3, created: 0, running: 1, done: 0, failed: 0, cancelled: 0, skipped: 0 });
  });

  it("parses split progress inside workflow canvas summaries", () => {
    const parsed = WorkflowRunCanvasSummaryResponseSchema.parse({
      run: { id: "run-1", workflow_id: "wf-1", workspace_id: "ws-1" },
      node_runs: [],
      node_runtime_summaries: [
        {
          workflow_node_id: "node-1",
          node_run_id: "node-run-1",
          display_status: "in_progress",
          split_progress: { total: 4, done: 1, running: 2 },
        },
      ],
    });
    expect(parsed.node_runtime_summaries[0]?.split_progress).toEqual({
      total: 4,
      created: 0,
      running: 2,
      done: 1,
      failed: 0,
      cancelled: 0,
      skipped: 0,
    });
  });

  it("falls back when canvas summary split progress has the wrong shape", () => {
    const parsed = parseWithFallback(
      {
        run: { id: "run-1", workflow_id: "wf-1", workspace_id: "ws-1" },
        node_runs: [],
        node_runtime_summaries: [
          {
            workflow_node_id: "node-1",
            node_run_id: "node-run-1",
            split_progress: { total: "bad" },
          },
        ],
      },
      WorkflowRunCanvasSummaryResponseSchema,
      EMPTY_WORKFLOW_RUN_CANVAS_SUMMARY_RESPONSE,
      { endpoint: "GET /api/workflows/:id/runs/:runId/canvas-summary" },
    );
    expect(parsed).toBe(EMPTY_WORKFLOW_RUN_CANVAS_SUMMARY_RESPONSE);
  });

  it("falls back when a split cancel node-run response has the wrong shape", () => {
    const parsed = parseWithFallback(
      { id: "node-run-1", workflow_run_id: 42 },
      WorkflowNodeRunSchema,
      EMPTY_WORKFLOW_NODE_RUN,
      { endpoint: "POST /api/node-runs/:id/split/cancel" },
    );
    expect(parsed).toBe(EMPTY_WORKFLOW_NODE_RUN);
  });

  it("defaults missing split review chat session on node runs", () => {
    const parsed = WorkflowNodeRunSchema.parse({
      id: "node-run-1",
      workflow_run_id: "run-1",
      workflow_node_id: "node-1",
      status: "awaiting_split_review",
    });

    expect(parsed.split_review_chat_session_id).toBeNull();
  });
});

// The duplicate-issue branch in create-issue.tsx feeds ApiError.body
// (typed as `unknown`) through this schema. Any future server drift that
// loses the contract MUST fail the parse so the UI falls back to a normal
// error toast instead of rendering an empty / partial duplicate card.
describe("DuplicateIssueErrorBodySchema", () => {
  const valid = {
    code: "active_duplicate_issue",
    error: "An active issue with this title already exists: MUL-12 – Login bug",
    issue: {
      id: "11111111-1111-1111-1111-111111111111",
      identifier: "MUL-12",
      title: "Login bug",
    },
  };

  it("accepts a well-formed body", () => {
    expect(DuplicateIssueErrorBodySchema.safeParse(valid).success).toBe(true);
  });

  it("accepts unknown extra fields via .loose()", () => {
    const forwardCompat = {
      ...valid,
      hint: "Try a different title",
      issue: { ...valid.issue, workspace_id: "ws-1", status: "todo" },
    };
    expect(DuplicateIssueErrorBodySchema.safeParse(forwardCompat).success).toBe(true);
  });

  it("rejects a renamed code (so renames degrade to the generic toast)", () => {
    const renamed = { ...valid, code: "duplicate_issue" };
    expect(DuplicateIssueErrorBodySchema.safeParse(renamed).success).toBe(false);
  });

  it("rejects a missing issue object", () => {
    const { issue: _omit, ...without } = valid;
    expect(DuplicateIssueErrorBodySchema.safeParse(without).success).toBe(false);
  });

  it("rejects a non-string issue.id", () => {
    const broken = { ...valid, issue: { ...valid.issue, id: 42 } };
    expect(DuplicateIssueErrorBodySchema.safeParse(broken).success).toBe(false);
  });

  it("accepts a missing error field (it is optional)", () => {
    const { error: _omit, ...without } = valid;
    expect(DuplicateIssueErrorBodySchema.safeParse(without).success).toBe(true);
  });
});

// `user.timezone` (Viewing tz) was added in the timezone-architecture RFC.
// A desktop build older than the server — or a server predating the
// `user.timezone` migration — will return a `/api/me` body with no
// `timezone` key. The schema must not fail closed on that: the field
// defaults to `null`, which the frontend resolves to the browser-detected
// tz at render time.
describe("UserSchema timezone drift", () => {
  const base = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Ada",
    email: "ada@example.com",
  };

  it("defaults timezone to null when the field is absent", () => {
    const parsed = UserSchema.parse(base);
    expect(parsed.timezone).toBe(null);
  });

  it("preserves an explicit IANA timezone", () => {
    const parsed = UserSchema.parse({ ...base, timezone: "Asia/Tokyo" });
    expect(parsed.timezone).toBe("Asia/Tokyo");
  });

  it("accepts an explicit null timezone", () => {
    const parsed = UserSchema.parse({ ...base, timezone: null });
    expect(parsed.timezone).toBe(null);
  });

  // Wrong-type drift: a future server bug sending `timezone` as a number
  // must not throw into the UI. parseWithFallback degrades the whole user
  // object to the explicit fallback (EMPTY_USER) so /api/me callers keep a
  // valid shape instead of white-screening.
  it("falls back to EMPTY_USER when timezone is the wrong type", () => {
    const parsed = parseWithFallback(
      { ...base, timezone: 42 },
      UserSchema,
      EMPTY_USER,
      { endpoint: "GET /api/me" },
    );
    expect(parsed).toBe(EMPTY_USER);
  });
});

// The workspace dashboard and runtime-detail pages were re-pointed at the
// unified `task_usage_hourly` rollup. Every numeric field drives chart /
// KPI math, and string keys (date / agent_id / model) bucket the series.
// The contract these schemas must hold: a row missing a field degrades
// that field to a sane default rather than dropping the WHOLE array to
// the `[]` fallback — one drifted row must not blank the entire chart.
describe("dashboard + runtime usage schema drift", () => {
  it("coerces a missing numeric field to 0 instead of dropping the array", () => {
    const parsed = DashboardUsageDailyListSchema.parse([
      { date: "2026-05-19", model: "claude-opus-4-7", input_tokens: 100 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.output_tokens).toBe(0);
    expect(parsed[0]?.cache_read_tokens).toBe(0);
    expect(parsed[0]?.cache_write_tokens).toBe(0);
  });

  it("coerces a missing date key to \"\" so the rest of the series survives", () => {
    const parsed = DashboardUsageDailyListSchema.parse([
      { model: "claude-opus-4-7", input_tokens: 5 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.date).toBe("");
  });

  it("coerces a missing agent_id key to \"\" for the agent-runtime panel", () => {
    const parsed = DashboardAgentRunTimeListSchema.parse([
      { total_seconds: 42, task_count: 3, failed_count: 0 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.agent_id).toBe("");
  });

  it("coerces a missing agent_id key to \"\" for the usage-by-agent panel", () => {
    const parsed = DashboardUsageByAgentListSchema.parse([
      { model: "claude-opus-4-7", input_tokens: 7 },
    ]);
    expect(parsed[0]?.agent_id).toBe("");
  });

  it("coerces missing fields on every runtime usage schema", () => {
    expect(RuntimeUsageListSchema.parse([{ date: "2026-05-19" }])[0]?.input_tokens).toBe(0);
    expect(RuntimeHourlyActivityListSchema.parse([{ hour: 9 }])[0]?.count).toBe(0);
    expect(RuntimeUsageByAgentListSchema.parse([{ model: "x" }])[0]?.agent_id).toBe("");
    expect(RuntimeUsageByHourListSchema.parse([{ hour: 9 }])[0]?.model).toBe("");
  });

  it("rejects a non-array body so parseWithFallback can return its fallback", () => {
    expect(DashboardUsageDailyListSchema.safeParse(null).success).toBe(false);
    expect(RuntimeUsageListSchema.safeParse({ rows: [] }).success).toBe(false);
  });

  it("keeps unknown server-side fields via .loose()", () => {
    const parsed = RuntimeUsageListSchema.parse([
      { date: "2026-05-19", region: "us-east" },
    ]);
    expect((parsed[0] as Record<string, unknown>).region).toBe("us-east");
  });
});
