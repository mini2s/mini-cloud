// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@multica/core/i18n/react";
import { RuntimeSelectDialog } from "./runtime-select-dialog";
import enAgents from "../../locales/en/agents.json";

describe("RuntimeSelectDialog", () => {
  it("keeps auto selection available when the workspace has no runtime", () => {
    const onConfirm = vi.fn();

    render(
      <I18nProvider locale="en" resources={{ en: { agents: enAgents } }}>
        <RuntimeSelectDialog
          agentName="Test Workflow"
          runtimes={[]}
          loading={false}
          allowAuto
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Auto-select (recommended)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });
});
