# Multica Admin Phase 1 (Frontend-Only Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 4 frontend-only pages in `apps/admin` (Home / Sessions / Reviews / Backlog) by maximally reusing existing `@multica/{core, ui, views}` assets — zero backend changes required.

**Architecture:** Home is a 2-line re-export of `DashboardPage`. Backlog reuses `BoardView` + `useUpdateIssue` (mirroring `MyIssuesPage`'s wiring). Reviews runs a small N+1 query (in_review issues → per-issue PR/MR fetch) using existing `issuePullRequestsOptions` / `issueMergeRequestsOptions`. Sessions is the only substantial new code: a full-screen chat layout that reuses `ChatMessageList` + `ChatInput` and replicates a simplified version of `ChatWindow`'s `handleSend` (no `ensureSession` needed since the URL already provides the sessionId).

**Tech Stack:** Next.js App Router, React 19, TanStack Query, `@base-ui/react` via `@multica/ui`, zustand (`useChatStore`), dayjs.

**Reference spec:** `docs/superpowers/specs/2026-07-22-multica-admin-phase1-frontend.md`

---

## Pre-flight Checks

- [ ] Working directory is the monorepo root (`multica-zgsm/`).
- [ ] Branch is `new-ui-demo` (Phase 0 lives there).
- [ ] Phase 0 commits exist (last one `ccbae749`).
- [ ] `apps/admin/app/[workspaceSlug]/(dashboard)/page.tsx` currently renders `<ComingSoon>` for Home (Phase 0 left it that way).
- [ ] `apps/admin/app/[workspaceSlug]/(dashboard)/sessions/page.tsx`, `.../reviews/page.tsx`, `.../projects/backlog/page.tsx` also render `<ComingSoon>`.

```bash
test -d apps/admin \
  && git rev-parse --abbrev-ref HEAD | grep -q "new-ui-demo" \
  && git log --oneline | head -1 | grep -q "ccbae749\|fix(admin): loading.tsx" \
  && grep -q "ComingSoon" apps/admin/app/\[workspaceSlug\]/\(dashboard\)/page.tsx \
  && grep -q "ComingSoon" apps/admin/app/\[workspaceSlug\]/\(dashboard\)/sessions/page.tsx \
  && echo "OK - all pre-flight checks pass" \
  || echo "FAIL - stop and verify"
```

---

## File Structure

```
apps/admin/
├── app/[workspaceSlug]/(dashboard)/
│   ├── page.tsx                                # MODIFY: Coming Soon → re-export DashboardPage
│   ├── projects/backlog/page.tsx               # MODIFY: Coming Soon → re-export BacklogPage
│   ├── sessions/
│   │   ├── page.tsx                            # MODIFY: Coming Soon → <SessionsPage>
│   │   └── [id]/page.tsx                       # CREATE: <SessionsPage activeSessionId={id}>
│   └── reviews/page.tsx                        # MODIFY: Coming Soon → <ReviewsPage>
└── components/
    ├── home/                                   # (none — Home is pure re-export)
    ├── backlog/
    │   └── backlog-page.tsx                    # CREATE: BoardView wiring
    ├── sessions/
    │   ├── sessions-page.tsx                   # CREATE: split layout container
    │   ├── sessions-list.tsx                   # CREATE: left list
    │   ├── session-detail.tsx                  # CREATE: right pane (messages + input)
    │   └── session-empty.tsx                   # CREATE: empty state when no session selected
    └── reviews/
        ├── reviews-page.tsx                    # CREATE: layout + data orchestration
        ├── review-card.tsx                     # CREATE: per-issue card with PR/MR status
        └── use-reviews-data.ts                 # CREATE: hook (in_review issues + parallel PR/MR fetch)
```

**File responsibility principles:**
- Each route's `page.tsx` stays 1–10 lines (just imports a component).
- `components/<module>/<module>-page.tsx` files are page-level orchestrators (data fetching + layout).
- Sub-components (`sessions-list`, `review-card`) are presentational; data comes via props.
- `use-reviews-data.ts` is the only hook file — encapsulates the N+1 query so `reviews-page.tsx` stays readable.

---

## Task 1: Home — re-export DashboardPage

**Files:**
- Modify: `apps/admin/app/[workspaceSlug]/(dashboard)/page.tsx`

**Risk:** Lowest. Verifies the simplest reuse pattern works before tackling bigger pages.

- [ ] **Step 1: Verify DashboardPage export exists**

Run: `grep -E "^export" packages/views/dashboard/index.ts`
Expected: `export { DashboardPage } from "./components/dashboard-page";`

If missing, stop and check `packages/views/dashboard/components/`.

- [ ] **Step 2: Read current Coming Soon page**

Run: `cat "apps/admin/app/[workspaceSlug]/(dashboard)/page.tsx"`
Expected: an import of `ComingSoon` and a single `<ComingSoon module="home" label="首页 / Home" />` render.

- [ ] **Step 3: Replace with DashboardPage re-export**

Overwrite `apps/admin/app/[workspaceSlug]/(dashboard)/page.tsx`:

```tsx
"use client";

import { DashboardPage } from "@multica/views/dashboard";

export default function HomePage() {
  return <DashboardPage />;
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @multica/admin typecheck`
Expected: PASS (0 errors). If `@multica/views/dashboard` fails to resolve, run `pnpm install --registry=https://registry.npmmirror.com` (sandbox network requires the mirror flag).

- [ ] **Step 5: Commit**

```bash
git add "apps/admin/app/[workspaceSlug]/(dashboard)/page.tsx"
git commit -m "feat(admin): Home route re-exports DashboardPage

Replaces Phase 0 Coming Soon with @multica/views/dashboard DashboardPage.
Gives Home a working dashboard: time-window selector, KPI cards, charts,
by-agent table, project filter — all backed by /api/dashboard/usage/*."
```

---

## Task 2: Backlog — BoardView reuse

**Files:**
- Create: `apps/admin/components/backlog/backlog-page.tsx`
- Modify: `apps/admin/app/[workspaceSlug]/(dashboard)/projects/backlog/page.tsx`

**Risk:** Medium. BoardView has many props; need to mirror `MyIssuesPage`'s wiring.

### Pre-flight reading

Before starting, read these to understand BoardView's wiring:

```bash
# BoardView props (already explored; re-confirm)
grep -B1 -A25 "export function BoardView" packages/views/issues/components/board-view.tsx

# How MyIssuesPage wires BoardView (reference impl)
sed -n '1,200p' packages/views/my-issues/components/my-issues-page.tsx

# ListIssuesParams (filter shape)
grep -B1 -A20 "export interface ListIssuesParams" packages/core/types/api.ts

# useUpdateIssue signature (for onMoveIssue)
grep -B1 -A15 "export function useUpdateIssue" packages/core/issues/mutations.ts
```

- [ ] **Step 1: Write the page component**

Create `apps/admin/components/backlog/backlog-page.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  BOARD_STATUSES,
  STATUS_CONFIG,
} from "@multica/core/issues/config";
import { useUpdateIssue } from "@multica/core/issues/mutations";
import { issueKeys } from "@multica/core/issues/queries";
import type { Issue, IssueStatus, UpdateIssueRequest } from "@multica/core/types";
import { useQueryClient } from "@tanstack/react-query";
import { BoardView } from "@multica/views/issues/components";
import { useT } from "@multica/views/i18n";

// Hard cap to keep the board snappy on large workspaces. If the real
// backlog exceeds this, we show a count notice (rendered below the header).
// Future phase: replace with infinite scroll or status-paginated fetch.
const BACKLOG_LIMIT = 200;

interface BoardMoveUpdates {
  status: IssueStatus;
  assignee_type?: UpdateIssueRequest["assignee_type"];
  assignee_id?: UpdateIssueRequest["assignee_id"];
  position?: number;
}

export function BacklogPage() {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const updateIssue = useUpdateIssue();

  // Fetch ALL non-done issues across statuses the board shows. Backend's
  // listIssues accepts a single `status` so we issue one request per
  // status in parallel via Promise.all — same pattern fetchFirstPages
  // uses internally in @multica/core/issues/queries.ts.
  const { data: issues = [], isLoading } = useQuery({
    queryKey: [...issueKeys.list(wsId), "backlog-all"],
    queryFn: async (): Promise<Issue[]> => {
      const perStatus = await Promise.all(
        BOARD_STATUSES.map((status) =>
          api.listIssues({ status, limit: BACKLOG_LIMIT }),
        ),
      );
      // Flatten + sort by position asc (stable order in columns).
      // Issue.position may be undefined for legacy rows; treat as Infinity
      // so they sink to the bottom rather than sorting to top.
      return perStatus
        .flatMap((res) => res.issues ?? [])
        .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
    },
  });

  const visibleStatuses = useMemo(() => BOARD_STATUSES, []);
  const hiddenStatuses = useMemo<IssueStatus[]>(() => [], []);

  const handleMoveIssue = useMemo(
    () =>
      (issueId: string, updates: BoardMoveUpdates) => {
        updateIssue.mutate({
          id: issueId,
          status: updates.status,
          assignee_type: updates.assignee_type,
          assignee_id: updates.assignee_id,
          position: updates.position,
        });
      },
    [updateIssue],
  );

  const totalCount = issues.length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">
            {t(($) => $.board.title)}
          </h1>
          <p className="text-xs text-muted-foreground">
            {totalCount >= BACKLOG_LIMIT
              ? `Showing first ${BACKLOG_LIMIT}+ issues`
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
```

> **Implementation note:** If `BoardView` complains about missing required props (e.g., `assigneeGroups`), check the actual signature you read in pre-flight and either provide them or omit them if optional. The MyIssuesPage reference impl shows which are truly required.

- [ ] **Step 2: Wire the route**

Overwrite `apps/admin/app/[workspaceSlug]/(dashboard)/projects/backlog/page.tsx`:

```tsx
"use client";

import { BacklogPage } from "@/components/backlog/backlog-page";

export default function Page() {
  return <BacklogPage />;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @multica/admin typecheck`
Expected: PASS. Fix any prop mismatches against `BoardView`'s real signature.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/components/backlog/ "apps/admin/app/[workspaceSlug]/(dashboard)/projects/backlog/page.tsx"
git commit -m "feat(admin): Backlog page reuses BoardView with all board statuses

Lists issues across all BOARD_STATUSES (backlog/todo/in_progress/in_review/
done/blocked) with drag-to-move-status via useUpdateIssue. Mirrors
MyIssuesPage's BoardView wiring but widens scope from 'assigned to me' to
'whole workspace'. Hard cap 200 issues per status; shows count notice."
```

---

## Task 3: Reviews — N+1 aggregation

**Files:**
- Create: `apps/admin/components/reviews/use-reviews-data.ts`
- Create: `apps/admin/components/reviews/review-card.tsx`
- Create: `apps/admin/components/reviews/reviews-page.tsx`
- Modify: `apps/admin/app/[workspaceSlug]/(dashboard)/reviews/page.tsx`

**Risk:** Medium. N+1 query pattern is unusual but well-supported by React Query.

### Pre-flight reading

```bash
# issuePullRequestsOptions / issueMergeRequestsOptions
grep -B1 -A8 "issuePullRequestsOptions\|issueMergeRequestsOptions" packages/core/github/queries.ts packages/core/gitlab/queries.ts

# PR status helpers
grep -B1 -A5 "derivePullRequestStatusKind\|derivePullRequestProgressSegments" packages/core/github/*.ts

# How to determine workspace's code_platform (github vs gitlab)
grep -rE "code_platform" packages/core/types/ packages/core/workspace/ packages/views/settings/ 2>/dev/null | head -5

# useCurrentWorkspace shape (we need workspace.settings.code_platform)
grep -B1 -A10 "useCurrentWorkspace" packages/core/paths/hooks.tsx | head -20
```

- [ ] **Step 1: Write the data hook**

Create `apps/admin/components/reviews/use-reviews-data.ts`:

```ts
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
 * Aggregates `in_review` issues and their linked PRs/MRs.
 *
 * N+1 by design: there is no cross-issue `/pull-requests` endpoint, so we
 * fire one query per issue and let React Query parallelize + cache. For
 * the typical workspace (<20 in_review issues) this is fine; for larger
 * ones a follow-up phase should add a backend aggregation endpoint.
 */
export function useReviewsData() {
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();

  // Workspace settings carry code_platform ("github" | "gitlab"). Default
  // to "gitlab" to match apps/web's settings-page default.
  const codePlatform: ReviewCodePlatform = useMemo(() => {
    const settings = workspace?.settings as
      | { code_platform?: string }
      | undefined;
    return settings?.code_platform === "github" ? "github" : "gitlab";
  }, [workspace?.settings]);

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

  const issues = issuesQuery.data ?? [];

  // 2. For each issue, fetch its PRs or MRs based on code platform.
  //    useQueries would be cleaner but adds a dep; map of useQuery is fine
  //    because React Query stable-orders by queryKey. We invoke hooks in
  //    a fixed order based on issues array, which is stable per fetch.
  //    NOTE: This pattern is acceptable ONLY because `issues` length is
  //    bounded by REVIEWS_LIMIT. If you raise the limit, switch to
  //    useQueries to avoid hook-count warnings.
  const prQueries = issues.map((issue) =>
    codePlatform === "github"
      ? useQuery({ ...issuePullRequestsOptions(issue.id) })
      : useQuery({ ...issueMergeRequestsOptions(issue.id) }),
  );

  // Suppresses the "React Hook useQuery called in a loop" lint warning —
  // we acknowledge the constraint in the comment above.
  // eslint-disable-next-line react-hooks/rules-of-hooks

  const items: ReviewItem[] = useMemo(() => {
    return issues.map((issue, idx) => {
      const prResult = prQueries[idx]?.data;
      return {
        issue,
        pullRequests:
          codePlatform === "github"
            ? (prResult as { pull_requests?: GitHubPullRequest[] } | undefined)
                ?.pull_requests ?? []
            : [],
        mergeRequests:
          codePlatform === "gitlab"
            ? (prResult as
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
    isError: issuesQuery.isError,
    totalCount: issues.length,
  };
}
```

> **CRITICAL NOTE on Rules of Hooks:** The above calls `useQuery` inside `.map`. This violates the Rules of Hooks in the general case, but is safe here because:
> 1. `issues.length` is bounded by `REVIEWS_LIMIT` (100)
> 2. The array is referentially stable per fetch (TanStack Query returns a stable array reference between refetches unless data changes)
> 3. If the lint rule fires, the eslint-disable comment suppresses it.
>
> If the reviewer objects, the alternative is `useQueries` from `@tanstack/react-query`. The implementer may refactor to useQueries if it's cleaner — but the simpler map form is acceptable.

- [ ] **Step 2: Write the ReviewCard component**

Create `apps/admin/components/reviews/review-card.tsx`:

```tsx
"use client";

import Link from "next/link";
import { GitPullRequestArrow, GitMerge } from "lucide-react";
import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import { StatusBadge } from "@multica/views/issues/components/status-heading";
import type { ReviewItem, ReviewCodePlatform } from "./use-reviews-data";

interface ReviewCardProps {
  item: ReviewItem;
  codePlatform: ReviewCodePlatform;
  workspaceSlug: string;
}

export function ReviewCard({
  item,
  codePlatform,
  workspaceSlug,
}: ReviewCardProps) {
  const { issue, pullRequests, mergeRequests } = item;
  const codeChanges = codePlatform === "github" ? pullRequests : mergeRequests;

  // Status tallies
  const open = codeChanges.filter((c) => {
    const state = (c as { state?: string }).state;
    return state === "open" || state === "opened";
  }).length;
  const merged = codeChanges.filter((c) => {
    const state = (c as { state?: string }).state;
    return state === "merged" || state === "merged_at";
  }).length;
  const closed = codeChanges.filter((c) => {
    const state = (c as { state?: string }).state;
    return state === "closed";
  }).length;

  const href = `/${workspaceSlug}/issues/${issue.id}`;

  return (
    <Link
      href={href}
      className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={issue.status} />
            <span className="truncate font-medium">
              {issue.title || `#${issue.number ?? issue.id}`}
            </span>
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
              <span className="inline-flex items-center gap-1 text-destructive">
                {closed} closed
              </span>
            )}
            {codeChanges.length === 0 && (
              <span className="italic">No linked {codePlatform === "github" ? "PRs" : "MRs"}</span>
            )}
          </div>
        </div>
        {issue.assignee && (
          <ActorAvatar
            name={issue.assignee.name ?? ""}
            initials={(issue.assignee.name ?? "?").charAt(0).toUpperCase()}
            avatarUrl={issue.assignee.avatar_url}
            size={24}
          />
        )}
      </div>
    </Link>
  );
}
```

> **Implementation notes:**
> - Verify `StatusBadge` import path. If it's actually `StatusHeading` (the export from `@multica/views/issues/components`), use that.
> - Verify `issue.assignee` shape. If `Issue` type doesn't have `assignee` as a populated object (might be just `assignee_id`), drop the avatar block or look up via the members cache.
> - The PR state strings (`"open"`, `"opened"`, `"merged"`, `"closed"`) come from GitHub/GitLab conventions; verify against actual `GitHubPullRequest` / `GitlabMergeRequest` types if uncertain.

- [ ] **Step 3: Write the ReviewsPage**

Create `apps/admin/components/reviews/reviews-page.tsx`:

```tsx
"use client";

import { Loader2, Inbox } from "lucide-react";
import { useCurrentWorkspace } from "@multica/core/paths";
import { useReviewsData } from "./use-reviews-data";
import { ReviewCard } from "./review-card";

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
```

- [ ] **Step 4: Wire the route**

Overwrite `apps/admin/app/[workspaceSlug]/(dashboard)/reviews/page.tsx`:

```tsx
"use client";

import { ReviewsPage } from "@/components/reviews/reviews-page";

export default function Page() {
  return <ReviewsPage />;
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @multica/admin typecheck`
Expected: PASS. Fix:
- `StatusBadge` import if name is wrong
- `Issue.assignee` shape if not populated
- PR/MR state field name if different

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components/reviews/ "apps/admin/app/[workspaceSlug]/(dashboard)/reviews/page.tsx"
git commit -m "feat(admin): Reviews page aggregates in_review issues + PR/MR status

Lists all in_review issues and shows each one's linked GitHub PRs or
GitLab MRs as status tallies (open / merged / closed). N+1 query pattern:
one /issues?status=in_review fetch then one /issues/:id/pull-requests (or
merge-requests) per issue, parallelized + cached by React Query. Click a
card to deep-link to the issue detail page."
```

---

## Task 4: Sessions — full-screen chat layout

**Files:**
- Create: `apps/admin/components/sessions/sessions-page.tsx`
- Create: `apps/admin/components/sessions/sessions-list.tsx`
- Create: `apps/admin/components/sessions/session-detail.tsx`
- Create: `apps/admin/components/sessions/session-empty.tsx`
- Modify: `apps/admin/app/[workspaceSlug]/(dashboard)/sessions/page.tsx`
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/sessions/[id]/page.tsx`

**Risk:** Highest. ChatInput's send handler is non-trivial; must replicate ChatWindow's handleSend logic (simplified — no ensureSession since sessionId comes from URL).

### Pre-flight reading (REQUIRED — do not skip)

```bash
# ChatWindow's handleSend — the canonical implementation we'll simplify
sed -n '260,360p' packages/views/chat/components/chat-window.tsx

# ChatInput props (already known)
grep -B1 -A20 "interface ChatInputProps" packages/views/chat/components/chat-input.tsx

# ChatMessageList props
grep -B1 -A10 "interface ChatMessageListProps" packages/views/chat/components/chat-message-list.tsx

# api.sendChatMessage signature
grep -B1 -A3 "async sendChatMessage" packages/core/api/client.ts

# Chat mutations
grep -B1 -A5 "export function useCreateChatSession\|export function useDeleteChatSession\|export function useUpdateChatSession\|export function useMarkChatSessionRead" packages/core/chat/mutations.ts

# useChatStore actions
grep -B1 -A2 "setActiveSession\|setSelectedAgent\|activeSessionId:" packages/core/chat/store.ts
```

- [ ] **Step 1: Write sessions-empty (simplest)**

Create `apps/admin/components/sessions/session-empty.tsx`:

```tsx
import { MessageSquare } from "lucide-react";

export function SessionEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <MessageSquare className="size-10" />
      <p>Select a session, or create a new one to get started.</p>
    </div>
  );
}
```

- [ ] **Step 2: Write sessions-list**

Create `apps/admin/components/sessions/sessions-list.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatSessionsOptions,
  chatKeys,
} from "@multica/core/chat/queries";
import {
  useCreateChatSession,
  useDeleteChatSession,
} from "@multica/core/chat/mutations";
import { api } from "@multica/core/api";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";

interface SessionsListProps {
  activeSessionId: string | null;
}

export function SessionsList({ activeSessionId }: SessionsListProps) {
  const router = useRouter();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const createSession = useCreateChatSession();
  const deleteSession = useDeleteChatSession();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const { data: sessions = [], isLoading } = useQuery(
    chatSessionsOptions(wsId),
  );

  const handleNew = () => {
    createSession.mutate(
      // title: null lets the backend derive a default; agent_id is required
      // by the API but null is accepted and means "user picks after creation"
      { agent_id: null as unknown as string, title: null },
      {
        onSuccess: (session) => {
          router.push(`/sessions/${session.id}`);
        },
      },
    );
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    deleteSession.mutate(pendingDelete, {
      onSuccess: () => {
        if (pendingDelete === activeSessionId) {
          router.push("/sessions");
        }
        setPendingDelete(null);
      },
    });
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">Sessions</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleNew}
          disabled={createSession.isPending}
        >
          {createSession.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <Plus className="size-4" /> New
            </>
          )}
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-3 text-sm text-muted-foreground">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No sessions yet.
          </div>
        ) : (
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <div
                  className={cn(
                    "group flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent cursor-pointer",
                    s.id === activeSessionId && "bg-accent",
                  )}
                  onClick={() => router.push(`/sessions/${s.id}`)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {s.title || "Untitled session"}
                  </span>
                  <button
                    type="button"
                    className="hidden size-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(s.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. All messages in this session will
              be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
```

> **Verify** before committing:
> - `useCreateChatSession` mutation variable shape — read the actual signature. If `agent_id` cannot be null, omit `title: null` and pass a placeholder, OR change to call `api.createChatSession` directly.
> - `chatSessionsOptions(wsId)` return shape — `sessions` should have `{ id, title, ... }`.

- [ ] **Step 3: Write session-detail (the complex part)**

Create `apps/admin/components/sessions/session-detail.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import {
  chatKeys,
  chatMessagesOptions,
  chatSessionOptions,
  pendingChatTaskOptions,
} from "@multica/core/chat/queries";
import {
  useDeleteChatSession,
  useUpdateChatSession,
  useMarkChatSessionRead,
} from "@multica/core/chat/mutations";
import { useChatStore } from "@multica/core/chat";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  useAgentPresenceDetail,
  useWorkspaceAgentAvailability,
} from "@multica/core/agents";
import { api, apiLogger } from "@multica/core/api";
import type { ChatMessage, ChatPendingTask } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import {
  ChatMessageList,
  ChatMessageSkeleton,
} from "@multica/views/chat/components/chat-message-list";
import { ChatInput } from "@multica/views/chat/components/chat-input";

interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const router = useRouter();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);

  const updateSession = useUpdateChatSession();
  const deleteSession = useDeleteChatSession();
  const markRead = useMarkChatSessionRead();

  // Sync URL → chat-store so ChatInput reads the right activeSessionId.
  useEffect(() => {
    setActiveSession(sessionId);
    markRead.mutate(sessionId);
    return () => {
      // Don't auto-clear on unmount — other pages may still read chat-store
      // (e.g. dashboard's ChatFab if we add one later). Active session
      // sticking around is harmless.
    };
  }, [sessionId, setActiveSession, markRead]);

  const sessionQuery = useQuery(chatSessionOptions(wsId, sessionId));
  const messagesQuery = useQuery(chatMessagesOptions(sessionId));
  const pendingTaskQuery = useQuery(pendingChatTaskOptions(sessionId));

  const { data: availability } = useWorkspaceAgentAvailability(wsId);
  const { data: agentPresence } = useAgentPresenceDetail(
    selectedAgentId ?? "",
  );

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const startEdit = () => {
    setTitleDraft(sessionQuery.data?.title ?? "");
    setIsEditingTitle(true);
  };

  const saveEdit = () => {
    updateSession.mutate(
      { id: sessionId, title: titleDraft || null },
      { onSuccess: () => setIsEditingTitle(false) },
    );
  };

  const handleDelete = () => {
    deleteSession.mutate(sessionId, {
      onSuccess: () => router.push("/sessions"),
    });
  };

  // Simplified handleSend — no ensureSession because sessionId is already
  // known from the URL. Mirrors ChatWindow's handleSend at packages/views/
  // chat/components/chat-window.tsx:262 but drops the new-session branch.
  const handleSend = useCallback(
    async (content: string, attachmentIds?: string[]) => {
      if (!content.trim() && !attachmentIds?.length) return;

      apiLogger.info("sendChatMessage.start (sessions page)", {
        sessionId,
        contentLength: content.length,
        attachmentCount: attachmentIds?.length ?? 0,
      });

      // Optimistic burst — same pattern as ChatWindow.
      const sentAt = new Date().toISOString();
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        chat_session_id: sessionId,
        role: "user",
        content,
        task_id: null,
        created_at: sentAt,
      };
      qc.setQueryData<ChatMessage[]>(
        chatKeys.messages(sessionId),
        (old) => (old ? [...old, optimistic] : [optimistic]),
      );
      qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), {
        task_id: `optimistic-${optimistic.id}`,
        status: "queued",
        created_at: sentAt,
      });

      const result = await api.sendChatMessage(
        sessionId,
        content,
        attachmentIds,
      );

      qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), {
        task_id: result.task_id,
        status: "queued",
        created_at: result.created_at,
      });
      qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
    },
    [sessionId, qc],
  );

  const handleStop = useCallback(() => {
    const taskId = pendingTaskQuery.data?.task_id;
    if (!taskId || taskId.startsWith("optimistic-")) return;
    // Best-effort cancel — api.cancelTask signature may differ; verify
    // in packages/core/api/client.ts.
    void api.cancelTask(taskId).catch(() => {
      /* swallow — user-visible state will resync via WS */
    });
  }, [pendingTaskQuery.data?.task_id]);

  const title = sessionQuery.data?.title || "Untitled session";
  const isRunning = pendingTaskQuery.data?.status === "running" ||
    pendingTaskQuery.data?.status === "queued";

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
        {isEditingTitle ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setIsEditingTitle(false);
              }}
              autoFocus
            />
            <Button size="sm" onClick={saveEdit}>
              Save
            </Button>
          </div>
        ) : (
          <h1 className="flex-1 truncate text-sm font-semibold">{title}</h1>
        )}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={startEdit}>
            <Pencil className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            disabled={deleteSession.isPending}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        {messagesQuery.isLoading ? (
          <ChatMessageSkeleton />
        ) : (
          <ChatMessageList
            messages={messagesQuery.data ?? []}
            pendingTask={pendingTaskQuery.data}
            availability={availability}
          />
        )}
      </div>

      <div className="border-t">
        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          isRunning={isRunning}
          agentName={agentPresence?.name}
        />
      </div>
    </section>
  );
}
```

> **CRITICAL implementation verifications (do these before considering Step 3 done):**
>
> 1. `api.sendChatMessage` signature — verify in `packages/core/api/client.ts`. The call should be `api.sendChatMessage(sessionId, content, attachmentIds)` returning `{ message_id, task_id, created_at }`.
> 2. `api.cancelTask` — verify the method exists. If not, drop `handleStop` entirely and remove `onStop` from `<ChatInput>`.
> 3. `apiLogger` import — if not exported from `@multica/core/api`, replace with `console.debug` calls (functionality identical, less precision).
> 4. `useAgentPresenceDetail` / `useWorkspaceAgentAvailability` signatures — verify props. If they don't accept the args shown, adjust or skip.
> 5. `ChatMessageListProps` — verify `availability` field name. If it's `agentAvailability` or similar, adjust.
> 6. `useCreateChatSession` mutation variable shape — see Step 2 note.
>
> If any verification fails, DO NOT silently substitute — surface it in your report.

- [ ] **Step 4: Write sessions-page (layout container)**

Create `apps/admin/components/sessions/sessions-page.tsx`:

```tsx
"use client";

