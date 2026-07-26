"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@multica/ui/components/ui/dialog"
import { Button } from "@multica/ui/components/ui/button"
import { Input } from "@multica/ui/components/ui/input"
import { Label } from "@multica/ui/components/ui/label"
import { Textarea } from "@multica/ui/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select"
import { Badge } from "@multica/ui/components/ui/badge"
import { Avatar } from "@multica/ui/components/ui/avatar"
import type {
  CapabilityItem,
  DistributionTarget,
  HubDistributionDepartment,
  SearchedUser,
} from "@multica/core/types/hub"
import {
  flattenHubDistributionDepartments,
  useHubDistributionAuthority,
  useHubDistributeMutation,
  useHubEligibleUserSearch,
} from "@multica/core/hub"
import { useT } from "@multica/views/i18n"
import { toast } from "sonner"
import { Building2, Check, Plus, Send, UserRound, X } from "lucide-react"

const PERMISSION_MODES = ["readonly", "dismissible"] as const
type PermissionMode = (typeof PERMISSION_MODES)[number]

type Scope = "user" | "department"

export type DistributeDialogProps = {
  item: CapabilityItem
  onCreated: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Distribute an item to departments and/or eligible users (source store
 * semantics, design A2): user targets come from `hubSearchEligibleUsers`,
 * department targets from the caller's `hubMyDistributionAuthority`
 * departments (flat multi-select — no admin dept-tree interface). When the
 * authority reports no managed departments the dialog only offers the
 * "by user" scope.
 */
export function DistributeDialog(props: DistributeDialogProps) {
  const { t } = useT("hub")
  const { departments } = useHubDistributionAuthority()
  const { search } = useHubEligibleUserSearch()
  const distributeMutation = useHubDistributeMutation()

  const [scope, setScope] = useState<Scope>("user")
  const [permMode, setPermMode] = useState<PermissionMode>("readonly")
  const [message, setMessage] = useState("")
  // User scope: debounced search + multi-select chips.
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchedUser[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState<SearchedUser[]>([])
  // Department scope: flat multi-select over the managed department tree.
  const [selectedDepts, setSelectedDepts] = useState<HubDistributionDepartment[]>([])

  const flatDepts = useMemo(() => flattenHubDistributionDepartments(departments), [departments])
  const deptModeAvailable = flatDepts.length > 0

  // Reset all local state each time the dialog opens.
  useEffect(() => {
    if (!props.open) return
    setScope("user")
    setPermMode("readonly")
    setMessage("")
    setQuery("")
    setResults([])
    setSearching(false)
    setSelectedUsers([])
    setSelectedDepts([])
  }, [props.open])

  // Debounced eligible-user search; already-selected users are filtered out.
  useEffect(() => {
    if (scope !== "user") return
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    search(trimmed)
      .then((users) => {
        if (cancelled) return
        setResults(users.filter((u) => !selectedUsers.some((s) => s.id === u.id)))
      })
      .catch((err) => {
        if (cancelled) return
        setResults([])
        toast.error(t(($) => $.dialog.distribute.error_failed), {
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope, search])

  function addUser(user: SearchedUser) {
    setSelectedUsers((prev) => (prev.some((u) => u.id === user.id) ? prev : [...prev, user]))
    setResults((prev) => prev.filter((u) => u.id !== user.id))
    setQuery("")
  }

  function removeUser(userId: string) {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId))
  }

  function toggleDept(dept: HubDistributionDepartment) {
    setSelectedDepts((prev) =>
      prev.some((d) => d.deptId === dept.deptId)
        ? prev.filter((d) => d.deptId !== dept.deptId)
        : [...prev, dept],
    )
  }

  const targetCount = scope === "user" ? selectedUsers.length : selectedDepts.length
  const submitting = distributeMutation.isPending

  function handleSubmit() {
    if (targetCount === 0) {
      toast.error(t(($) => $.dialog.distribute.error_no_target))
      return
    }
    const targets: DistributionTarget[] =
      scope === "user"
        ? selectedUsers.map((u) => ({ scopeType: "user", targetId: u.id }))
        : selectedDepts.map((d) => ({ scopeType: "department", targetId: d.deptId }))
    distributeMutation.mutate(
      {
        id: props.item.id,
        data: {
          targets,
          permissionMode: permMode,
          message: message.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $.dialog.distribute.success))
          props.onCreated()
          props.onOpenChange(false)
        },
        onError: (err) => {
          toast.error(t(($) => $.dialog.distribute.error_failed), {
            description: err instanceof Error ? err.message : String(err),
          })
        },
      },
    )
  }

  return (
    <Dialog open={props.open} onOpenChange={(v) => { if (!submitting) props.onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4" />
            {t(($) => $.dialog.distribute.title)}
          </DialogTitle>
          <DialogDescription>
            {t(($) => $.dialog.distribute.subtitle, { name: props.item.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-3">
          {/* Scope switch — only when the caller manages departments (A2) */}
          {deptModeAvailable && (
            <div className="space-y-1.5">
              <Label>{t(($) => $.dialog.distribute.scope_label)}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={scope === "user" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setScope("user")}
                >
                  <UserRound className="size-4" />
                  {t(($) => $.dialog.distribute.scope_user)}
                </Button>
                <Button
                  type="button"
                  variant={scope === "department" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setScope("department")}
                >
                  <Building2 className="size-4" />
                  {t(($) => $.dialog.distribute.scope_department)}
                </Button>
              </div>
            </div>
          )}

          {/* User scope: search + multi-select */}
          {scope === "user" && (
            <div className="space-y-1.5">
              <Label>{t(($) => $.dialog.distribute.user_search_label)}</Label>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(($) => $.dialog.distribute.user_search_placeholder)}
              />
              {searching && (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  {t(($) => $.dialog.distribute.submitting)}
                </p>
              )}
              {!searching && results.length > 0 && (
                <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                  {results.map((user) => (
                    <li key={user.id}>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-muted/50"
                        onClick={() => addUser(user)}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar className="size-7 shrink-0 overflow-hidden rounded-full bg-muted">
                            {user.avatarUrl ? (
                              <img src={user.avatarUrl} alt="" className="size-full object-cover" />
                            ) : (
                              <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
                                {(user.displayName || user.name || user.id).slice(0, 1).toUpperCase()}
                              </span>
                            )}
                          </Avatar>
                          <span className="truncate text-sm">
                            {user.displayName || user.name}
                          </span>
                        </span>
                        <Plus className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!searching && query.trim() && results.length === 0 && (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  {t(($) => $.dialog.distribute.user_search_empty)}
                </p>
              )}
            </div>
          )}

          {/* Department scope: flat multi-select over managed departments */}
          {scope === "department" && (
            <div className="space-y-1.5">
              <Label>{t(($) => $.dialog.distribute.dept_label)}</Label>
              {flatDepts.length === 0 ? (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  {t(($) => $.dialog.distribute.dept_empty)}
                </p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
                  {flatDepts.map(({ dept, depth }) => {
                    const active = selectedDepts.some((d) => d.deptId === dept.deptId)
                    return (
                      <li key={dept.deptId}>
                        <button
                          type="button"
                          className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                            active ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                          }`}
                          style={{ paddingLeft: `${depth * 16 + 10}px` }}
                          onClick={() => toggleDept(dept)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Building2 className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate text-sm">{dept.deptName}</span>
                          </span>
                          {active && <Check className="size-4 shrink-0" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Selected targets */}
          {targetCount > 0 && (
            <div className="space-y-1.5">
              <Label>{t(($) => $.dialog.distribute.selected_label)}</Label>
              <div className="flex flex-wrap gap-1.5">
                {scope === "user"
                  ? selectedUsers.map((u) => (
                      <Badge key={u.id} variant="secondary" className="gap-1">
                        <UserRound className="size-3" />
                        {u.displayName || u.name}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="ml-0.5 size-4 p-0 hover:bg-transparent"
                          onClick={() => removeUser(u.id)}
                        >
                          <X className="size-3" />
                        </Button>
                      </Badge>
                    ))
                  : selectedDepts.map((d) => (
                      <Badge key={d.deptId} variant="secondary" className="gap-1">
                        <Building2 className="size-3" />
                        {d.deptName}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="ml-0.5 size-4 p-0 hover:bg-transparent"
                          onClick={() => toggleDept(d)}
                        >
                          <X className="size-3" />
                        </Button>
                      </Badge>
                    ))}
              </div>
            </div>
          )}

          {/* Permission mode */}
          <div className="space-y-1.5">
            <Label>{t(($) => $.dialog.distribute.permission_label)}</Label>
            <Select value={permMode} onValueChange={(v) => setPermMode(v as PermissionMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(($) => $.dialog.distribute.permission[mode])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label>{t(($) => $.dialog.distribute.message_label)}</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t(($) => $.dialog.distribute.message_placeholder)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={submitting}
          >
            {t(($) => $.dialog.cancel)}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || targetCount === 0}>
            {submitting
              ? t(($) => $.dialog.distribute.submitting)
              : t(($) => $.dialog.distribute.submit)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
