"use client";

import { useMemo, useState } from "react";
import { Puzzle, Info, X, Cloud, Plus, Loader2, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Agent, AgentCloudSkill, CatalogSkill } from "@multica/core/types";
import { api } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  agentCloudSkillOptions,
  builtinPluginListOptions,
  catalogSkillListOptions,
  pluginDetailOptions,
  workspaceKeys,
} from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import { useT } from "../../../i18n";
import { PluginPickerList, useDebouncedPluginSearch } from "../plugin-picker-list";
import {
  CloudSkillPickerList,
  useDebouncedCatalogSkillSearch,
} from "../cloud-skill-picker-list";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover";

export function PluginTab({
  agent,
}: {
  agent: Agent;
}) {
  const { t } = useT("agents");
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  const { data: plugins } = useQuery(builtinPluginListOptions());
  const items = plugins?.items ?? [];
  const listSelected = items.find((p) => p.id === agent.plugin_id) ?? null;
  const shouldHydrateSelected = !!agent.plugin_id && !listSelected;
  const { data: hydratedSelected, isFetching: isHydratingSelected } = useQuery({
    ...pluginDetailOptions(agent.plugin_id ?? ""),
    enabled: shouldHydrateSelected,
  });
  const selected = listSelected ?? (hydratedSelected?.id ? hydratedSelected : null);
  const stale = !selected && !!agent.plugin_id && !isHydratingSelected;

  const cloudSkillsQuery = useQuery(agentCloudSkillOptions(wsId, agent.id));
  const cloudSkills = cloudSkillsQuery.data ?? [];
  const cloudSkillsError = cloudSkillsQuery.isError;
  const [removingCloudSkillId, setRemovingCloudSkillId] = useState<string | null>(null);

  const handleChange = async (pluginId: string) => {
    try {
      await api.updateAgent(agent.id, {
        plugin_id: pluginId === agent.plugin_id ? "" : pluginId,
      });
      qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      toast.success(t(($) => $.detail.agent_updated_toast));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t(($) => $.detail.update_failed_toast),
      );
    }
  };

  const handleRemove = async () => {
    try {
      await api.updateAgent(agent.id, { plugin_id: "" });
      qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      toast.success(t(($) => $.detail.agent_updated_toast));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t(($) => $.detail.update_failed_toast),
      );
    }
  };

  const handleRemoveCloudSkill = async (skillId: string) => {
    // Full replacement list built from the CURRENT bindings so unrelated
    // cloud skills are never dropped on a single remove.
    const nextIds = cloudSkills.map((s) => s.id).filter((id) => id !== skillId);
    setRemovingCloudSkillId(skillId);
    try {
      await api.setAgentCloudSkills(agent.id, { skill_ids: nextIds });
      qc.invalidateQueries({ queryKey: agentCloudSkillOptions(wsId, agent.id).queryKey });
      toast.success(t(($) => $.tab_body.plugin.cloud_skills.updated_toast));
    } catch {
      toast.error(t(($) => $.tab_body.plugin.cloud_skills.update_failed_toast));
    } finally {
      setRemovingCloudSkillId(null);
    }
  };

  const refetchCloudSkills = () => {
    qc.invalidateQueries({ queryKey: agentCloudSkillOptions(wsId, agent.id).queryKey });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">
            {t(($) => $.tab_body.plugin.section_title)}
          </h3>
        </div>
        <PluginPickerPopover
          selectedId={agent.plugin_id}
          onSelect={handleChange}
          triggerLabel={t(($) => $.tab_body.plugin.change_action)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t(($) => $.tab_body.plugin.intro)}
      </p>

      {items.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-info/20 bg-info/5 px-3 py-2.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
          <p className="text-xs text-muted-foreground">
            {t(($) => $.tab_body.plugin.info_hint)}
          </p>
        </div>
      )}

      {stale ? (
        <div className="rounded-lg border border-warning/30 bg-warning/5">
          <div className="flex items-start gap-3 px-4 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/10">
              <Puzzle className="h-5 w-5 text-warning" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold text-warning">
                {t(($) => $.inspector.plugin_unavailable_chip, { id: agent.plugin_id!.slice(0, 8) + "..." })}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(($) => $.inspector.plugin_removed_hint)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleRemove}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : !selected ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Puzzle className="h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            {t(($) => $.tab_body.plugin.empty_title)}
          </p>
          <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
            {t(($) => $.tab_body.plugin.empty_hint)}
          </p>
          {items.length > 0 && (
            <PluginPickerPopover
              selectedId={agent.plugin_id}
              onSelect={handleChange}
              className="mt-3"
              triggerLabel={t(($) => $.tab_body.plugin.select_action)}
            />
          )}
        </div>
      ) : (
        <div className="rounded-lg border">
          <div className="flex items-start gap-3 px-4 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
              <Puzzle className="h-5 w-5 text-purple-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold">
                  {selected.name}
                </h3>
                {selected.version && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    v{selected.version}
                  </span>
                )}
              </div>
              {selected.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {selected.category}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/60">
                  {selected.slug}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <PluginPickerPopover
                selectedId={agent.plugin_id}
                onSelect={handleChange}
                triggerLabel={t(($) => $.tab_body.plugin.change_action)}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleRemove}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cloud skills — public catalog skills bound to this agent without
          importing them into the workspace. Kept on the Plugin tab because
          both are marketplace capability selection. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">
              {t(($) => $.tab_body.plugin.cloud_skills.section_title)}
            </h3>
          </div>
          <CloudSkillAddPopover
            agent={agent}
            currentSkills={cloudSkills}
            triggerLabel={t(($) => $.tab_body.plugin.cloud_skills.add_action)}
            disabled={cloudSkillsError}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t(($) => $.tab_body.plugin.cloud_skills.intro)}
        </p>

        {cloudSkillsQuery.isLoading ? (
          <div className="flex items-center gap-2 rounded-lg border px-4 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t(($) => $.tab_body.plugin.cloud_skills.picker_loading)}
          </div>
        ) : cloudSkillsError ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="text-xs text-destructive">
              {t(($) => $.tab_body.plugin.cloud_skills.load_error)}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={refetchCloudSkills}
            >
              <RefreshCw className="h-3 w-3" />
              {t(($) => $.tab_body.plugin.cloud_skills.retry_action)}
            </Button>
          </div>
        ) : cloudSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10">
            <Cloud className="h-7 w-7 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {t(($) => $.tab_body.plugin.cloud_skills.empty_title)}
            </p>
            <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
              {t(($) => $.tab_body.plugin.cloud_skills.empty_hint)}
            </p>
            <CloudSkillAddPopover
              agent={agent}
              currentSkills={cloudSkills}
              className="mt-3"
              triggerLabel={t(($) => $.tab_body.plugin.cloud_skills.add_action)}
            />
          </div>
        ) : (
          <div className="space-y-2">
            {cloudSkills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-start gap-3 rounded-lg border px-4 py-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
                  <Cloud className="h-5 w-5 text-sky-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold">
                    {skill.name}
                  </h3>
                  {skill.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {skill.description}
                    </p>
                  )}
                  {skill.slug && (
                    <span className="mt-1 inline-block font-mono text-[10px] text-muted-foreground/60">
                      {skill.slug}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleRemoveCloudSkill(skill.id)}
                  disabled={removingCloudSkillId === skill.id}
                  aria-label={t(($) => $.tab_body.plugin.cloud_skills.remove_label, {
                    name: skill.name,
                  })}
                  className="text-muted-foreground hover:text-destructive"
                >
                  {removingCloudSkillId === skill.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact plugin picker popover for the PluginTab. */
function PluginPickerPopover({
  selectedId,
  onSelect,
  className,
  triggerLabel,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
  triggerLabel: string;
}) {
  const { t } = useT("agents");

  const { searchQuery, setSearchQuery, debouncedSearch } = useDebouncedPluginSearch();
  const { data: plugins, isLoading } = useQuery(builtinPluginListOptions(debouncedSearch));
  const items = plugins?.items ?? [];

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className={className}>
            <Puzzle className="h-3 w-3" />
            {triggerLabel}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-72 p-0">
        <PluginPickerList
          plugins={items}
          selectedId={selectedId}
          onSelect={(id) => {
            onSelect(id);
          }}
          loading={isLoading}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        {selectedId && (
          <div className="border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => onSelect(selectedId)}
              className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="mr-1.5 inline-block h-3 w-3" />
              {t(($) => $.inspector.plugin_clear)}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Compact cloud-skill add popover for the PluginTab. Mirrors
 * PluginPickerPopover: a trigger button opens a server-search list of public
 * catalog skills (already-bound ones excluded). Unlike the old add dialog,
 * there is no draft/confirm step — clicking a row immediately binds the
 * skill via a full-replacement PUT built from the current bindings, so
 * unrelated bindings are never dropped.
 */
function CloudSkillAddPopover({
  agent,
  currentSkills,
  className,
  triggerLabel,
  disabled,
}: {
  agent: Agent;
  currentSkills: readonly AgentCloudSkill[];
  className?: string;
  triggerLabel: string;
  disabled?: boolean;
}) {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { searchQuery, setSearchQuery, debouncedSearch } =
    useDebouncedCatalogSkillSearch();
  const { data: catalog, isLoading } = useQuery(
    catalogSkillListOptions(debouncedSearch),
  );
  const items = catalog?.items ?? [];

  const boundIds = useMemo(
    () => new Set(currentSkills.map((s) => s.id)),
    [currentSkills],
  );
  const available = useMemo(
    () => items.filter((s) => !boundIds.has(s.id)),
    [items, boundIds],
  );

  const handleAdd = async (skill: CatalogSkill) => {
    // Full replacement list = current bindings + the newly added id, so a
    // single add never wipes unrelated cloud skills.
    const nextIds = [...currentSkills.map((s) => s.id), skill.id];
    try {
      await api.setAgentCloudSkills(agent.id, { skill_ids: nextIds });
      qc.invalidateQueries({
        queryKey: agentCloudSkillOptions(wsId, agent.id).queryKey,
      });
      toast.success(t(($) => $.tab_body.plugin.cloud_skills.updated_toast));
      // Immediate-add pickers close once the bind is persisted.
      setOpen(false);
    } catch {
      toast.error(t(($) => $.tab_body.plugin.cloud_skills.update_failed_toast));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className={className} disabled={disabled}>
            <Plus className="h-3 w-3" />
            {triggerLabel}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-72 p-0">
        <CloudSkillPickerList
          skills={available}
          selectedIds={new Set()}
          onToggle={handleAdd}
          loading={isLoading}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </PopoverContent>
    </Popover>
  );
}
