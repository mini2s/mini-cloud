"use client"

import { useCallback, useRef, useState } from "react"
import { Textarea } from "@multica/ui/components/ui/textarea"
import { Button } from "@multica/ui/components/ui/button"
import { Upload, Trash2 } from "lucide-react"
import { cn } from "@multica/ui/lib/utils"
import type { ContentMode } from "../lib/content"
import { ACCEPTED_ARCHIVE_TYPES, formatBytes, isArchive } from "../lib/constants"

interface Props {
  archive?: boolean
  mode: ContentMode
  text: string
  file: File | null
  rows?: number
  textClass?: string
  existingArchive?: boolean
  onModeChange: (mode: ContentMode) => void
  onTextChange: (text: string) => void
  onFileChange: (file: File | null) => void
  onError?: (message: string) => void
}

const modes: ContentMode[] = ["text", "archive"]

export function ContentField(props: Props) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const mode = props.archive === false ? "text" : props.mode

  const fail = useCallback(() => {
    props.onError?.("Invalid archive file")
  }, [props.onError])

  const pick = useCallback(
    (file: File | undefined | null) => {
      if (!file) return
      if (!isArchive(file.name)) {
        fail()
        return
      }
      props.onError?.("")
      props.onFileChange(file)
    },
    [fail, props.onError, props.onFileChange],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDrag(false)
      pick(e.dataTransfer?.files[0])
    },
    [pick],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDrag(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
  }, [])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="block text-sm font-medium text-foreground">
          {"Content"}
        </label>
        {props.archive !== false && (
          <div className="flex items-center gap-2">
            {modes.map((item) => (
              <button
                key={item}
                type="button"
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm transition-colors",
                  mode !== item
                    ? "border-border text-muted-foreground"
                    : "border-border bg-accent/20 text-foreground",
                )}
                onClick={() => props.onModeChange(item)}
              >
                {item === "text" ? "Text" : "Archive"}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "text" ? (
        <Textarea
          value={props.text}
          onChange={(e) => props.onTextChange(e.target.value)}
          rows={props.rows ?? 10}
          className={cn("min-h-[200px] resize-y", props.textClass)}
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          className={cn(
            "rounded-xl bg-background p-5 transition-colors outline-none",
            props.file
              ? "cursor-pointer border border-border"
              : drag
                ? "border-2 border-dashed border-primary/50 bg-accent/10"
                : "cursor-pointer border-2 border-dashed border-border hover:border-foreground/30",
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return
            e.preventDefault()
            inputRef.current?.click()
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_ARCHIVE_TYPES}
            className="hidden"
            onChange={(e) => {
              pick(e.currentTarget.files?.[0])
              e.currentTarget.value = ""
            }}
          />

          {props.file ? (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{props.file.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{formatBytes(props.file.size)}</div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onError?.("")
                  props.onFileChange(null)
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : props.existingArchive ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
              <div className="flex size-10 items-center justify-center rounded-full bg-accent/20 text-accent-foreground">
                <Upload className="h-5 w-5" />
              </div>
              <div className="text-sm text-foreground">{"Archive"}</div>
              <div className="text-xs">{"Drag & drop to replace"}</div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
              <div className="flex size-10 items-center justify-center rounded-full bg-accent/20 text-accent-foreground">
                <Upload className="h-5 w-5" />
              </div>
              <div className="text-sm text-foreground">{"Drop archive here"}</div>
              <div className="text-xs">{`Accepted: .zip, .tar.gz, .tgz`}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}