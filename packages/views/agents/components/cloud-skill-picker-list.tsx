"use client";

import { useEffect, useState } from "react";
import { Cloud, Search, Loader2 } from "lucide-react";
import type { CatalogSkill } from "@multica/core/types";
import { Input } from "@multica/ui/components/ui/input";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";

/**
 * Debounce a search box into a trimmed, debounced value for a server-backed
 * query. Mirrors `useDebouncedPluginSearch` in plugin-picker-list.tsx so the
 * cloud catalog search behaves the same as builtin plugin search.
 */
export function useDebouncedCatalogSkillSearch(delay = 300) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, delay);

    return () => clearTimeout(timer);
  }, [delay, searchQuery]);

  return { searchQuery, setSearchQuery, debouncedSearch };
}

interface CloudSkillPickerListProps {
  /** Catalog skills to show. Callers fetch these from the server (catalog
   *  search) and exclude already-bound IDs BEFORE passing them in — this
   *  component deliberately does NOT locally filter server results by the
   *  search query, because the catalog may be large and search is
   *  server-side. */
  skills: readonly CatalogSkill[];

  /** Currently-active rows (highlighted + aria-pressed). For the immediate-add
   *  popover this is empty; the prop is kept so the list stays a generic
   *  multi-select surface. */
  selectedIds: ReadonlySet<string>;

  /** Fires on every row click. Caller persists (e.g. adds the skill). */
  onToggle: (skill: CatalogSkill) => void;

  /** Loading state for the catalog query. */
  loading?: boolean;

  /** Controlled search input value. */
  searchQuery: string;
  onSearchChange: (query: string) => void;

  /** Caller-supplied empty / no-match copy. */
  emptyMessage?: string;
  noMatchMessage?: string;

  /** Outer-wrapper className. */
  className?: string;
}

/**
 * Server-backed list of public catalog skills, styled to match
 * `PluginPickerList` so the skill and plugin pickers feel identical. Every row
 * received is treated as authoritative search output — the caller runs the
 * debounced server query and passes results in (only excluding already-bound
 * IDs). Rows are plain clickable buttons (icon + name + description); there is
 * no draft/checkbox state because selection persists immediately.
 */
export function CloudSkillPickerList({
  skills,
  selectedIds,
  onToggle,
  loading = false,
  searchQuery,
  onSearchChange,
  emptyMessage,
  noMatchMessage,
  className,
}: CloudSkillPickerListProps) {
  const { t } = useT("agents");

  const resolvedEmpty =
    emptyMessage ?? t(($) => $.tab_body.plugin.cloud_skills.picker_empty);
  const resolvedNoMatch =
    noMatchMessage ?? t(($) => $.tab_body.plugin.cloud_skills.picker_no_match);

  return (
    <div className={cn("w-full", className)}>
      {/* Search */}
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t(($) => $.tab_body.plugin.cloud_skills.search_placeholder)}
            aria-label={t(($) => $.tab_body.plugin.cloud_skills.search_placeholder)}
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      {/* List */}
      <div className="max-h-72 overflow-y-auto p-1">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t(($) => $.tab_body.plugin.cloud_skills.picker_loading)}
          </div>
        ) : skills.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {searchQuery.trim() ? resolvedNoMatch : resolvedEmpty}
          </div>
        ) : (
          skills.map((skill) => {
            const isSelected = selectedIds.has(skill.id);
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => onToggle(skill)}
                aria-pressed={isSelected}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50",
                  isSelected && "bg-accent",
                )}
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
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
