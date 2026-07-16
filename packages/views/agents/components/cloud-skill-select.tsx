"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Cloud, Plus, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { CatalogSkill } from "@multica/core/types";
import { catalogSkillListOptions } from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import { useT } from "../../i18n";
import {
  CloudSkillPickerList,
  useDebouncedCatalogSkillSearch,
} from "./cloud-skill-picker-list";

interface CloudSkillSelectProps {
  /** Catalog skills selected for the agent being created. */
  value: readonly CatalogSkill[];
  /** Replaces the draft selection whenever a row is toggled. */
  onChange: (skills: CatalogSkill[]) => void;
}

/**
 * Catalog skill multi-select for the create-agent form. Its collapsed and
 * expanded layout mirrors PluginSelect, while its search and row rendering
 * reuse the same server-backed picker as the Plugin tab.
 */
export function CloudSkillSelect({ value, onChange }: CloudSkillSelectProps) {
  const { t } = useT("agents");
  const [expanded, setExpanded] = useState(value.length > 0);
  const { searchQuery, setSearchQuery, debouncedSearch } =
    useDebouncedCatalogSkillSearch();
  const { data: catalog, isFetching } = useQuery(
    catalogSkillListOptions(debouncedSearch),
  );
  const selectedIds = useMemo(
    () => new Set(value.map((skill) => skill.id)),
    [value],
  );

  const toggle = (skill: CatalogSkill) => {
    if (selectedIds.has(skill.id)) {
      onChange(value.filter((selected) => selected.id !== skill.id));
      return;
    }
    onChange([...value, skill]);
  };

  const label = t(($) => $.tab_body.plugin.cloud_skills.section_title);

  if (!expanded) {
    return (
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1.5 flex w-full items-center gap-2.5 rounded-lg border bg-card px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
        >
          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {value.length > 0
              ? value.map((skill) => skill.name).join(", ")
              : t(($) => $.tab_body.plugin.cloud_skills.add_action)}
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(false)}
          className="h-6 gap-1 px-2 text-xs"
        >
          <X className="h-3 w-3" />
          {t(($) => $.create_dialog.plugin_section.collapse)}
        </Button>
      </div>

      <div className="mt-1.5 overflow-hidden rounded-lg border">
        <CloudSkillPickerList
          skills={catalog?.items ?? []}
          selectedIds={selectedIds}
          onToggle={toggle}
          loading={isFetching}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>

      {value.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {value.map((skill) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => toggle(skill)}
              aria-label={t(($) => $.tab_body.plugin.cloud_skills.remove_label, {
                name: skill.name,
              })}
              className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50"
            >
              <Cloud className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{skill.name}</div>
                {skill.description ? (
                  <div className="truncate text-xs text-muted-foreground">
                    {skill.description}
                  </div>
                ) : null}
              </div>
              <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
