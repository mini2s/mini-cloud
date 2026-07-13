// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { ChatWindow } from "./chat-window";

const mocks = vi.hoisted(() => ({
  isOpen: false,
  isExpanded: false,
  activeSessionId: null as string | null,
  selectedAgentId: null as string | null,
  setOpen: vi.fn(),
  setActiveSession: vi.fn(),
  setSelectedAgentId: vi.fn(),
}));

vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, ...props }: { children: ReactNode }) => <div data-testid="chat-window" {...props}>{children}</div>,
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: "user-1" } }),
}));

vi.mock("@multica/core/workspace/queries", () => ({
  agentListOptions: () => ({ queryKey: ["agents"] }),
  memberListOptions: () => ({ queryKey: ["members"] }),
}));

vi.mock("@multica/views/issues/components", () => ({
  canAssignAgent: () => true,
}));

vi.mock("@multica/core/api", () => ({
  api: {
    sendChatMessage: vi.fn(),
    cancelTaskById: vi.fn(),
  },
}));

vi.mock("@multica/core/agents", () => ({
  useAgentPresenceDetail: () => "loading",
  useWorkspaceAgentAvailability: () => "some",
}));

vi.mock("@multica/core/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ uploadWithToast: vi.fn() }),
}));

vi.mock("@multica/core/chat/queries", () => ({
  chatSessionsOptions: () => ({ queryKey: ["chat-sessions"] }),
  chatMessagesOptions: () => ({ queryKey: ["chat-messages"] }),
  pendingChatTaskOptions: () => ({ queryKey: ["pending-task"] }),
  pendingChatTasksOptions: () => ({ queryKey: ["pending-tasks"] }),
  chatKeys: {
    messages: (id: string) => ["chat-messages", id],
    pendingTask: (id: string) => ["pending-task", id],
  },
}));

vi.mock("@multica/core/chat/mutations", () => ({
  useCreateChatSession: () => ({ mutateAsync: vi.fn() }),
  useDeleteChatSession: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkChatSessionRead: () => ({ mutate: vi.fn() }),
  useUpdateChatSession: () => ({ mutate: vi.fn() }),
}));

vi.mock("@multica/core/chat", () => ({
  useChatStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        isOpen: mocks.isOpen,
        activeSessionId: mocks.activeSessionId,
        selectedAgentId: mocks.selectedAgentId,
        setOpen: mocks.setOpen,
        setActiveSession: mocks.setActiveSession,
        setSelectedAgentId: mocks.setSelectedAgentId,
        isExpanded: mocks.isExpanded,
        focusMode: false,
      }),
    { getState: () => ({ focusMode: false }) },
  ),
}));

vi.mock("./chat-message-list", () => ({
  ChatMessageList: () => <div />,
  ChatMessageSkeleton: () => <div />,
}));

vi.mock("./chat-input", () => ({
  ChatInput: () => <div />,
}));

vi.mock("./context-anchor", () => ({
  ContextAnchorButton: () => <div />,
  ContextAnchorCard: () => <div />,
  buildAnchorMarkdown: () => "",
  useRouteAnchorCandidate: () => ({ candidate: null }),
}));

vi.mock("./chat-resize-handles", () => ({
  ChatResizeHandles: () => <div />,
}));

vi.mock("./use-chat-resize", () => ({
  useChatResize: () => ({
    renderWidth: 420,
    renderHeight: 640,
    isAtMax: false,
    boundsReady: true,
    isDragging: false,
    toggleExpand: vi.fn(),
    startDrag: vi.fn(),
  }),
}));

vi.mock("@multica/core/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: () => <div />,
}));

vi.mock("./offline-banner", () => ({ OfflineBanner: () => <div /> }));
vi.mock("./no-agent-banner", () => ({ NoAgentBanner: () => <div /> }));

vi.mock("../../i18n", () => ({
  useT: () => ({
    t: () => "translated",
  }),
}));

describe("ChatWindow", () => {
  beforeEach(() => {
    mocks.isOpen = false;
    mocks.isExpanded = false;
    mocks.activeSessionId = null;
    mocks.selectedAgentId = null;
  });

  it("does not leave an invisible window layer in the DOM when closed", () => {
    render(<ChatWindow />);

    expect(screen.queryByTestId("chat-window")).not.toBeInTheDocument();
  });
});
