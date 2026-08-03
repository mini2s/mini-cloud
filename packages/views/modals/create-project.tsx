"use client";

import { useState, useRef } from "react";
import { ChevronRight, Maximize2, Minimize2, X as XIcon, UserMinus, GitBranch } from "lucide-react";

// Repo host icon: GitHub mark for github.com, generic git icon (lucide
// GitBranch) for everything else — GitLab/Gitea/etc. lucide v1 dropped
// brand icons, so we inline the Octicon-style GitHub mark and fall back to
// GitBranch for non-GitHub hosts.
function RepoIcon({ url, className }: { url?: string; className?: string }) {
  const isGithub = !!url && /(^|\.)github\.com(:|\/|$)/i.test(url);
  if (isGithub) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
        <path d="M12 .5C5.73.5.66 5.57.66 11.84c0 5.01 3.25 9.26 7.76 10.76.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.13-3.16.69-3.83-1.34-3.83-1.34-.52-1.31-1.27-1.66-1.27-1.66-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.52-.29-5.18-1.26-5.18-5.62 0-1.24.45-2.26 1.18-3.06-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.17a10.93 10.93 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.57.23 2.73.11 3.02.74.8 1.18 1.82 1.18 3.06 0 4.37-2.67 5.32-5.21 5.61.41.35.78 1.04.78 2.1 0 1.52-.01 2.74-.01 3.11 0 .3.21.66.79.55 4.51-1.5 7.76-5.75 7.76-10.76C23.34 5.57 18.27.5 12 .5Z" />
      </svg>
    );
  }
  return <GitBranch className={className} aria-hidden="true" />;
}
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCreateProject } from "@multica/core/projects/mutations";
import { api } from "@multica/core/api";
import { isValidGitRepoURL } from "@multica/core/repo-url";
import { useProjectDraftStore } from "@multica/core/projects";
import {
  PROJECT_STATUS_CONFIG,
  PROJECT_STATUS_ORDER,
  PROJECT_PRIORITY_ORDER,
} from "@multica/core/projects/config";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
import { memberListOptions, workspaceKeys } from "@multica/core/workspace/queries";
import { isActiveWorkspaceMember } from "@multica/core/workspace/members";
import { useActorName } from "@multica/core/workspace/hooks";
import type { ProjectStatus, ProjectPriority, Workspace } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@multica/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@multica/ui/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@multica/ui/components/ui/tooltip";
import { Button } from "@multica/ui/components/ui/button";
import { EmojiPicker } from "@multica/ui/components/common/emoji-picker";
import { ContentEditor, type ContentEditorRef, TitleEditor } from "../editor";
import { PriorityIcon } from "../issues/components/priority-icon";
import { ActorAvatar } from "../common/actor-avatar";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { matchesPinyin } from "../editor/extensions/pinyin-match";
import {
  useProjectStatusLabels,
  useProjectPriorityLabels,
} from "../projects/components/labels";

function PillButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        "hover:bg-accent/60 transition-colors cursor-pointer",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function RepoUrlText({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            title={url}
            className={cn("truncate flex-1 text-left", className)}
          >
            {url}
          </span>
        }
      />
      <TooltipContent side="top" align="start" className="max-w-sm break-all">
        {url}
      </TooltipContent>
    </Tooltip>
  );
}

