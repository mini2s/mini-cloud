const archives = [".zip", ".tar.gz", ".tgz"] as const

export const ACCEPTED_ARCHIVE_TYPES = archives.join(",")

export const TYPE_PREFIX: Record<string, string> = {
  skill: "skill-",
  subagent: "agent-",
  command: "cmd-",
  mcp: "mcp-",
  plugin: "plugin-",
}

/* SD-09: TYPE_COLORS moved to ./type-colors.ts as a themeable token map.
   Re-exported here so existing consumers keep working while imports are
   migrated to the new module. */
export { TYPE_COLORS, typeColor } from "./type-colors"

export const TYPE_CONTENT_PLACEHOLDER: Record<string, string> = {
  skill: "# SKILL\n\nDescribe what this skill does...",
  subagent: "# Subagent\n\nDescribe the subagent behavior...",
  command: "# Command\n\nDescribe the command behavior...",
  mcp: '{\n  "mcpServers": {\n      \n  }\n}',
  plugin: '{\n  "install": {\n    "plugin_name": "",\n    "marketplace_name": "",\n    "marketplace_repo": ""\n  }\n}',
}

export function typeKey(type: string) {
  return `hub.capability.type.${type}`
}

export function isArchive(name: string) {
  const file = name.toLowerCase()
  return archives.some((ext) => file.endsWith(ext))
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
