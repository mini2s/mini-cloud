"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@multica/ui/components/ui/tabs";
import {
  PricingPage,
  DatasourcesPage,
  SyncTasksPage,
  SystemConfigPage,
  PlatformOverviewPage,
  PlatformHealthPage,
  RealtimeReportPage,
  RealtimeQueryPage,
} from "./index";

// Efficiency settings/ops shell. The source SettingsLayout.tsx grouped eight
// efficiency sub-pages under a 设置 shell with two tab groups:
//   设置组  — pricing / datasources / sync / config
//   平台运维组 — platform overview / health / realtime report / realtime query
//
// Each sub-page already ships its own PageHeader (sidebar trigger + page title
// + any page-level action buttons, e.g. "Add pricing") and a flex h-full
// flex-col body that scrolls internally. To avoid a double header — and to keep
// every sub-page's header actions intact — this shell renders ONLY the tab
// switcher as a slim section bar and hands the full height below it to the
// active sub-page. The "指标运维" identity surfaces via the sidebar entry.
//
// Per the no-URL-state decision, tab state is local useState: this is a single
// Next.js route, so useState is fine and consistent with the codebase.
//
// The eight original routes (/settings/{pricing,datasources,sync,config} and
// /settings/platform/{overview,health,realtime,realtime/query}) stay reachable
// directly for deep-link compatibility; this shell is the organized sidebar
// entry point that surfaces them all from one place.

type SettingsTabKey =
  | "pricing"
  | "datasources"
  | "sync"
  | "config";

type PlatformTabKey =
  | "overview"
  | "health"
  | "realtime"
  | "realtimeQuery";

type ActiveTab = SettingsTabKey | PlatformTabKey;

const SETTINGS_TABS: { key: SettingsTabKey; label: string }[] = [
  { key: "pricing", label: "模型价格" },
  { key: "datasources", label: "数据源" },
  { key: "sync", label: "同步任务" },
  { key: "config", label: "系统配置" },
];

const PLATFORM_TABS: { key: PlatformTabKey; label: string }[] = [
  { key: "overview", label: "平台总览" },
  { key: "health", label: "AI 服务健康度" },
  { key: "realtime", label: "实时态势" },
  { key: "realtimeQuery", label: "明细查询" },
];

export function EfficiencySettingsShell() {
  const [active, setActive] = useState<ActiveTab>("pricing");

  return (
    <div className="flex h-full flex-col">
      {/* Section bar: two labelled tab groups, mirrors source SettingsLayout
          (设置组 + 平台运维组 separated by a group heading). */}
      <div className="shrink-0 border-b px-4 py-2">
        <Tabs
          value={active}
          onValueChange={(v) => setActive(v as ActiveTab)}
          className="gap-0"
        >
          <TabsList variant="line" className="h-auto flex-wrap gap-1 bg-transparent">
            <span className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">
              设置
            </span>
            {SETTINGS_TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label}
              </TabsTrigger>
            ))}

            <span className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">
              平台运维
            </span>
            {PLATFORM_TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Active sub-page. Each page owns its own PageHeader + scroll body, so
          mounting the component directly is the correct reuse (no props).
          Render only the active one so each sub-page's React Query / dialog
          state stays scoped to its tab. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {active === "pricing" && <PricingPage />}
        {active === "datasources" && <DatasourcesPage />}
        {active === "sync" && <SyncTasksPage />}
        {active === "config" && <SystemConfigPage />}
        {active === "overview" && <PlatformOverviewPage />}
        {active === "health" && <PlatformHealthPage />}
        {active === "realtime" && <RealtimeReportPage />}
        {active === "realtimeQuery" && <RealtimeQueryPage />}
      </div>
    </div>
  );
}
