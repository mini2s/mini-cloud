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

function renderSession(mode: "observe" | "control", onTakeover = vi.fn()) {
  return render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <Session
        sessionId="session-test"
        mode={mode}
        active
        onTakeover={onTakeover}
      />
    </I18nProvider>,
  );
}

describe("Session", () => {
  it("hydrates fixture messages and keeps observe mode read-only", async () => {
    const onTakeover = vi.fn();
    const user = userEvent.setup();
    renderSession("observe", onTakeover);

    expect(screen.getByRole("status", { name: "Loading live session…" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Live session message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Take over the session to send messages or stop the current run."),
    ).toBeInTheDocument();

    await screen.findByRole("button", { name: "Show read details" });
    expect(screen.getByRole("button", { name: "Show fixture_metadata details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show search details" })).toHaveTextContent("Failed");

    await user.click(screen.getByRole("button", { name: "Take over session" }));
    expect(onTakeover).toHaveBeenCalledOnce();
  });

  it("streams a fixture reply and can stop it without discarding output", async () => {
    const user = userEvent.setup();
    renderSession("control");

    const input = screen.getByRole("textbox", { name: "Live session message" });
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, "Summarize the next step");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("button", { name: "Stop generating" })).toBeEnabled();
    expect(screen.getByText("Summarize the next step")).toBeInTheDocument();
    await screen.findByText("I reviewed your message.");

    await user.click(screen.getByRole("button", { name: "Stop generating" }));
    await screen.findByText("Response stopped");
    expect(screen.getByText("I reviewed your message.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled());
  });
});
