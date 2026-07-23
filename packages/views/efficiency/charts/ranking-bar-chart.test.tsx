import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RankingBarChart } from "./ranking-bar-chart";

describe("RankingBarChart", () => {
  it("renders without crashing for non-empty data", () => {
    const data = [
      { label: "Team A", value: 120 },
      { label: "Team B", value: 85 },
    ];
    // recharts renders SVG; jsdom won't fully lay it out (width/height 0
    // warning is expected), but the layout="vertical" path must not throw.
    const { container } = render(<RankingBarChart data={data} />);
    expect(container.firstChild).not.toBeNull();
  });
});
