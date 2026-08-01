"use client";

import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@multica/core/types";
import { builtinPluginListOptions, pluginDetailOptions } from "@multica/core/workspace/queries";

/**
 * Resolve an agent's bound plugin, tolerating catalog UUID rotation.
 *
 * `agent.plugin_id` is a catalog UUID that changes whenever the plugin
 * catalog is rebuilt — builtin agents are seeded with a reference-env UUID
 * (migration 124) that 404s in a fresh catalog, producing the spurious
 * "plugin removed from marketplace" banner. `agent.plugin_name` is the
 * stable install slug, so when the id misses we recover the binding by slug
 * before declaring it stale. Mirrors the dispatch path, which already
 * resolves addons by name (resolveCSCloudAddons).
 */
export function useBoundPlugin(agent: Agent) {
  const { data: plugins } = useQuery(builtinPluginListOptions());
  const items = plugins?.items ?? [];

  // Primary: the (unstable) catalog UUID.
  const listSelected = items.find((p) => p.id === agent.plugin_id) ?? null;
  // Fallback: catalog UUIDs rotate on rebuild; the install slug is stable.
  const listBySlug =
    !listSelected && agent.plugin_name
      ? (items.find((p) => p.slug === agent.plugin_name) ?? null)
      : null;

  // Only hit the detail endpoint if both list lookups missed but an id is
  // still set — covers plugins outside the builtin list response.
  const shouldHydrate = !!agent.plugin_id && !listSelected && !listBySlug;
  const { data: hydrated, isFetching } = useQuery({
    ...pluginDetailOptions(agent.plugin_id ?? ""),
    enabled: shouldHydrate,
  });

  const selected = listSelected ?? listBySlug ?? (hydrated?.id ? hydrated : null);
  const stale = !selected && !!agent.plugin_id && !isFetching;

  return { selected, stale, isHydrating: isFetching, items };
}
