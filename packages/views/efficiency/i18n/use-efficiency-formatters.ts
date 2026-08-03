"use client";

import { useCallback } from "react";
import {
  formatCurrency as formatCoreCurrency,
  formatNumber as formatCoreNumber,
  getDurationParts,
  type Granularity,
} from "@multica/core/efficiency";
import { useT } from "../../i18n";

function normalizeLocale(language: string): "en" | "zh-Hans" {
  return language.startsWith("zh") ? "zh-Hans" : "en";
}

export function useEfficiencyFormatters() {
  const { t, i18n } = useT("efficiency");
  const locale = normalizeLocale(i18n.resolvedLanguage ?? i18n.language);

  const formatNumber = useCallback(
    (
      value: number | string | null | undefined,
      digits = 0,
    ): string => formatCoreNumber(value, digits, locale),
    [locale],
  );

  const formatCurrency = useCallback(
    (
      value: number | null | undefined,
      currency: string,
    ): string => formatCoreCurrency(value, currency, locale),
    [locale],
  );

  const formatDuration = useCallback(
    (minutes: number | null | undefined): string => {
      const parts = getDurationParts(minutes);
      switch (parts.kind) {
        case "empty":
          return "-";
        case "minutes":
          return t(($) => $.common.units.minute, {
            count: parts.minutes,
          });
        case "hours":
          return t(($) => $.common.units.hour, {
            count: parts.hours,
          });
        case "hours_minutes":
          return t(($) => $.common.units.hours_minutes, {
            hours: parts.hours,
            minutes: parts.minutes,
          });
        case "person_days":
          return t(($) => $.common.units.person_day, {
            count: parts.personDays,
            value: parts.personDays.toFixed(1),
          });
      }
    },
    [t],
  );

  const formatVerifyDuration = useCallback(
    (minutes: number | null | undefined): string =>
      Number(minutes ?? 0) === 0 ? "—" : formatDuration(minutes),
    [formatDuration],
  );

  const granularityLabel = useCallback(
    (granularity: Granularity): string => {
      switch (granularity) {
        case "day":
          return t(($) => $.common.granularity.day);
        case "week":
          return t(($) => $.common.granularity.week);
        case "month":
          return t(($) => $.common.granularity.month);
      }
    },
    [t],
  );

  const formatBucketLabel = useCallback(
    (key: string, granularity: Granularity): string => {
      const isoDate =
        granularity === "month" ? `${key}-01T00:00:00` : `${key}T00:00:00`;
      const date = new Date(isoDate);
      if (Number.isNaN(date.getTime())) return key;
      return new Intl.DateTimeFormat(
        locale,
        granularity === "month"
          ? { month: "short" }
          : { month: "2-digit", day: "2-digit" },
      ).format(date);
    },
    [locale],
  );

  return {
    locale,
    formatNumber,
    formatCurrency,
    formatDuration,
    formatVerifyDuration,
    granularityLabel,
    formatBucketLabel,
  };
}
