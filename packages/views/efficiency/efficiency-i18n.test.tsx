import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useT } from "../i18n";
import { renderWithI18n } from "../test/i18n";

function EfficiencyI18nProbe() {
  const { t } = useT("efficiency");

  return (
    <div>
      <h1>{t(($) => $.overview.page_title)}</h1>
      <span>{t(($) => $.common.entities.need, { count: 2 })}</span>
    </div>
  );
}

describe("efficiency i18n resources", () => {
  it("renders English copy", () => {
    renderWithI18n(<EfficiencyI18nProbe />);

    expect(screen.getByRole("heading", { name: "AI Efficiency Overview" })).toBeInTheDocument();
    expect(screen.getByText("2 Needs")).toBeInTheDocument();
  });

  it("renders Simplified Chinese copy", () => {
    renderWithI18n(<EfficiencyI18nProbe />, { locale: "zh-Hans" });

    expect(screen.getByRole("heading", { name: "AI 提效总览" })).toBeInTheDocument();
    expect(screen.getByText("2 个需求")).toBeInTheDocument();
  });
});
