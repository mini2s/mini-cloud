"use client";

import { useCallback, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createPersistStorage } from "../platform/persist-storage";
import { defaultStorage } from "../platform/storage";
import type { StorageAdapter } from "../types/storage";

// ── View preference types (SD-07) ────────────────────────────────────────

export type HubViewMode = "grid" | "list";
export type HubPageSize = 15 | 30 | 50;

/** Page-size options offered by the hub pagination bar (F-07). */
export const HUB_PAGE_SIZE_OPTIONS: readonly HubPageSize[] = [15, 30, 50];
export const HUB_DEFAULT_PAGE_SIZE: HubPageSize = 15;
export const HUB_DEFAULT_VIEW_MODE: HubViewMode = "list";

const STORAGE_KEY = "multica_hub_view";

/** Bare-localStorage keys superseded by this store. */
const LEGACY_PAGE_SIZE_KEY = "hub:pageSize";
const LEGACY_VIEW_MODE_KEY = "hub:viewMode";

export interface HubViewState {
  viewMode: HubViewMode;
  pageSize: HubPageSize;
  setViewMode: (mode: HubViewMode) => void;
  /** Accepts any number; values outside 15/30/50 fall back to the default. */
  setPageSize: (size: number) => void;
}

function isHubPageSize(n: number): n is HubPageSize {
  return n === 15 || n === 30 || n === 50;
}

/**
 * One-time migration: fold the legacy bare-localStorage keys
 * ("hub:pageSize" / "hub:viewMode") into the persisted store payload, then
 * remove them so no component ever reads the old keys again. Runs at module
 * init, before the store hydrates. No-op when storage is unavailable (SSR).
 */
function migrateLegacyKeys(storage: StorageAdapter): void {
  try {
    const legacyPageSize = storage.getItem(LEGACY_PAGE_SIZE_KEY);
    const legacyViewMode = storage.getItem(LEGACY_VIEW_MODE_KEY);
    if (legacyPageSize === null && legacyViewMode === null) return;

    // Never clobber an already-migrated persisted payload.
    if (storage.getItem(STORAGE_KEY) === null) {
      const state: { viewMode?: HubViewMode; pageSize?: HubPageSize } = {};
      const n = Number(legacyPageSize);
      if (legacyPageSize !== null && Number.isFinite(n) && isHubPageSize(n)) {
        state.pageSize = n;
      }
      if (legacyViewMode === "grid" || legacyViewMode === "list") {
        state.viewMode = legacyViewMode;
      }
      if (state.pageSize !== undefined || state.viewMode !== undefined) {
        storage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }));
      }
    }

    storage.removeItem(LEGACY_PAGE_SIZE_KEY);
    storage.removeItem(LEGACY_VIEW_MODE_KEY);
  } catch {
    // Storage unavailable (SSR / privacy mode) — skip migration.
  }
}

migrateLegacyKeys(defaultStorage);

export const useHubViewStore = create<HubViewState>()(
  persist(
    (set) => ({
      viewMode: HUB_DEFAULT_VIEW_MODE,
      pageSize: HUB_DEFAULT_PAGE_SIZE,
      setViewMode: (viewMode) => set({ viewMode }),
      setPageSize: (size) =>
        set({ pageSize: isHubPageSize(size) ? size : HUB_DEFAULT_PAGE_SIZE }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => createPersistStorage(defaultStorage)),
      partialize: (state) => ({
        viewMode: state.viewMode,
        pageSize: state.pageSize,
      }),
    },
  ),
);

// ── Pagination hook (pageSize persisted via view-store, page is ephemeral) ──

export interface HubPagination {
  page: number;
  pageSize: HubPageSize;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

export function useHubPagination(): HubPagination {
  const [page, setPage] = useState(1);
  const pageSize = useHubViewStore((s) => s.pageSize);
  const setStorePageSize = useHubViewStore((s) => s.setPageSize);

  const setPageSize = useCallback(
    (size: number) => {
      setStorePageSize(size);
      setPage(1);
    },
    [setStorePageSize],
  );

  return { page, pageSize, setPage, setPageSize };
}
