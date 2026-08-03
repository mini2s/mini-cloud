import { describe, it, expect, vi } from "vitest";
import { renderHook, act, render } from "@testing-library/react";

const { agents, workflows, runtimes, squads } = vi.hoisted(() => ({
	agents: [{ id: "ag1", is_builtin: true, name: "Agent One" }],
	workflows: [{ id: "wf1", title: "Workflow One" }],
	runtimes: [{ id: "rt1", status: "online" }, { id: "rt2", status: "online" }],
	squads: [{ id: "sq1", name: "Squad One" }],
}));

vi.mock("@multica/core/runtimes/queries", () => ({
	runtimeListOptions: () => ({ queryKey: ["runtimes"], queryFn: () => runtimes }),
}));
vi.mock("@multica/core/workspace/queries", () => ({
	agentListOptions: () => ({ queryKey: ["agents"], queryFn: () => agents }),
	squadListOptions: () => ({ queryKey: ["squads"], queryFn: () => squads }),
}));
vi.mock("@multica/core/workflows/queries", () => ({
	workflowActiveListOptions: () => ({ queryKey: ["workflows"], queryFn: () => workflows }),
}));
vi.mock("../../workflows/components/use-usable-workflow-runtimes", () => ({
	useUsableWorkflowRuntimes: () => ({ runtimes, isLoading: false }),
}));

// Mock the dialog to a tiny component that exposes its props as data
// attributes, so the test can verify the hook passes the right per-kind
// workflowTitle / initialValue without coupling to the real dialog's internals
// (i18n, providers, etc.).
vi.mock("../../workflows/components/workflow-runtime-strategy-dialog", () => ({
	WorkflowRuntimeStrategyDialog: ({
		workflowTitle,
		initialValue,
	}: {
		workflowTitle: string;
		initialValue: { policy: string; runtimeId: string | null };
	}) => (
		<div
			data-testid="workflow-runtime-strategy-dialog"
			data-workflowtitle={workflowTitle}
			data-policy={initialValue?.policy}
			data-runtimeid={initialValue?.runtimeId ?? ""}
		/>
	),
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
		act(() => {
			expect(result.current.maybeSelectRuntimeThen("member", "m1", payload, committed)).toBe(true);
		});
		expect(committed).toHaveBeenCalledTimes(1);

		// workflow -> defers; dialog should carry the workflow title + defaults
		act(() => {
			expect(result.current.maybeSelectRuntimeThen("workflow", "wf1", payload, committed)).toBe(false);
		});
		let view = render(result.current.dialogs);
		let dialog = view.getByTestId("workflow-runtime-strategy-dialog");
		expect(dialog).toHaveAttribute("data-workflowtitle", "Workflow One");
		expect(dialog).toHaveAttribute("data-policy", "idle_first");
		expect(dialog).toHaveAttribute("data-runtimeid", "");
		view.unmount();

		// agent (builtin) -> defers; dialog should carry the agent name
		act(() => {
			expect(result.current.maybeSelectRuntimeThen("agent", "ag1", payload, committed)).toBe(false);
		});
		view = render(result.current.dialogs);
		dialog = view.getByTestId("workflow-runtime-strategy-dialog");
		expect(dialog).toHaveAttribute("data-workflowtitle", "Agent One");
		expect(dialog).toHaveAttribute("data-policy", "idle_first");
		expect(dialog).toHaveAttribute("data-runtimeid", "");
		view.unmount();

		// squad -> defers; dialog should carry the squad name (not empty)
		act(() => {
			expect(result.current.maybeSelectRuntimeThen("squad", "sq1", payload, committed)).toBe(false);
		});
		view = render(result.current.dialogs);
		dialog = view.getByTestId("workflow-runtime-strategy-dialog");
		expect(dialog).toHaveAttribute("data-workflowtitle", "Squad One");
		expect(dialog).toHaveAttribute("data-policy", "idle_first");
		expect(dialog).toHaveAttribute("data-runtimeid", "");
		view.unmount();

		expect(committed).toHaveBeenCalledTimes(1); // member still the only commit
	});
});
