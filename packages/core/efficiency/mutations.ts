// CRUD mutation hooks for the chat settings pages (pricing / datasources /
// sync / config). Mirrors the issues/mutations.ts pattern (useMutation +
// mutationFn + onSuccess invalidate), but each mutationFn branches on
// MOCK_ENABLED:
//   - MOCK_ENABLED (default): return a plausible success result WITHOUT
//     hitting the network. The form "succeeds", onSuccess invalidates the
//     list cache, and the list queryFn re-runs the mock factory which yields
//     the same static sample (functional CRUD in the pre-backend phase).
//   - !MOCK_ENABLED: call the real api.* stub (which throws NOT_WIRED until
//     the backend mounts /api/v2/efficiency/chat/*, but that is correct —
//     once the backend is up, EFFICIENCY_MOCK=0 flips and the real call works).
//
// Unlike issues, the chat settings tables are small + static mock samples, so
// these hooks do NOT attempt optimistic onMutate cache patches — a plain
// onSuccess invalidate is enough for the refetch to land the post-mutation
// state. (The mock samples are static, so "after mutation" reads the same
// list; when the real backend lands, its response becomes the source of
// truth.)

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceId } from "../hooks";
import { efficiencyKeys } from "./queries";
import { MOCK_ENABLED } from "./mock";
import {
  addRepoToProject,
  addTasksToProject,
  cancelChatSyncTask,
  checkProjectConflicts,
  createChatDatasource,
  createChatPricing,
  createProject,
  deleteChatDatasource,
  deleteChatPricing,
  deleteProject,
  removeRepoFromProject,
  retryChatSyncTask,
  submitChatSyncTask,
  testChatDatasource,
  updateChatDatasource,
  updateChatPricing,
  updateChatSystemConfig,
  updateCommitManual,
  updateProject,
  updateProjectManual,
  updateProjectNeedSelection,
  updateTaskManual,
} from "./api";
import type {
  AddRepoRequest,
  AddTasksRequest,
  ChatDatasource,
  ChatDatasourceTestResult,
  ChatDatasourceUpsert,
  ChatSyncSubmitReq,
  ChatSyncSubmitResponse,
  ChatSystemConfig,
  CheckConflictsResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  ModelPricing,
  ModelPricingUpsert,
  UpdateCommitManualRequest,
  UpdateProjectManualRequest,
  UpdateProjectNeedSelectionRequest,
  UpdateProjectRequest,
  UpdateTaskManualRequest,
} from "./types";

// ============================ Pricing ============================

/** Create or update a model pricing row. */
export function useUpsertChatPricing() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (input: ModelPricingUpsert): Promise<ModelPricing> => {
      if (MOCK_ENABLED) {
        const now = new Date().toISOString();
        return {
          ...input,
          id: input.id ?? Math.floor(Math.random() * 100_000),
          created_at: now,
        };
      }
      return input.id != null
        ? updateChatPricing(input.id, input)
        : createChatPricing(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: efficiencyKeys.chatPricing(wsId) });
    },
  });
}

/** Delete a model pricing row by id. */
export function useDeleteChatPricing() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      if (MOCK_ENABLED) return;
      return deleteChatPricing(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: efficiencyKeys.chatPricing(wsId) });
    },
  });
}

// ============================ Datasources ============================

/** Create or update a datasource row. The datasource upsert body type omits
 * `id`, so this hook carries an optional id at the hook layer to distinguish
 * update (PUT /{id}) from create (POST). */
export function useUpsertChatDatasource() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (input: ChatDatasourceUpsert & {
      id?: number;
    }): Promise<ChatDatasource> => {
      const { id: maybeId, ...body } = input;
      if (MOCK_ENABLED) {
        const now = new Date().toISOString();
        return {
          config_json: null,
          pg_host: null,
          pg_port: null,
          pg_database: null,
          pg_schema: null,
          pg_table: null,
          pg_username: null,
          pg_password: null,
          pg_ssl_mode: null,
          es_hosts: null,
          es_username: null,
          es_password: null,
          es_index: null,
          es_verify_certs: null,
          es_scroll_duration: null,
          loki_url: null,
          loki_username: null,
          loki_password: null,
          loki_tenant_id: null,
          loki_verify_certs: null,
          loki_queries: null,
          max_open_conns: null,
          max_idle_conns: null,
          notes: null,
          updated_at: now,
          ...body,
          id: maybeId ?? Math.floor(Math.random() * 100_000),
          is_enabled: body.is_enabled ?? false,
          created_at: now,
        };
      }
      return maybeId != null
        ? updateChatDatasource(maybeId, body)
        : createChatDatasource(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: efficiencyKeys.chatDatasources(wsId) });
    },
  });
}

/** Delete a datasource row by id. */
export function useDeleteChatDatasource() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      if (MOCK_ENABLED) return;
      return deleteChatDatasource(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: efficiencyKeys.chatDatasources(wsId) });
    },
  });
}

