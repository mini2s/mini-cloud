// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "@multica/core/types";
import { useUsableWorkflowRuntimes } from "./use-usable-workflow-runtimes";

const permissionResults = vi.hoisted(() => [] as Array<{
  data?: { can_control: boolean };
  isLoading: boolean;
}>);

vi.mock("@tanstack/react-query", () => ({
  useQueries: () => permissionResults,
}));

vi.mock("@multica/core/runtimes/queries", () => ({
  myRuntimePermissionOptions: (runtimeId: string) => ({ queryKey: ["runtime-permission", runtimeId] }),
}));

function runtime(
  id: string,
  visibility: "public" | "private",
  provider = "csc",
): AgentRuntime {
  return {
    id,
    workspace_id: "ws-1",
    daemon_id: id,
    name: id,
    runtime_mode: "local",
    provider,
    launch_header: "",
    status: "online",
    device_info: "",
    metadata: {},
    owner_id: null,
    visibility,
    last_seen_at: "",
    created_at: "",
    updated_at: "",
  };
}

describe("useUsableWorkflowRuntimes", () => {
  it("keeps public and controllable private runtimes", () => {
    permissionResults.splice(
      0,
      permissionResults.length,
      { data: { can_control: true }, isLoading: false },
      { data: { can_control: false }, isLoading: false },
    );
    const runtimes = [
      runtime("public", "public"),
      runtime("allowed-private", "private"),
      runtime("denied-private", "private"),
    ];

    const { result } = renderHook(() => useUsableWorkflowRuntimes(runtimes));

    expect(result.current.runtimes.map((candidate) => candidate.id)).toEqual([
      "public",
      "allowed-private",
    ]);
    expect(result.current.isLoading).toBe(false);
  });

  it("supports csc and cs-cloud providers only", () => {
    permissionResults.splice(0, permissionResults.length);
    const runtimes = [
      runtime("csc", "public", "csc"),
      runtime("cs-cloud", "public", "cs-cloud"),
      runtime("codex", "public", "codex"),
    ];

    const { result } = renderHook(() => useUsableWorkflowRuntimes(runtimes));

    expect(result.current.runtimes.map((candidate) => candidate.id)).toEqual([
      "csc",
      "cs-cloud",
    ]);
  });
});
