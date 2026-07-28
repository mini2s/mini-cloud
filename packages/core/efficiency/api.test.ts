import { afterEach, describe, expect, it, vi } from "vitest";
import { getUserDetailV2 } from "./api";
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
