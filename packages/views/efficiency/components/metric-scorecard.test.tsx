import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Mock the shadcn Tooltip so the test doesn't depend on base-ui's Portal /
// positioner layout in jsdom (which warns and can swallow the content). The
// component's own render path is still exercised — we just flatten the tooltip
// primitives to passthrough wrappers.
vi.mock("@multica/ui/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

// Skeleton is a plain div; keep the real one (no portal/observer).
import { MetricScorecard } from "./metric-scorecard";

describe("MetricScorecard", () => {
  it("renders label, value, hint and sparkline for typical props", () => {
    render(
      <MetricScorecard
        label="使用人数"
        value="1,234"
        hint="需求 42 已合并"
        tip="活跃用户：当期真正用 AI 产出交付的人数。"
        series={[10, 20, 15, 30, 25]}
        accent="brand"
      />,
    );
    expect(screen.getByText("使用人数")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("需求 42 已合并")).toBeInTheDocument();
    // The glossary caliber text is rendered into the mocked tooltip content.
    expect(
      screen.getByText(/当期真正用 AI 产出交付的人数/),
    ).toBeInTheDocument();
  });

  it("renders a delta arrow for a positive wow", () => {
    const { container } = render(
      <MetricScorecard
        label="贡献行数"
        value="9,876"
        tip="代码贡献（净增行）"
        series={[1, 2, 3, 4]}
        // delta_pct is already a percentage (26.14 = 26.14%), NOT a decimal.
        delta={{ current: 100, previous: 80, delta_pct: 26.14 }}
        higherIsBetter
        accent="chart-2"
      />,
    );
    // Up arrow uses the success token color (good = higherIsBetter && up).
    const arrow = container.querySelector(".text-success");
    expect(arrow).not.toBeNull();
    expect(arrow?.textContent).toContain("▲");
    // delta_pct already in percent units — rendered as "26%", not "2614%".
    expect(arrow?.textContent).toContain("26%");
  });

  it("renders no arrow when delta is null", () => {
    const { container } = render(
      <MetricScorecard
        label="AI 代码占比"
        value="63%"
        tip="AI 代码占比"
        series={[]}
        delta={null}
        accent="chart-3"
      />,
    );
    // No success/destructive arrow span should be present.
    expect(container.querySelector(".text-success")).toBeNull();
    expect(container.querySelector(".text-destructive")).toBeNull();
    // Empty series degrades to the placeholder div — no sparkline svg. The
    // only svg present is the info-icon (aria-hidden, no role="img").
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });

  it("shows a skeleton while loading and does not render the value", () => {
    render(
      <MetricScorecard
        label="使用人数"
        value="1,234"
        tip="活跃用户"
        series={[1, 2, 3]}
        loading
      />,
    );
    expect(screen.queryByText("1,234")).toBeNull();
  });
});
