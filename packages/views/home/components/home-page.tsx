"use client";

import { PageHeader } from "../../layout/page-header";
import { useT } from "../../i18n";
import { StatusBar } from "./status-bar";
import { ActionRequiredSection } from "./action-required-section";
import { AgentActivitySection } from "./agent-activity-section";
import { StatsSection } from "./stats-section";
import { QuickNavSection } from "./quick-nav-section";
import { ActiveWorkflowsSection } from "./active-workflows-section";

/**
 * Workspace home — the default landing surface for `/{workspaceSlug}`.
 *
 * Information hierarchy, top to bottom:
 *   1. StatusBar              — one-line posture summary, highlights blocked
 *   2. ActionRequiredSection  — unread inbox + my unfinished issues
 *   3. AgentActivitySection   — fleet presence, running tasks, 7d trend
 *   4. StatsSection           — completion / active / weekly done / failure
 *   5. QuickNavSection        — jump-off grid
 *   6. ActiveWorkflowsSection — running workflows (hidden when none)
 *
 * All data comes from the shared TanStack Query caches in @multica/core —
 * each section subscribes to the hooks it needs; TanStack dedupes by key
 * so overlapping subscriptions cost nothing.
 */
export function HomePage() {
  const { t } = useT("home");

  return (
    <>
      <PageHeader>
        <h1 className="text-sm font-semibold">{t(($) => $.title)}</h1>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
          <StatusBar />
          <ActionRequiredSection />
          <AgentActivitySection />
          <StatsSection />
          <QuickNavSection />
          <ActiveWorkflowsSection />
        </div>
      </div>
    </>
  );
}
