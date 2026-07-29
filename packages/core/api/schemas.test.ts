import { describe, expect, it } from "vitest";
import {
  AgentCloudSkillListSchema,
  BuiltinPluginSchema,
  CatalogSkillListResponseSchema,
  CatalogSkillSchema,
  DashboardAgentRunTimeListSchema,
  DashboardUsageByAgentListSchema,
  DashboardUsageDailyListSchema,
  DuplicateIssueErrorBodySchema,
  EMPTY_AGENT_CLOUD_SKILLS,
  EMPTY_CATALOG_SKILL_LIST,
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
  WorkflowRoleResolutionsResponseSchema,
  WorkflowRolesResponseSchema,
  WorkflowSchema,
  WorkflowRunSchema,
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
	it("parses split task assignees and tolerates older responses", () => {
		const current = SplitTasksResponseSchema.parse({
			tasks: [{
				id: "task-1",
				node_run_id: "nr-1",
				assignee_type: "squad",
				assignee_id: "squad-1",
				workflow_id: null,
			}],
		});
		expect(current.tasks[0]).toMatchObject({ assignee_type: "squad", assignee_id: "squad-1" });

		const old = SplitTasksResponseSchema.parse({ tasks: [{ id: "task-2", node_run_id: "nr-1" }] });
		expect(old.tasks[0]).toMatchObject({ assignee_type: null, assignee_id: null, workflow_id: null });
	});

	it("falls back when split tasks is null", () => {
		expect(SplitTasksResponseSchema.parse({ tasks: null }).tasks).toEqual([]);
	});

  it("parses split config versions and draft provenance", () => {
    const nodeRun = WorkflowNodeRunSchema.parse({
      id: "nr-1",
      workflow_run_id: "run-1",
      workflow_node_id: "node-1",
      split_config_version: 4,
    });
    const split = SplitTasksResponseSchema.parse({
      tasks: [{
        id: "task-1",
        node_run_id: "nr-1",
        workflow_id: "wf-1",
        draft_key: "backend",
        draft_source: "recovered",
      }],
    });

    expect(nodeRun.split_config_version).toBe(4);
    expect(split.tasks[0]).toMatchObject({
      workflow_id: "wf-1",
      draft_key: "backend",
      draft_source: "recovered",
    });
  });

  it("defaults additive split fields from an older server response", () => {
    const nodeRun = WorkflowNodeRunSchema.parse({
      id: "nr-1",
      workflow_run_id: "run-1",
      workflow_node_id: "node-1",
    });
    expect(nodeRun.split_config_version).toBe(1);
  });

  it("falls back when split config version is malformed", () => {
    const parsed = parseWithFallback(
      {
        id: "nr-1",
        workflow_run_id: "run-1",
        workflow_node_id: "node-1",
        split_config_version: null,
      },
      WorkflowNodeRunSchema,
      EMPTY_WORKFLOW_NODE_RUN,
      { endpoint: "GET /api/workflow-runs/:id/node-runs" },
    );

    expect(parsed).toBe(EMPTY_WORKFLOW_NODE_RUN);
  });

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

  it.each([
		["assignee_type", { ...validTask, assignee_type: "future-assignee" }],
		["draft_key", { ...validTask, draft_key: 42 }],
  ])("falls back when split task %s is malformed", (_field, task) => {
    const parsed = parseWithFallback(
      { tasks: [task] },
      SplitTasksResponseSchema,
      EMPTY_SPLIT_TASKS_RESPONSE,
      { endpoint: "GET /api/node-runs/:id/split/tasks" },
    );

    expect(parsed).toBe(EMPTY_SPLIT_TASKS_RESPONSE);
  });

  it("downgrades an unknown draft source at the API boundary", () => {
    const parsed = parseWithFallback(
      { tasks: [{ ...validTask, draft_source: "future-source" }] },
      SplitTasksResponseSchema,
      EMPTY_SPLIT_TASKS_RESPONSE,
      { endpoint: "GET /api/node-runs/:id/split/tasks" },
    );

    expect(parsed).not.toBe(EMPTY_SPLIT_TASKS_RESPONSE);
    expect(parsed.tasks[0]?.draft_source).toBe("agent");
  });

  it("accepts split task lists and keeps unknown fields", () => {
    const parsed = SplitTasksResponseSchema.parse({
      tasks: [{ ...validTask, server_hint: "future" }],
      progress: { total: 1, created: 0, running: 1, done: 0, failed: 0, cancelled: 0, skipped: 0 },
    });
    expect(parsed.tasks[0]?.depends_on).toEqual(["task-0"]);
    expect((parsed.tasks[0] as Record<string, unknown>).server_hint).toBe("future");
  });

  it("defaults missing additive split task fields", () => {
    const { workflow_id: _a, issue_id: _b, run_id: _c, depends_on: _d, last_error: _e, version: _f, ...partial } = validTask;
    const parsed = SplitTasksResponseSchema.parse({ tasks: [partial] });
		expect(parsed.tasks[0]?.workflow_id).toBeNull();
		expect(parsed.tasks[0]?.assignee_type).toBeNull();
		expect(parsed.tasks[0]?.assignee_id).toBeNull();
    expect(parsed.tasks[0]?.draft_key).toBeNull();
    expect(parsed.tasks[0]?.draft_source).toBe("agent");
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

  it("keeps failed runtime status when error details are missing or extended", () => {
    const parsed = WorkflowRunCanvasSummaryResponseSchema.parse({
      run: { id: "run-1", workflow_id: "wf-1", workspace_id: "ws-1" },
      node_runs: [],
      node_runtime_summaries: [
        {
          workflow_node_id: "node-1",
          node_run_id: "node-run-1",
          display_status: "failed",
          has_error: true,
          provider_error_code: "future_error_code",
        },
      ],
    });

    expect(parsed.node_runtime_summaries[0]).toMatchObject({
      display_status: "failed",
      has_error: true,
      error_message: "",
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

describe("workflow runtime isolation schemas", () => {
  const oldWorkflowRun = {
    id: "run-1",
    workflow_id: "workflow-1",
    workspace_id: "workspace-1",
  };

  it("keeps the legacy node id and accepts a new source id", () => {
    const parsed = WorkflowNodeRunSchema.parse({
      id: "nr",
      workflow_run_id: "run",
      workflow_node_id: "node-old",
      source_workflow_node_id: "node-new",
    });
    expect(parsed.workflow_node_id).toBe("node-old");
    expect(parsed.source_workflow_node_id).toBe("node-new");
  });

  it("accepts an old response without snapshot fields", () => {
    expect(WorkflowRunSchema.safeParse(oldWorkflowRun).success).toBe(true);
  });

  it("parses a complete schema version 1 snapshot", () => {
    const parsed = WorkflowRunSchema.parse({
      ...oldWorkflowRun,
      definition_schema_version: 1,
      definition_snapshot: {
        schema_version: 1,
        snapshot_origin: "native",
        workflow: {
          id: "workflow-1",
          workspace_id: "workspace-1",
          title: "Snapshot workflow",
          description: "",
          is_default: false,
          max_retries: 3,
          runtime_selection_policy: "idle_first",
          config_revision: 4,
        },
        nodes: [{
          id: "node-1",
          title: "Snapshot node",
          description: "",
          position_x: 0,
          position_y: 0,
          sort_order: 0,
          kind: "task",
          worker_type: "human",
          critic_type: "human",
        }],
        edges: [],
        stages: [],
        roles: [],
        deliverables: [],
      },
    });
    expect(parsed.definition_snapshot?.nodes[0]?.title).toBe("Snapshot node");
  });

  it("falls back for an unknown snapshot schema without rejecting the run", () => {
    const parsed = WorkflowRunSchema.parse({
      ...oldWorkflowRun,
      definition_schema_version: 99,
      definition_snapshot: { schema_version: 99, snapshot_origin: "native", nodes: "invalid" },
    });
    expect(parsed.definition_snapshot).toBeNull();
  });

  it("falls back for a malformed known snapshot without rejecting the run", () => {
    const parsed = WorkflowRunSchema.parse({
      ...oldWorkflowRun,
      definition_schema_version: 1,
      definition_snapshot: { schema_version: 1, snapshot_origin: "native", nodes: "invalid" },
    });
    expect(parsed.definition_snapshot).toBeNull();
  });

  it("rejects a non-string workflow_node_id", () => {
    expect(WorkflowNodeRunSchema.safeParse({
      id: "nr",
      workflow_run_id: "run",
      workflow_node_id: 7,
    }).success).toBe(false);
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
describe("BuiltinPluginSchema", () => {
  it("accepts item-search plugin records with install metadata and extra fields", () => {
    const parsed = BuiltinPluginSchema.parse({
      id: "figma",
      name: "Figma",
      description: "Design handoff",
      slug: "figma",
      version: "1.0.0",
      category: "design",
      content: "Plugin instructions",
      item_type: "plugin",
      metadata: {
        install: {
          method: "csc",
          plugin_name: "figma-plugin",
          marketplace: "github",
        },
        bundle: {
          skills_count: 1,
          agents_count: 0,
          commands_count: 0,
          hooks_count: 0,
          skills_namespaces: ["figma"],
        },
      },
    });

    expect(parsed.metadata?.install?.plugin_name).toBe("figma-plugin");
    expect(parsed.content).toBe("Plugin instructions");
    expect(parsed.item_type).toBe("plugin");
  });
});

describe("CatalogSkillSchema", () => {
  it("accepts catalog skill records with camelCase or snake_case item type", () => {
    const camel = CatalogSkillSchema.parse({
      id: "search-skill",
      name: "Search",
      description: "Web search skill",
      slug: "search",
      version: "2.0.0",
      category: "web",
      itemType: "skill",
      repoVisibility: "public",
      metadata: {
        install: {
          method: "csc",
          skill_id: "search-skill",
          spec: "search-skill",
          source_url: "https://example.test/search",
          verified: true,
        },
      },
    });

    expect(camel.name).toBe("Search");
    expect(camel.itemType).toBe("skill");
    expect(camel.metadata?.install?.method).toBe("csc");
    expect(camel.metadata?.install?.verified).toBe(true);

    const snake = CatalogSkillSchema.parse({
      id: "search-skill",
      name: "Search",
      item_type: "skill",
    });
    expect(snake.item_type).toBe("skill");
  });

  it("defaults optional display fields and preserves unknown fields", () => {
    const parsed = CatalogSkillSchema.parse({
      id: "bare",
      name: "Bare",
      // description/slug/version/category intentionally absent
      future_field: "kept via loose()",
    });

    expect(parsed.description).toBe("");
    expect(parsed.version).toBe("");
    // Unknown field is preserved because the schema is `.loose()`.
    expect((parsed as Record<string, unknown>).future_field).toBe("kept via loose()");
  });
});

describe("CatalogSkillListResponseSchema", () => {
  it("parses a populated list envelope", () => {
    const parsed = CatalogSkillListResponseSchema.parse({
      items: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      total: 2,
      page: 1,
      pageSize: 50,
      hasMore: false,
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.hasMore).toBe(false);
  });

  it("falls back to an empty list when the envelope is malformed", () => {
    const parsed = parseWithFallback(
      { not: "an envelope" },
      CatalogSkillListResponseSchema,
      EMPTY_CATALOG_SKILL_LIST,
      { endpoint: "GET /api/catalog/skills" },
    );
    expect(parsed.items).toEqual([]);
    expect(parsed.total).toBe(0);
  });
});

describe("AgentCloudSkillListSchema", () => {
  it("parses binding snapshots and preserves install object", () => {
    const parsed = AgentCloudSkillListSchema.parse([
      {
        id: "search-skill",
        name: "Search",
        description: "Web search",
        slug: "search",
        position: 0,
        install: { method: "csc", skill_id: "search-skill" },
      },
    ]);
    expect(parsed[0]?.install?.method).toBe("csc");
    expect(parsed[0]?.position).toBe(0);
  });

  it("falls back to an empty binding list on drift", () => {
    const parsed = parseWithFallback(
      null,
      AgentCloudSkillListSchema,
      EMPTY_AGENT_CLOUD_SKILLS,
      { endpoint: "GET /api/agents/{id}/cloud-skills" },
    );
    expect(parsed).toEqual([]);
  });
});

describe("workflow role response schemas", () => {
  it("defaults missing role fields and preserves unknown fields", () => {
    const parsed = WorkflowRolesResponseSchema.parse({
      roles: [{ id: "role-1", workspace_id: "ws-1", future_field: true }],
    });
    expect(parsed.roles[0]).toMatchObject({
      id: "role-1",
      name: "",
      description: "",
      is_builtin: false,
      needs_description: false,
      is_referenced: false,
      future_field: true,
    });
  });

  it("degrades a malformed role list to an empty list", () => {
    const parsed = WorkflowRolesResponseSchema.parse({
      roles: [{ id: 42, workspace_id: "ws-1" }],
    });
    expect(parsed.roles).toEqual([]);
  });

  it("defaults missing resolution fields and preserves unknown statuses", () => {
    const parsed = WorkflowRoleResolutionsResponseSchema.parse({
      resolutions: [{
        id: "resolution-1",
        workflow_run_id: "run-1",
        workflow_node_run_id: "node-run-1",
        status: "future_resolution_state",
      }],
    });
    expect(parsed.resolutions[0]).toMatchObject({
      slot_type: "worker",
      role_id: null,
      status: "future_resolution_state",
      version: 1,
      resolved_user_id: null,
    });
  });

  it("degrades malformed resolutions and accepts unknown run statuses", () => {
    expect(WorkflowRoleResolutionsResponseSchema.parse({
      resolutions: [{ id: null }],
    }).resolutions).toEqual([]);

    const run = WorkflowRunSchema.parse({
      id: "run-1",
      workflow_id: "workflow-1",
      workspace_id: "ws-1",
      status: "future_run_state",
    });
    expect(run.status).toBe("future_run_state");
    expect(run.runtime_selection_policy).toBe("idle_first");
  });

  it("defaults legacy workflows to the idle-first runtime strategy", () => {
    const workflow = WorkflowSchema.parse({
      id: "workflow-1",
      workspace_id: "ws-1",
      title: "Legacy workflow",
    });

    expect(workflow.default_runtime_selection_policy).toBe("idle_first");
    expect(workflow.default_runtime_id).toBeNull();
  });
});
