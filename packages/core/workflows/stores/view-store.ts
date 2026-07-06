"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createWorkspaceAwareStorage, registerForWorkspaceRehydration } from "../../platform/workspace-storage";
import { defaultStorage } from "../../platform/storage";

export type WorkflowViewMode = "panorama" | "editor";

interface WorkflowViewState {
  viewMode: WorkflowViewMode;
  setViewMode: (mode: WorkflowViewMode) => void;
}

/**
 * Workflow view mode store.
 *
 * @deprecated The workflow detail page now uses a single ReactFlow-based editor
 * view (WorkflowDetailPage) with view/edit mode toggle via useWorkflowEditorStore.mode.
 * This store is kept for backward compatibility with persisted localStorage state
 * and for potential future use by runtime panorama consumers.
 */
export const useWorkflowViewStore = create<WorkflowViewState>()(
  persist(
    (set) => ({
      viewMode: "editor" as WorkflowViewMode,
      setViewMode: (mode: WorkflowViewMode) => set({ viewMode: mode }),
    }),
    {
      name: "multica_workflows_view",
      storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
    },
  ),
);

registerForWorkspaceRehydration(() => useWorkflowViewStore.persist.rehydrate());
