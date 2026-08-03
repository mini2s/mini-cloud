"use client"

// Capability editor page container (task 13 / FR-15) — migrated from the
// source store console `console/capability-editor-page` (AI panel excluded
// per the design decision).
//
// Layout: left virtual file tree / center CodeMirror editor / right
// properties + Markdown preview column, with the publish bar pinned to the
// bottom of the right column. Two modes:
//   - create (/hub/editor): start from a type-conventional main-file template
//   - edit (/hub/editor/[itemId]): rebuild the file map from the item's
//     `content` (main file at `sourcePath`) + `assets[]` entries
//
// Publish semantics (mirrors the source API contract):
//   - create → single JSON hubCreateItem carrying content + assets + tags +
//     visibility + registryId + sourcePath
//   - edit   → JSON hubUpdateItem for metadata + main-file content; a second
//     multipart hubUpdateItem with the zipped bundle ONLY when non-main
//     assets changed (the JSON mode has no assets field)
// On success the lists are invalidated and the page returns to the manager.

import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowLeft,
  FileCode2,
  FolderTree,
  Loader2,
  SlidersHorizontal,
} from "lucide-react"
import { api } from "@multica/core/api"
import { useWorkspacePaths } from "@multica/core/paths"
import {
  hubKeys,
  useHubFilterOptions,
  useHubItemDetail,
  useHubMyRepos,
} from "@multica/core/hub"
import { Button } from "@multica/ui/components/ui/button"
import { Input } from "@multica/ui/components/ui/input"
import { Textarea } from "@multica/ui/components/ui/textarea"
import { Label } from "@multica/ui/components/ui/label"
import { Badge } from "@multica/ui/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@multica/ui/components/ui/sheet"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@multica/ui/components/ui/resizable"
import { useIsMobile } from "@multica/ui/hooks/use-mobile"
import { useT } from "@multica/views/i18n"
import { useNavigation } from "../../navigation"
import { PageHeader } from "../../layout/page-header"
import { EditorFileTree } from "./editor-file-tree"
import { EditorCm } from "./editor-cm"
import { EditorMarkdownPreview } from "./editor-markdown-preview"
import { TagInput } from "./tag-input"
import {
  NamespaceSelect,
  namespaceFromItem,
  namespaceToPublishFields,
  type NamespaceValue,
} from "./namespace-select"
import { PublishBar } from "./publish-bar"
import {
  fileMapFromItem,
  fileMapsEqual,
  fileMapToZipFile,
  firstFilePath,
  initialFileMapForCreate,
  mainFileForType,
  renamePath,
  setFileContent,
  type EditorFileMap,
} from "./lib/editor-files"

const ITEM_TYPES = ["skill", "subagent", "command", "mcp", "plugin"] as const

export interface CapabilityEditorPageProps {
  /** Present → edit mode; absent → create mode. */
  itemId?: string
}