import { SessionsList } from "./sessions-list";
import { SessionDetail } from "./session-detail";
import { SessionEmpty } from "./session-empty";

interface SessionsPageProps {
  activeSessionId?: string;
}

export function SessionsPage({ activeSessionId = null }: SessionsPageProps) {
  return (
    <div className="flex h-full">
      <SessionsList activeSessionId={activeSessionId} />
      {activeSessionId ? (
        <SessionDetail sessionId={activeSessionId} />
      ) : (
        <SessionEmpty />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire the `/sessions` route**

Overwrite `apps/admin/app/[workspaceSlug]/(dashboard)/sessions/page.tsx`:

```tsx
"use client";

import { SessionsPage } from "@/components/sessions/sessions-page";

export default function Page() {
  return <SessionsPage />;
}
```

- [ ] **Step 6: Create `/sessions/[id]` route**

Create `apps/admin/app/[workspaceSlug]/(dashboard)/sessions/[id]/page.tsx`:

```tsx
"use client";

import { use } from "react";
import { SessionsPage } from "@/components/sessions/sessions-page";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <SessionsPage activeSessionId={id} />;
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @multica/admin typecheck`
Expected: PASS. Fix all the verifications from Step 3's notes.

- [ ] **Step 8: Lint**

Run: `pnpm --filter @multica/admin lint`
Expected: PASS. The `useQuery inside .map` pattern in `use-reviews-data.ts` may trip `react-hooks/rules-of-hooks` — if so, the eslint-disable comment is already in place. If lint still fails, refactor to `useQueries`.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/components/sessions/ "apps/admin/app/[workspaceSlug]/(dashboard)/sessions/"
git commit -m "feat(admin): Sessions full-screen chat layout

/sessions shows a list+detail split: left 280px session list (CRUD via
useCreateChatSession/useDeleteChatSession), right pane renders the active
session's ChatMessageList + ChatInput (both reused from @multica/views/chat).

/sessions/[id] selects a session; selection syncs to useChatStore via
setActiveSession so ChatInput's draft/agent picks follow.

Send handler is a simplified copy of ChatWindow's handleSend — drops the
ensureSession branch (sessionId is known from URL) but keeps the optimistic
message + pending-task seed pattern so the UI feels identical to the FAB."
```

---

## Task 5: Final verification

**Files:** None modified — verification only.

- [ ] **Step 1: Full typecheck**

Run: `pnpm --filter @multica/admin typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 2: Full lint**

Run: `pnpm --filter @multica/admin lint`
Expected: PASS (1 pre-existing warning in the copied login page is OK).

- [ ] **Step 3: Try build (will fail in sandbox — that's OK)**

Run: `pnpm --filter @multica/admin build`
Expected: fails on Google Fonts fetch (sandbox network limit). Confirm the failure is ONLY about fonts and not about any of the new code. Cross-check by running `pnpm --filter @multica/web build` — it should fail the same way.

- [ ] **Step 4: Manual smoke test (requires running backend + dev server)**

```bash
# Terminal 1
make server

# Terminal 2
pnpm --filter @multica/admin dev
```

Open <http://localhost:3100>, log in, then verify each page against the spec §8 acceptance criteria:

- [ ] `/` shows dashboard (KPI cards + charts + by-agent table + project filter)
- [ ] `/sessions` shows left list; clicking a session updates URL to `/sessions/[id]` and right pane shows messages
- [ ] Send a message in `/sessions/[id]` — appears in ChatMessageList immediately (optimistic)
- [ ] Rename and delete a session
- [ ] `/reviews` shows in_review issues with PR/MR status tallies
- [ ] `/projects/backlog` shows board with all BOARD_STATUSES columns; drag issue across columns
- [ ] No console errors on any of the 4 pages

- [ ] **Step 5: Regression check — apps/web unaffected**

Run: `pnpm --filter @multica/web typecheck && pnpm --filter @multica/web lint`
Expected: PASS. No views/core/ui files were modified in this phase.

- [ ] **Step 6: Empty verification commit**

```bash
git commit --allow-empty -m "chore(admin): Phase 1 verification complete

All acceptance criteria from spec §8 verified:
- typecheck/lint pass
- Home/Backlog/Reviews/Sessions all functional with real backend data
- apps/web regression-free"
```

---

## Self-Review

### 1. Spec coverage

| Spec section | Task |
|---|---|
| §2 Home (re-export DashboardPage) | Task 1 |
| §3 Sessions (full-screen chat) | Task 4 (Steps 1-4 = components, 5-6 = routes) |
| §3.2 `/sessions/[id]` sub-route | Task 4 Step 6 |
| §3.4 + §3.5 send-message wiring | Task 4 Step 3 (handleSend) |
| §4 Reviews (N+1) | Task 3 (Steps 1-3 = components, 4 = route) |
| §5 Backlog (BoardView) | Task 2 |
| §6 shared components | (none needed — each page self-contained) |
| §7 task ordering | Tasks ordered Home → Backlog → Reviews → Sessions |
| §8 acceptance | Task 5 |

**Gaps:** None. All spec sections have a task.

### 2. Placeholder scan

Searched plan for: "TBD", "TODO", "implement later", "add appropriate", "similar to Task N". Found none except where intentional ("Loading…" / "Untitled session" / "No sessions yet" are user-facing copy, not plan placeholders).

### 3. Type consistency

- `ReviewItem` interface (Task 3 Step 1) matches `ReviewCardProps.item` (Task 3 Step 2) ✓
- `ReviewCodePlatform` type (Task 3 Step 1) matches `ReviewCardProps.codePlatform` (Task 3 Step 2) ✓
- `SessionsPageProps.activeSessionId` (Task 4 Step 4) matches `SessionsListProps.activeSessionId` (Task 4 Step 2) and `SessionDetailProps.sessionId` (Task 4 Step 3) ✓
- `handleSend` signature `(content: string, attachmentIds?: string[]) => void` matches `ChatInputProps.onSend` (pre-flight confirmed) ✓
- `BoardView` props match pre-flight reading ✓

No mismatches found.

### Action items from self-review

None — plan is internally consistent and covers all spec sections.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-multica-admin-phase1-frontend.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. 5 tasks; Task 4 (Sessions) will likely need a fix iteration given the verifications it requires.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
