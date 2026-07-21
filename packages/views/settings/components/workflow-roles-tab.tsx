"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, ShieldCheck, Trash2, UserRoundCog, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { memberListOptions } from "@multica/core/workspace/queries";
import { useCreateWorkflowRole, useDeleteWorkflowRole, useUpdateWorkflowRole, workflowRolesOptions } from "@multica/core/workflows/queries";
import type { WorkflowRole } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@multica/ui/components/ui/alert-dialog";
import { useT } from "../../i18n";

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 2000;

// Built-in roles are seeded with English identifiers as the underlying name,
// but the UI renders them through i18n. Validation must reject collisions on
// both surfaces — otherwise a user typing "Developer" gets a confusing 409
// from the backend while the list shows the localized name (e.g. "研发"),
// and a user typing the localized name silently creates a visual duplicate.
const BUILTIN_ROLE_IDENTIFIERS = ["developer", "qa", "tech_lead"];

export function WorkflowRolesTab() {
  const { t } = useT("settings");
  // Built-in role labels live under the workflows namespace (shared with the
  // node config panel) so the localized names stay consistent across surfaces.
  const { t: tWf } = useT("workflows");
  const wsId = useWorkspaceId();
  const user = useAuthStore((state) => state.user);
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: roles = [], isLoading } = useQuery(workflowRolesOptions(wsId));
  const createRole = useCreateWorkflowRole(wsId);
  const updateRole = useUpdateWorkflowRole(wsId);
  const deleteRole = useDeleteWorkflowRole(wsId);
  const currentMember = members.find((member) => member.user_id === user?.id);
  const canManage = currentMember?.role === "owner" || currentMember?.role === "admin";

  // Create form state — always creating. The form never switches into edit
  // mode; edits happen inline on the row itself.
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  // Inline edit state — populated when a row's pencil is clicked. While set,
  // that row swaps from display mode to an editable form.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<WorkflowRole | null>(null);

  const sortedRoles = useMemo(
    () => [...roles].sort((a, b) => Number(b.is_builtin) - Number(a.is_builtin) || a.name.localeCompare(b.name)),
    [roles],
  );

  // Lowercased trimmed builtin display names — recomputed per render is cheap
  // (three entries) and stays in sync with the current locale.
  const builtinDisplayNamesLower = BUILTIN_ROLE_IDENTIFIERS.map((key) => {
    if (key === "developer") return tWf(($) => $.builtin_roles.developer.name).trim().toLowerCase();
    if (key === "qa") return tWf(($) => $.builtin_roles.qa.name).trim().toLowerCase();
    return tWf(($) => $.builtin_roles.tech_lead.name).trim().toLowerCase();
  });

  // Returns the kind of conflict: "builtin" (collides with a built-in role's
  // English identifier or localized display name), a matching custom role
  // (so the message can name it), or null when the name is free to use.
  // excludeRoleId lets an inline-edit submit keep its own current name.
  const findNameConflict = (input: string, excludeRoleId?: string | null): "builtin" | WorkflowRole | null => {
    const n = input.trim().toLowerCase();
    if (!n) return null;
    for (const role of roles) {
      if (excludeRoleId && role.id === excludeRoleId) continue;
      if (role.name.trim().toLowerCase() === n) {
        return role.is_builtin ? "builtin" : role;
      }
    }
    if (BUILTIN_ROLE_IDENTIFIERS.some((id) => id.toLowerCase() === n)) return "builtin";
    if (builtinDisplayNamesLower.some((d) => d === n)) return "builtin";
    return null;
  };

  const buildErrors = (rawName: string, rawDescription: string, excludeRoleId?: string | null) => {
    const name = rawName.trim();
    const description = rawDescription.trim();
    let nameError = name.length === 0
      ? t(($) => $.workflow_roles.name_required)
      : name.length > MAX_NAME_LENGTH
        ? t(($) => $.workflow_roles.name_too_long, { max: MAX_NAME_LENGTH })
        : "";
    if (!nameError) {
      const conflict = findNameConflict(name, excludeRoleId);
      if (conflict === "builtin") {
        nameError = t(($) => $.workflow_roles.name_duplicate_builtin);
      } else if (conflict) {
        nameError = t(($) => $.workflow_roles.name_duplicate);
      }
    }
    const descriptionError = description.length === 0
      ? t(($) => $.workflow_roles.description_required)
      : description.length > MAX_DESCRIPTION_LENGTH
        ? t(($) => $.workflow_roles.description_too_long, { max: MAX_DESCRIPTION_LENGTH })
        : "";
    return { name, description, nameError, descriptionError };
  };

  const createCheck = buildErrors(newName, newDescription);
  const editCheck = buildErrors(editName, editDescription, editingId);
  const canCreate = canManage && !createCheck.nameError && !createCheck.descriptionError && !createRole.isPending;
  const canSaveEdit = canManage && !editCheck.nameError && !editCheck.descriptionError && !updateRole.isPending;

  // Built-in role labels live under the workflows namespace (shared with the
  // node config panel) so localized names stay consistent across surfaces.
  // Falls back to the raw name/description for custom roles.
  const renderRoleName = (role: WorkflowRole) => {
    if (!role.is_builtin) return role.name;
    if (role.name === "developer") return tWf(($) => $.builtin_roles.developer.name);
    if (role.name === "qa") return tWf(($) => $.builtin_roles.qa.name);
    if (role.name === "tech_lead") return tWf(($) => $.builtin_roles.tech_lead.name);
    return role.name;
  };
  const renderRoleDescription = (role: WorkflowRole) => {
    if (!role.is_builtin) return role.description;
    if (role.name === "developer") return tWf(($) => $.builtin_roles.developer.description);
    if (role.name === "qa") return tWf(($) => $.builtin_roles.qa.description);
    if (role.name === "tech_lead") return tWf(($) => $.builtin_roles.tech_lead.description);
    return role.description;
  };

  const submitCreate = async () => {
    if (!canCreate) return;
    try {
      await createRole.mutateAsync({ name: createCheck.name, description: createCheck.description });
      toast.success(t(($) => $.workflow_roles.toast_created));
      setNewName("");
      setNewDescription("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.workflow_roles.toast_save_failed));
    }
  };
  const beginInlineEdit = (role: WorkflowRole) => {
    setEditingId(role.id);
    setEditName(role.name);
    setEditDescription(role.description);
  };
  const cancelInlineEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
  };
  const submitInlineEdit = async () => {
    if (!editingId || !canSaveEdit) return;
    try {
      await updateRole.mutateAsync({ roleId: editingId, name: editCheck.name, description: editCheck.description });
      toast.success(t(($) => $.workflow_roles.toast_updated));
      cancelInlineEdit();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.workflow_roles.toast_save_failed));
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteRole.mutateAsync(deleteTarget.id);
      toast.success(t(($) => $.workflow_roles.toast_deleted));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.workflow_roles.toast_delete_failed));
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <UserRoundCog className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{t(($) => $.workflow_roles.title)}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t(($) => $.workflow_roles.description)}</p>
        {!canManage ? <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{t(($) => $.workflow_roles.read_only)}</p> : null}
      </section>

      {canManage ? (
        <section className="space-y-4 rounded-xl border p-4">
          <h3 className="text-sm font-medium">{t(($) => $.workflow_roles.create_title)}</h3>
          <div className="space-y-1.5">
            <Label htmlFor="workflow-role-name">{t(($) => $.workflow_roles.name_label)}</Label>
            <Input id="workflow-role-name" value={newName} maxLength={MAX_NAME_LENGTH + 1} onChange={(event) => setNewName(event.target.value)} placeholder={t(($) => $.workflow_roles.name_placeholder)} />
            <div className="flex justify-between gap-3 text-[11px]"><span className="text-destructive">{newName ? createCheck.nameError : ""}</span><span className="text-muted-foreground">{newName.length}/{MAX_NAME_LENGTH}</span></div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workflow-role-description">{t(($) => $.workflow_roles.description_label)}</Label>
            <Textarea id="workflow-role-description" value={newDescription} maxLength={MAX_DESCRIPTION_LENGTH + 1} onChange={(event) => setNewDescription(event.target.value)} placeholder={t(($) => $.workflow_roles.description_placeholder)} rows={5} />
            <div className="flex justify-between gap-3 text-[11px]"><span className="text-destructive">{newDescription ? createCheck.descriptionError : ""}</span><span className="text-muted-foreground">{newDescription.length}/{MAX_DESCRIPTION_LENGTH}</span></div>
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={!canCreate} onClick={() => void submitCreate()}>
              <Plus className="mr-1 size-3.5" />
              {t(($) => $.workflow_roles.create)}
            </Button>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">{t(($) => $.workflow_roles.loading)}</p>
        ) : sortedRoles.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t(($) => $.workflow_roles.empty)}</p>
        ) : sortedRoles.map((role, index) => {
          const deleteDisabled = role.is_builtin || role.is_referenced;
          const deleteReason = role.is_builtin
            ? t(($) => $.workflow_roles.builtin_read_only)
            : role.is_referenced ? t(($) => $.workflow_roles.referenced_cannot_delete) : undefined;
          const dividerClass = index > 0 ? "border-t" : "";
          const isEditing = editingId === role.id;
          return (
            <article key={role.id} className={dividerClass}>
              {isEditing ? (
                <div className="space-y-3 p-4">
                  <div className="space-y-1.5">
                    <Label htmlFor={`workflow-role-edit-name-${role.id}`}>{t(($) => $.workflow_roles.name_label)}</Label>
                    <Input id={`workflow-role-edit-name-${role.id}`} value={editName} maxLength={MAX_NAME_LENGTH + 1} onChange={(event) => setEditName(event.target.value)} />
                    <div className="flex justify-between gap-3 text-[11px]"><span className="text-destructive">{editName ? editCheck.nameError : ""}</span><span className="text-muted-foreground">{editName.length}/{MAX_NAME_LENGTH}</span></div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`workflow-role-edit-description-${role.id}`}>{t(($) => $.workflow_roles.description_label)}</Label>
                    <Textarea id={`workflow-role-edit-description-${role.id}`} value={editDescription} maxLength={MAX_DESCRIPTION_LENGTH + 1} onChange={(event) => setEditDescription(event.target.value)} rows={5} />
                    <div className="flex justify-between gap-3 text-[11px]"><span className="text-destructive">{editDescription ? editCheck.descriptionError : ""}</span><span className="text-muted-foreground">{editDescription.length}/{MAX_DESCRIPTION_LENGTH}</span></div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={cancelInlineEdit}><X className="mr-1 size-3.5" />{t(($) => $.workflow_roles.cancel)}</Button>
                    <Button type="button" size="sm" disabled={!canSaveEdit} onClick={() => void submitInlineEdit()}>
                      <Pencil className="mr-1 size-3.5" />
                      {t(($) => $.workflow_roles.update)}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-4">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    {role.is_builtin ? <ShieldCheck className="size-4" /> : <UserRoundCog className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{renderRoleName(role)}</h3>
                      {role.is_builtin ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t(($) => $.workflow_roles.builtin)}</span> : null}
                      {role.needs_description ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{t(($) => $.workflow_roles.needs_description)}</span> : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{role.is_builtin ? renderRoleDescription(role) : (role.description || t(($) => $.workflow_roles.no_description))}</p>
                    {deleteReason ? <p className="mt-1 text-[11px] text-muted-foreground">{deleteReason}</p> : null}
                  </div>
                  {canManage && !role.is_builtin ? (
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => beginInlineEdit(role)}><Pencil className="size-3.5" /><span className="sr-only">{t(($) => $.workflow_roles.edit)}</span></Button>
                      <Button type="button" variant="ghost" size="icon-sm" disabled={deleteDisabled} title={deleteReason} onClick={() => setDeleteTarget(role)}><Trash2 className="size-3.5" /><span className="sr-only">{t(($) => $.workflow_roles.delete)}</span></Button>
                    </div>
                  ) : null}
                </div>
              )}
            </article>
          );
        })}
      </section>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.workflow_roles.delete_title)}</AlertDialogTitle>
            <AlertDialogDescription>{t(($) => $.workflow_roles.delete_description, { name: deleteTarget?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.workflow_roles.cancel)}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>{t(($) => $.workflow_roles.delete)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