/** Test a datasource connection. Does NOT invalidate — the result is a
 * side-query consumed inline by the row, not a list cache entry. */
export function useTestChatDatasource() {
  return useMutation({
    mutationFn: async (id: number): Promise<ChatDatasourceTestResult> => {
      if (MOCK_ENABLED) {
        // Simulate a healthy connection check without touching the network.
        return { success: true, message: "mock: connection ok", ping_ms: 4 };
      }
      return testChatDatasource(id);
    },
  });
}

// ============================ Sync tasks ============================

/** Submit a new sync task. */
export function useSubmitChatSyncTask() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (
      input: ChatSyncSubmitReq,
    ): Promise<ChatSyncSubmitResponse> => {
      if (MOCK_ENABLED) {
        const ts = Date.now();
        return {
          task_id: `mock-sync-${ts}`,
          status: "queued",
          gaps: [],
          source_id: input.source_id ?? 0,
          source_name: "mock",
        };
      }
      return submitChatSyncTask(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: efficiencyKeys.chatSyncTasks(wsId) });
    },
  });
}

/** Retry a failed sync task. */
export function useRetryChatSyncTask() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (
      taskId: string,
    ): Promise<{ task_id: string; status: string }> => {
      if (MOCK_ENABLED) {
        return { task_id: taskId, status: "retrying" };
      }
      return retryChatSyncTask(taskId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: efficiencyKeys.chatSyncTasks(wsId) });
    },
  });
}

/** Cancel a running/retrying sync task. */
export function useCancelChatSyncTask() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (
      taskId: string,
    ): Promise<{ task_id: string; status: string }> => {
      if (MOCK_ENABLED) {
        return { task_id: taskId, status: "failed" };
      }
      return cancelChatSyncTask(taskId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: efficiencyKeys.chatSyncTasks(wsId) });
    },
  });
}

// ============================ System config ============================

/** Update the flat KV system config. Accepts a partial patch; merges into the
 * cached config so the form reflects the saved state immediately. */
export function useUpdateChatSystemConfig() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (
      input: Partial<ChatSystemConfig>,
    ): Promise<ChatSystemConfig> => {
      // Drop undefined values so the merge stays Record<string, string>
      // (Partial<KV> widens values to string | undefined).
      const patch: ChatSystemConfig = {};
      for (const [k, v] of Object.entries(input)) {
        if (v != null) patch[k] = v;
      }
      if (MOCK_ENABLED) {
        // No network call — return the patch merged onto the cached config so
        // callers can use the resolved value. The invalidate below refetches
        // the (static) mock sample, which is fine.
        const cached = qc.getQueryData<ChatSystemConfig>(
          efficiencyKeys.chatSystemConfig(wsId),
        );
        return { ...(cached ?? {}), ...patch };
      }
      // The real api stub takes the full body; the backend PUT replaces KV.
      await updateChatSystemConfig(patch);
      return patch;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: efficiencyKeys.chatSystemConfig(wsId),
      });
    },
  });
}

// ============================================================================
// Detail-dimension mutations (project CRUD + repo source management + need
// selection + task/commit manual override). Same mock-aware pattern as the
// chat settings hooks above: mutationFn branches on MOCK_ENABLED — the mock
// branch returns a plausible success result WITHOUT hitting the network, so
// the form "succeeds" and onSuccess invalidates the detail/list cache (which
// re-runs the static mock factory); the real branch calls the api.* stub
// (NOT_WIRED until the backend mounts /api/v2/efficiency/*, correct until
// EFFICIENCY_MOCK=0 flips live).
//
// Invalidations are scoped to the affected entity detail + the project list
// (project-scoped mutations change the list's need-scope aggregates; the task/
// commit manual overrides only change their own detail row but are cheap to
// invalidate broadly). No optimistic onMutate patches — the mock samples are
// static, so a plain invalidate + refetch lands the post-mutation state.
// ============================================================================

/** Create a project (POST /v2/projects). Returns the new project_id. */
export function useCreateProject() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (
      body: CreateProjectRequest,
    ): Promise<CreateProjectResponse> => {
      if (MOCK_ENABLED) {
        return {
          project_id: `mock-proj-${Date.now()}`,
          name: body.name,
        };
      }
      return createProject(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: efficiencyKeys.projectList(wsId) });
    },
  });
}

/** Edit a project (PUT /v2/projects/{id}). repos MUST be echoed back as-is. */
export function useUpdateProject() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      body: UpdateProjectRequest;
    }): Promise<void> => {
      if (MOCK_ENABLED) return;
      return updateProject(input.projectId, input.body);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectDetail(wsId, vars.projectId),
      });
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectNeeds(wsId, vars.projectId),
      });
      qc.invalidateQueries({ queryKey: efficiencyKeys.projectList(wsId) });
    },
  });
}

