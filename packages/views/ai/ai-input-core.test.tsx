import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiInputCore } from "./ai-input-core";

describe("AiInputCore", () => {
  /** Convenience helper: find the submit button in the button list. */
  function getSubmitButton() {
    const buttons = screen.getAllByRole("button");
    // The last button in the action row is SubmitButton.
    return buttons[buttons.length - 1]!;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  it("renders the textarea with the given placeholder", () => {
    render(
      <AiInputCore
        mode="command"
        placeholder="Type a command…"
        showAgentSelector={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByPlaceholderText("Type a command…"),
    ).toBeInTheDocument();
  });

  it("disables the textarea when disabled is true", () => {
    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("disables the submit button from the start when disabled is true (no text typed)", () => {
    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={vi.fn()}
        disabled
      />,
    );
    expect(getSubmitButton()).toBeDisabled();
  });

  it("shows the agent selector dropdown when showAgentSelector is true", () => {
    render(
      <AiInputCore
        mode="chat"
        placeholder=""
        showAgentSelector
        defaultAgentId=""
        onSubmit={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
  });

  it("renders Default agent as the default option text", () => {
    render(
      <AiInputCore
        mode="chat"
        placeholder=""
        showAgentSelector
        defaultAgentId=""
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: "Default agent" })).toBeInTheDocument();
  });

  it("does not render the agent selector when showAgentSelector is false", () => {
    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("disables the agent selector when disabled is true", () => {
    render(
      <AiInputCore
        mode="chat"
        placeholder=""
        showAgentSelector
        defaultAgentId="agent-1"
        onSubmit={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  // ---------------------------------------------------------------------------
  // Submission behaviour (command mode)
  // ---------------------------------------------------------------------------

  it("calls onSubmit with trimmed text on Enter in command mode", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox"), "deploy to prod");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("deploy to prod", "");
  });

  it("does not submit when the input is empty", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit when the input is whitespace only", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox"), "   ");
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears the textarea after a successful submit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="command"
        placeholder="Enter text"
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByPlaceholderText("Enter text");
    await user.type(textarea, "do something");
    await user.keyboard("{Enter}");

    // Wait for React state to settle after the async onSubmit resolves.
    await vi.waitFor(() => {
      expect(textarea).toHaveValue("");
    });
  });

  // ---------------------------------------------------------------------------
  // Submission behaviour (chat mode — Mod+Enter)
  // ---------------------------------------------------------------------------

  it("submits on Ctrl+Enter in chat mode", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="chat"
        placeholder=""
        showAgentSelector
        defaultAgentId="agent-42"
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox"), "build a CI pipeline");
    await user.keyboard("{Control>}{Enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("build a CI pipeline", "agent-42");
  });

  it("submits on Meta+Enter in chat mode", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="chat"
        placeholder=""
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox"), "hello");
    await user.keyboard("{Meta>}{Enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("hello", "");
  });

  it("does NOT submit on plain Enter in chat mode", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="chat"
        placeholder=""
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox"), "hello");
    await user.keyboard("{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  it("shows an error message when onSubmit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Network failure"));
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox"), "trigger error");
    await user.keyboard("{Enter}");

    const errorEl = await screen.findByText("Network failure");
    expect(errorEl).toBeInTheDocument();
    // Error text uses the destructive colour token.
    expect(errorEl).toHaveClass("text-destructive");
  });

  it("shows a generic message when onSubmit rejects with a non-Error", async () => {
    const onSubmit = vi.fn().mockRejectedValue("string reason");
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox"), "boom");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("clears the error message when the user starts typing again", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Fail"));
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="command"
        placeholder="input"
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    // Trigger an error.
    const textarea = screen.getByPlaceholderText("input");
    await user.type(textarea, "fail");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Fail")).toBeInTheDocument();

    // Type again — error should go away.
    await user.type(textarea, "x");
    expect(screen.queryByText("Fail")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Submit button disabled state
  // ---------------------------------------------------------------------------

  it("disables the submit button when the textarea is empty", () => {
    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(getSubmitButton()).toBeDisabled();
  });

  it("disables the submit button when the textarea has only whitespace", async () => {
    const user = userEvent.setup();
    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox"), "   ");

    expect(getSubmitButton()).toBeDisabled();
  });

  it("enables the submit button after text is typed", async () => {
    const user = userEvent.setup();
    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox"), "a");

    expect(getSubmitButton()).toBeEnabled();
  });

  // ---------------------------------------------------------------------------
  // Preventing double-submit while a submission is in-flight
  // ---------------------------------------------------------------------------

  it("does not call onSubmit again while a previous submit is still resolving", async () => {
    // Keep the promise pending so we control when it resolves.
    let resolvePromise!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolvePromise = res;
        }),
    );

    const user = userEvent.setup();
    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox"), "first");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // While the first call is still pending, press Enter again.
    await user.keyboard("{Enter}");
    // The second Enter should be ignored because submitting is still true.
    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolvePromise!();
  });

  // ---------------------------------------------------------------------------
  // Shift+Enter inserts a newline (command mode does not submit)
  // ---------------------------------------------------------------------------

  it("does not submit on Shift+Enter in command mode", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="command"
        placeholder=""
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox"), "multi line");
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
