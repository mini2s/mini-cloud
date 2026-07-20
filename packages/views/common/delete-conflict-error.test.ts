import { describe, expect, it } from "vitest";
import { ApiError } from "@multica/core/api";
import { getDeleteConflictMessage } from "./delete-conflict-error";

const messages = {
  active_split_blocking: "active split",
  runtime_has_active_agents: "active agents",
  template_has_derived_workflows: "derived workflows",
};

describe("getDeleteConflictMessage", () => {
  it.each([
    ["active_split_blocking", "active split"],
    ["runtime_has_active_agents", "active agents"],
    ["template_has_derived_workflows", "derived workflows"],
  ])("maps %s to its localized message", (code, expected) => {
    const error = new ApiError("backend message", 409, "Conflict", { code });

    expect(getDeleteConflictMessage(error, messages)).toBe(expected);
  });

  it("ignores non-conflict errors", () => {
    const error = new ApiError("server error", 500, "Server Error", {
      code: "active_split_blocking",
    });

    expect(getDeleteConflictMessage(error, messages)).toBeNull();
  });

  it.each([null, {}, { code: null }, { code: 42 }, { code: "future_conflict_code" }])(
    "ignores malformed error bodies %#",
    (body) => {
      const error = new ApiError("backend message", 409, "Conflict", body);

      expect(getDeleteConflictMessage(error, messages)).toBeNull();
    },
  );
});
