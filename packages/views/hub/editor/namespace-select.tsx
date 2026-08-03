"use client"

// Namespace selector for the capability editor (task 13 / FR-15).
//
// Mirrors the source console namespace segment: publish to the public
// catalog, keep private, or publish into one of the caller's repositories
// (options from `hubListMyRepos`). The value model keeps the repo id so the
// publish layer can map it onto `registryId` + repo visibility.

import { Globe, Lock, Database } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select"
import { useT } from "@multica/views/i18n"
import { useHubMyRepos } from "@multica/core/hub"
import type { Repository } from "@multica/core/types/hub"

export type NamespaceValue =
  | { kind: "public" }
  | { kind: "private" }
  | { kind: "repo"; repoId: string }

/** Serialize for the Select widget (single string value). */
function encodeValue(v: NamespaceValue): string {
  return v.kind === "repo" ? `repo:${v.repoId}` : v.kind
}

function decodeValue(v: string): NamespaceValue {
  if (v.startsWith("repo:")) return { kind: "repo", repoId: v.slice(5) }
  if (v === "private") return { kind: "private" }
  return { kind: "public" }
}

/** Resolve the publish payload fields for a namespace value. */
export function namespaceToPublishFields(
  v: NamespaceValue,
  repos: Repository[],
): { visibility: string; registryId?: string } {
  if (v.kind === "repo") {
    const repo = repos.find((r) => r.id === v.repoId)
    return { visibility: repo?.visibility ?? "private", registryId: v.repoId }
  }
  return { visibility: v.kind }
}

/** Best-effort inverse mapping when editing an existing item. */
export function namespaceFromItem(item: {
  visibility?: string
  repoId?: string
  registryId?: string
}): NamespaceValue {
  const repoId = item.repoId ?? ""
  if (repoId) return { kind: "repo", repoId }
  if (item.visibility === "private") return { kind: "private" }
  return { kind: "public" }
}

export interface NamespaceSelectProps {
  value: NamespaceValue
  onChange: (v: NamespaceValue) => void
  disabled?: boolean
}

export function NamespaceSelect({ value, onChange, disabled }: NamespaceSelectProps) {
  const { t } = useT("hub")
  const { repos: repoList } = useHubMyRepos()

  return (
    <Select
      value={encodeValue(value)}
      onValueChange={(v) => onChange(decodeValue(v ?? "public"))}
      disabled={disabled}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="public">
          <span className="flex items-center gap-2">
            <Globe className="size-3.5 text-muted-foreground" />
            {t(($) => $.editor.namespace.public)}
          </span>
        </SelectItem>
        <SelectItem value="private">
          <span className="flex items-center gap-2">
            <Lock className="size-3.5 text-muted-foreground" />
            {t(($) => $.editor.namespace.private)}
          </span>
        </SelectItem>
        {repoList.map((repo) => (
          <SelectItem key={repo.id} value={`repo:${repo.id}`}>
            <span className="flex items-center gap-2">
              <Database className="size-3.5 text-muted-foreground" />
              <span className="truncate">
                {t(($) => $.editor.namespace.repo_prefix)}
                {repo.displayName || repo.name}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
