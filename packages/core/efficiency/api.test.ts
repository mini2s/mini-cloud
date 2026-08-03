import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCommitDetailV2,
  getNeedDetailV2,
  getTaskDetailV2,
  getUsageDeptMembers,
  getUsageUserDetail,
  getUserDetailV2,
} from "./api";
import { mock } from "./mock";

describe("getUserDetailV2", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes a null needs collection without discarding the detail payload", async () => {
    const detail = mock.userDetail("user-1", {
      startDate: "20260722",
      endDate: "20260728",
    });
    const payload = { ...detail, needs: null };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await getUserDetailV2("user-1", {
      startDate: "20260722",
      endDate: "20260728",
    });

    expect(result.summary?.user_id).toBe(detail.summary?.user_id);
    expect(result.weeks).toHaveLength(detail.weeks.length);
    expect(result.commits).toHaveLength(detail.commits.length);
    expect(result.needs).toEqual([]);
  });
});

describe("getNeedDetailV2", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes a slash-bearing need id exactly once as one route value", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ need: null, sessions: [], commits: [] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getNeedDetailV2(
      "branch:git@example.com/acme/app.git:feature/TASK-210-login",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/kanban/api/v2/needs/branch%3Agit%40example.com%2Facme%2Fapp.git%3Afeature%2FTASK-210-login",
      expect.any(Object),
    );
  });

  it("keeps the need when optional collections and signals are null", async () => {
    const needId =
      "branch:github.com/askhz/multica:workflow-runtime-selection@2026-07-20";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            need: { need_id: needId },
            sessions: null,
            commits: null,
            stage_metrics: null,
            baseline_components: null,
            confidence_signals: null,
            quality_signals: null,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const result = await getNeedDetailV2(needId);

    expect(result.need?.need_id).toBe(needId);
    expect(result.sessions).toEqual([]);
    expect(result.commits).toEqual([]);
    expect(result.stage_metrics).toEqual([]);
    expect(result.baseline_components).toEqual({});
    expect(result.confidence_signals).toEqual({});
    expect(result.quality_signals).toEqual({});
  });
});

describe("getCommitDetailV2", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the commit when the backend returns null related_tasks", async () => {
    const commitId = "0559293ea2baef0eb0ea5f6191eeab461c9577dd";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            commit: { commit_id: commitId },
            related_tasks: null,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const result = await getCommitDetailV2(commitId);

    expect(result.commit?.commit_id).toBe(commitId);
    expect(result.related_tasks).toEqual([]);
  });
});

describe("getTaskDetailV2", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes the task separator exactly once", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ task: null, conversations: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getTaskDetailV2(
      "4f24522b-a029-44d6-8eac-e6c35c8b1d18|0559293ea2baef0eb0ea5f6191eeab461c9577dd",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/kanban/api/v2/tasks/4f24522b-a029-44d6-8eac-e6c35c8b1d18%7C0559293ea2baef0eb0ea5f6191eeab461c9577dd",
      expect.any(Object),
    );
  });
});

// The chat-stats backend emits `"username": null` for users missing from its
// directory sync. zod `.optional()` rejects explicit null, which used to fail
// the whole members array and silently render "暂无数据" (the fallback) even
// though the request succeeded. Mirrors the live response shape.
function stubChatPayload(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "", data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

describe("getUsageDeptMembers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps rows whose username is null instead of discarding the whole page", async () => {
    stubChatPayload({
      dept_id: "49",
      total: 2,
      page: 1,
      page_size: 20,
      members: [
        {
          universal_id: "u-1",
          username: "alice",
          user_id: "1001",
          total_requests: 10,
          sum_prompt_tokens: 80,
          sum_completion_tokens: 20,
          sum_total_tokens: 100,
          success_rate: 99.5,
          avg_duration_ms: 1234,
          active_days: 3,
          estimated_total_cost: 0,
        },
        {
          universal_id: "u-2",
          username: null,
          user_id: "1002",
          total_requests: 5,
          sum_prompt_tokens: 40,
          sum_completion_tokens: 10,
          sum_total_tokens: 50,
          success_rate: 100,
          avg_duration_ms: 100,
          active_days: 1,
          estimated_total_cost: 0,
        },
      ],
    });

    const result = await getUsageDeptMembers({
      deptId: "49",
      start: "2026-06-29",
      end: "2026-07-29",
      includeChildren: true,
      page: 1,
      pageSize: 20,
      sortBy: "sum_total_tokens",
      sortOrder: "desc",
      search: "",
    });

    expect(result.total).toBe(2);
    expect(result.members).toHaveLength(2);
    expect(result.members[1]?.universal_id).toBe("u-2");
    expect(result.members[1]?.username).toBeNull();
  });
});

describe("getUsageUserDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the detail payload when username and model_preference are null", async () => {
    stubChatPayload({
      user_detail: {
        universal_id: "u-2",
        username: null,
        total_requests: 5,
        success_requests: 5,
        error_requests: 0,
        success_rate: 100,
        error_rate: 0,
        sum_prompt_tokens: 40,
        sum_completion_tokens: 10,
        sum_total_tokens: 50,
        sum_cache_tokens: 0,
        total_sessions: 2,
        active_days: 1,
        avg_duration_ms: 100,
        avg_ttft_ms: 50,
        avg_token_output_speed: 12,
        model_preference: null,
        estimated_total_cost: 0,
      },
      models: [],
      auto_routing: [],
      departments: [],
    });

    const result = await getUsageUserDetail("u-2", "2026-06-29", "2026-07-29");

    expect(result.user_detail.universal_id).toBe("u-2");
    expect(result.user_detail.username).toBeNull();
    expect(result.user_detail.model_preference).toBeNull();
    expect(result.user_detail.total_requests).toBe(5);
  });
});
