import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@multica/core/i18n/react";
import enChat from "../../locales/en/chat.json";
import { Session } from "./session";

const TEST_RESOURCES = { en: { chat: enChat } };

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

function SessionHarness({ sessionId, mode = "control" }: { sessionId: string; mode?: "observe" | "control" }) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <Session sessionId={sessionId} mode={mode} active onTakeover={vi.fn()} />
    </I18nProvider>
  );
}

describe("FixtureSessionRuntimeProvider", () => {
  it("drops pending stream callbacks when the session changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SessionHarness sessionId="session-a" />);

    const input = screen.getByRole("textbox", { name: "Live session message" });
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, "Start an old-session response");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("I reviewed your message.");

    rerender(<SessionHarness sessionId="session-b" />);
    expect(screen.getByTestId("session")).toHaveAttribute("data-session-id", "session-b");
    expect(screen.getByRole("status", { name: "Loading live session…" })).toBeInTheDocument();

    await screen.findByRole("button", { name: "Show read details" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByText("Start an old-session response")).not.toBeInTheDocument();
    expect(screen.queryByText(/Here is the fixture response/)).not.toBeInTheDocument();
  });

  it("does not append messages while observing", async () => {
    const user = userEvent.setup();
    render(<SessionHarness sessionId="session-observe" mode="observe" />);

    await screen.findByRole("button", { name: "Show read details" });
    expect(screen.queryByRole("textbox", { name: "Live session message" })).not.toBeInTheDocument();
    await user.keyboard("This must not be sent{Enter}");
    expect(screen.queryByText("This must not be sent")).not.toBeInTheDocument();
  });
});
