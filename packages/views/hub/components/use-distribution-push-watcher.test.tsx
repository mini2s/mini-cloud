import type { ReactNode } from "react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@multica/core/i18n/react"
import { RESOURCES } from "../../test/i18n"

const receivedMock = vi.hoisted(() => vi.fn<() => Promise<unknown[]>>())
const pushMock = vi.hoisted(() => vi.fn())

vi.mock("@multica/core/api", () => ({
  api: { hubMyReceivedDistributions: receivedMock },
}))

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}))

vi.mock("@multica/core/hub", () => ({
  hubKeys: { distributionsReceived: () => ["hub", "distributions-received"] },
}))

vi.mock("@multica/core/paths", () => ({
  // Mirrors production: a fresh object per call, matching `paths.workspace()`.
  useWorkspacePaths: () => ({
    hubManager: () => "/test-workspace/hub/manager",
  }),
}))

vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: pushMock }),
}))

vi.mock("sonner", () => ({ toast: vi.fn() }))

import { useDistributionPushWatcher } from "./use-distribution-push-watcher"

const POLL_INTERVAL_MS = 45_000

function makeWrapper() {
  const qc = new QueryClient()
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <I18nProvider locale="en" resources={RESOURCES}>
          {children}
        </I18nProvider>
      </QueryClientProvider>
    )
  }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe("useDistributionPushWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    receivedMock.mockReset()
    receivedMock.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("polls once on mount, then on the normal interval", async () => {
    renderHook(() => useDistributionPushWatcher(), { wrapper: makeWrapper() })
    await flush()
    expect(receivedMock).toHaveBeenCalledTimes(1)

    await advance(POLL_INTERVAL_MS)
    expect(receivedMock).toHaveBeenCalledTimes(2)
  })

  it("does not restart polling when the component re-renders", async () => {
    const { rerender } = renderHook(() => useDistributionPushWatcher(), {
      wrapper: makeWrapper(),
    })
    await flush()
    expect(receivedMock).toHaveBeenCalledTimes(1)

    rerender()
    rerender()
    await flush()
    expect(receivedMock).toHaveBeenCalledTimes(1)

    await advance(POLL_INTERVAL_MS)
    expect(receivedMock).toHaveBeenCalledTimes(2)
  })

  it("backs off exponentially after failures and restores the interval after a success", async () => {
    receivedMock.mockRejectedValue(new Error("429"))
    renderHook(() => useDistributionPushWatcher(), { wrapper: makeWrapper() })
    await flush()
    expect(receivedMock).toHaveBeenCalledTimes(1)

    // 1st failure → retry after 30s (not the normal 45s)
    await advance(30_000)
    expect(receivedMock).toHaveBeenCalledTimes(2)

    // 2nd failure → 60s
    await advance(59_999)
    expect(receivedMock).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(receivedMock).toHaveBeenCalledTimes(3)

    // 3rd failure → 120s
    await advance(119_999)
    expect(receivedMock).toHaveBeenCalledTimes(3)
    await advance(1)
    expect(receivedMock).toHaveBeenCalledTimes(4)

    // 4th failure → 240s; this attempt succeeds, resetting the backoff
    receivedMock.mockResolvedValue([])
    await advance(239_999)
    expect(receivedMock).toHaveBeenCalledTimes(4)
    await advance(1)
    expect(receivedMock).toHaveBeenCalledTimes(5)

    // Success → back to the normal 45s interval
    await advance(POLL_INTERVAL_MS)
    expect(receivedMock).toHaveBeenCalledTimes(6)
  })

  it("stops polling after unmount", async () => {
    const { unmount } = renderHook(() => useDistributionPushWatcher(), {
      wrapper: makeWrapper(),
    })
    await flush()
    expect(receivedMock).toHaveBeenCalledTimes(1)

    unmount()
    await advance(POLL_INTERVAL_MS * 4)
    expect(receivedMock).toHaveBeenCalledTimes(1)
  })
})
