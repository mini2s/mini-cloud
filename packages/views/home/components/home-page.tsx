"use client";

import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import {
  ListTodo,
  CircleUser,
  FolderKanban,
  // Inbox, // Hidden per product decision — inbox menu removed.
  GitBranch,
  BookOpenText,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@multica/ui/components/ui/card";
import { Badge } from "@multica/ui/components/ui/badge";
import { cn } from "@multica/ui/lib/utils";
import { useWorkspacePaths } from "@multica/core/paths";
import { AppLink } from "../../navigation";
import { PageHeader } from "../../layout/page-header";
import { useT } from "../../i18n";

// ---------------------------------------------------------------------------
// MOCK DATA — replace with TanStack Query hooks when wiring this page up.
// Kept inline + clearly labeled so the real implementation is a drop-in.
// ---------------------------------------------------------------------------

type MockStatus = "todo" | "in_progress" | "review" | "done";

interface MockItem {
  id: string;
  title: string;
  status: MockStatus;
}

const STATUS_DOT: Record<MockStatus, string> = {
  todo: "bg-muted-foreground/40",
  in_progress: "bg-sky-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
};

const STATS: { labelKey: "completion_rate" | "active_tasks" | "done_this_week" | "avg_cycle_time"; value: string; delta: string; trend: "up" | "down" }[] = [
  { labelKey: "completion_rate", value: "87%", delta: "+5%", trend: "up" },
  { labelKey: "active_tasks", value: "24", delta: "+3", trend: "up" },
  { labelKey: "done_this_week", value: "18", delta: "+12%", trend: "up" },
  { labelKey: "avg_cycle_time", value: "2.3d", delta: "-0.4d", trend: "up" },
];

const MY_WORK: MockItem[] = [
  { id: "MUL-204", title: "Refactor issue filter pipeline", status: "in_progress" },
  { id: "MUL-198", title: "Draft: workspace switch animation", status: "todo" },
  { id: "MUL-191", title: "Fix sidebar collapse on mobile", status: "review" },
];

const WATCHING: MockItem[] = [
  { id: "MUL-176", title: "Agent runtime auto-reconnect", status: "in_progress" },
  { id: "MUL-170", title: "Project Gantt performance", status: "review" },
  { id: "MUL-155", title: "Webhook delivery retries", status: "done" },
];

const ASSIGNED: MockItem[] = [
  { id: "MUL-210", title: "Review PR #95 design specs", status: "review" },
  { id: "MUL-207", title: "Implement metrics placeholders", status: "in_progress" },
  { id: "MUL-201", title: "Triage inbox backlog", status: "todo" },
  { id: "MUL-199", title: "Update i18n parity test", status: "done" },
];

const QUICK_NAV: { labelKey: "issues" | "my_issues" | "projects" | "inbox" | "workflows" | "skills"; icon: LucideIcon; href: (p: ReturnType<typeof useWorkspacePaths>) => string }[] = [
  { labelKey: "issues", icon: ListTodo, href: (p) => p.issues() },
  { labelKey: "my_issues", icon: CircleUser, href: (p) => p.myIssues() },
  { labelKey: "projects", icon: FolderKanban, href: (p) => p.projects() },
  // { labelKey: "inbox", icon: Inbox, href: (p) => p.inbox() }, // Hidden per product decision — inbox menu removed.
  { labelKey: "workflows", icon: GitBranch, href: (p) => p.workflows() },
  { labelKey: "skills", icon: BookOpenText, href: (p) => p.skills() },
];

// ---------------------------------------------------------------------------

function StatCard({ value, delta, trend, label }: { value: string; delta: string; trend: "up" | "down"; label: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          <span className={cn("text-xs font-medium", trend === "up" ? "text-emerald-600" : "text-destructive")}>
            {delta}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ItemList({ items, emptyLabel }: { items: MockItem[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="px-4 pb-4 text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <CardContent className="gap-0">
      <ul className="divide-y divide-border/60">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 py-2">
            <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[item.status])} />
            <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.id}</span>
          </li>
        ))}
      </ul>
    </CardContent>
  );
}

export function HomePage() {
  const { t } = useT("home");
  const p = useWorkspacePaths();

  return (
    <>
      <PageHeader>
        <h1 className="text-sm font-semibold">{t(($) => $.title)}</h1>
        <Badge variant="secondary" className="ml-auto text-[10px] text-muted-foreground">
          {t(($) => $.mock_badge)}
        </Badge>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-8 p-6">
          {/* Performance stats */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">{t(($) => $.stats.section)}</h2>
              <span className="text-xs text-muted-foreground">{t(($) => $.stats.period)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {STATS.map((s) => (
                <StatCard
                  key={s.labelKey}
                  label={t(($) => $.stats[s.labelKey])}
                  value={s.value}
                  delta={s.delta}
                  trend={s.trend}
                />
              ))}
            </div>
          </section>

          {/* Quick navigation */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">{t(($) => $.quick_nav.section)}</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {QUICK_NAV.map((item) => {
                const Icon: ComponentType<LucideProps> = item.icon;
                return (
                  <AppLink key={item.labelKey} href={item.href(p)} className="block">
                    <Card size="sm" className="transition-colors hover:bg-accent/50">
                      <CardContent className="flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" />
                        <span className="text-sm">{t(($) => $.quick_nav[item.labelKey])}</span>
                      </CardContent>
                    </Card>
                  </AppLink>
                );
              })}
            </div>
          </section>

          {/* Work lists */}
          <section className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-sm">{t(($) => $.lists.section_my_work)}</CardTitle>
                <CardAction>
                  <AppLink href={p.myIssues()} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <span>{t(($) => $.lists.view_all)}</span>
                    <ArrowRight className="size-3" />
                  </AppLink>
                </CardAction>
              </CardHeader>
              <ItemList items={MY_WORK} emptyLabel={t(($) => $.lists.empty)} />
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-sm">{t(($) => $.lists.section_watching)}</CardTitle>
                <CardAction>
                  <AppLink href={p.issues()} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <span>{t(($) => $.lists.view_all)}</span>
                    <ArrowRight className="size-3" />
                  </AppLink>
                </CardAction>
              </CardHeader>
              <ItemList items={WATCHING} emptyLabel={t(($) => $.lists.empty)} />
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-sm">{t(($) => $.lists.section_assigned)}</CardTitle>
                <CardAction>
                  <AppLink href={p.myIssues()} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <span>{t(($) => $.lists.view_all)}</span>
                    <ArrowRight className="size-3" />
                  </AppLink>
                </CardAction>
              </CardHeader>
              <ItemList items={ASSIGNED} emptyLabel={t(($) => $.lists.empty)} />
            </Card>
          </section>
        </div>
      </div>
    </>
  );
}
