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
  EMPTY_USER,
  ListIssuesResponseSchema,
  RuntimeHourlyActivityListSchema,
  RuntimeUsageByAgentListSchema,
  RuntimeUsageByHourListSchema,
  RuntimeUsageListSchema,
  UserSchema,
  WorkflowRoleResolutionsResponseSchema,
  WorkflowRolesResponseSchema,
  WorkflowRunSchema,
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
  });
});
