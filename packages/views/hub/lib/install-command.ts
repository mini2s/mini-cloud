// Install-command builder migrated from the source store project
// (`pages/store/components/item-detail-content.tsx` getInstallCommand).
//
// Rules (kept in sync with the source):
// - metadata.install.method === "zip_download" with a commands array: the
//   commands are joined with newlines and shown verbatim.
// - plugin items with metadata.install.plugin_name: `csc plugin install
//   <plugin_name>@costrict-plugins`. plugin_name comes from metadata.install
//   (NOT item.slug, which carries an owner prefix); the `costrict-plugins`
//   marketplace is the unified publish target every first-party plugin ships
//   to, so it is intentionally fixed and must NOT use the upstream
//   marketplace_name/marketplace_repo.
// - Non-plugin types (skill/subagent/command/mcp) are distributed via
//   subscription and have no install command -> null (UI hides the block).
//
// Consumed by the detail page (item-detail-content) and, later, by the
// capability editor publish bar (task 13) — keep the input shape minimal so
// callers without a full CapabilityItem (e.g. an editor draft) can reuse it.

export interface InstallCommandSource {
  itemType?: string
  metadata?: Record<string, unknown>
}

interface InstallMetadata {
  method?: unknown
  commands?: unknown
  plugin_name?: unknown
}

export function getInstallCommand(item: InstallCommandSource | null | undefined): string | null {
  if (!item) return null
  const install = (item.metadata as { install?: InstallMetadata } | undefined)?.install
  if (install?.method === "zip_download" && Array.isArray(install.commands)) {
    const commands = install.commands.filter((c): c is string => typeof c === "string" && c.length > 0)
    return commands.length > 0 ? commands.join("\n") : null
  }
  if (item.itemType === "plugin" && typeof install?.plugin_name === "string" && install.plugin_name) {
    return `csc plugin install ${install.plugin_name}@costrict-plugins`
  }
  return null
}
