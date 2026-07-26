"use client"

// Markdown preview pane for the capability editor (task 13 / FR-15).
//
// Renders the current file through the shared `packages/ui` Markdown
// component (GFM + KaTeX + shiki-highlighted code blocks, already themed for
// light/dark). Non-markdown files get a small placeholder instead.

import { Markdown } from "@multica/ui/markdown"
import { FileText } from "lucide-react"
import { useT } from "@multica/views/i18n"
import { isMarkdownPath } from "./lib/editor-files"

export interface EditorMarkdownPreviewProps {
  /** Currently selected file path (drives the markdown check). */
  path: string | null
  content: string
}

export function EditorMarkdownPreview({ path, content }: EditorMarkdownPreviewProps) {
  const { t } = useT("hub")

  if (!path || !isMarkdownPath(path)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <FileText className="size-6 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">
          {t(($) => $.editor.preview.not_markdown)}
        </p>
      </div>
    )
  }

  if (!content.trim()) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-xs text-muted-foreground">{t(($) => $.editor.preview.empty)}</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto px-4 py-3">
      <Markdown mode="full">{content}</Markdown>
    </div>
  )
}
