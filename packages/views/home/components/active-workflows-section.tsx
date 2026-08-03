"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, GitBranch } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@multica/ui/components/ui/card";
import { Badge } from "@multica/ui/components/ui/badge";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { workflowActiveListOptions } from "@multica/core/workflows/queries";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";

const PREVIEW_COUNT = 5;

/**
 * Active (non-template) workflows in the workspace. Hidden entirely when
 * none exist — an empty "no workflows" card would be noise for workspaces
 * that haven't adopted the feature yet.
 */
export function ActiveWorkflowsSection() {
  const { t } = useT("home");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { data: workflows, isLoading } = useQuery(workflowActiveListOptions(wsId));

  if (isLoading) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t(($) => $.workflows.section)}</h2>
        <Skeleton className="h-24 w-full rounded-xl" />
      </section>
    );
  }

  if (!workflows || workflows.length === 0) return null;

  const visible = workflows.slice(0, PREVIEW_COUNT);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{t(($) => $.workflows.section)}</h2>
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-sm">
            {t(($) => $.workflows.active_count, { count: workflows.length })}
          </CardTitle>
          <CardAction>
            <AppLink
              href={paths.workflows()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <span>{t(($) => $.action_required.view_all)}</span>
              <ArrowRight className="size-3" />
            </AppLink>
          </CardAction>
        </CardHeader>
        <CardContent className="gap-0">
          <ul className="divide-y divide-border/60">
            {visible.map((workflow) => (
              <li key={workflow.id}>
                <AppLink
                  href={paths.workflowDetail(workflow.id)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60"
                >
                  <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {workflow.title}
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {t(($) => $.workflows.nodes, { count: workflow.node_count })}
                  </Badge>
                </AppLink>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
