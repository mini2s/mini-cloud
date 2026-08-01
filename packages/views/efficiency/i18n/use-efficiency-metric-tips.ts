"use client";

import { useT } from "../../i18n";

export function useEfficiencyMetricTips() {
  const { t } = useT("efficiency");

  return {
    verifyUnavailable: t(($) => $.common.metric_tips.verify_unavailable),
    stageEstimate: t(($) => $.common.metric_tips.stage_estimate),
    actualEffort: t(($) => $.common.metric_tips.actual_effort),
    baselineEffort: t(($) => $.common.metric_tips.baseline_effort),
    actualDeliveryTime: t(
      ($) => $.common.metric_tips.actual_delivery_time,
    ),
    baselineDeliveryTime: t(
      ($) => $.common.metric_tips.baseline_delivery_time,
    ),
    effortEfficiency: t(($) => $.common.metric_tips.effort_efficiency),
    calendarEfficiency: t(
      ($) => $.common.metric_tips.calendar_efficiency,
    ),
  };
}
