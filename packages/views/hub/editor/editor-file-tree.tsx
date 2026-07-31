"use client"

// Virtual file tree for the capability editor (task 13 / FR-15).
//
// Backed by the flat EditorFileMap (path -> content + explicit dirs), this
// component renders the derived tree and provides:
//   - create file / create directory (inline naming, scoped to the selected
//     directory or the bundle root)
//   - rename (inline) and delete (with confirmation, cascades for dirs)
//   - whole-directory import via a hidden <input webkitdirectory>
// The tree is a pure function of the map — every mutation produces a new map
// that flows back up through `onChange`.

import { useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderInput,
  Pencil,
  Trash2,
} from "lucide-react"
import { cn } from "@multica/ui/lib/utils"
import { Button } from "@multica/ui/components/ui/button"
import { Input } from "@multica/ui/components/ui/input"
import { useT } from "@multica/views/i18n"
import { ConfirmDialog } from "../components/confirm-dialog"
import {
  addDir,
  addFile,
  buildFileTree,
  collectDescendantFiles,
  deletePath,
  joinPath,
  normalizeRelPath,
  renamePath,
  type EditorFileMap,
  type FileTreeNode,
} from "./lib/editor-files"

export interface EditorFileTreeProps {
  map: EditorFileMap
  /** Main entry file (SKILL.md …) — pinned on top, shown with a badge. */
  mainFile?: string
  currentFile: string | null
  /** Paths whose content differs from the initial snapshot. */
  dirtyPaths?: ReadonlySet<string>
  onSelect: (path: string | null) => void
  onChange: (next: EditorFileMap) => void
}

type PendingCreate = { kind: "file" | "dir"; parentDir: string } | null

