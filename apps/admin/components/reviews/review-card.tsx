"use client";

import Link from "next/link";
import { GitPullRequestArrow, GitMerge } from "lucide-react";
import type {
  GitHubPullRequest,
  GitlabMergeRequest,
} from "@multica/core/types";
import type { ReviewCodePlatform, ReviewItem } from "./use-reviews-data";

interface ReviewCardProps {
  item: ReviewItem;
  codePlatform: ReviewCodePlatform;
  workspaceSlug: string;
}

// GitHub PR state uses "open"; GitLab MR state uses "opened". Treat both as open.
function isOpen(state: string | undefined): boolean {
  return state === "open" || state === "opened";
}

/**
 * Card summarising a single `in_review` issue with a tally of its linked
 * PRs/MRs by state. Clicking deep-links to the issue detail page.
 *
 * State vocabularies:
 *   - GitHub PR (`GitHubPullRequest.state`): "open" | "closed" | "merged" | "draft"
 *   - GitLab MR (`GitlabMergeRequest.state`): "opened" | "merged" | "closed"
 *
 * "draft" PRs count toward the open tally (they're still awaiting merge).
 */
export function ReviewCard({ item, codePlatform, workspaceSlug }: ReviewCardProps) {
  const { issue, pullRequests, mergeRequests } = item;
  const codeChanges: (GitHubPullRequest | GitlabMergeRequest)[] =
    codePlatform === "github" ? pullRequests : mergeRequests;

  let open = 0;
  let merged = 0;
  let closed = 0;
  for (const c of codeChanges) {
    const state = (c as { state?: string }).state;
    if (isOpen(state)) open++;
    else if (state === "merged") merged++;
    else if (state === "closed") closed++;
  }

  const href = `/${workspaceSlug}/issues/${issue.id}`;
  const issueLabel = issue.title || issue.identifier || `#${issue.number}`;

  return (
    <Link
      href={href}
      className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
              In Review
            </span>
            <span className="truncate font-medium">{issueLabel}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {open > 0 && (
              <span className="inline-flex items-center gap-1">
                <GitPullRequestArrow className="size-3" />
                {open} open
              </span>
            )}
            {merged > 0 && (
              <span className="inline-flex items-center gap-1">
                <GitMerge className="size-3" />
                {merged} merged
              </span>
            )}
            {closed > 0 && (
              <span className="text-destructive">{closed} closed</span>
            )}
            {codeChanges.length === 0 && (
              <span className="italic">
                No linked {codePlatform === "github" ? "PRs" : "MRs"}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
