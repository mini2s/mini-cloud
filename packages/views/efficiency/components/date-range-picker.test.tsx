import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DateRangePicker } from "./date-range-picker";

// DateRangePicker commits a [start, end] YYYY-MM-DD tuple only when a full
// range is chosen (shortcut, or both calendar endpoints); a half-picked range
// stays a draft. The calendar is reached via the defaultOpen test prop so no
// trigger interaction is needed (Base UI popover portals into document.body).

// The Calendar day button carries data-day formatted by the active locale
// (zhCN → toLocaleDateString("zh-CN")). Compute the attribute the same way so
// the lookup stays correct whatever ICU build the runner ships.
function dataDay(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day).toLocaleDateString("zh-CN");
}

function dayButton(year: number, month: number, day: number): HTMLElement {
  const el = document.querySelector(
    `button[data-day="${dataDay(year, month, day)}"]`,
  );
  expect(el, `day button ${year}-${month}-${day} to be rendered`).not.toBeNull();
  return el as HTMLElement;
}

describe("DateRangePicker", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("trigger shows the committed range", () => {
    render(
      <DateRangePicker
        value={["2026-07-01", "2026-07-29"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("2026-07-01 ~ 2026-07-29")).toBeInTheDocument();
  });

  it("renders all six shortcuts when open", () => {
    render(
      <DateRangePicker
        value={["2026-07-01", "2026-07-29"]}
        onChange={() => {}}
        defaultOpen
      />,
    );
    for (const label of ["今天", "1 天前", "3 天前", "1 周前", "1 月前", "3 月前"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shortcut commits its range (end = today) and closes the popover", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0));
    let captured: [string, string] | null = null;
    render(
      <DateRangePicker
        value={["2026-07-01", "2026-07-29"]}
        onChange={(r) => (captured = r)}
        defaultOpen
      />,
    );
    fireEvent.click(screen.getByText("1 周前"));
    // 7-day window ending today: start = today - 6.
    expect(captured).toEqual(["2026-07-23", "2026-07-29"]);
    expect(screen.queryByText("今天")).not.toBeInTheDocument();
  });

  it("今天 shortcut commits a single-day range", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0));
    let captured: [string, string] | null = null;
    render(
      <DateRangePicker
        value={["2026-07-01", "2026-07-29"]}
        onChange={(r) => (captured = r)}
        defaultOpen
      />,
    );
    fireEvent.click(screen.getByText("今天"));
    expect(captured).toEqual(["2026-07-29", "2026-07-29"]);
  });

  it("calendar: first click stays a draft, second click commits and closes", () => {
    const calls: [string, string][] = [];
    render(
      <DateRangePicker
        value={["2026-07-01", "2026-07-29"]}
        onChange={(r) => calls.push(r)}
        defaultOpen
      />,
    );
    // Full range already selected → next click starts a fresh draft range.
    fireEvent.click(dayButton(2026, 7, 10));
    expect(calls).toHaveLength(0);
    fireEvent.click(dayButton(2026, 7, 15));
    expect(calls).toEqual([["2026-07-10", "2026-07-15"]]);
    expect(screen.queryByText("今天")).not.toBeInTheDocument();
  });
});
