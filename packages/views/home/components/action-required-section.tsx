"use client";

import { memo, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@multica/ui/components/ui/card";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { cn } from "@multica/ui/lib/utils";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths, type WorkspacePaths } from "@multica/core/paths";
import {
  deduplicateInboxItems,
  inboxListOptions,
} from "@multica/core/inbox/queries";
import { myIssueListOptions } from "@multica/core/issues/queries";
import { STATUS_CONFIG } from "@multica/core/issues/config";
import type { InboxItem, InboxSeverity, Issue, IssueStatus } from "@multica/core/types";
import { AppLink } from "../../navigation";
import { getInboxDisplayTitle } from "../../inbox/components/inbox-display";
import { useT } from "../../i18n";

const INBOX_PREVIEW_COUNT = 5;
const MY_TASKS_PREVIEW_COUNT = 6;

const SEVERITY_DOT: Record<InboxSeverity, string> = {
  action_required: "bg-destructive",
  attention: "bg-warning",
  info: "bg-muted-foreground/40",
};

const SEVERITY_RANK: Record<InboxSeverity, number> = {
  action_required: 0,
  attention: 1,
  info: 2,
};

// Surface order for "my tasks": fires first, then active work, then the
// backlog-ish tail. Done / cancelled rows are filtered out entirely.
const STATUS_RANK: Partial<Record<IssueStatus, number>> = {
  blocked: 0,
  in_progress: 1,
  in_review: 2,
  todo: 3,
  backlog: 4,
};

function ViewAllLink({ href, label }: { href: string; label: string }) {
  return (
    <AppLink
      href={href}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <span>{label}</span>
      <ArrowRight className="size-3" />
    </AppLink>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <CardContent className="gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </CardContent>
  );
}

const InboxRow = memo(function InboxRow({
  item,
  paths,
}: {
  item: InboxItem;
  paths: WorkspacePaths;
}) {
  const href = item.issue_id ? paths.issueDetail(item.issue_id) : paths.inbox();
  return (
    <li>
      <AppLink
        href={href}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60"
      >
        <span
          className={cn("size-2 shrink-0 rounded-full", SEVERITY_DOT[item.severity])}
        />
        <span className="min-w-0 flex-1 truncate text-sm">
          {getInboxDisplayTitle(item)}
        </span>
        {!item.read && <span className="size-1.5 shrink-0 rounded-full bg-brand" />}
      </AppLink>
    </li>
  );
});

const IssueRow = memo(function IssueRow({
  issue,
  paths,
  statusLabel,
}: {
  issue: Issue;
  paths: WorkspacePaths;
  statusLabel: string;
}) {
  const blocked = issue.status === "blocked";
  return (
    <li>
      <AppLink
        href={paths.issueDetail(issue.id)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60"
      >
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            STATUS_CONFIG[issue.status].dividerColor,
          )}
        />
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {issue.identifier}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
        <span
          className={cn(
            "shrink-0 text-[11px]",
            blocked ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {statusLabel}
        </span>
      </AppLink>
    </li>
  );
});

function InboxPreviewCard() {
  const { t } = useT("home");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { data: rawItems, isLoading } = useQuery(inboxListOptions(wsId));

  const items = useMemo(() => {
    if (!rawItems) return [];
    return deduplicateInboxItems(rawItems)
      .filter((item) => !item.read)
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, INBOX_PREVIEW_COUNT);
  }, [rawItems]);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">
          {t(($) => $.action_required.inbox_title)}
        </CardTitle>
        <CardAction>
          <ViewAllLink href={paths.inbox()} label={t(($) => $.action_required.view_all)} />
        </CardAction>
      </CardHeader>
      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : items.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          {t(($) => $.action_required.inbox_empty)}
        </p>
      ) : (
        <CardContent className="gap-0">
          <ul className="divide-y divide-border/60">
            {items.map((item) => (
              <InboxRow key={item.id} item={item} paths={paths} />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function MyTasksCard() {
  const { t } = useT("home");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const user = useAuthStore((s) => s.user);

  // Same source as the My Issues page "assigned" scope — the flat list
  // variant (not the assignee-grouped one) since the home preview doesn't
  // need grouping, just the first N rows by urgency.
  const { data: issues, isLoading } = useQuery({
    ...myIssueListOptions(wsId, "assigned", { assignee_id: user?.id ?? "" }),
    enabled: !!user,
  });

  const tasks = useMemo(() => {
    return (issues ?? [])
      .filter((issue) => issue.status !== "done" && issue.status !== "cancelled")
      .sort(
        (a, b) =>
          (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99) ||
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )
      .slice(0, MY_TASKS_PREVIEW_COUNT);
  }, [issues]);

  const statusLabels: Partial<Record<IssueStatus, string>> = {
    backlog: t(($) => $.status.backlog),
    todo: t(($) => $.status.todo),
    in_progress: t(($) => $.status.in_progress),
    in_review: t(($) => $.status.in_review),
    blocked: t(($) => $.status.blocked),
  };

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">
          {t(($) => $.action_required.my_tasks_title)}
        </CardTitle>
        <CardAction>
          <ViewAllLink href={paths.myIssues()} label={t(($) => $.action_required.view_all)} />
        </CardAction>
      </CardHeader>
      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : tasks.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          {t(($) => $.action_required.my_tasks_empty)}
        </p>
      ) : (
        <CardContent className="gap-0">
          <ul className="divide-y divide-border/60">
            {tasks.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                paths={paths}
                statusLabel={statusLabels[issue.status] ?? ""}
              />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * "Action required" — the two lists a user owes a response to: unread
 * inbox notifications (severity-ordered) and their own unfinished issues
 * (blocked first). Everything else on the page is informational; this
 * section is the to-do list.
 */
export function ActionRequiredSection() {
  const { t } = useT("home");
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{t(($) => $.action_required.section)}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <InboxPreviewCard />
        <MyTasksCard />
      </div>
    </section>
  );
}
