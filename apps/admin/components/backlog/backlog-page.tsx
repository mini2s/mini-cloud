"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { IssueStatus, UpdateIssueRequest } from "@multica/core/types";
import { useWorkspaceId } from "@multica/core/hooks";
import { BOARD_STATUSES } from "@multica/core/issues/config";
import { useUpdateIssue } from "@multica/core/issues/mutations";
import { issueListOptions } from "@multica/core/issues/queries";
import {
  createIssueViewStore,
  useClearFiltersOnWorkspaceChange,
} from "@multica/core/issues/stores/view-store";
import { ViewStoreProvider } from "@multica/core/issues/stores/view-store-context";
import { BoardView } from "@multica/views/issues/components";

/**
 * Per-status hard cap baked into {@link issueListOptions} / `fetchFirstPages`
 * is {@link ISSUE_PAGE_SIZE} (50). The board renders the first page per
 * status; further pages load via the per-column load-more. We surface the
 * cap as a header notice so users know more exist.
 */
const FIRST_PAGE_PER_STATUS = 50;
const CAPPED_TOTAL = FIRST_PAGE_PER_STATUS * BOARD_STATUSES.length;

/**
 * Isolated, persisted view store for the Backlog page. Separate key from
 * `multica_issues_view` (the `/issues` page) and `multica_my_issues_view`
 * (the `/me`-style page) so this page's sort/grouping/filter state doesn't
 * leak into siblings. Module-level singleton matches how the other two
 * stores are declared.
 */
const backlogViewStore = createIssueViewStore("multica_admin_backlog_view");

/**
 * Workspace-wide backlog board. Mirrors `MyIssuesPage`'s `BoardView` wiring
 * but widens scope from "assigned to me" to "whole workspace".
 *
 * Data: reuses {@link issueListOptions} — the canonical workspace-wide first
 * page query. It fetches all `BOARD_STATUSES` in parallel and flattens. The
 * `useUpdateIssue` mutation invalidates the same cache key (`issueKeys.list`),
 * so drags land immediately.
 *
 * Store: `BoardView` reads sort/grouping via `useViewStore`, which requires
 * a `ViewStoreProvider` ancestor — see {@link backlogViewStore}.
 */
export function BacklogPage() {
  // Reset filters when the user switches workspace (URL-driven).
  useClearFiltersOnWorkspaceChange(backlogViewStore, useWorkspaceId());

  return (
    <ViewStoreProvider store={backlogViewStore}>
      <BacklogBoard />
    </ViewStoreProvider>
  );
}

function BacklogBoard() {
  const wsId = useWorkspaceId();
  const listOptions = useMemo(() => issueListOptions(wsId), [wsId]);
  const { data: issues = [], isLoading } = useQuery(listOptions);

  const visibleStatuses = useMemo(() => BOARD_STATUSES, []);
  const hiddenStatuses = useMemo<IssueStatus[]>(() => [], []);

  const updateIssue = useUpdateIssue();
  const handleMoveIssue = useCallback(
    (
      issueId: string,
      updates: Pick<
        UpdateIssueRequest,
        "status" | "assignee_type" | "assignee_id" | "position"
      >,
    ) => {
      updateIssue.mutate(
        { id: issueId, ...updates },
        {
          onError: (err) =>
            toast.error(
              err instanceof Error && err.message
                ? err.message
                : "Failed to move issue.",
            ),
        },
      );
    },
    [updateIssue],
  );

  const totalCount = issues.length;
  const cappedNotice = totalCount >= CAPPED_TOTAL;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">Backlog</h1>
          <p className="text-xs text-muted-foreground">
            {cappedNotice
              ? `Showing first ${FIRST_PAGE_PER_STATUS} per status (${totalCount}+)`
              : `${totalCount} issues`}
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : (
          <BoardView
            issues={issues}
            visibleStatuses={visibleStatuses}
            hiddenStatuses={hiddenStatuses}
            onMoveIssue={handleMoveIssue}
          />
        )}
      </div>
    </div>
  );
}
