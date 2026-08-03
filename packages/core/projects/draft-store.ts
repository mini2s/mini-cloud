import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ProjectStatus, ProjectPriority } from "../types";
import { createWorkspaceAwareStorage, registerForWorkspaceRehydration } from "../platform/workspace-storage";
import { defaultStorage } from "../platform/storage";

interface ProjectDraft {
  title: string;
  description: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  leadType?: "member" | "agent";
  leadId?: string;
  icon?: string;
  repos: string[];
}

const EMPTY_DRAFT: ProjectDraft = {
  title: "",
  description: "",
  status: "planned",
  priority: "none",
  leadType: undefined,
  leadId: undefined,
  icon: undefined,
  repos: [],
};

interface ProjectDraftStore {
  draft: ProjectDraft;
  setDraft: (patch: Partial<ProjectDraft>) => void;
  clearDraft: () => void;
  hasDraft: () => boolean;
}

export const useProjectDraftStore = create<ProjectDraftStore>()(
  persist(
    (set, get) => ({
      draft: { ...EMPTY_DRAFT },
      setDraft: (patch) =>
        set((s) => ({ draft: { ...s.draft, ...patch } })),
      clearDraft: () =>
        set({ draft: { ...EMPTY_DRAFT } }),
      hasDraft: () => {
        const { draft } = get();
        return !!(draft.title || draft.description);
      },
    }),
    {
      name: "multica_project_draft",
      version: 1,
      // Backfill fields added after this store first shipped. commit c76717e6d
      // added `repos` to ProjectDraft; drafts persisted before then rehydrate
      // without it (draft.repos === undefined), which crashed the create-project
      // modal on selectedRepos.length. migrate merges the legacy draft over
      // EMPTY_DRAFT and forces repos to an array.
      migrate: (persistedState) => {
        const s = (persistedState as { draft?: Partial<ProjectDraft> }) ?? {};
        return {
          ...s,
          draft: {
            ...EMPTY_DRAFT,
            ...(s.draft ?? {}),
            repos: Array.isArray(s.draft?.repos) ? s.draft!.repos : [],
          },
        };
      },
      storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
    },
  ),
);

registerForWorkspaceRehydration(() => useProjectDraftStore.persist.rehydrate());
