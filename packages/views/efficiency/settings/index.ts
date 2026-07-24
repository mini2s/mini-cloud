// Barrel for the efficiency settings UI (4 standalone top-level pages).
// Consumed via `import { PricingPage } from "@multica/views/efficiency"`.
//
// Per the migration brief these are NOT detail drill-downs (no back button /
// no react-router) — each is a standalone page with its own PageHeader. CRUD
// is display + form UI only; mutations are NOT_WIRED in the mock phase so
// every form action surfaces NotWiredNotice instead of calling the backend.
// The read tables/cards are the deliverable.
export { PricingPage } from "./pricing-page";
export { DatasourcesPage } from "./datasources-page";
export { SyncTasksPage } from "./sync-tasks-page";
export { SystemConfigPage } from "./system-config-page";
