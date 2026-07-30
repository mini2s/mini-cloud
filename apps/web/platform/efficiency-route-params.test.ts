import { describe, expect, it } from "vitest";
import {
  resolveNeedIdFromPathname,
  resolveRepoParams,
  resolveTaskIdFromPathname,
} from "./efficiency-route-params";

describe("resolveNeedIdFromPathname", () => {
  const needId =
    "branch:github.com/askhz/multica:workflow-runtime-selection@2026-07-20";

  it("restores the complete need id from the encoded application URL", () => {
    expect(
      resolveNeedIdFromPathname(
        "/costrict/metrics/need/branch%3Agithub.com%2Faskhz%2Fmultica%3Aworkflow-runtime-selection%402026-07-20",
        ["branch"],
      ),
    ).toBe(needId);
  });

  it("also accepts an already-decoded pathname", () => {
    expect(
      resolveNeedIdFromPathname(
        `/costrict/metrics/need/${needId}`,
        ["branch"],
      ),
    ).toBe(needId);
  });

  it("fully restores a value that the client router encoded twice", () => {
    expect(
      resolveNeedIdFromPathname(
        "/costrict/metrics/need/branch%253Agithub.com%252Faskhz%252Fmultica%253Aworkflow-runtime-selection%25402026-07-20",
        ["branch"],
      ),
    ).toBe(needId);
  });

  it("falls back to the catch-all route parameter", () => {
    expect(
      resolveNeedIdFromPathname("/costrict/metrics/need", [
        "branch:github.com",
        "askhz",
        "multica:workflow-runtime-selection@2026-07-20",
      ]),
    ).toBe(needId);
  });
});

describe("resolveTaskIdFromPathname", () => {
  const taskId =
    "4f24522b-a029-44d6-8eac-e6c35c8b1d18|0559293ea2baef0eb0ea5f6191eeab461c9577dd";

  it("restores the task id when the client router encoded it twice", () => {
    expect(
      resolveTaskIdFromPathname(
        "/costrict/metrics/task/4f24522b-a029-44d6-8eac-e6c35c8b1d18%257C0559293ea2baef0eb0ea5f6191eeab461c9577dd",
        "fallback",
      ),
    ).toBe(taskId);
  });

  it("falls back to the decoded route parameter", () => {
    expect(
      resolveTaskIdFromPathname("/costrict/metrics/task", taskId),
    ).toBe(taskId);
  });
});

describe("resolveRepoParams", () => {
  it("keeps a multi-segment repository address separate from the branch", () => {
    expect(
      resolveRepoParams([
        "github.com/askhz/multica",
        "feature/runtime/selection",
      ]),
    ).toEqual({
      repoAddr: "github.com/askhz/multica",
      repoBranch: "feature/runtime/selection",
    });
  });

  it("supports whole-repository scope without inventing a branch", () => {
    expect(
      resolveRepoParams(["git@github.com:costrict/repo-1.git"]),
    ).toEqual({
      repoAddr: "git@github.com:costrict/repo-1.git",
    });
  });

  it("fully restores repository parameters encoded twice by the client router", () => {
    expect(
      resolveRepoParams([
        "github.com%252Faskhz%252Fmultica",
        "feature%252Fruntime",
      ]),
    ).toEqual({
      repoAddr: "github.com/askhz/multica",
      repoBranch: "feature/runtime",
    });
  });

  it("decodes encoded route parameters exactly once to their raw values", () => {
    expect(
      resolveRepoParams([
        "github.com%2Faskhz%2Fmultica",
        "feature%2Fruntime",
      ]),
    ).toEqual({
      repoAddr: "github.com/askhz/multica",
      repoBranch: "feature/runtime",
    });
  });
});
