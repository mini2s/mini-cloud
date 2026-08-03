import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n } from "../../test/i18n";
import { useEfficiencyFormatters } from "./use-efficiency-formatters";

function FormattersProbe() {
  const {
    formatNumber,
    formatCurrency,
    formatDuration,
    formatBucketLabel,
    granularityLabel,
  } = useEfficiencyFormatters();

  return (
    <dl>
      <dt>number</dt>
      <dd>{formatNumber(1234.5, 1)}</dd>
      <dt>currency</dt>
      <dd>{formatCurrency(1234.5, "USD")}</dd>
      <dt>duration</dt>
      <dd>{formatDuration(125)}</dd>
      <dt>granularity</dt>
      <dd>{granularityLabel("week")}</dd>
      <dt>month bucket</dt>
      <dd>{formatBucketLabel("2026-07", "month")}</dd>
    </dl>
  );
}

describe("useEfficiencyFormatters", () => {
  it("formats values in English", () => {
    renderWithI18n(<FormattersProbe />);

    expect(screen.getByText("1,234.5")).toBeInTheDocument();
    expect(screen.getByText("$1,234.50")).toBeInTheDocument();
    expect(screen.getByText("2 hr 5 min")).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("Jul")).toBeInTheDocument();
  });

  it("formats values in Simplified Chinese", () => {
    renderWithI18n(<FormattersProbe />, { locale: "zh-Hans" });

    expect(screen.getByText("1,234.5")).toBeInTheDocument();
    expect(screen.getByText("US$1,234.50")).toBeInTheDocument();
    expect(screen.getByText("2 小时 5 分钟")).toBeInTheDocument();
    expect(screen.getByText("按周")).toBeInTheDocument();
    expect(screen.getByText("7月")).toBeInTheDocument();
  });
});