export function CapabilityEditorPage({ itemId }: CapabilityEditorPageProps) {
  const mode: "create" | "edit" = itemId ? "edit" : "create"
  const { t } = useT("hub")
  const navigation = useNavigation()
  const paths = useWorkspacePaths()
  const qc = useQueryClient()
  const isMobile = useIsMobile()

  const detailQuery = useHubItemDetail(itemId)
  const item = detailQuery.data
  const { data: filterOpts } = useHubFilterOptions()
  const { repos } = useHubMyRepos()

  // ── Metadata state ───────────────────────────────────────────────────────
  const [itemType, setItemType] = useState<string>("skill")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [namespace, setNamespace] = useState<NamespaceValue>({ kind: "public" })
  const [version, setVersion] = useState("")
  const [commitMsg, setCommitMsg] = useState("")

  // ── File state ───────────────────────────────────────────────────────────
  const [fileMap, setFileMap] = useState<EditorFileMap>(() =>
    initialFileMapForCreate("skill", ""),
  )
  /** Edit-mode baseline for dirty tracking (null in create mode). */
  const [snapshot, setSnapshot] = useState<EditorFileMap | null>(null)
  const [mainFile, setMainFile] = useState<string>(mainFileForType("skill"))
  const [currentFile, setCurrentFile] = useState<string | null>(mainFileForType("skill"))
  const [publishing, setPublishing] = useState(false)
  /** Create-mode: the untouched template may be swapped when the type changes. */
  const templateUntouchedRef = useRef(true)
  /** Edit-mode: the detail payload initializes the form exactly once. */
  const [initialized, setInitialized] = useState(mode === "create")

  // Drawer state (narrow screens — A8).
  const [treeOpen, setTreeOpen] = useState(false)
  const [propsOpen, setPropsOpen] = useState(false)

  // SD-08: back action goes through the navigation adapter (adapter.back()),
  // falling back to the manager page when there is no history to pop.
  const handleBack = () => {
    if (window.history.length > 1) navigation.back()
    else navigation.push(paths.hubManager())
  }

  // ── Edit-mode initialization ─────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "edit" || initialized || !item) return
    const { map, mainFile: mf } = fileMapFromItem(item)
    setItemType(item.itemType)
    setName(item.name)
    setDescription(item.description ?? "")
    setTags((item.tags ?? []).map((tag) => tag.slug))
    setNamespace(namespaceFromItem(item))
    setVersion(item.version ?? "")
    setFileMap(map)
    setSnapshot(map)
    setMainFile(mf)
    setCurrentFile(firstFilePath(map, mf))
    templateUntouchedRef.current = false
    setInitialized(true)
  }, [mode, initialized, item])

  // ── Type switching (create mode only — itemType is immutable on edit) ────
  const handleTypeChange = (nextType: string) => {
    if (nextType === itemType) return
    const nextMain = mainFileForType(nextType)
    if (templateUntouchedRef.current) {
      setFileMap(initialFileMapForCreate(nextType, name))
    } else if (fileMap.files[mainFile] !== undefined && fileMap.files[nextMain] === undefined) {
      // Keep authored content: move the previous main file to the new
      // type-conventional path.
      setFileMap((prev) => renamePath(prev, mainFile, nextMain))
    }
    setItemType(nextType)
    setMainFile(nextMain)
    if (currentFile === mainFile || !currentFile) setCurrentFile(nextMain)
  }

  const handleMapChange = (next: EditorFileMap) => {
    templateUntouchedRef.current = false
    setFileMap(next)
  }

  const handleSelectFile = (path: string | null) => {
    setCurrentFile(path)
    setTreeOpen(false)
  }

  // ── Dirty tracking ───────────────────────────────────────────────────────
  const filesDirty = snapshot ? !fileMapsEqual(fileMap, snapshot) : false

  const dirtyPaths = useMemo(() => {
    if (!snapshot) return undefined
    const out = new Set<string>()
    for (const [p, content] of Object.entries(fileMap.files)) {
      if (snapshot.files[p] !== content) out.add(p)
    }
    return out
  }, [fileMap, snapshot])

  const metaDirty = useMemo(() => {
    if (mode !== "edit" || !item) return false
    const ns = namespaceToPublishFields(namespace, repos)
    const itemTagSlugs = (item.tags ?? []).map((tag) => tag.slug).sort()
    return (
      name.trim() !== item.name ||
      description.trim() !== (item.description ?? "") ||
      version.trim() !== (item.version ?? "") ||
      ns.visibility !== item.visibility ||
      JSON.stringify([...tags].sort()) !== JSON.stringify(itemTagSlugs)
    )
  }, [mode, item, name, description, version, tags, namespace, repos])

  const dirty = filesDirty || metaDirty

  const hasMainFile = fileMap.files[mainFile] !== undefined
  const canPublish =
    !publishing &&
    name.trim().length > 0 &&
    hasMainFile &&
    (mode === "create" || dirty || commitMsg.trim().length > 0)

  // ── Publish ──────────────────────────────────────────────────────────────
  const handlePublish = async () => {
    const trimmedName = name.trim()
    if (!trimmedName || publishing) return
    setPublishing(true)
    try {
      const ns = namespaceToPublishFields(namespace, repos)
      const mainContent = fileMap.files[mainFile] ?? ""
      const trimmedVersion = version.trim()
      const trimmedCommit = commitMsg.trim()
      // TagInput works in slug space; map known slugs back to catalog ids and
      // pass new labels through verbatim (the backend creates them) — same
      // semantics as the source console publish flow.
      const catalogIdBySlug = new Map(
        (filterOpts?.tags ?? []).map((tag) => [tag.slug, tag.id] as const),
      )
      const tagPayload = tags.map((slug) => catalogIdBySlug.get(slug) ?? slug)

      if (mode === "create") {
        const assets = Object.entries(fileMap.files)
          .filter(([p]) => p !== mainFile)
          .map(([relPath, textContent]) => ({ relPath, textContent }))
        await api.hubCreateItem({
          itemType,
          name: trimmedName,
          description: description.trim() || undefined,
          tags: tagPayload.length > 0 ? tagPayload : undefined,
          version: trimmedVersion || undefined,
          content: mainContent,
          visibility: ns.visibility,
          registryId: ns.registryId,
          sourcePath: mainFile,
          assets: assets.length > 0 ? assets : undefined,
        })
        toast.success(t(($) => $.editor.toast.create_success))
      } else if (itemId) {
        const mainChanged = !snapshot || snapshot.files[mainFile] !== mainContent
        const assetsChanged = (() => {
          if (!snapshot) return false
          const cur = Object.keys(fileMap.files).filter((p) => p !== mainFile)
          const prev = Object.keys(snapshot.files).filter((p) => p !== mainFile)
          if (cur.length !== prev.length) return true
          return cur.some((p) => snapshot.files[p] !== fileMap.files[p])
        })()

        // Metadata + main-file content (JSON mode; no assets field there).
        if (metaDirty || mainChanged || trimmedCommit) {
          await api.hubUpdateItem(itemId, {
            name: trimmedName,
            description: description.trim() || undefined,
            visibility: ns.visibility,
            tags: tagPayload,
            version: trimmedVersion || undefined,
            content: mainChanged ? mainContent : undefined,
            commitMsg: trimmedCommit || undefined,
          })
        }
        // Non-main assets ride the multipart zip payload, matching the
        // source API semantics (file upload replaces the bundle).
        if (assetsChanged) {
          await api.hubUpdateItem(itemId, {
            file: fileMapToZipFile(fileMap, trimmedName),
            commitMsg: trimmedCommit || undefined,
          })
        }
        toast.success(t(($) => $.editor.toast.update_success))
      }

      qc.invalidateQueries({ queryKey: hubKeys.items() })
      if (itemId) qc.invalidateQueries({ queryKey: hubKeys.item(itemId) })
      navigation.push(paths.hubManager())
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(
        mode === "create"
          ? t(($) => $.editor.toast.create_failed)
          : t(($) => $.editor.toast.update_failed),
        { description: msg },
      )
    } finally {
      setPublishing(false)
    }
  }

  const typeLabel = (type: string): string => {
    switch (type) {
      case "subagent":
        return t(($) => $.type.subagent)
      case "command":
        return t(($) => $.type.command)
      case "mcp":
        return t(($) => $.type.mcp)
      case "plugin":
        return t(($) => $.type.plugin)
      default:
        return t(($) => $.type.skill)
    }
  }

  // ── Loading / error gates (edit mode) ────────────────────────────────────
  if (mode === "edit" && !initialized) {
    if (detailQuery.isError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">{t(($) => $.editor.load_failed)}</p>
          <Button variant="outline" size="sm" onClick={() => navigation.push(paths.hubManager())}>
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t(($) => $.editor.back_to_manager)}
          </Button>
        </div>
      )
    }
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t(($) => $.editor.loading)}
      </div>
    )
  }

  // ── Shared panels ────────────────────────────────────────────────────────
  const fileTreePanel = (
    <EditorFileTree
      map={fileMap}
      mainFile={mainFile}
      currentFile={currentFile}
      dirtyPaths={dirtyPaths}
      onSelect={handleSelectFile}
      onChange={handleMapChange}
    />
  )

  const editorPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <FileCode2 className="size-3.5 shrink-0" />
        <span className="truncate font-mono">
          {currentFile ?? t(($) => $.editor.no_file_selected)}
        </span>
        {currentFile && dirtyPaths?.has(currentFile) && (
          <span className="inline-block size-1.5 shrink-0 rounded-full bg-warning" />
        )}
      </div>
      <div className="min-h-0 flex-1">
        {currentFile ? (
          <EditorCm
            path={currentFile}
            value={fileMap.files[currentFile] ?? ""}
            onChange={(v) =>
              setFileMap((prev) => setFileContent(prev, currentFile, v))
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {t(($) => $.editor.no_file_selected)}
          </div>
        )}
      </div>
    </div>
  )

  const propsForm = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">{t(($) => $.editor.props.type)}</Label>
        <Select
          value={itemType}
          onValueChange={(v) => v && handleTypeChange(v)}
          disabled={mode === "edit"}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ITEM_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {typeLabel(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t(($) => $.editor.props.name)}</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(($) => $.editor.props.name_placeholder)}
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t(($) => $.editor.props.description)}</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t(($) => $.editor.props.description_placeholder)}
          rows={2}
          className="resize-none text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t(($) => $.editor.props.tags)}</Label>
        <TagInput value={tags} onChange={setTags} suggestions={filterOpts?.tags ?? []} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t(($) => $.editor.props.namespace)}</Label>
        <NamespaceSelect value={namespace} onChange={setNamespace} />
        {mode === "edit" && (
          <p className="text-[11px] leading-4 text-muted-foreground">
            {t(($) => $.editor.props.namespace_hint_edit)}
          </p>
        )}
      </div>
    </div>
  )

  const rightPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="max-h-[45%] shrink-0 overflow-auto border-b border-border px-4 py-3">
        {propsForm}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center border-b border-border px-3 text-xs font-medium text-muted-foreground">
          {t(($) => $.editor.preview_title)}
        </div>
        <div className="min-h-0 flex-1">
          <EditorMarkdownPreview
            path={currentFile}
            content={currentFile ? (fileMap.files[currentFile] ?? "") : ""}
          />
        </div>
      </div>
      <PublishBar
        mode={mode}
        itemType={itemType}
        name={name}
        version={version}
        onVersionChange={setVersion}
        commitMsg={commitMsg}
        onCommitMsgChange={setCommitMsg}
        publishing={publishing}
        canPublish={canPublish}
        onPublish={() => void handlePublish()}
      />
    </div>
  )

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader className="gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-8 shrink-0 px-2"
          onClick={handleBack}
        >
          <ArrowLeft className="mr-1 size-4" />
          {t(($) => $.editor.back_to_manager)}
        </Button>
        <h1 className="truncate text-sm font-semibold">
          {mode === "create" ? t(($) => $.editor.title_create) : t(($) => $.editor.title_edit)}
        </h1>
        {mode === "edit" && name && (
          <span className="truncate text-sm text-muted-foreground">— {name}</span>
        )}
        {mode === "edit" && dirty && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {t(($) => $.editor.unsaved_badge)}
          </Badge>
        )}
        {isMobile && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => setTreeOpen(true)}
            >
              <FolderTree className="mr-1 size-3.5" />
              {t(($) => $.editor.open_tree)}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => setPropsOpen(true)}
            >
              <SlidersHorizontal className="mr-1 size-3.5" />
              {t(($) => $.editor.open_props)}
            </Button>
          </div>
        )}
      </PageHeader>

      {isMobile ? (
        <div className="min-h-0 flex-1">{editorPanel}</div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="editor-tree" defaultSize="18%" minSize="12%" maxSize="32%">
            {fileTreePanel}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="editor-main" defaultSize="50%" minSize="30%">
            {editorPanel}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="editor-props" defaultSize="32%" minSize="22%">
            {rightPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* Narrow-screen drawers (A8) */}
      <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
        <SheetContent side="left" className="w-80 p-0 data-[side=left]:w-80 data-[side=left]:sm:max-w-none">
          <SheetHeader className="sr-only">
            <SheetTitle>{t(($) => $.editor.open_tree)}</SheetTitle>
            <SheetDescription>{t(($) => $.editor.open_tree)}</SheetDescription>
          </SheetHeader>
          {fileTreePanel}
        </SheetContent>
      </Sheet>
      <Sheet open={propsOpen} onOpenChange={setPropsOpen}>
        <SheetContent side="right" className="w-80 p-0 data-[side=right]:w-80 data-[side=right]:sm:max-w-none">
          <SheetHeader className="sr-only">
            <SheetTitle>{t(($) => $.editor.open_props)}</SheetTitle>
            <SheetDescription>{t(($) => $.editor.open_props)}</SheetDescription>
          </SheetHeader>
          {rightPanel}
        </SheetContent>
      </Sheet>
    </div>
  )
}
