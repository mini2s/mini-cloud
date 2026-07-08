"use client";

import { useEffect, useState } from "react";
import { Puzzle, Search, Check, Loader2 } from "lucide-react";
import type { BuiltinPlugin } from "@multica/core/api/schemas";
import { Input } from "@multica/ui/components/ui/input";

interface PluginPickerListProps {
  plugins: BuiltinPlugin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
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
 * Searchable list of builtin plugins. Used by both PluginSelect (create
 * dialog) and PluginAttach (inspector). Displays each plugin as a row with
 * name (bold) + description (muted, one line, truncated). Click to select;
 * selected row gets a Check icon + accent background.
 */
export function PluginPickerList({
  plugins,
  selectedId,
  onSelect,
  loading = false,
  searchQuery,
  onSearchChange,
}: PluginPickerListProps) {
  const [localQuery, setLocalQuery] = useState("");
  const query = searchQuery ?? localQuery;

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
            placeholder="Search plugins..."
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      {/* List */}
      <div className="max-h-72 overflow-y-auto p-1">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading plugins...
          </div>
        ) : plugins.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {query.trim()
              ? "No plugins match your search"
              : "No plugins available"}
          </div>
        ) : (
          plugins.map((plugin) => {
            const isSelected = plugin.id === selectedId;
            return (
              <button
                key={plugin.id}
                type="button"
                onClick={() => onSelect(plugin.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 ${
                  isSelected ? "bg-accent" : ""
                }`}
              >
                <Puzzle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {plugin.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {plugin.description}
                  </div>
                </div>
                {isSelected && (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
