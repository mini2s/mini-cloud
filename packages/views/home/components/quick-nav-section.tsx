"use client";

import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import {
  ListTodo,
  CircleUser,
  FolderKanban,
  Bot,
  GitBranch,
  BookOpenText,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@multica/ui/components/ui/card";
import { useWorkspacePaths, type WorkspacePaths } from "@multica/core/paths";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";

type NavKey = "issues" | "my_issues" | "projects" | "agents" | "workflows" | "skills";

// Inbox stays out of this grid per the standing product decision that
// removed the inbox sidebar entry; unread notifications are surfaced in
// the Action Required section above instead.
const QUICK_NAV: {
  labelKey: NavKey;
  icon: LucideIcon;
  href: (p: WorkspacePaths) => string;
}[] = [
  { labelKey: "issues", icon: ListTodo, href: (p) => p.issues() },
  { labelKey: "my_issues", icon: CircleUser, href: (p) => p.myIssues() },
  { labelKey: "projects", icon: FolderKanban, href: (p) => p.projects() },
  { labelKey: "agents", icon: Bot, href: (p) => p.agents() },
  { labelKey: "workflows", icon: GitBranch, href: (p) => p.workflows() },
  { labelKey: "skills", icon: BookOpenText, href: (p) => p.skills() },
];

export function QuickNavSection() {
  const { t } = useT("home");
  const paths = useWorkspacePaths();

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{t(($) => $.quick_nav.section)}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {QUICK_NAV.map((item) => {
          const Icon: ComponentType<LucideProps> = item.icon;
          return (
            <AppLink key={item.labelKey} href={item.href(paths)} className="block">
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
  );
}
