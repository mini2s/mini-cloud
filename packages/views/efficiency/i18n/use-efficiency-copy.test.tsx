import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n } from "../../test/i18n";
import { useEfficiencyGlossary } from "./use-efficiency-glossary";
import { useEfficiencyMetricTips } from "./use-efficiency-metric-tips";

function CopyProbe() {
  const { glossaryTip } = useEfficiencyGlossary();
  const metricTips = useEfficiencyMetricTips();
  return (
    <>
      <p>{glossaryTip("roi")}</p>
      <p>{metricTips.actualDeliveryTime}</p>
    </>
  );
}

describe("efficiency metric copy", () => {
  it("returns English glossary and metric help", () => {
    renderWithI18n(<CopyProbe />);

    expect(screen.getByText(/Equivalent labor savings returned/)).toBeVisible();
    expect(screen.getByText(/Actual delivery time: elapsed time/)).toBeVisible();
  });

  it("returns Simplified Chinese glossary and metric help", () => {
    renderWithI18n(<CopyProbe />, { locale: "zh-Hans" });

    expect(screen.getByText(/每单位 AI 成本换回/)).toBeVisible();
    expect(screen.getByText(/实际交付时间：这个需求/)).toBeVisible();
  });
});