export function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const { t } = useT("modals");
  const router = useNavigation();
  const workspace = useCurrentWorkspace();
  const workspaceName = workspace?.name;
  const wsPaths = useWorkspacePaths();
  const wsId = useWorkspaceId();
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { getActorName } = useActorName();
  const projectStatusLabels = useProjectStatusLabels();
  const projectPriorityLabels = useProjectPriorityLabels();

  const draft = useProjectDraftStore((s) => s.draft);
  const setDraft = useProjectDraftStore((s) => s.setDraft);
  const clearDraft = useProjectDraftStore((s) => s.clearDraft);

  const [title, setTitle] = useState(draft.title);
  const descEditorRef = useRef<ContentEditorRef>(null);
  const [status, setStatus] = useState<ProjectStatus>(draft.status);
  const [priority, setPriority] = useState<ProjectPriority>(draft.priority);
  const [leadType, setLeadType] = useState<"member" | undefined>(
    draft.leadType === "member" ? draft.leadType : undefined,
  );
  const [leadId, setLeadId] = useState<string | undefined>(
    draft.leadType === "member" ? draft.leadId : undefined,
  );
  const [icon, setIcon] = useState<string | undefined>(draft.icon);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  // Repos selected to attach as github_repo resources after the project is
  // created. Stored as URLs (not full ProjectResource rows) — they're not
  // persisted until handleSubmit fires the createProjectResource calls.
  const [selectedRepos, setSelectedRepos] = useState<string[]>(draft.repos ?? []);
  const [repoComboboxOpen, setRepoComboboxOpen] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");
  const workspaceRepos = workspace?.repos ?? [];
  const filteredRepos = workspaceRepos.filter((r) =>
    r.url.toLowerCase().includes(repoQuery.trim().toLowerCase()),
  );

  // Sync field changes to draft store
  const updateTitle = (v: string) => { setTitle(v); setDraft({ title: v }); };
  const updateStatus = (v: ProjectStatus) => { setStatus(v); setDraft({ status: v }); };
  const updatePriority = (v: ProjectPriority) => { setPriority(v); setDraft({ priority: v }); };
  const updateLead = (type?: "member", id?: string) => {
    setLeadType(type); setLeadId(id);
    setDraft({ leadType: type, leadId: id });
  };
  const updateIcon = (v: string | undefined) => { setIcon(v); setDraft({ icon: v }); };

  const [leadOpen, setLeadOpen] = useState(false);
  const [leadFilter, setLeadFilter] = useState("");

  const leadQuery = leadFilter.toLowerCase();
  const filteredMembers = members.filter((m) => isActiveWorkspaceMember(m) && (m.name.toLowerCase().includes(leadQuery) || matchesPinyin(m.name, leadQuery)));

  const leadLabel =
    leadType && leadId ? getActorName(leadType, leadId) : t(($) => $.create_project.lead);

  const qc = useQueryClient();
  const createProject = useCreateProject();

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const project = await createProject.mutateAsync({
        title: title.trim(),
        description: descEditorRef.current?.getMarkdown()?.trim() || undefined,
        icon,
        status,
        priority,
        lead_type: leadType,
        lead_id: leadId,
        // Server attaches these in the same transaction as the project.
        resources:
          selectedRepos.length > 0
            ? selectedRepos.map((url) => ({
                resource_type: "github_repo" as const,
                resource_ref: { url },
              }))
            : undefined,
      });
      clearDraft();
      onClose();
      toast.success(t(($) => $.create_project.toast_created));
      router.push(wsPaths.projectDetail(project.id));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.create_project.toast_failed),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRepo = (url: string) => {
    setSelectedRepos((prev) => {
      const next = prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url];
      setDraft({ repos: next });
      return next;
    });
  };

  const addCustomRepo = async (url: string) => {
    url = url.trim();
    if (!url) return;
    setSelectedRepos((prev) => {
      const next = prev.includes(url) ? prev : [...prev, url];
      setDraft({ repos: next });
      return next;
    });
    // Register the URL at the workspace level too, so it shows up in
    // Settings → Repositories and is reusable by other projects.
    if (workspace && !workspace.repos.some((r) => r.url === url)) {
      try {
        const updated = await api.updateWorkspace(workspace.id, {
          repos: [...workspace.repos, { url }],
        });
        qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
          old?.map((ws) => (ws.id === updated.id ? updated : ws)),
        );
      } catch {
        // best-effort: project attach already recorded in local state
      }
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "p-0 gap-0 flex flex-col overflow-hidden",
          "!top-1/2 !left-1/2 !-translate-x-1/2",
          "!transition-all !duration-300 !ease-out",
          isExpanded
            ? "!max-w-4xl !w-full !h-5/6 !-translate-y-1/2"
            : "!max-w-2xl !w-full !h-96 !-translate-y-1/2",
        )}
      >
        <DialogTitle className="sr-only">{t(($) => $.create_project.title)}</DialogTitle>

        <div className="flex items-center justify-between px-5 pt-3 pb-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{workspaceName}</span>
            <ChevronRight className="size-3 text-muted-foreground/50" />
            <span className="font-medium">{t(($) => $.create_project.title_breadcrumb)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="rounded-sm p-1.5 opacity-70 hover:opacity-100 hover:bg-accent/60 transition-all cursor-pointer"
                  >
                    {isExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                  </button>
                }
              />
              <TooltipContent side="bottom">
                {isExpanded
                  ? t(($) => $.common.collapse_tooltip)
                  : t(($) => $.common.expand_tooltip)}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={onClose}
                    className="rounded-sm p-1.5 opacity-70 hover:opacity-100 hover:bg-accent/60 transition-all cursor-pointer"
                  >
                    <XIcon className="size-4" />
                  </button>
                }
              />
              <TooltipContent side="bottom">{t(($) => $.common.close)}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="px-5 pb-2 shrink-0">
          <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className="text-2xl cursor-pointer rounded-lg p-1 -ml-1 hover:bg-accent/60 transition-colors"
                  title={t(($) => $.create_project.icon_tooltip)}
                >
                  {icon || "📁"}
                </button>
              }
            />
            <PopoverContent align="start" className="w-auto p-0">
              <EmojiPicker
                onSelect={(emoji) => {
                  updateIcon(emoji);
                  setIconPickerOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <TitleEditor
            autoFocus
            defaultValue={draft.title}
            placeholder={t(($) => $.create_project.title_placeholder)}
            className="text-lg font-semibold"
            onChange={(v) => updateTitle(v)}
            onSubmit={handleSubmit}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5">
          <ContentEditor
            ref={descEditorRef}
            defaultValue={draft.description}
            placeholder={t(($) => $.create_project.description_placeholder)}
            onUpdate={(md) => setDraft({ description: md })}
            debounceMs={500}
          />
        </div>

        {/* Code repository — required. Pinned to the bottom. Combobox: type to
            search workspace repos or paste a URL; selections show as chips. */}
        <div className="px-5 py-3 space-y-2 border-t shrink-0">
          <div className="flex items-center gap-1 text-xs font-medium">
            <RepoIcon className="size-3.5" />
            <span>{t(($) => $.create_project.repos_section_title)}</span>
            <span className="text-destructive">*</span>
          </div>

          {selectedRepos.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedRepos.map((url) => (
                <span
                  key={url}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-xs"
                >
                  <RepoIcon url={url} className="size-3 shrink-0" />
                  <span className="truncate max-w-[220px]" title={url}>{url}</span>
                  <button
                    type="button"
                    onClick={() => toggleRepo(url)}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <Popover open={repoComboboxOpen} onOpenChange={setRepoComboboxOpen}>
            <PopoverTrigger
              render={
                <div className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs text-muted-foreground cursor-pointer hover:bg-accent/60 transition-colors">
                  <RepoIcon className="size-3.5" />
                  <span>{t(($) => $.create_project.repos_combobox_placeholder)}</span>
                </div>
              }
            />
            <PopoverContent align="start" className="w-72 p-2 space-y-1">
              <input
                type="text"
                value={repoQuery}
                onChange={(e) => setRepoQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const url = repoQuery.trim();
                    if (url && isValidGitRepoURL(url)) {
                      addCustomRepo(url);
                      setRepoQuery("");
                    }
                  }
                }}
                placeholder={t(($) => $.create_project.repos_url_placeholder)}
                className={cn(
                  "w-full bg-transparent text-xs px-1 py-1 border-b outline-none placeholder:text-muted-foreground",
                  repoQuery.trim() && !isValidGitRepoURL(repoQuery.trim()) && "border-destructive",
                )}
                autoFocus
              />
              {repoQuery.trim() && !isValidGitRepoURL(repoQuery.trim()) && (
                <p className="px-1 py-1 text-xs text-destructive">
                  {t(($) => $.create_project.repos_invalid_hint)}
                </p>
              )}
              <div className="max-h-44 overflow-y-auto">
                {filteredRepos.map((repo) => {
                  const checked = selectedRepos.includes(repo.url);
                  return (
                    <button
                      type="button"
                      key={repo.url}
                      onClick={() => toggleRepo(repo.url)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors",
                        checked && "bg-accent",
                      )}
                    >
                      <input type="checkbox" checked={checked} readOnly className="size-3.5" />
                      <RepoIcon url={repo.url} className="size-3.5" />
                      <RepoUrlText url={repo.url} />
                    </button>
                  );
                })}
                {filteredRepos.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t(($) => $.create_project.repos_empty)}
                  </p>
                )}
              </div>
              {repoQuery.trim() && isValidGitRepoURL(repoQuery.trim()) && !workspaceRepos.some((r) => r.url === repoQuery.trim()) && (
                <button
                  type="button"
                  onClick={() => {
                    addCustomRepo(repoQuery.trim());
                    setRepoQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors border-t"
                >
                  <RepoIcon url={repoQuery.trim()} className="size-3.5" />
                  <span className="truncate">{t(($) => $.create_project.repos_add_new, { url: repoQuery.trim() })}</span>
                </button>
              )}
            </PopoverContent>
          </Popover>

          <p className="text-xs text-muted-foreground">
            {t(($) => $.create_project.repos_hint)}
          </p>
        </div>

        {/* Footer: properties (left, wrap) + Create button (right). Single row
            so the modal stays compact — Linear-style. Code repository lives in
            the form body above (required), not here. */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <PillButton>
                  <span className={cn("size-2 rounded-full", PROJECT_STATUS_CONFIG[status].dotColor)} />
                  <span>{projectStatusLabels[status]}</span>
                </PillButton>
              }
            />
            <DropdownMenuContent align="start" className="w-44">
              {PROJECT_STATUS_ORDER.map((s) => (
                <DropdownMenuItem key={s} onClick={() => updateStatus(s)}>
                  <span className={cn("size-2 rounded-full", PROJECT_STATUS_CONFIG[s].dotColor)} />
                  <span>{projectStatusLabels[s]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <PillButton>
                  <PriorityIcon priority={priority} />
                  <span>{projectPriorityLabels[priority]}</span>
                </PillButton>
              }
            />
            <DropdownMenuContent align="start" className="w-44">
              {PROJECT_PRIORITY_ORDER.map((pr) => (
                <DropdownMenuItem key={pr} onClick={() => updatePriority(pr)}>
                  <PriorityIcon priority={pr} />
                  <span>{projectPriorityLabels[pr]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover
            open={leadOpen}
            onOpenChange={(v) => {
              setLeadOpen(v);
              if (!v) setLeadFilter("");
            }}
          >
            <PopoverTrigger
              render={
                <PillButton>
                  {leadType && leadId ? (
                    <>
                      <ActorAvatar actorType={leadType} actorId={leadId} size={16} showStatusDot />
                      <span>{leadLabel}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{t(($) => $.create_project.lead)}</span>
                  )}
                </PillButton>
              }
            />
            <PopoverContent align="start" className="w-52 p-0">
              <div className="px-2 py-1.5 border-b">
                <input
                  type="text"
                  value={leadFilter}
                  onChange={(e) => setLeadFilter(e.target.value)}
                  placeholder={t(($) => $.create_project.lead_placeholder)}
                  className="w-full bg-transparent text-sm placeholder:text-muted-foreground outline-none"
                />
              </div>
              <div className="p-1 max-h-60 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    updateLead(undefined, undefined);
                    setLeadOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  <UserMinus className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{t(($) => $.create_project.no_lead)}</span>
                </button>
                {filteredMembers.length > 0 && (
                  <>
                    <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t(($) => $.create_project.members_group)}
                    </div>
                    {filteredMembers.map((m) => (
                      <button
                        type="button"
                        key={m.user_id}
                        onClick={() => {
                          updateLead("member", m.user_id);
                          setLeadOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                      >
                        <ActorAvatar actorType="member" actorId={m.user_id} size={16} />
                        <span>{m.name}</span>
                      </button>
                    ))}
                  </>
                )}
                {filteredMembers.length === 0 &&
                  leadFilter && (
                    <div className="px-2 py-3 text-center text-sm text-muted-foreground">
                      {t(($) => $.create_project.no_results)}
                    </div>
                  )}
              </div>
            </PopoverContent>
          </Popover>

          </div>

          <div className="flex items-center gap-2 shrink-0">
            {(!title.trim() || selectedRepos.length === 0) && (
              <span className="text-xs text-muted-foreground">
                {selectedRepos.length === 0
                  ? t(($) => $.create_project.repos_required_hint)
                  : t(($) => $.create_project.title_placeholder)}
              </span>
            )}
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!title.trim() || selectedRepos.length === 0 || submitting}
            >
              {submitting ? t(($) => $.create_project.submitting) : t(($) => $.create_project.submit)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
