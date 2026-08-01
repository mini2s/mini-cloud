import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import {
  renderHook,
  act,
} from "@testing-library/react";
import {
  GranularityToggle,
  useGranularity,
} from "./granularity-toggle";
import { renderWithI18n } from "../../test/i18n";

describe("GranularityToggle", () => {
  it("renders one button per option", () => {
    renderWithI18n(
      <GranularityToggle
        value="week"
        options={["day", "week", "month"]}
        onChange={() => {}}
      />,
      { locale: "zh-Hans" },
    );
    expect(screen.getByText("按天")).toBeInTheDocument();
    expect(screen.getByText("按周")).toBeInTheDocument();
    expect(screen.getByText("按月")).toBeInTheDocument();
  });

  it("returns null when fewer than 2 options (short ranges are day-only)", () => {
    const { container } = renderWithI18n(
      <GranularityToggle value="day" options={["day"]} onChange={() => {}} />,
      { locale: "zh-Hans" },
    );
    // null render → container has no toggle buttons.
    expect(container.firstChild).toBeNull();
  });

  it("marks the active option aria-pressed and calls onChange on click", () => {
    let captured: string | null = null;
    renderWithI18n(
      <GranularityToggle
        value="week"
        options={["day", "week", "month"]}
        onChange={(g) => (captured = g)}
      />,
      { locale: "zh-Hans" },
    );
    const dayBtn = screen.getByText("按天");
    expect(dayBtn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(dayBtn);
    expect(captured).toBe("day");
  });
});

describe("useGranularity", () => {
  afterEach(cleanup);

  it("defaults to month for a wide range and exposes all three options", () => {
    const { result } = renderHook(() =>
      useGranularity("2026-01-01", "2026-06-30"),
    );
    // ≥ 60 days → default month, options day/week/month.
    expect(result.current.gran).toBe("month");
    expect(result.current.options).toEqual(["day", "week", "month"]);
  });

  it("defaults to day for a short range with a single option", () => {
    const { result } = renderHook(() =>
      useGranularity("2026-07-01", "2026-07-05"),
    );
    expect(result.current.gran).toBe("day");
    expect(result.current.options).toEqual(["day"]);
  });

  it("preserves a manual selection within the same range", () => {
    // Feb 1 → Mar 15 = 43 days (≥ 14 & < 60) → default week.
    const { result } = renderHook(() =>
      useGranularity("2026-02-01", "2026-03-15"),
    );
    expect(result.current.gran).toBe("week");
    act(() => result.current.setGran("day"));
    expect(result.current.gran).toBe("day");
  });
});
