"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";
import { getDefaultDateRangeWide } from "./utils/date";

// Global view state for the efficiency dashboard (zustand).
// Holds the global time range bound to the per-page DateRangePicker (replaces
// the old "each page owns its own DateRangePicker" pattern). The focused drill-
// down object (org/user/project/repo) is intentionally NOT persisted here — it
// lives in the URL query (?object=<id>) as the single source of truth so that
// refresh/deep-link keeps state and switching dimension tabs doesn't lose it.
// Only the time range is persisted, so a refresh keeps the selected window.
// Default reuses the wide 90-day range from utils/date — matches the
// executive-dashboard intent and the Overview page's "90d" preset initial
// activeKey (a 7-day default would show "90d" highlighted on first load
// while the cards render 7-day data).

interface ViewState {
  /** Global time range [start, end], format YYYY-MM-DD. */
  timeRange: [string, string];
  setTimeRange: (range: [string, string]) => void;
}

// StorageAdapter (sync getItem returning string | null) is a structural subset
// of zustand's StateStorage, so it can be handed in directly via cast.
const stateStorage = defaultStorage as unknown as StateStorage;

export const useViewState = create<ViewState>()(
  persist(
    (set) => ({
      timeRange: getDefaultDateRangeWide(90),
      setTimeRange: (range) => set({ timeRange: range }),
    }),
    {
      name: "efficiency.viewState.timeRange",
      storage: createJSONStorage(() => stateStorage),
    },
  ),
);