export function EditorFileTree(props: EditorFileTreeProps) {
  const { t } = useT("hub")
  const { map, mainFile, currentFile, dirtyPaths, onSelect, onChange } = props

  const tree = useMemo(() => buildFileTree(map, mainFile), [map, mainFile])
const [selectedDir, setSelectedDir] = useState<string>("")
// Directories start expanded (source console behavior) — the state holds
// the explicitly COLLAPSED paths.
const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
const [creating, setCreating] = useState<PendingCreate>(null)
const [createName, setCreateName] = useState("")
const [renaming, setRenaming] = useState<string | null>(null)
const [renameValue, setRenameValue] = useState("")
const [deleting, setDeleting] = useState<string | null>(null)
const [error, setError] = useState("")
const importInputRef = useRef<HTMLInputElement>(null)

const isExpanded = (path: string) => !collapsed.has(path)
const handleToggle = (path: string) => {
  setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
}

  // ── Create ───────────────────────────────────────────────────────────────

  const startCreate = (kind: "file" | "dir") => {
    startCreateIn(kind, selectedDir)
  }

  // Start an inline create scoped to `parentDir`. The target directory is
  // force-expanded so the naming row is visible where the user clicked.
  const startCreateIn = (kind: "file" | "dir", parentDir: string) => {
    setSelectedDir(parentDir)
    if (parentDir) {
      setCollapsed((prev) => {
        if (!prev.has(parentDir)) return prev
        const next = new Set(prev)
        next.delete(parentDir)
        return next
      })
    }
    setCreating({ kind, parentDir })
    setCreateName("")
    setError("")
  }

  const commitCreate = () => {
    if (!creating) return
    const name = createName.trim()
    if (!name) {
      setCreating(null)
      return
    }
    const path = normalizeRelPath(joinPath(creating.parentDir, name))
    if (!path) {
      setError(t(($) => $.editor.tree.error_invalid_name))
      return
    }
    if (creating.kind === "file") {
      if (map.files[path] !== undefined || map.dirs.has(path)) {
        setError(t(($) => $.editor.tree.error_exists))
        return
      }
      const next = addFile(map, path, "")
      onChange(next)
      onSelect(path)
    } else {
      if (map.dirs.has(path) || map.files[path] !== undefined) {
        setError(t(($) => $.editor.tree.error_exists))
        return
      }
      onChange(addDir(map, path))
    }
    setCreating(null)
    setCreateName("")
    setError("")
  }

  // ── Rename ───────────────────────────────────────────────────────────────

  const startRename = (path: string) => {
    setRenaming(path)
    setRenameValue(path.split("/").pop() ?? path)
    setError("")
  }

  const commitRename = () => {
    if (!renaming) return
    const name = renameValue.trim()
    if (!name) {
      setRenaming(null)
      return
    }
    const parent = renaming.includes("/") ? renaming.slice(0, renaming.lastIndexOf("/")) : ""
    const target = normalizeRelPath(joinPath(parent, name))
    if (!target || target === renaming) {
      setRenaming(null)
      return
    }
    if (map.files[target] !== undefined || map.dirs.has(target)) {
      setError(t(($) => $.editor.tree.error_exists))
      return
    }
    const next = renamePath(map, renaming, target)
    if (next === map) {
      setError(t(($) => $.editor.tree.error_invalid_name))
      return
    }
    onChange(next)
    if (currentFile === renaming) onSelect(target)
    else if (currentFile && currentFile.startsWith(`${renaming}/`)) {
      onSelect(target + currentFile.slice(renaming.length))
    }
    setRenaming(null)
    setRenameValue("")
    setError("")
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  const deletingFiles = deleting ? collectDescendantFiles(map, deleting) : []

  const commitDelete = () => {
    if (!deleting) return
    const next = deletePath(map, deleting)
    onChange(next)
    if (currentFile && (currentFile === deleting || currentFile.startsWith(`${deleting}/`))) {
      const remaining = Object.keys(next.files).sort()
      onSelect(remaining[0] ?? null)
    }
    setDeleting(null)
  }

  // ── Directory import ─────────────────────────────────────────────────────

  const handleImportFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    let next = map
    // webkitRelativePath looks like "<root>/<sub>/<file>"; strip the leading
    // root segment so the imported contents land at the bundle root (or under
    // the selected dir when one is active).
    const prefix = selectedDir ? `${selectedDir}/` : ""
    for (const file of Array.from(list)) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      const segments = rel.split("/").filter(Boolean)
      if (segments.length > 1) segments.shift()
      const path = normalizeRelPath(prefix + segments.join("/"))
      if (!path) continue
      // Binary assets can't round-trip through the text model; skip them
      // loudly instead of corrupting the bundle.
      if (!isTextLike(file)) continue
      const text = await file.text()
      next = addFile(next, path, text)
    }
    onChange(next)
    if (importInputRef.current) importInputRef.current.value = ""
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const renderNode = (node: FileTreeNode, depth: number): React.ReactNode => {
    const paddingLeft = depth * 12 + 8

    if (node.isDirectory) {
      const open = isExpanded(node.path)
      const FolderIcon = open ? FolderOpen : Folder
      const ChevronIcon = open ? ChevronDown : ChevronRight
      const selected = selectedDir === node.path
      return (
        <div key={node.path}>
          <div
            className={cn(
              "group flex w-full items-center gap-1 rounded-sm py-1 pr-1 text-left text-xs hover:bg-accent/60",
              selected && "bg-accent",
            )}
            style={{ paddingLeft }}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5"
              onClick={() => {
                handleToggle(node.path)
                setSelectedDir(node.path)
              }}
            >
              <ChevronIcon className="size-3 shrink-0 text-muted-foreground" />
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
              {renaming === node.path ? (
                <Input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename()
                    if (e.key === "Escape") setRenaming(null)
                  }}
                  className="h-5 px-1 py-0 text-xs"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="truncate"
                  onDoubleClick={() => startRename(node.path)}
                >
                  {node.name}
                </span>
              )}
            </button>
            <RowActions
              onNewFile={() => startCreateIn("file", node.path)}
              onNewDir={() => startCreateIn("dir", node.path)}
              onRename={() => startRename(node.path)}
              onDelete={() => setDeleting(node.path)}
              newFileLabel={t(($) => $.editor.tree.new_file)}
              newDirLabel={t(($) => $.editor.tree.new_dir)}
              renameLabel={t(($) => $.editor.tree.action_rename)}
              deleteLabel={t(($) => $.editor.tree.action_delete)}
            />
          </div>
          {open && creating && creating.parentDir === node.path && (
            <CreateRow
              kind={creating.kind}
              value={createName}
              onChange={setCreateName}
              onCommit={commitCreate}
              onCancel={() => setCreating(null)}
              depth={depth + 1}
              placeholder={
                creating.kind === "file"
                  ? t(($) => $.editor.tree.new_file_placeholder)
                  : t(($) => $.editor.tree.new_dir_placeholder)
              }
            />
          )}
          {open && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }
    const isCurrent = node.path === currentFile
    const dirty = dirtyPaths?.has(node.path)
    const FileIcon = /\.(md|mdx|markdown)$/i.test(node.name) ? FileText : File
    return (
      <div
        key={node.path}
        className={cn(
          "group flex w-full items-center gap-1 rounded-sm py-1 pr-1 text-left text-xs hover:bg-accent/60",
          isCurrent && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: paddingLeft + 12 }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onClick={() => onSelect(node.path)}
        >
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          {renaming === node.path ? (
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename()
                if (e.key === "Escape") setRenaming(null)
              }}
              className="h-5 px-1 py-0 text-xs"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="truncate" onDoubleClick={() => startRename(node.path)}>
              {node.name}
              {node.path === mainFile && (
                <span className="ml-1.5 rounded bg-primary/10 px-1 py-px text-[10px] text-primary">
                  {t(($) => $.editor.tree.main_badge)}
                </span>
              )}
            </span>
          )}
          {dirty && <span className="ml-1 inline-block size-1.5 shrink-0 rounded-full bg-warning" />}
        </button>
        <RowActions
          onRename={() => startRename(node.path)}
          onDelete={() => setDeleting(node.path)}
          renameLabel={t(($) => $.editor.tree.action_rename)}
          deleteLabel={t(($) => $.editor.tree.action_delete)}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="mr-auto px-1 text-xs font-medium text-muted-foreground">
          {t(($) => $.editor.tree.title)}
        </span>
        <ToolButton label={t(($) => $.editor.tree.new_file)} onClick={() => startCreate("file")}>
          <FilePlus2 className="size-3.5" />
        </ToolButton>
        <ToolButton label={t(($) => $.editor.tree.new_dir)} onClick={() => startCreate("dir")}>
          <FolderPlus className="size-3.5" />
        </ToolButton>
        <ToolButton label={t(($) => $.editor.tree.import_dir)} onClick={() => importInputRef.current?.click()}>
          <FolderInput className="size-3.5" />
        </ToolButton>
        <input
          ref={importInputRef}
          type="file"
          multiple
          className="hidden"
          // @ts-expect-error — non-standard but universally supported attr
          webkitdirectory=""
          onChange={(e) => void handleImportFiles(e.target.files)}
        />
      </div>

      {error && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        {creating && creating.parentDir === "" && (
          <CreateRow
            kind={creating.kind}
            value={createName}
            onChange={setCreateName}
            onCommit={commitCreate}
            onCancel={() => setCreating(null)}
            depth={0}
            placeholder={
              creating.kind === "file"
                ? t(($) => $.editor.tree.new_file_placeholder)
                : t(($) => $.editor.tree.new_dir_placeholder)
            }
          />
        )}
        {tree.map((node) => renderNode(node, 0))}
        {tree.length === 0 && !creating && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t(($) => $.editor.tree.empty)}
          </p>
        )}
        {/* Fallback: only when the target directory node itself is not in
            the tree (neither an explicit dir nor derivable from file paths),
            render the pending row at the bottom instead of losing it. */}
        {creating &&
          creating.parentDir !== "" &&
          !map.dirs.has(creating.parentDir) &&
          !Object.keys(map.files).some((p) => p.startsWith(`${creating.parentDir}/`)) && (
          <CreateRow
            kind={creating.kind}
            value={createName}
            onChange={setCreateName}
            onCommit={commitCreate}
            onCancel={() => setCreating(null)}
            depth={1}
            placeholder={t(($) => $.editor.tree.create_in, {
              dir: creating.parentDir,
            })}
          />
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) setDeleting(null)
        }}
        title={t(($) => $.editor.tree.delete_title)}
        description={
          deleting && map.dirs.has(deleting)
            ? t(($) => $.editor.tree.delete_dir_desc, { count: deletingFiles.length })
            : t(($) => $.editor.tree.delete_file_desc)
        }
        onConfirm={commitDelete}
      />
    </div>
  )
}

