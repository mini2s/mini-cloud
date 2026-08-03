import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { ChannelsPage } from "./channels-page";

const state = vi.hoisted(() => ({
  channels: { data: undefined as unknown, isLoading: true },
  types: { data: undefined as unknown, isLoading: true },
  identities: { data: undefined as unknown, isLoading: true },
}));

vi.mock("@multica/core/channels", () => ({
  useChannels: () => state.channels,
  useAvailableChannelTypes: () => state.types,
  useIdentities: () => state.identities,
  useUpdateChannelMutation: () => ({ mutateAsync: vi.fn() }),
  useDeleteChannelMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestChannelMutation: () => ({ mutateAsync: vi.fn() }),
  channelKeys: { list: () => ["channels", "list"] },
}));

vi.mock("@tanstack/react-query", async (orig) => {
  const actual = await orig();
  return {
    ...(actual as object),
    useQueryClient: () => ({
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
    }),
  };
});

vi.mock("@multica/core/api", () => ({ api: { startIdentityBind: vi.fn() } }));

function resetState() {
  state.channels = { data: undefined, isLoading: true };
  state.types = { data: undefined, isLoading: true };
  state.identities = { data: undefined, isLoading: true };
}

describe("ChannelsPage", () => {
  it("renders the title and loading state while fetching", () => {
    resetState();
    renderWithI18n(<ChannelsPage />);

    expect(screen.getByText("Notification Channel Configuration")).toBeInTheDocument();
    expect(screen.getByText("Loading notification channels...")).toBeInTheDocument();
  });

  it("renders the empty state when no channel types are available", () => {
    state.channels = { data: [], isLoading: false };
    state.types = { data: [], isLoading: false };
    state.identities = { data: [], isLoading: false };

    renderWithI18n(<ChannelsPage />);

    expect(screen.getByText("No notification channels enabled")).toBeInTheDocument();
  });

  it("renders a section per available channel type", () => {
    state.channels = { data: [], isLoading: false };
    state.types = {
      data: [
        {
          type: "wecom-bot",
          capabilities: {
            inboundMessages: true,
            outboundMessages: true,
            directChat: true,
            groupChat: true,
            markdown: true,
            media: false,
            mentionRequired: false,
            contentTypes: ["text", "markdown"],
          },
          schema: null,
        },
      ],
      isLoading: false,
    };
    state.identities = { data: [], isLoading: false };

    renderWithI18n(<ChannelsPage />);

    expect(screen.getByText("WeCom Bot")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("shows Chinese copy under the zh-Hans locale", () => {
    state.channels = { data: [], isLoading: false };
    state.types = { data: [], isLoading: false };
    state.identities = { data: [], isLoading: false };

    renderWithI18n(<ChannelsPage />, { locale: "zh-Hans" });

    expect(screen.getByText("通知渠道配置")).toBeInTheDocument();
    expect(screen.getByText("平台未启用任何通知渠道")).toBeInTheDocument();
  });
});
