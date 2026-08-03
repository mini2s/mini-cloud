"use client";

import { useEffect, useState } from "react";
import { Puzzle, Search, Check, Loader2 } from "lucide-react";
import type { BuiltinPlugin } from "@multica/core/api/schemas";
import { Input } from "@multica/ui/components/ui/input";
import { useT } from "../../i18n";

interface PluginPickerListProps {
  plugins: BuiltinPlugin[];
  catalogPlugins?: BuiltinPlugin[];
  selectedId: string | null;
  /** Called with the plugin id + its install slug (e.g.
   * "cospowers-integration-verification"). The slug is carried alongside so the
   * backend can install by name without a catalog lookup. */
  onSelect: (id: string, slug: string) => void;
  loading?: boolean;
  catalogLoading?: boolean;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export function useDebouncedPluginSearch(delay = 300) {
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

/**
 * Searchable plugin list. Callers may provide a second cloud catalog group;
 * when present, builtin plugins stay pinned above a divider and cloud results
 * render below it.
 */
export function PluginPickerList({
  plugins,
  catalogPlugins,
  selectedId,
  onSelect,
  loading = false,
  catalogLoading = false,
  searchQuery,
  onSearchChange,
}: PluginPickerListProps) {
  const { t } = useT("agents");
  const [localQuery, setLocalQuery] = useState("");
  const query = searchQuery ?? localQuery;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const usesServerSearch = searchQuery !== undefined && !!onSearchChange;
  const filteredBuiltinPlugins = normalizedQuery && !usesServerSearch
    ? plugins.filter((plugin) =>
        [plugin.name, plugin.description, plugin.slug, plugin.category].some(
          (value) => value.toLocaleLowerCase().includes(normalizedQuery),
        ),
      )
    : plugins;
  const hasCatalog = catalogPlugins !== undefined;

  const handleSearchChange = (value: string) => {
    if (onSearchChange) {
      onSearchChange(value);
    } else {
      setLocalQuery(value);
    }
  };



  return (
    <div>
      {/* Search */}
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            type="text"
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t(($) => $.tab_body.plugin.picker.search_placeholder)}
            aria-label={t(($) => $.tab_body.plugin.picker.search_placeholder)}
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      {/* List */}
      <div className="max-h-72 overflow-y-auto p-1">
        {!hasCatalog && loading ? (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t(($) => $.tab_body.plugin.picker.loading)}
          </div>
        ) : !hasCatalog && filteredBuiltinPlugins.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {query.trim()
              ? t(($) => $.tab_body.plugin.picker.no_match)
              : t(($) => $.tab_body.plugin.picker.empty)}
          </div>
        ) : (
          <>
            {hasCatalog ? (
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(($) => $.tab_body.plugin.picker.builtin_section)}
                </div>
                {loading ? (
                  <PluginLoading />
                ) : filteredBuiltinPlugins.length > 0 ? (
                  <PluginGroup
                    plugins={filteredBuiltinPlugins}
                    selectedId={selectedId}
                    onSelect={onSelect}
                  />
                ) : (
                  <PluginEmpty hasQuery={query.trim().length > 0} />
                )}
              </div>
            ) : (
              <PluginGroup
                plugins={filteredBuiltinPlugins}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            )}

            {hasCatalog && (
              <div className="mt-1 border-t border-border pt-1">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(($) => $.tab_body.plugin.picker.cloud_section)}
                </div>
                {catalogLoading ? (
                  <PluginLoading />
                ) : catalogPlugins.length > 0 ? (
                  <PluginGroup
                    plugins={catalogPlugins}
                    selectedId={selectedId}
                    onSelect={onSelect}
                  />
                ) : (
                  <PluginEmpty hasQuery={query.trim().length > 0} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PluginLoading() {
  const { t } = useT("agents");
  return (
    <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {t(($) => $.tab_body.plugin.picker.loading)}
    </div>
  );
}

function PluginEmpty({ hasQuery }: { hasQuery: boolean }) {
  const { t } = useT("agents");
  return (
    <div className="px-3 py-4 text-center text-sm text-muted-foreground">
      {hasQuery
        ? t(($) => $.tab_body.plugin.picker.no_match)
        : t(($) => $.tab_body.plugin.picker.empty)}
    </div>
  );
}

function PluginGroup({
  plugins,
  selectedId,
  onSelect,
}: {
  plugins: readonly BuiltinPlugin[];
  selectedId: string | null;
  onSelect: (id: string, slug: string) => void;
}) {
  return (
    <div>
      {plugins.map((plugin) => {
        const isSelected = plugin.id === selectedId;
        return (
          <button
            key={plugin.id}
            type="button"
            onClick={() => onSelect(plugin.id, plugin.slug)}
            aria-pressed={isSelected}
            className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 ${
              isSelected ? "bg-accent" : ""
            }`}
          >
            <Puzzle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{plugin.name}</div>
              {plugin.description && (
                <div className="truncate text-xs text-muted-foreground">
                  {plugin.description}
                </div>
              )}
            </div>
            {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
