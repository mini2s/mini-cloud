import { describe, expect, it } from "vitest";
import { buildShareableUrl, withBasePath } from "./shareable-url";

describe("withBasePath", () => {
  it("adds the configured base path to workspace routes", () => {
    expect(
      withBasePath(
        "/test123456/issues/node-issue-1?view=session&takeover=1",
        "/tasks",
      ),
    ).toBe(
      "/tasks/test123456/issues/node-issue-1?view=session&takeover=1",
    );
  });

  it("does not duplicate an existing base path", () => {
    expect(withBasePath("/tasks/test123456/issues/issue-1", "/tasks"))
      .toBe("/tasks/test123456/issues/issue-1");
  });

  it("leaves routes unchanged when no base path is configured", () => {
    expect(withBasePath("/test123456/issues/issue-1", ""))
      .toBe("/test123456/issues/issue-1");
  });
});

describe("buildShareableUrl", () => {
  it("builds a shareable URL with the Next.js base path", () => {
    expect(
      buildShareableUrl(
        "http://192.168.100.21:3000",
        "/test123456/issues/node-issue-1?view=session&takeover=1",
        "/tasks",
      ),
    ).toBe(
      "http://192.168.100.21:3000/tasks/test123456/issues/node-issue-1?view=session&takeover=1",
    );
  });
});
