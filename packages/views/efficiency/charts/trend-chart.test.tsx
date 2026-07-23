import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TrendChart } from "./trend-chart";

describe("TrendChart", () => {
  it("renders without crashing for non-empty data", () => {
    const data = [
      { label: "W1", value: 10 },
      { label: "W2", value: 20 },
    ];
    // recharts renders SVG; jsdom won't fully lay it out, but it must not throw.
    const { container } = render(<TrendChart data={data} />);
    expect(container.firstChild).not.toBeNull();
  });
});
