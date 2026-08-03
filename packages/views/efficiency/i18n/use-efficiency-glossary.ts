"use client";

import { useCallback } from "react";
import { useT } from "../../i18n";

export type EfficiencyGlossaryKey =
  | "efficiency_ratio"
  | "work_caliber"
  | "saved_person_days"
  | "roi"
  | "ai_code_ratio"
  | "cost"
  | "active_users"
  | "commit_diff_lines"
  | "coverage_eligible"
  | "wow"
  | "merged_need"
  | "silica"
  | "dept_efficiency";

interface EfficiencyGlossaryEntry {
  term: string;
  description: string;
  formula: string;
  scope: string;
}

export function useEfficiencyGlossary() {
  const { t } = useT("efficiency");

  const entry = useCallback(
    (key: EfficiencyGlossaryKey): EfficiencyGlossaryEntry => {
      switch (key) {
        case "efficiency_ratio":
          return {
            term: t(($) => $.glossary.efficiency_ratio.term),
            description: t(($) => $.glossary.efficiency_ratio.description),
            formula: t(($) => $.glossary.efficiency_ratio.formula),
            scope: t(($) => $.glossary.efficiency_ratio.scope),
          };
        case "work_caliber":
          return {
            term: t(($) => $.glossary.work_caliber.term),
            description: t(($) => $.glossary.work_caliber.description),
            formula: t(($) => $.glossary.work_caliber.formula),
            scope: t(($) => $.glossary.work_caliber.scope),
          };
        case "saved_person_days":
          return {
            term: t(($) => $.glossary.saved_person_days.term),
            description: t(($) => $.glossary.saved_person_days.description),
            formula: t(($) => $.glossary.saved_person_days.formula),
            scope: t(($) => $.glossary.saved_person_days.scope),
          };
        case "roi":
          return {
            term: t(($) => $.glossary.roi.term),
            description: t(($) => $.glossary.roi.description),
            formula: t(($) => $.glossary.roi.formula),
            scope: t(($) => $.glossary.roi.scope),
          };
        case "ai_code_ratio":
          return {
            term: t(($) => $.glossary.ai_code_ratio.term),
            description: t(($) => $.glossary.ai_code_ratio.description),
            formula: t(($) => $.glossary.ai_code_ratio.formula),
            scope: t(($) => $.glossary.ai_code_ratio.scope),
          };
        case "cost":
          return {
            term: t(($) => $.glossary.cost.term),
            description: t(($) => $.glossary.cost.description),
            formula: t(($) => $.glossary.cost.formula),
            scope: t(($) => $.glossary.cost.scope),
          };
        case "active_users":
          return {
            term: t(($) => $.glossary.active_users.term),
            description: t(($) => $.glossary.active_users.description),
            formula: t(($) => $.glossary.active_users.formula),
            scope: t(($) => $.glossary.active_users.scope),
          };
        case "commit_diff_lines":
          return {
            term: t(($) => $.glossary.commit_diff_lines.term),
            description: t(($) => $.glossary.commit_diff_lines.description),
            formula: t(($) => $.glossary.commit_diff_lines.formula),
            scope: t(($) => $.glossary.commit_diff_lines.scope),
          };
        case "coverage_eligible":
          return {
            term: t(($) => $.glossary.coverage_eligible.term),
            description: t(($) => $.glossary.coverage_eligible.description),
            formula: t(($) => $.glossary.coverage_eligible.formula),
            scope: t(($) => $.glossary.coverage_eligible.scope),
          };
        case "wow":
          return {
            term: t(($) => $.glossary.wow.term),
            description: t(($) => $.glossary.wow.description),
            formula: t(($) => $.glossary.wow.formula),
            scope: t(($) => $.glossary.wow.scope),
          };
        case "merged_need":
          return {
            term: t(($) => $.glossary.merged_need.term),
            description: t(($) => $.glossary.merged_need.description),
            formula: t(($) => $.glossary.merged_need.formula),
            scope: t(($) => $.glossary.merged_need.scope),
          };
        case "silica":
          return {
            term: t(($) => $.glossary.silica.term),
            description: t(($) => $.glossary.silica.description),
            formula: t(($) => $.glossary.silica.formula),
            scope: t(($) => $.glossary.silica.scope),
          };
        case "dept_efficiency":
          return {
            term: t(($) => $.glossary.dept_efficiency.term),
            description: t(($) => $.glossary.dept_efficiency.description),
            formula: t(($) => $.glossary.dept_efficiency.formula),
            scope: t(($) => $.glossary.dept_efficiency.scope),
          };
      }
    },
    [t],
  );

  const glossaryTip = useCallback(
    (key: EfficiencyGlossaryKey): string => {
      const value = entry(key);
      const separator = t(($) => $.glossary.labels.separator);
      return [
        `${value.term}${separator}${value.description}`,
        `${t(($) => $.glossary.labels.formula)}${separator}${value.formula}`,
        `${t(($) => $.glossary.labels.scope)}${separator}${value.scope}`,
      ].join("\n");
    },
    [entry, t],
  );

  return { glossaryEntry: entry, glossaryTip };
}
