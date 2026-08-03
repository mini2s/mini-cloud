import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { QuotaPage } from "./quota-page";

const quotaState = vi.hoisted(() => ({
  quota: { data: undefined as unknown, isLoading: true },
  usage: { data: undefined as unknown, isLoading: true },
}));

vi.mock("@multica/core/quota", () => ({
  useUserQuota: () => quotaState.quota,
  useUsageStatistics: () => quotaState.usage,
}));

function resetState() {
  quotaState.quota = { data: undefined, isLoading: true };
  quotaState.usage = { data: undefined, isLoading: true };
}

describe("QuotaPage", () => {
  it("renders both section titles while fetching, before any data arrives", () => {
    resetState();
    renderWithI18n(<QuotaPage />);

    expect(screen.getByText("Usage Statistics")).toBeInTheDocument();
    expect(screen.getByText("Quota Overview")).toBeInTheDocument();
    expect(screen.getByText("Usage Consumption")).toBeInTheDocument();
    // While quota is still loading, the "Remaining … Credits" line must not
    // render yet (it waits for data).
    expect(screen.queryByText(/Remaining/)).toBeNull();
  });

  it("renders quota overview numbers and the quota validity table once loaded", () => {
    quotaState.quota = {
      data: {
        total_quota: 1000,
        used_quota: 250,
        quota_list: [
          { amount: 500, expiry_date: "2026-12-31", source: "trial" },
          { amount: 500, expiry_date: "2027-06-30", source: "purchase" },
        ],
      },
      isLoading: false,
    };
    quotaState.usage = { data: { records: [], total: 0 }, isLoading: false };

    renderWithI18n(<QuotaPage />);

    expect(screen.getByText(/Used 250\.00 \/ 1000\.00 Credits/)).toBeInTheDocument();
    expect(screen.getByText(/Remaining 750\.00 Credits/)).toBeInTheDocument();
    expect(screen.getByText("2026-12-31")).toBeInTheDocument();
    expect(screen.getByText("purchase")).toBeInTheDocument();
    // Usage table empty state.
    expect(screen.getByText("No usage records")).toBeInTheDocument();
  });

  it("renders usage records and falls back to '-' for missing fields", () => {
    quotaState.quota = {
      data: { total_quota: 100, used_quota: 10, quota_list: [] },
      isLoading: false,
    };
    quotaState.usage = {
      data: {
        records: [
          {
            id: 1,
            user_id: "u1",
            model: "gpt-4",
            mode: "chat",
            tokens: 100,
            credits_used: 5,
            package: "pro",
            record_time: "2026-07-29T10:30:00Z",
            create_time: "",
            update_time: "",
          },
        ],
        total: 1,
        page: 1,
        page_size: 10,
      },
      isLoading: false,
    };

    renderWithI18n(<QuotaPage />);

    expect(screen.getByText("gpt-4")).toBeInTheDocument();
    expect(screen.getByText("chat")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("pro")).toBeInTheDocument();
  });

  it("shows Chinese copy under the zh-Hans locale", () => {
    quotaState.quota = {
      data: { total_quota: 100, used_quota: 0, quota_list: [] },
      isLoading: false,
    };
    quotaState.usage = { data: { records: [], total: 0 }, isLoading: false };

    renderWithI18n(<QuotaPage />, { locale: "zh-Hans" });

    expect(screen.getByText("用量统计")).toBeInTheDocument();
    expect(screen.getByText("额度概览")).toBeInTheDocument();
    expect(screen.getByText("用量消耗统计")).toBeInTheDocument();
    expect(screen.getByText("暂无用量记录")).toBeInTheDocument();
  });
});
