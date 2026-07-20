"use client";

import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace } from "@multica/core/paths";
import { issuePullRequestsOptions } from "@multica/core/github";
import { issueMergeRequestsOptions } from "@multica/core/gitlab";
import type {
  GitHubPullRequest,
  GitlabMergeRequest,
  Issue,
} from "@multica/core/types";

const REVIEWS_LIMIT = 100;

export type ReviewCodePlatform = "github" | "gitlab";

export interface ReviewItem {
  issue: Issue;
  pullRequests: GitHubPullRequest[];
  mergeRequests: GitlabMergeRequest[];
}

/**
 * Detects the workspace's code platform from `workspace.settings.code_platform`.
 * Matches the logic in `packages/views/settings/components/settings-page.tsx`:
 * default to "gitlab" when unset, "github" only when explicitly set.
 */
function detectCodePlatform(
  settings: Record<string, unknown> | undefined,
): ReviewCodePlatform {
  return settings?.code_platform === "github" ? "github" : "gitlab";
}

/**
 * Aggregates the Reviews page data:
 *   1. Fetches all `in_review` issues in a single request.
 *   2. For each issue, fetches its linked PRs (GitHub) or MRs (GitLab) in
 *      parallel via `useQueries` (Rules-of-Hooks safe for variable-length
 *      input — unlike `useQuery` inside `.map`).
 *
 * The per-issue queries reuse the same query options used by the issue-detail
 * sidebar (`issuePullRequestsOptions` / `issueMergeRequestsOptions`), so the
 * results are shared with the React Query cache.
 */
export function useReviewsData() {
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();

  const codePlatform: ReviewCodePlatform = useMemo(
    () =>
      detectCodePlatform(
        workspace?.settings as Record<string, unknown> | undefined,
      ),
    [workspace?.settings],
  );

  // 1. Fetch all in_review issues (single request).
  const issuesQuery = useQuery({
    queryKey: ["reviews", wsId, "in_review-issues"],
    queryFn: async (): Promise<Issue[]> => {
      const res = await api.listIssues({
        status: "in_review",
        limit: REVIEWS_LIMIT,
      });
      return res.issues ?? [];
    },
  });

  // Memoize so `issues` keeps a stable identity across renders where the
  // query data hasn't changed — otherwise downstream `useMemo`/`useQueries`
  // deps would thrash on every render (eslint-plugin-react-hooks/exhaustive-deps).
  const issues = useMemo(() => issuesQuery.data ?? [], [issuesQuery.data]);

  // 2. For each issue, fetch its PRs or MRs based on code platform.
  //    useQueries handles variable length correctly (Rules of Hooks safe).
  const prQueries = useQueries({
    queries: issues.map((issue) =>
      codePlatform === "github"
        ? issuePullRequestsOptions(issue.id)
        : issueMergeRequestsOptions(issue.id),
    ),
  });

  const items: ReviewItem[] = useMemo(() => {
    return issues.map((issue, idx) => {
      const result = prQueries[idx]?.data;
      return {
        issue,
        pullRequests:
          codePlatform === "github"
            ? (result as { pull_requests?: GitHubPullRequest[] } | undefined)
                ?.pull_requests ?? []
            : [],
        mergeRequests:
          codePlatform === "gitlab"
            ? (result as
                | { merge_requests?: GitlabMergeRequest[] }
                | undefined)?.merge_requests ?? []
            : [],
      };
    });
  }, [issues, prQueries, codePlatform]);

  return {
    codePlatform,
    items,
    isLoading: issuesQuery.isLoading,
    isError: issuesQuery.isError || prQueries.some((q) => q.isError),
    totalCount: issues.length,
  };
}
