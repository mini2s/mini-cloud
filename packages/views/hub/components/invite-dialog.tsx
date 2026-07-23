"use client"

import { useState, useRef, useEffect } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select"
import { Avatar } from "@multica/ui/components/ui/avatar"
import { Badge } from "@multica/ui/components/ui/badge"
import { api } from "@multica/core/api"
import type { SearchedUser } from "@multica/core/types/hub"
import { useT } from "@multica/views/i18n"
import { toast } from "sonner"
import { Search, UserPlus, Loader2 } from "lucide-react"

const ROLE_OPTS = [
  { value: "admin", label: "hub.invite.role.admin" },
  { value: "member", label: "hub.invite.role.member" },
  { value: "viewer", label: "hub.invite.role.viewer" },
] as const

export type InviteDialogProps = {
  repoId: string
  onInvited: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InviteDialog(props: InviteDialogProps) {
  const { t } = useT("hub")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchedUser[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SearchedUser | null>(null)
  const [role, setRole] = useState("member")
  const [submitting, setSubmitting] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    return () => clearTimeout(timer.current)
  }, [])

  function doSearch(q: string) {
    clearTimeout(timer.current)
    const trimmed = q.trim()
    if (!trimmed) {
      setResults([])
      return
    }
    timer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const users = await api.hubSearchUsers(trimmed)
        setResults(users)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(t(($) => $.invite.search_failed), { description: msg })
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  async function handle() {
    if (!selected) return
    setSubmitting(true)
    try {
      await api.hubInviteRepoMember(props.repoId, {
        inviteeId: selected.id,
        inviteeUsername: selected.name,
        role,
      })
      toast.success(
        t(($) => $.invite.success, { name: selected.displayName || selected.name }),
      )
      props.onInvited()
      props.onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t(($) => $.invite.failed), { description: msg })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(v) => { if (!submitting) props.onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-4" />
            {t(($) => $.invite.title)}
          </DialogTitle>
          <DialogDescription>
            {t(($) => $.invite.subtitle)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {/* Search */}
          <div className="space-y-1.5">
            <Label>{t(($) => $.invite.search_label)}</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-8"
                placeholder={t(($) => $.invite.search_placeholder)}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  doSearch(e.target.value)
                  setSelected(null)
                }}
              />
            </div>
          </div>

          {/* Search results */}
          <div className="max-h-[200px] space-y-1 overflow-y-auto rounded-md border p-1">
            {searching && (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t(($) => $.invite.searching)}
              </div>
            )}
            {!searching && query.trim() && results.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t(($) => $.invite.no_results)}
              </div>
            )}
            {!searching &&
              results.map((user) => {
                const active = selected?.id === user.id
                return (
                  <button
                    key={user.id}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent ${
                      active ? "bg-accent" : ""
                    }`}
                    onClick={() => setSelected(active ? null : user)}
                  >
                    <Avatar className="size-8 shrink-0 overflow-hidden rounded-full bg-muted">
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center text-xs font-medium text-muted-foreground">
                          {(user.displayName || user.name).charAt(0).toUpperCase()}
                        </span>
                      )}
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {user.displayName || user.name}
                      </div>
                      {user.displayName && user.name !== user.displayName && (
                        <div className="truncate text-xs text-muted-foreground">
                          @{user.name}
                        </div>
                      )}
                    </div>
                    {active && (
                      <Badge variant="secondary" className="shrink-0">
                        {t(($) => $.invite.selected)}
                      </Badge>
                    )}
                  </button>
                )
              })}
            {!searching && !query.trim() && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t(($) => $.invite.type_to_search)}
              </div>
            )}
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <Label>{t(($) => $.invite.role_label)}</Label>
            <Select value={role} onValueChange={(v) => { if (v) setRole(v); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(($) => ($ as any).invite.role[opt.value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <Button
            onClick={handle}
            disabled={submitting || !selected}
          >
            {submitting
              ? t(($) => $.invite.inviting)
              : t(($) => $.invite.invite)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default InviteDialog
