// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitConfigPanel } from "./split-config-panel";
import type { SplitConfig } from "@multica/core/types";

vi.mock("../../../i18n", () => {
  const translations = {
    detail_panel: {
      split_title: "Split settings",
      split_subtitle: "Configure child issue release behavior.",
      split_review_required_title: "Human review is required",
      split_review_required_hint: "Generated split tasks always stop for human review before child issues are created.",
      split_release_mode_label: "Release downstream work",
      split_release_after_finish: "barrier",
      split_release_after_created: "pipeline",
      split_mode_barrier_description: "Wait until child issues finish before downstream nodes continue.",
      split_mode_pipeline_description: "Continue downstream after child issues are created.",
      split_concurrency_question: "How many child issues can run at once?",
      split_concurrency_hint: "Run at most this many child issues at once.",
      split_failure_tolerance_label: "Failure tolerance",
      split_max_failures_hint: "Barrier mode fails the parent split when child failures exceed this number.",
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

const config: SplitConfig = {
  mode: "barrier",
  max_concurrency: 3,
  max_failures: 1,
};

describe("SplitConfigPanel", () => {
	it("does not render a default child workflow control", () => {
		render(<SplitConfigPanel config={config} onChange={vi.fn()} />);
		expect(screen.queryByLabelText("Child issue default workflow")).not.toBeInTheDocument();
	});

  it("renders user-facing split behavior copy and sends changes", () => {
    const onChange = vi.fn();

    render(
      <SplitConfigPanel
        config={config}
        onChange={onChange}
      />,
    );

    expect(screen.queryByText("Split settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Configure child issue release behavior.")).not.toBeInTheDocument();
    expect(screen.getByText("Release downstream work")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /barrier/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /pipeline/ })).toBeInTheDocument();
    expect(screen.getByText("Wait until child issues finish before downstream nodes continue.")).toBeInTheDocument();
    expect(screen.getByText("Continue downstream after child issues are created.")).toBeInTheDocument();
    expect(screen.getByLabelText("How many child issues can run at once?")).toHaveValue(3);
    expect(screen.getByLabelText("Failure tolerance")).toHaveValue(1);

    fireEvent.click(screen.getByRole("button", { name: /pipeline/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...config, mode: "pipeline" });

    fireEvent.change(screen.getByLabelText("How many child issues can run at once?"), {
      target: { value: "9" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...config, max_concurrency: 9 });
  });

  it("disables controls without calling onChange", () => {
    const onChange = vi.fn();

    render(
      <SplitConfigPanel
        config={config}
        disabled
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: /pipeline/ })).toBeDisabled();
    expect(screen.getByLabelText("How many child issues can run at once?")).toBeDisabled();
    expect(screen.getByLabelText("Failure tolerance")).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
