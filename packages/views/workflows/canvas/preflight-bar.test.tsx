// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { PreflightBar } from "./preflight-bar";

describe("PreflightBar", () => {
  it("renders success state when there are no issues", () => {
    renderWithI18n(<PreflightBar issues={[]} onIssueClick={() => undefined} />);
    expect(screen.getByText("Ready to publish")).toBeTruthy();
  });

  it("renders issues and calls locate callback", () => {
    const onIssueClick = vi.fn();
    renderWithI18n(
      <PreflightBar
        issues={[{ code: "missing_worker", nodeId: "n1", message: "Node is missing a worker." }]}
        onIssueClick={onIssueClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Node is missing a worker." }));
    expect(onIssueClick).toHaveBeenCalledWith({ code: "missing_worker", nodeId: "n1", message: "Node is missing a worker." });
  });
});
