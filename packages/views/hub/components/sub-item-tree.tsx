"use client"

import { useState, useMemo } from "react"
import { ChevronRight, ChevronDown, Folder, File } from "lucide-react"

export interface VirtualTreeNode {
  path: string
  name: string
  kind: "file" | "directory"
  children?: VirtualTreeNode[]
}

interface SubItemTreeProps {
  nodes: VirtualTreeNode[]
  onSelect?: (path: string) => void
}

function TreeNode({
  node,
  depth,
  onSelect,
  expanded,
  onToggle,
}: {
  node: VirtualTreeNode
  depth: number
  onSelect?: (path: string) => void
  expanded: Record<string, boolean>
  onToggle: (path: string) => void
}) {
  const isDir = node.kind === "directory"
  const isExp = expanded[node.path] ?? true
  const pad = `${8 + depth * 12}px`

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (isDir) {
            onToggle(node.path)
          } else {
            onSelect?.(node.path)
          }
        }}
        className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] transition-colors hover:bg-muted/50"
        style={{ paddingLeft: pad }}
        title={node.name}
      >
        {isDir ? (
          <>
            <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
              {isExp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </span>
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{node.name}</span>
          </>
        ) : (
          <>
            <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
              <File className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{node.name}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </button>
      {isDir && isExp && node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SubItemTree({ nodes, onSelect }: SubItemTreeProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const expanded = useMemo(() => {
    const out: Record<string, boolean> = {}
    for (const [path, isCollapsed] of Object.entries(collapsed)) {
      out[path] = !isCollapsed
    }
    return out
  }, [collapsed])

  const toggle = (path: string) => {
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))
  }

  return (
    <div className="min-w-0">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          onSelect={onSelect}
          expanded={expanded}
          onToggle={toggle}
        />
      ))}
    </div>
  )
}
