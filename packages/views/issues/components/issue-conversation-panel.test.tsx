import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useIssueConversationSession: vi.fn(),
  refetch: vi.fn(),
  sessionProps: null as Record<string, unknown> | null,
  runtimeProps: null as Record<string, unknown> | null,
}));

vi.mock("@multica/core/conversations", () => ({
  useIssueConversationSession: mocks.useIssueConversationSession,
  resolveCloudProxyBaseUrl: (baseUrl: string, origin: string) =>
    new URL(baseUrl, origin).href.replace(/\/$/, ""),
}));

vi.mock("../../common/session", () => ({
  Session: (props: Record<string, unknown>) => {
    mocks.sessionProps = props;
    return <div data-testid="real-session" />;
  },
}));

vi.mock("../../common/session/runtime/conversation-runtime-provider", () => ({
  ConversationRuntimeProvider: ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) => {
    mocks.runtimeProps = props;
    return children;
  },
}));

vi.mock("../../i18n", () => ({
  useT: () => ({
    t: (selector: (root: Record<string, unknown>) => unknown) =>
      selector({
        session: {
          loading: "Loading live session",
          load_error: "Could not load",
          retry: "Retry",
        },
      }),
  }),
}));

import { IssueConversationPanel } from "./issue-conversation-panel";

beforeEach(() => {
  mocks.refetch.mockReset();
  mocks.sessionProps = null;
  mocks.runtimeProps = null;
  mocks.useIssueConversationSession.mockReset();
});

describe("IssueConversationPanel", () => {
  it("keeps the issue session query disabled while the panel is inactive", () => {
    mocks.useIssueConversationSession.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
      refetch: mocks.refetch,
    });

    render(
      <IssueConversationPanel
        workspaceId="workspace-1"
        issueId="issue-1"
        mode="observe"
        active={false}
        onTakeover={vi.fn()}
      />,
    );

    expect(mocks.useIssueConversationSession).toHaveBeenCalledWith(
      "workspace-1",
      "issue-1",
      false,
    );
  });

  it("resolves the proxy URL and uses the returned conversation ID", () => {
    mocks.useIssueConversationSession.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        conversationId: "conversation-from-issue-session",
        workspaceDirectory: "/workspace",
        proxyBaseUrl: "/cloud-api/device-1/proxy",
      },
      refetch: mocks.refetch,
    });

    render(
      <IssueConversationPanel
        workspaceId="workspace-1"
        issueId="issue-1"
        mode="control"
        active
        onTakeover={vi.fn()}
      />,
    );

    expect(screen.getByTestId("real-session")).toBeInTheDocument();
    expect(mocks.sessionProps).toMatchObject({
      mode: "control",
      active: true,
    });
    expect(mocks.runtimeProps).toMatchObject({
      mode: "control",
      descriptor: {
        conversationId: "conversation-from-issue-session",
        workspaceDirectory: "/workspace",
        proxyBaseUrl: "http://localhost:3000/cloud-api/device-1/proxy",
      },
    });
  });

  it("renders a retry action when descriptor loading fails", () => {
    mocks.useIssueConversationSession.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      refetch: mocks.refetch,
    });

    render(
      <IssueConversationPanel
        workspaceId="workspace-1"
        issueId="issue-1"
        mode="observe"
        active
        onTakeover={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
