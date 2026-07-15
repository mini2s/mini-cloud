// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SplitChatReview } from "./split-chat-review";

describe("SplitChatReview", () => {
  it("labels the natural language adjustment composer", async () => {
    render(<SplitChatReview onSubmit={vi.fn()} />);

    const composer = screen.getByRole("textbox", { name: "输入调整要求" });

    expect(composer).toHaveAttribute("placeholder", "输入调整要求…");
  });

  it("submits typed natural language adjustments", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SplitChatReview onSubmit={onSubmit} />);

    await userEvent.type(screen.getByRole("textbox", { name: "输入调整要求" }), "删除第 3 个子 issue");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onSubmit).toHaveBeenCalledWith("删除第 3 个子 issue");
  });
});
