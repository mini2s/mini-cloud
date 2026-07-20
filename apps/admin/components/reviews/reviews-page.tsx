"use client";

import { Loader2, Inbox } from "lucide-react";
import { useCurrentWorkspace } from "@multica/core/paths";
import { useReviewsData } from "./use-reviews-data";
import { ReviewCard } from "./review-card";

/**
 * Reviews landing page. Lists every `in_review` issue in the workspace with
 * a per-issue tally of linked PR/MR states (open / merged / closed). Code
 * platform is detected from `workspace.settings.code_platform`.
 */
export function ReviewsPage() {
  const workspace = useCurrentWorkspace();
  const workspaceSlug = workspace?.slug ?? "";
  const { items, codePlatform, isLoading, isError, totalCount } =
    useReviewsData();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        Failed to load reviews.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">Reviews</h1>
          <p className="text-xs text-muted-foreground">
            {totalCount} issue{totalCount === 1 ? "" : "s"} in review ·{" "}
            {codePlatform === "github" ? "GitHub PRs" : "GitLab MRs"}
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-4">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Inbox className="size-8" />
            <p>Nothing in review.</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {items.map((item) => (
              <ReviewCard
                key={item.issue.id}
                item={item}
                codePlatform={codePlatform}
                workspaceSlug={workspaceSlug}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
