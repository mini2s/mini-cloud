"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useT } from "@multica/views/i18n"
import {
  useHubMyRepos,
  useHubRepoMembers,
  useHubDeleteRepoMutation,
  useHubRemoveRepoMemberMutation,
} from "@multica/core/hub"
import type { RepoMember, Repository } from "@multica/core/types/hub"
import { CreateRepoDialog } from "./create-repo-dialog"
import { EditRepoDialog } from "./edit-repo-dialog"
import { InviteDialog } from "./invite-dialog"
import { ConfirmDialog } from "./confirm-dialog"
import { RepoSyncPanel } from "./repo-sync-panel"
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  Lock,
  Pencil,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react"

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ── Member list (expanded row region) ────────────────────────────────────

function RepoMembersPanel({ repo }: { repo: Repository }) {
  const { t } = useT("hub")
  const { members, isLoading } = useHubRepoMembers(repo.id)
  const removeMutation = useHubRemoveRepoMemberMutation()

  async function handleRemove(member: RepoMember) {
    try {
      await removeMutation.mutateAsync({ repoId: repo.id, userId: member.userId })
      toast.success(t(($) => $.repo.member_removed))
    } catch (err) {
      toast.error(t(($) => $.repo.remove_member_failed), { description: errMsg(err) })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t(($) => $.repo.members_loading)}
      </div>
    )
  }

  if (members.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">{t(($) => $.repo.members_empty)}</p>
    )
  }

  return (
    <ul className="space-y-1 py-1">
      {members.map((member) => {
        const isOwner = member.role === "owner"
        const removing =
          removeMutation.isPending && removeMutation.variables?.userId === member.userId
        return (
          <li key={member.id} className="flex items-center gap-2 text-sm">
            <span className="font-medium text-foreground">{member.username}</span>
            <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {t(($) =>
                member.role === "owner"
                  ? $.repo.role_owner
                  : member.role === "admin"
                    ? $.repo.role_admin
                    : $.repo.role_member,
              )}
            </span>
            {!isOwner && (
              <button
                type="button"
                className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                disabled={removing}
                onClick={() => handleRemove(member)}
              >
                {removing ? <Loader2 className="size-3 animate-spin" /> : t(($) => $.repo.remove_member)}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── Single repo row ──────────────────────────────────────────────────────

function RepoRow(props: {
  repo: Repository
  onEdit: (repo: Repository) => void
  onDelete: (repo: Repository) => void
  onInvite: (repo: Repository) => void
}) {
  const { t } = useT("hub")
  const { repo } = props
  const [expanded, setExpanded] = useState(false)
  // Members are fetched per row so the count column and the expanded panel
  // share one cached query — removing a member updates both via the
  // core/hub invalidation on hubKeys.repoMembers(repo.id).
  const { members, isLoading: membersLoading } = useHubRepoMembers(repo.id)

  const isPublic = repo.visibility === "public"
  const isSync = repo.repoType === "sync"

  return (
    <>
      <tr className="border-b border-border/50 transition-colors hover:bg-muted/20">
        <td className="px-4 py-3">
          <div className="font-medium text-foreground">{repo.displayName || repo.name}</div>
          {repo.description && (
            <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {repo.description}
            </div>
          )}
        </td>
        <td className="w-28 px-4 py-3">
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {isPublic ? <Globe size={11} /> : <Lock size={11} />}
            {t(($) => (isPublic ? $.repo.visibility_public : $.repo.visibility_private))}
          </span>
        </td>
        <td className="w-24 px-4 py-3">
          <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t(($) => (isSync ? $.repo.type_sync : $.repo.type_normal))}
          </span>
        </td>
        <td className="w-28 px-4 py-3 text-muted-foreground">
          {membersLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            t(($) => $.repo.members, { count: members.length })
          )}
        </td>
        <td className="w-52 px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setExpanded((v) => !v)}
              title={t(($) => (expanded ? $.repo.hide_members : $.repo.show_members))}
            >
              {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => props.onInvite(repo)}
              title={t(($) => $.repo.invite_member)}
            >
              <UserPlus size={15} />
            </button>
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => props.onEdit(repo)}
              title={t(($) => $.repo.edit)}
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
              onClick={() => props.onDelete(repo)}
              title={t(($) => $.repo.delete)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/50">
          <td colSpan={5} className="bg-muted/20 px-6 py-2">
            {/* FR-04: sync-type repos surface status/trigger/logs above the member list */}
            {isSync && <RepoSyncPanel repo={repo} />}
            <RepoMembersPanel repo={repo} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Repo list (我的仓库 tab content) ─────────────────────────────────────

export function HubRepoList() {
  const { t } = useT("hub")
  const { repos, isLoading } = useHubMyRepos()
  const deleteMutation = useHubDeleteRepoMutation()

  const [editing, setEditing] = useState<Repository | null>(null)
  const [inviting, setInviting] = useState<Repository | null>(null)
  const [deleting, setDeleting] = useState<Repository | null>(null)

  return (
    <div className="mx-auto w-full max-w-5xl">
      {/* Header row: caption + create entry (M-10) */}
      <div className="flex items-center justify-between py-3">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users size={14} />
          {t(($) => $.repo.my_repos)} · {repos.length}
        </p>
        <CreateRepoDialog onCreated={() => {}} />
      </div>

      {isLoading && repos.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : repos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="mb-1 text-[15px] font-medium text-muted-foreground">
            {t(($) => $.repo.empty)}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 font-semibold text-foreground">
                  {t(($) => $.manager.colName)}
                </th>
                <th className="w-28 px-4 py-3 font-semibold text-foreground">
                  {t(($) => $.repo.col_visibility)}
                </th>
                <th className="w-24 px-4 py-3 font-semibold text-foreground">
                  {t(($) => $.repo.col_repo_type)}
                </th>
                <th className="w-28 px-4 py-3 font-semibold text-foreground">
                  {t(($) => $.repo.col_members)}
                </th>
                <th className="w-52 px-4 py-3 text-right font-semibold text-foreground">
                  {t(($) => $.repo.col_actions)}
                </th>
              </tr>
            </thead>
            <tbody>
              {repos.map((repo) => (
                <RepoRow
                  key={repo.id}
                  repo={repo}
                  onEdit={setEditing}
                  onDelete={setDeleting}
                  onInvite={setInviting}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit dialog — keyed so switching repos resets the form state */}
      {editing && (
        <EditRepoDialog
          key={editing.id}
          repo={editing}
          open={editing != null}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onUpdated={() => setEditing(null)}
        />
      )}

      {/* Invite dialog */}
      {inviting && (
        <InviteDialog
          repoId={inviting.id}
          open={inviting != null}
          onOpenChange={(open) => {
            if (!open) setInviting(null)
          }}
          onInvited={() => {}}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t(($) => $.repo.delete_title)}
        description={t(($) => $.repo.delete_confirm, {
          name: deleting?.displayName || deleting?.name || "",
        })}
        confirmLabel={t(($) => $.repo.delete)}
        variant="danger"
        onConfirm={async () => {
          if (!deleting) return
          try {
            await deleteMutation.mutateAsync(deleting.id)
            toast.success(t(($) => $.repo.deleted_toast))
            setDeleting(null)
          } catch (err) {
            toast.error(t(($) => $.repo.delete_failed), { description: errMsg(err) })
            throw err
          }
        }}
      />
    </div>
  )
}

export default HubRepoList
