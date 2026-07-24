import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DualAxisTrendChart } from "./dual-axis-trend-chart";

describe("DualAxisTrendChart", () => {
  it("renders without crashing for non-empty data", () => {
    // Magnitude gap the chart exists to solve: code lines (primary, thousands)
    // vs merged-needs+commits (secondary, single digits).
    const data = [
      { label: "W1", primary: 4200, secondary: 3 },
      { label: "W2", primary: 8800, secondary: 7 },
      { label: "W3", primary: 1500, secondary: 1 },
    ];
    // recharts renders SVG; jsdom won't lay it out, but it must not throw.
    const { container } = render(<DualAxisTrendChart data={data} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders an empty container without throwing", () => {
    const { container } = render(<DualAxisTrendChart data={[]} />);
    expect(container.firstChild).not.toBeNull();
  });
});
