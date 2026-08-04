"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../../platform/storage";
import { useModalStore } from "../../modals";

/**
 * Last create-issue mode the user landed on. The in-modal mode switch updates
 * this so UI inside the dialog can preserve the current panel while switching.
 * Generic create entry points still open manual mode by default; agent mode is
 * an explicit in-dialog choice.
 *
 * Workspace-agnostic on purpose: the user's mental preference for "how do I
 * file an issue" doesn't change per workspace, so this lives in plain
 * localStorage rather than the workspace-aware StateStorage that scopes
 * per-workspace stores like quick-create-store / draft-store.
 */
export type CreateMode = "agent" | "manual";

interface CreateModeState {
  lastMode: CreateMode;
  setLastMode: (mode: CreateMode) => void;
}

export const useCreateModeStore = create<CreateModeState>()(
  persist(
    (set) => ({
      lastMode: "manual",
      setLastMode: (mode) => set({ lastMode: mode }),
    }),
    {
      name: "multica_create_mode",
      storage: createJSONStorage(() => defaultStorage),
    },
  ),
);

/**
 * Open the manual create-issue flow. Generic entry points (sidebar button,
 * command palette, `c` shortcut) call this so creating an issue starts from
 * the human-authored form, while agent mode stays available via the in-dialog
 * switch.
 */
export function openCreateIssueWithPreference(
  data?: Record<string, unknown> | null,
) {
  useModalStore.getState().open("create-issue", data ?? null);
}
