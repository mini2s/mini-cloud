import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";

// RealtimeQueryPage integration smoke test. Mirrors the platform-overview-page
// test pattern: mock the workspace hook and intercept useQuery to return the
// real mock-data factories keyed off the queryKey shape so the page exercises
// its "form → submit → results table" render path. The point is that the
// whole page graph mounts without throwing and the filter form + results
// render.
//
// The chat query keys look like:
//   ["efficiency", wsId, "config"]
//   ["efficiency", wsId, "chat", "datasources"]
//   ["efficiency", wsId, "chat", "detail-query", req]
//   ["efficiency", wsId, "chat", "log-preview", path]
// so key[2] is the dimension ("chat" vs "config") and key[3] is the segment.
//
// The detail-query only fires after the user clicks 查询 (the page gates it on
// a committed-form state). To assert results we stub useQuery to always return
// detail rows, then click 查询 and wait for a known cell to appear.

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  const eff = await vi.importActual<typeof import("@multica/core/efficiency")>(
    "@multica/core/efficiency",
  );
  return {
    ...actual,
    useQuery: (opts: { queryKey: unknown[]; enabled?: boolean }) => {
      const key = opts.queryKey;
      const dimension = key[2];
      const segment = key[3];
      let data: unknown = undefined;
      // Respect the caller's `enabled` flag (the page disables detail-query
      // until the form is committed) so we exercise the real gating.
      const queryEnabled = opts.enabled !== false;
      if (dimension === "config") {
        data = eff.mock.globalConfig();
      } else if (dimension === "chat") {
        if (segment === "datasources") data = eff.mock.chatDatasources();
        else if (segment === "detail-query")
          data = eff.mock.chatDetailQuery({
            start_time: "2026-07-21T00:00:00+00:00",
            end_time: "2026-07-21T01:00:00+00:00",
            datasource_id: "1",
            limit: 100,
            order: "desc",
          });
        else if (segment === "trace-logs") {
          // The drawer fetches trace logs scoped to a request_id. Return the
          // mock factory so the drawer renders entries.
          const req = key[4] as {
            datasource_id: string;
            request_id: string;
            start_time: string;
            end_time: string;
          };
          data = eff.mock.chatTraceLogs(req);
        }
      }
      const resolved = queryEnabled && data !== undefined;
      return {
        data: resolved ? data : undefined,
        isLoading: false,
        isFetching: false,
        isSuccess: resolved,
        error: null,
        refetch: () => Promise.resolve(),
        dataUpdatedAt: Date.now(),
        errorUpdatedAt: 0,
      };
    },
  };
});

import { RealtimeQueryPage } from "./realtime-query-page";

describe("RealtimeQueryPage (smoke)", () => {
  beforeEach(() => cleanup());

  it("mounts and renders the page header title", () => {
    renderWithI18n(<RealtimeQueryPage />);
    expect(screen.getByText("明细查询")).toBeInTheDocument();
  });

  it("renders the filter form section and submit button", () => {
    renderWithI18n(<RealtimeQueryPage />);
    expect(screen.getByText("查询条件")).toBeInTheDocument();
    expect(screen.getByText("查询", { selector: "button" })).toBeInTheDocument();
    // The datasource select is auto-selected once the list resolves; the
    // placeholder option is still in the DOM.
    expect(screen.getByLabelText("数据源")).toBeInTheDocument();
    expect(screen.getByLabelText("开始时间")).toBeInTheDocument();
    expect(screen.getByLabelText("结束时间")).toBeInTheDocument();
  });

  it("renders the results section header before any query", () => {
    renderWithI18n(<RealtimeQueryPage />);
    expect(screen.getByText("查询结果")).toBeInTheDocument();
  });

  it("renders result rows after clicking 查询", async () => {
    const user = userEvent.setup();
    renderWithI18n(<RealtimeQueryPage />);

    // The datasource auto-selects; submit the default form.
    const submit = screen.getByText("查询", { selector: "button" });
    await user.click(submit);

    // The mock returns 8 rows; the table header "输出 Token" + a known
    // request_id should appear once the query resolves.
    await waitFor(() => {
      expect(screen.getByText("输出 Token")).toBeInTheDocument();
    });
    // The pre-submit empty hint goes away once results land.
    await waitFor(() => {
      expect(
        screen.queryByText("设置查询条件后点击「查询」"),
      ).not.toBeInTheDocument();
    });
  });

  it("opens the row detail dialog when a row is clicked", async () => {
    const user = userEvent.setup();
    renderWithI18n(<RealtimeQueryPage />);

    await user.click(screen.getByText("查询", { selector: "button" }));
    // Wait for rows to land, then click the first request_id cell. The id is
    // rendered inside a truncate span; findAllByText returns every row's id,
    // we click the first to open the detail dialog.
    const reqCells = await screen.findAllByText(/^req-\d+-\d+$/);
    expect(reqCells.length).toBeGreaterThan(0);
    fireEvent.click(reqCells[0]!);
    // The detail dialog title carries the "请求详情" prefix.
    await waitFor(() => {
      expect(screen.getByText(/请求详情/)).toBeInTheDocument();
    });
  });

  it("renders the export button in the results section header", async () => {
    const user = userEvent.setup();
    renderWithI18n(<RealtimeQueryPage />);

    // Export button is disabled until results land.
    expect(
      screen.getByRole("button", { name: /导出/ }),
    ).toBeDisabled();

    await user.click(screen.getByText("查询", { selector: "button" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /导出/ })).toBeEnabled();
    });
  });

  it("downloads a CSV when the export button is clicked", async () => {
    // jsdom doesn't implement URL.createObjectURL, and anchor.click() doesn't
    // trigger a real navigation. Stub the URL blob APIs + the prototype click
    // so the download helper runs end-to-end without a real browser download.
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const user = userEvent.setup();
    renderWithI18n(<RealtimeQueryPage />);

    await user.click(screen.getByText("查询", { selector: "button" }));
    const exportBtn = await screen.findByRole("button", { name: /导出/ });
    await user.click(exportBtn);

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith("blob:mock");

    createUrl.mockRestore();
    revokeUrl.mockRestore();
    anchorClick.mockRestore();
  });

  it("renders the speed distribution chart after results land", async () => {
    const user = userEvent.setup();
    renderWithI18n(<RealtimeQueryPage />);

    // Before query: no speed-distribution section.
    expect(screen.queryByText("输出速度分布")).not.toBeInTheDocument();

    await user.click(screen.getByText("查询", { selector: "button" }));
    // After query: the speed-distribution section title appears.
    await waitFor(() => {
      expect(screen.getByText("输出速度分布")).toBeInTheDocument();
    });
  });
});
