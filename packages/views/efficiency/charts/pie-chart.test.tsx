import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PieBreakdownChart } from "./pie-chart";

describe("PieBreakdownChart legend", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the cost-style scrollable legend without clipping entries", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 320,
      height: 280,
      top: 0,
      right: 320,
      bottom: 280,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const { container } = render(
      <PieBreakdownChart
        data={[
          { name: "模型 A", value: 10 },
          { name: "模型 B", value: 20 },
        ]}
        scrollLegend
      />,
    );

    const legend = screen.getByRole("group", { name: "图例" });
    expect(legend).toHaveClass("overflow-x-auto");
    expect(
      screen
        .getByRole("button", { name: "隐藏 模型 A" })
        .querySelector("span"),
    ).toHaveStyle({ backgroundColor: "var(--chart-1)" });
    expect(container.querySelectorAll(".recharts-sector")).toHaveLength(2);

    const modelB = screen.getByRole("button", { name: "隐藏 模型 B" });
    fireEvent.click(modelB);
    expect(screen.getByRole("button", { name: "显示 模型 B" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders equal slices when every value is zero", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 320,
      height: 280,
      top: 0,
      right: 320,
      bottom: 280,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const { container } = render(
      <PieBreakdownChart
        data={[
          { name: "模型 A", value: 0 },
          { name: "模型 B", value: 0 },
          { name: "模型 C", value: 0 },
        ]}
        scrollLegend
      />,
    );

    expect(container.querySelectorAll(".recharts-sector")).toHaveLength(3);
  });
});
