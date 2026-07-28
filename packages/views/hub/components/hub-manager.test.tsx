import type { ReactNode } from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@multica/core/i18n/react"
import { RESOURCES } from "../../test/i18n"
import type { CapabilityItem } from "@multica/core/types/hub"
import type { HubManagerListViewProps } from "./hub-manager-list-view"

const listViewProps = vi.hoisted(() => [] as HubManagerListViewProps[])
const searchParamsRef = vi.hoisted(() => ({ current: new URLSearchParams("tab=favorited") }))
const replaceMock = vi.hoisted(() => vi.fn())
const pushMock = vi.hoisted(() => vi.fn())

const item: CapabilityItem = {
  id: "item-1",
  registryId: "registry-1",
  slug: "test-skill",
  itemType: "skill",
  name: "Test Skill",
  description: "A skill used by HubManager tests",
  category: "testing",
  version: "1.0.0",
  content: "# Test Skill",
  visibility: "public",
  status: "published",
  favoriteCount: 3,
  favorited: true,
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
}

vi.mock("../../navigation", () => ({
  useNavigation: () => ({
    searchParams: searchParamsRef.current,
    pathname: "/test-workspace/hub/manager",
    replace: replaceMock,
    push: pushMock,
  }),
}))

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    hub: () => "/test-workspace/hub",
    hubEditor: () => "/test-workspace/hub/editor",
    hubEditorItem: (id: string) => `/test-workspace/hub/editor/${id}`,
  }),
}))

vi.mock("@multica/core/hub", () => ({
  useHubItems: () => ({ data: { items: [item], total: 1 }, isLoading: false }),
  useHubMyItems: () => ({ data: { items: [item], total: 1 }, isLoading: false }),
  useHubFavoriteMutation: () => ({ mutate: vi.fn() }),
  useHubUnfavoriteMutation: () => ({ mutate: vi.fn() }),
  useHubForkDistributionMutation: () => ({ mutate: vi.fn() }),
  useHubMyReceivedDistributions: () => ({ receipts: [], isLoading: false }),
  useHubMySentDistributions: () => ({ distributions: [], isLoading: false }),
  useHubDistributionAuthority: () => ({ canDistribute: false, departments: [], isLoading: false }),
  useHubFilterOptions: () => ({ data: { tags: [] } }),
  useHubManagerTabCounts: () => ({ createdCount: 1, favoritedCount: 1, isLoading: false }),
  useHubLogBehaviorMutation: () => ({ mutate: vi.fn() }),
}))

vi.mock("@multica/core/api", () => ({
  api: {
    hubDeleteItem: vi.fn(),
    hubBatchDeleteItems: vi.fn(),
    hubListMyItems: vi.fn(),
    hubRevokeDistribution: vi.fn(),
    hubDismissDistribution: vi.fn(),
    hubMarkDistributionRead: vi.fn(),
    hubGetUserNames: vi.fn(),
  },
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock("./hub-manager-list-view", () => ({
  HubManagerListView: (props: HubManagerListViewProps) => {
    listViewProps.push(props)
    return <div data-testid="hub-manager-list-view" />
  },
}))

vi.mock("./hub-filter-bar", () => ({ HubFilterBar: () => <div /> }))
vi.mock("./create-capability-dialog", () => ({ CreateCapabilityDialog: () => <button>创建能力</button> }))
vi.mock("./edit-capability-dialog", () => ({ EditCapabilityDialog: () => <div /> }))
vi.mock("./upload-plugin-dialog", () => ({ UploadPluginDialog: () => <div /> }))
vi.mock("./distribute-dialog", () => ({ DistributeDialog: () => <div /> }))
vi.mock("./hub-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock("../../layout/page-header", () => ({ PageHeader: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock("./pagination-bar", () => ({ PaginationBar: () => <div /> }))
vi.mock("./confirm-dialog", () => ({ ConfirmDialog: () => <div /> }))
vi.mock("./search-token-box", () => ({ SearchTokenBox: ({ placeholder }: { placeholder: string }) => <input aria-label={placeholder} /> }))
vi.mock("./item-detail-content", () => ({ ItemDetailContent: () => <div /> }))

import { HubManager } from "./hub-manager"

function renderManager(locale: "en" | "zh-Hans" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale} resources={RESOURCES}>
        <HubManager />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe("HubManager item tab list actions", () => {
  beforeEach(() => {
    listViewProps.length = 0
    searchParamsRef.current = new URLSearchParams("tab=favorited")
    replaceMock.mockClear()
    pushMock.mockClear()
  })

  it("does not expose inline subscribe or owner-only list actions on the favorited tab", () => {
    renderManager()

    const props = listViewProps.at(-1)
    expect(props).toBeTruthy()
    expect(props?.selectable).toBe(false)
    expect(props?.onFav).toBeUndefined()
    expect(props?.onEdit).toBeUndefined()
    expect(props?.onOpenInEditor).toBeUndefined()
    expect(props?.onDelete).toBeUndefined()
  })

  it("routes the created-tab edit action to the full editor page (no dialog)", () => {
    searchParamsRef.current = new URLSearchParams("tab=created")
    renderManager()

    const props = listViewProps.at(-1)
    expect(props).toBeTruthy()
    expect(typeof props?.onEdit).toBe("function")
    // old store has a single "edit" entry that opens the full editor page;
    // the separate "open in editor" button is gone.
    expect(props?.onOpenInEditor).toBeUndefined()

    // invoking onEdit must navigate to the editor route, not open a dialog
    pushMock.mockClear()
    props!.onEdit!(item)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock.mock.calls[0]![0]).toContain("/hub/editor/item-1")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("uses source-store toolbar and search labels in Chinese", () => {
    renderManager("zh-Hans")

    expect(screen.getByRole("button", { name: "回到首页" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "创建能力" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "上传 Plugin" })).toBeTruthy()
    expect(screen.getByLabelText("搜索能力")).toBeTruthy()
  })

  it("uses source-store sidebar tab labels in Chinese", () => {
    renderManager("zh-Hans")

    expect(screen.getByRole("button", { name: /我创建的/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /我订阅的/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /我收到的推送/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /我下发的/ })).toBeTruthy()
  })

  it("uses source-store copy for empty received and sent tabs", () => {
    searchParamsRef.current = new URLSearchParams("tab=received")
    const { unmount } = renderManager("zh-Hans")

    expect(screen.getByRole("heading", { name: "我收到的推送" })).toBeTruthy()
    expect(screen.getByText("管理员推送给您的 skill")).toBeTruthy()
    expect(screen.getByText("暂无推送")).toBeTruthy()
    expect(screen.getByText("当管理员向您推送 skill 时，将显示在这里")).toBeTruthy()

    unmount()
    listViewProps.length = 0
    searchParamsRef.current = new URLSearchParams("tab=sent")
    renderManager("zh-Hans")

    expect(screen.getByRole("heading", { name: "我下发的" })).toBeTruthy()
    expect(screen.getByText("管理您推送给团队或个人的 skill")).toBeTruthy()
    expect(screen.getByText("暂无下发记录")).toBeTruthy()
    expect(screen.getByText("您可以将 skill 推送给团队成员")).toBeTruthy()
  })
})
