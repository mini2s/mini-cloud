import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasNonZeroTrendValue,
  MultiTrendChart,
} from "./multi-trend-chart";

describe("MultiTrendChart legend", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a scrollable interactive legend when requested", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 640,
      height: 280,
      top: 0,
      right: 640,
      bottom: 280,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const { container } = render(
      <MultiTrendChart
        data={[
          { label: "07-28", modelA: 8, modelB: 16 },
          { label: "07-29", modelA: 10, modelB: 20 },
        ]}
        series={[
          { key: "modelA", name: "模型 A", color: "var(--chart-1)" },
          { key: "modelB", name: "模型 B", color: "var(--chart-2)" },
        ]}
        showLegend
      />,
    );

    const legend = screen.getByRole("group", { name: "图例" });
    expect(legend).toHaveClass("overflow-x-auto");

    const modelA = screen.getByRole("button", { name: "隐藏 模型 A" });
    expect(modelA).toHaveAttribute("aria-pressed", "true");
    expect(
      container.querySelectorAll(".recharts-area-area"),
    ).toHaveLength(2);

    fireEvent.click(modelA);
    expect(screen.getByRole("button", { name: "显示 模型 A" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("distinguishes an all-zero trend from a trend with values", () => {
    const series = [
      { key: "modelA", name: "模型 A", color: "#0071e3" },
      { key: "modelB", name: "模型 B", color: "#34c759" },
    ];

    expect(
      hasNonZeroTrendValue(
        [{ label: "07-29", modelA: 0, modelB: 0 }],
        series,
      ),
    ).toBe(false);
    expect(
      hasNonZeroTrendValue(
        [{ label: "07-29", modelA: 0, modelB: 1 }],
        series,
      ),
    ).toBe(true);
  });
});
