// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreflightBar } from "./preflight-bar";
import type { PreflightResult } from "@multica/core/workflows/preflight-checks";

vi.mock("../../../i18n", () => {
  const translations = {
    preflight: {
      bar_collapsed_all_clear: "Ready to publish",
      bar_dismiss: "Dismiss",
      bar_expand: "Review issues",
      bar_publish: "Publish",
      bar_publishing: "Publishing...",
      check_dag_cycle: "Cycle",
      check_worker_missing: "No worker",
      check_stage_missing: "No stage",
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string, options?: Record<string, string>) => {
        let value = selector(translations);
        if (options) for (const [k, r] of Object.entries(options)) value = value.replace(`{{${k}}}`, String(r));
        return value;
      },
    }),
  };
});

function makeResult(o: Partial<PreflightResult>): PreflightResult {
  return { issues: [], blockingCount: 0, warningCount: 0, passed: true, ...o };
}

describe("PreflightBar", () => {
  const base = { onNavigateToNode: vi.fn(), onPublish: vi.fn(), onDismiss: vi.fn() };

  it("shows all-clear with publish button", () => {
    render(<PreflightBar {...base} result={makeResult({ passed: true, issues: [] })} />);
    expect(screen.getByText("Ready to publish")).toBeDefined();
    expect(screen.getByTestId("preflight-publish-btn")).not.toBeDisabled();
  });

  it("shows inline chips for issues", () => {
    render(<PreflightBar {...base} result={makeResult({
      passed: false, blockingCount: 1, warningCount: 1,
      issues: [
        { checkId: "worker-missing", severity: "error", blocking: true, nodeId: "n1", nodeTitle: "Node A", message: "" },
        { checkId: "stage-missing", severity: "warning", blocking: false, nodeId: "n2", nodeTitle: "Node B", message: "" },
      ],
    })} />);
    const chips = screen.getAllByTestId("preflight-issue-item");
    expect(chips.length).toBe(2);
    expect(screen.getByTestId("preflight-publish-btn")).toBeDisabled();
  });

  it("summarizes many issues behind a review popover instead of expanding the bar", () => {
    render(<PreflightBar {...base} result={makeResult({
      passed: false,
      blockingCount: 20,
      warningCount: 0,
      issues: Array.from({ length: 20 }, (_, index) => ({
        checkId: "worker-missing",
        severity: "error",
        blocking: true,
        nodeId: `n${index}`,
        nodeTitle: `Node ${index}`,
        message: "",
      })),
    })} />);

    expect(screen.getByTestId("preflight-bar").className).toContain("h-12");
    expect(screen.getAllByTestId("preflight-issue-item")).toHaveLength(4);
    expect(screen.getByTestId("preflight-review-btn")).toHaveTextContent("Review issues");

    fireEvent.click(screen.getByTestId("preflight-review-btn"));

    expect(screen.getByTestId("preflight-review-list").className).toContain("overflow-y-auto");
    expect(screen.getAllByTestId("preflight-review-issue-item")).toHaveLength(20);
  });

  it("navigates to node when chip clicked", () => {
    const nav = vi.fn();
    render(<PreflightBar {...base} onNavigateToNode={nav} result={makeResult({
      passed: false, blockingCount: 1, warningCount: 0,
      issues: [{ checkId: "dag-cycle", severity: "error", blocking: true, nodeId: "n1", nodeTitle: "A", message: "" }],
    })} />);
    fireEvent.click(screen.getByTestId("preflight-issue-item"));
    expect(nav).toHaveBeenCalledWith("n1");
  });

  it("calls onPublish when no blocking issues", () => {
    const pub = vi.fn();
    render(<PreflightBar {...base} onPublish={pub} result={makeResult({ passed: true, issues: [] })} />);
    fireEvent.click(screen.getByTestId("preflight-publish-btn"));
    expect(pub).toHaveBeenCalledOnce();
  });

  it("calls onDismiss", () => {
    const dis = vi.fn();
    render(<PreflightBar {...base} onDismiss={dis} result={makeResult({
      passed: false, blockingCount: 1, warningCount: 0,
      issues: [{ checkId: "worker-missing", severity: "error", blocking: true, nodeId: "n1", nodeTitle: "A", message: "" }],
    })} />);
    fireEvent.click(screen.getByTestId("preflight-dismiss-btn"));
    expect(dis).toHaveBeenCalledOnce();
  });
});