// ── Small pieces ───────────────────────────────────────────────────────────

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      className="size-6"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function RowActions({
  onNewFile,
  onNewDir,
  onRename,
  onDelete,
  newFileLabel,
  newDirLabel,
  renameLabel,
  deleteLabel,
}: {
  onNewFile?: () => void
  onNewDir?: () => void
  onRename: () => void
  onDelete: () => void
  newFileLabel?: string
  newDirLabel?: string
  renameLabel: string
  deleteLabel: string
}) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      {onNewFile && (
        <button
          type="button"
          title={newFileLabel}
          aria-label={newFileLabel}
          className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          onClick={onNewFile}
        >
          <FilePlus2 className="size-3" />
        </button>
      )}
      {onNewDir && (
        <button
          type="button"
          title={newDirLabel}
          aria-label={newDirLabel}
          className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          onClick={onNewDir}
        >
          <FolderPlus className="size-3" />
        </button>
      )}
      <button
        type="button"
        title={renameLabel}
        aria-label={renameLabel}
        className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
        onClick={onRename}
      >
        <Pencil className="size-3" />
      </button>
      <button
        type="button"
        title={deleteLabel}
        aria-label={deleteLabel}
        className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="size-3" />
      </button>
    </span>
  )
}

function CreateRow({
  kind,
  value,
  onChange,
  onCommit,
  onCancel,
  depth,
  placeholder,
}: {
  kind: "file" | "dir"
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  depth: number
  placeholder?: string
}) {
  const Icon = kind === "file" ? FilePlus2 : FolderPlus
  return (
    <div
      className="flex items-center gap-1.5 py-1 pr-1"
      style={{ paddingLeft: depth * 12 + 8 }}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <Input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit()
          if (e.key === "Escape") onCancel()
        }}
        className="h-5 px-1 py-0 text-xs"
      />
    </div>
  )
}

/** Heuristic for the text-only bundle model: anything without a MIME type or
 *  with a text/*, JSON, XML or script-ish type is treated as text. */
function isTextLike(file: File): boolean {
  const type = file.type
  if (!type) {
    // Extension fallback for files the OS reports no type for.
    return /\.(md|mdx|markdown|txt|json|ya?ml|toml|xml|svg|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|c|h|cc|cpp|hpp|cs|sh|bash|zsh|fish|css|scss|less|html?|vue|svelte|sql|graphql|proto|ini|cfg|conf|env|gitignore|gitattributes|editorconfig|dockerfile|makefile|license)$/i.test(
      file.name,
    )
  }
  return (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("xml") ||
    type.includes("javascript") ||
    type.includes("typescript") ||
    type === "application/x-yaml" ||
    type === "application/yaml" ||
    type === "image/svg+xml"
  )
}
