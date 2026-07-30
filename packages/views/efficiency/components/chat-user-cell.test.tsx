import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatUserCell } from "./chat-user-cell";

// ChatUserCell mirrors the source's fallback chain: roster hit (真名(工号)) →
// trimmed chat username → truncated UUID (first 8 chars + …) → "-".
// resolveName is injected, so each branch is exercised without query mocks.

const UID = "3f4b9a2e-1111-2222-3333-444455556666";

describe("ChatUserCell", () => {
  it("shows the resolved roster name when resolveName maps the uid", () => {
    render(
      <ChatUserCell
        universalId={UID}
        chatUsername="zhangsan"
        resolveName={(id) => (id === UID ? "张三(10023)" : id ?? "-")}
      />,
    );
    expect(screen.getByText("张三(10023)")).toBeInTheDocument();
    // The raw chat username must not leak through on a roster hit.
    expect(screen.queryByText("zhangsan")).not.toBeInTheDocument();
  });

  it("falls back to the trimmed chat username when the roster has no entry", () => {
    render(
      <ChatUserCell
        universalId={UID}
        chatUsername="  zhangsan  "
        resolveName={(id) => id ?? "-"}
      />,
    );
    expect(screen.getByText("zhangsan")).toBeInTheDocument();
  });

  it("falls back to the truncated UUID when neither roster nor username exists", () => {
    render(
      <ChatUserCell
        universalId={UID}
        chatUsername={null}
        resolveName={(id) => id ?? "-"}
      />,
    );
    expect(screen.getByText("3f4b9a2e…")).toBeInTheDocument();
  });

  it('renders "-" when there is nothing to show', () => {
    render(
      <ChatUserCell
        universalId={null}
        chatUsername={null}
        resolveName={(id) => id ?? "-"}
      />,
    );
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("treats a resolveName '-' result as a miss and uses the username fallback", () => {
    // resolveName returns "-" for empty ids; a uid resolving to "-" (edge)
    // must follow the fallback chain rather than render "-".
    render(
      <ChatUserCell
        universalId={UID}
        chatUsername="lisi"
        resolveName={() => "-"}
      />,
    );
    expect(screen.getByText("lisi")).toBeInTheDocument();
  });
});
