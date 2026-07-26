"use client"

// Publish bar for the capability editor (task 13 / FR-15).
//
// Bottom action row of the editor: install-command preview (reusing the
// task-8 `getInstallCommand` builder), an optional commit message (edit
// mode), and the publish / update submit button. All API work happens in the
// page container — this component is presentational.

import { useState } from "react"
import { Button } from "@multica/ui/components/ui/button"
import { Input } from "@multica/ui/components/ui/input"
import { Check, Copy, Loader2, Rocket, Save } from "lucide-react"
import { useT } from "@multica/views/i18n"
import { toast } from "sonner"
import { getInstallCommand } from "../lib/install-command"

/** Best-effort plugin name guess for the install-command preview — the
 *  backend derives the real one from the published package manifest. */
function guessPluginName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-plugin"
  )
}

export interface PublishBarProps {
  mode: "create" | "edit"
  itemType: string
  name: string
  version: string
  onVersionChange: (v: string) => void
  commitMsg: string
  onCommitMsgChange: (v: string) => void
  publishing: boolean
  canPublish: boolean
  onPublish: () => void
}

export function PublishBar(props: PublishBarProps) {
  const { t } = useT("hub")
  const [copied, setCopied] = useState(false)

  const installPreview = getInstallCommand({
    itemType: props.itemType,
    metadata:
      props.itemType === "plugin"
        ? { install: { plugin_name: guessPluginName(props.name) } }
        : undefined,
  })

  const copyPreview = async () => {
    if (!installPreview) return
    try {
      await navigator.clipboard.writeText(installPreview)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      toast.error(t(($) => $.editor.publish.copy_failed), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const PublishIcon = props.mode === "create" ? Rocket : Save

  return (
    <div className="flex shrink-0 flex-col gap-3 border-t border-border px-4 py-3">
      {/* Install command preview (plugin types produce a real command; other
          types are subscription-distributed and show a hint instead). */}
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          {t(($) => $.editor.publish.install_preview)}
        </span>
        {installPreview ? (
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
              {installPreview}
            </code>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label={t(($) => $.editor.publish.copy)}
              onClick={() => void copyPreview()}
            >
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t(($) => $.editor.publish.no_install_command)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={props.version}
          onChange={(e) => props.onVersionChange(e.target.value)}
          placeholder={t(($) => $.editor.publish.version_placeholder)}
          className="h-8 w-28 text-xs"
          aria-label={t(($) => $.editor.publish.version_label)}
        />
        {props.mode === "edit" && (
          <Input
            value={props.commitMsg}
            onChange={(e) => props.onCommitMsgChange(e.target.value)}
            placeholder={t(($) => $.editor.publish.commit_placeholder)}
            className="h-8 min-w-0 flex-1 text-xs"
            aria-label={t(($) => $.editor.publish.commit_label)}
          />
        )}
        <Button
          type="button"
          size="sm"
          className="ml-auto h-8 shrink-0 px-3"
          disabled={!props.canPublish || props.publishing}
          onClick={props.onPublish}
        >
          {props.publishing ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <PublishIcon className="mr-1.5 size-3.5" />
          )}
          {props.publishing
            ? t(($) => $.editor.publish.publishing)
            : props.mode === "create"
              ? t(($) => $.editor.publish.submit_create)
              : t(($) => $.editor.publish.submit_update)}
        </Button>
      </div>
    </div>
  )
}
