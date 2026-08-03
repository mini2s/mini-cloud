"use client";

import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import { PlaceholderPage } from "../common/placeholder-page";
import { useT } from "../i18n";

/**
 * Label keys for the upcoming product surface. Must stay in sync with the
 * `nav` object in `packages/views/locales/{en,zh-Hans}/layout.json`.
 */
export type PlaceholderNavKey =
  | "home"
  | "sessions"
  | "reviews"
  | "dispatch"
  | "wiki"
  | "memory"
  | "metrics_efficiency"
  | "metrics_quality"
  | "metrics_cost"
  | "metrics_coverage"
  | "metrics_contribution"
  | "permissions"
  | "devices"
  | "connectors"
  | "channels"
  | "quotas"
  | "me_profile"
  | "me_quota"
  | "me_notifications"
  | "me_devices";

/**
 * Placeholder page wired to a sidebar nav label. Until a page gets its real
 * implementation, routes render this. Swap the route's import for a real
 * domain component (under `packages/views/<domain>/`) when it lands.
 */
export function NavPlaceholderPage({
  navKey,
  icon,
}: {
  navKey: PlaceholderNavKey;
  icon: ComponentType<LucideProps>;
}) {
  const { t } = useT("layout");
  return <PlaceholderPage title={t(($) => $.nav[navKey])} icon={icon} />;
}
