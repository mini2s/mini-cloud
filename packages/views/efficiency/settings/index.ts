// Barrel for the efficiency settings UI. Consumed via
// `import { PricingPage } from "@multica/views/efficiency"`.
//
// Two groups: the four CRUD settings pages (pricing / datasources / sync /
// config) and the three platform-ops pages (overview / health / realtime
// report) plus the detail-query page (realtime query). Per the migration brief
// these are NOT detail drill-downs (no back button / no react-router) — each
// is a standalone page with its own PageHeader. The platform-ops pages are
// read-only dashboards over the chat realtime/config datasources.
export { PricingPage } from "./pricing-page";
export { DatasourcesPage } from "./datasources-page";
export { SyncTasksPage } from "./sync-tasks-page";
export { SystemConfigPage } from "./system-config-page";
export { PlatformOverviewPage } from "./platform-overview-page";
export { PlatformHealthPage } from "./platform-health-page";
export { RealtimeReportPage } from "./realtime-report-page";
export { RealtimeQueryPage } from "./realtime-query-page";
export { EfficiencySettingsShell } from "./settings-shell";