/** Delete a project (DELETE /v2/projects/{id}). */
export function useDeleteProject() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (projectId: string): Promise<void> => {
      if (MOCK_ENABLED) return;
      return deleteProject(projectId);
    },
    onSuccess: (_data, projectId) => {
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectDetail(wsId, projectId),
      });
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectNeeds(wsId, projectId),
      });
      qc.invalidateQueries({ queryKey: efficiencyKeys.projectList(wsId) });
    },
  });
}

/** Project manual override (PUT /v2/projects/{id}/manual). */
export function useUpdateProjectManual() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      body: UpdateProjectManualRequest;
    }): Promise<void> => {
      if (MOCK_ENABLED) return;
      return updateProjectManual(input.projectId, input.body);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectDetail(wsId, vars.projectId),
      });
    },
  });
}

/** Attach tasks to a project (POST /v2/projects/{id}/tasks). */
export function useAddTasksToProject() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      body: AddTasksRequest;
    }): Promise<void> => {
      if (MOCK_ENABLED) return;
      return addTasksToProject(input.projectId, input.body);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectDetail(wsId, vars.projectId),
      });
      qc.invalidateQueries({ queryKey: efficiencyKeys.projectList(wsId) });
    },
  });
}

/**
 * Add a repo source filter to a project (POST /v2/projects/{id}/repos). The
 * backend does read→append→write without a transaction, so callers MUST invoke
 * this sequentially (one await per source), not in parallel — concurrent adds
 * read the same initial repos and the later write wins. (The source modal
 * loops sources in series for this reason.)
 */
export function useAddRepoToProject() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      body: AddRepoRequest;
    }): Promise<void> => {
      if (MOCK_ENABLED) return;
      return addRepoToProject(input.projectId, input.body);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectDetail(wsId, vars.projectId),
      });
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectNeeds(wsId, vars.projectId),
      });
      qc.invalidateQueries({ queryKey: efficiencyKeys.projectList(wsId) });
    },
  });
}

/**
 * Remove a repo source filter by array index (DELETE /v2/projects/{id}/repos/
 * {index}). Indexes drift after a remove, so callers must reload the project
 * detail before issuing the next remove (the invalidate below triggers that).
 */
export function useRemoveRepoFromProject() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      index: number;
    }): Promise<void> => {
      if (MOCK_ENABLED) return;
      return removeRepoFromProject(input.projectId, input.index);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectDetail(wsId, vars.projectId),
      });
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectNeeds(wsId, vars.projectId),
      });
      qc.invalidateQueries({ queryKey: efficiencyKeys.projectList(wsId) });
    },
  });
}

/**
 * Conflict check for the two-phase "add to project" flow (POST /v2/projects/
 * check-conflicts). Query-ish (read-only), but modeled as a mutation because
 * it's triggered by a user action and returns a one-shot result the modal
 * consumes inline (not a cache entry). Mock branch always reports no
 * conflicts so the mock-phase flow proceeds.
 */
export function useCheckProjectConflicts() {
  return useMutation({
    mutationFn: async (body: {
      commit_ids: string[];
    }): Promise<CheckConflictsResponse> => {
      if (MOCK_ENABLED) {
        return { conflicts: [] };
      }
      return checkProjectConflicts(body);
    },
  });
}

/** Include/exclude a single need (PUT /v2/projects/{id}/needs/selection). */
export function useUpdateProjectNeedSelection() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      body: UpdateProjectNeedSelectionRequest;
    }): Promise<void> => {
      if (MOCK_ENABLED) return;
      return updateProjectNeedSelection(input.projectId, input.body);
    },
    onSuccess: (_data, vars) => {
      // Need selection changes both the candidate-pool needs list and the
      // detail's Need-scope aggregates (clean-need recomputation).
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectNeeds(wsId, vars.projectId),
      });
      qc.invalidateQueries({
        queryKey: efficiencyKeys.projectDetail(wsId, vars.projectId),
      });
    },
  });
}

/** Task manual override (PUT /v2/tasks/{id}/manual). */
export function useUpdateTaskManual() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (input: {
      taskId: string;
      body: UpdateTaskManualRequest;
    }): Promise<void> => {
      if (MOCK_ENABLED) return;
      return updateTaskManual(input.taskId, input.body);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: efficiencyKeys.taskDetail(wsId, vars.taskId),
      });
    },
  });
}

/** Commit manual override (PUT /v2/commits/{id}/manual). */
export function useUpdateCommitManual() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: async (input: {
      commitId: string;
      body: UpdateCommitManualRequest;
    }): Promise<void> => {
      if (MOCK_ENABLED) return;
      return updateCommitManual(input.commitId, input.body);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: efficiencyKeys.commitDetail(wsId, vars.commitId),
      });
    },
  });
}
