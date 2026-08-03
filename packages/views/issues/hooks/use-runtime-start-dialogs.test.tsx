import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const { agents, workflows, runtimes } = vi.hoisted(() => ({
	agents: [{ id: "ag1", is_builtin: true, name: "Agent One" }],
	workflows: [{ id: "wf1", title: "Workflow One" }],
	runtimes: [{ id: "rt1", status: "online" }, { id: "rt2", status: "online" }],
}));

vi.mock("@multica/core/runtimes/queries", () => ({
	runtimeListOptions: () => ({ queryKey: ["runtimes"], queryFn: () => runtimes }),
}));
vi.mock("@multica/core/workspace/queries", () => ({
	agentListOptions: () => ({ queryKey: ["agents"], queryFn: () => agents }),
}));
vi.mock("@multica/core/workflows/queries", () => ({
	workflowActiveListOptions: () => ({ queryKey: ["workflows"], queryFn: () => workflows }),
}));
vi.mock("../../workflows/components/use-usable-workflow-runtimes", () => ({
	useUsableWorkflowRuntimes: () => ({ runtimes, isLoading: false }),
}));

// The hook calls useQuery(runtimeListOptions(wsId)) etc. — each *ListOptions
// mock above returns a {queryKey, queryFn} pair. useQuery must invoke queryFn
// so the hoisted data flows through as `data`.
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryFn }: { queryFn?: () => unknown }) => ({
		data: queryFn ? queryFn() : undefined,
		isLoading: false,
	}),
}));

import { useRuntimeStartDialogs } from "./use-runtime-start-dialogs";

describe("useRuntimeStartDialogs", () => {
	it("defers (opens dialog) for workflow / agent / squad, commits directly for member", () => {
		const { result } = renderHook(() => useRuntimeStartDialogs("ws-1"));
		const committed = vi.fn();
		const payload = { status: "in_progress" };

		// member -> commits directly, returns true
		expect(result.current.maybeSelectRuntimeThen("member", "m1", payload, committed)).toBe(true);
		expect(committed).toHaveBeenCalledTimes(1);

		// workflow -> defers
		expect(result.current.maybeSelectRuntimeThen("workflow", "wf1", payload, committed)).toBe(false);
		// agent (builtin) -> defers
		expect(result.current.maybeSelectRuntimeThen("agent", "ag1", payload, committed)).toBe(false);
		// squad -> defers
		expect(result.current.maybeSelectRuntimeThen("squad", "sq1", payload, committed)).toBe(false);

		expect(committed).toHaveBeenCalledTimes(1); // member still the only commit
	});
});
