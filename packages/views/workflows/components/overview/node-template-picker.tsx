"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@multica/ui/components/ui/input";
import { ScrollArea } from "@multica/ui/components/ui/scroll-area";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../../i18n";
import {
  filterNodeTemplates,
  NODE_TEMPLATE_CATEGORIES,
  type NodeTemplate,
  type NodeTemplateCategory,
} from "./node-template-catalog";

export interface NodeTemplatePickerProps {
  onSelect: (template: NodeTemplate) => void;
  disabledTemplateIds?: Set<string>;
  excludeBoundary?: boolean;
}

function getCategoryLabel(
  category: NodeTemplateCategory,
  t: ReturnType<typeof useT<"workflows">>["t"],
): string {
  switch (category.id) {
    case "trigger":
      return t(($) => $.panorama.node_picker.trigger);
    case "action":
      return t(($) => $.panorama.node_picker.action);
    case "logic":
      return t(($) => $.panorama.node_picker.logic);
    case "ai":
      return t(($) => $.panorama.node_picker.ai);
    case "human":
      return t(($) => $.panorama.node_picker.human);
    case "annotation":
      return t(($) => $.panorama.node_picker.annotation);
  }
}

export function NodeTemplatePicker({
  onSelect,
  disabledTemplateIds = new Set<string>(),
  excludeBoundary = false,
}: NodeTemplatePickerProps) {
  const { t } = useT("workflows");
  const [query, setQuery] = useState("");
  const templates = useMemo(
    () => filterNodeTemplates(query).filter((template) => !excludeBoundary || !template.boundary_kind),
    [excludeBoundary, query],
  );

  return (
    <div
      className="grid h-[min(420px,calc(100vh-6rem))] max-h-[min(420px,calc(100vh-6rem))] w-full max-w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
      data-testid="node-template-picker"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(($) => $.panorama.node_picker.search_placeholder)}
          className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {templates.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t(($) => $.panorama.node_picker.empty)}
            </div>
          ) : (
            NODE_TEMPLATE_CATEGORIES.map((category) => {
              const items = templates.filter((template) => template.category === category.id);
              if (items.length === 0) return null;

              return (
                <section key={category.id} className="mb-2">
                  <div className="px-2.5 pb-1 pt-1.5">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {getCategoryLabel(category, t)}
                    </h3>
                  </div>
                  <div className="space-y-0.5">
                    {items.map((template) => {
                      const disabled = disabledTemplateIds.has(template.id);
                      return (
                        <button
                        key={template.id}
                        type="button"
                        onClick={() => onSelect(template)}
                        disabled={disabled}
                        title={disabled ? t(($) => $.panorama.node_picker.boundary_already_exists) : undefined}
                        className={cn(
                          "flex w-full min-w-0 flex-col rounded-md px-2.5 py-2 text-left transition-colors",
                          "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                        )}
                        aria-label={`${template.title}: ${template.description}`}
                      >
                        <span className="block truncate text-sm font-medium">{template.title}</span>
                        <span className="line-clamp-2 min-w-0 text-xs text-muted-foreground">
                          {template.description}
                        </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
