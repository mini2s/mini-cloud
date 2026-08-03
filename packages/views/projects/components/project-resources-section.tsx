"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FolderGit, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  projectResourcesOptions,
  useCreateProjectResource,
  useDeleteProjectResource,
} from "@multica/core/projects";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace } from "@multica/core/paths";
import { api } from "@multica/core/api";
import { isValidGitRepoURL } from "@multica/core/repo-url";
import { workspaceKeys } from "@multica/core/workspace/queries";
import type {
  GithubRepoResourceRef,
  ProjectResource,
  Workspace,
} from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@multica/ui/components/ui/tooltip";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";

// Project code-repository sidebar section. Combobox mirrors the create-project
// picker: select a workspace repo or type a new URL; new URLs are also
// registered at the workspace level so Settings and project pages agree.
export function ProjectResourcesSection({ projectId }: { projectId: string }) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [repoComboboxOpen, setRepoComboboxOpen] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");

  const { data: resources = [] } = useQuery(
    projectResourcesOptions(wsId, projectId),
  );
  const createResource = useCreateProjectResource(wsId, projectId);
  const deleteResource = useDeleteProjectResource(wsId, projectId);

  const attachedUrls = new Set(
    resources
      .filter((r) => r.resource_type === "github_repo")
      .map((r) => (r.resource_ref as GithubRepoResourceRef).url),
  );
  const workspaceRepos = workspace?.repos ?? [];
  const filteredRepos = workspaceRepos.filter((r) =>
    r.url.toLowerCase().includes(repoQuery.trim().toLowerCase()),
  );

  const handleAttach = async (url: string) => {
    try {
      await createResource.mutateAsync({
        resource_type: "github_repo",
        resource_ref: { url },
      });
      // Register at the workspace level too, so it shows in Settings →
      // Repositories and is reusable by other projects.
      if (workspace && !workspaceRepos.some((r) => r.url === url)) {
        try {
          const updated = await api.updateWorkspace(workspace.id, {
            repos: [...workspaceRepos, { url }],
          });
          qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
            old?.map((ws) => (ws.id === updated.id ? updated : ws)),
          );
        } catch {
          // best-effort: project attach already succeeded
        }
      }
      toast.success(t(($) => $.resources.toast_attached));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t(($) => $.resources.toast_attach_failed);
      toast.error(msg);
    }
  };

  const handleRemove = async (resource: ProjectResource) => {
    try {
      await deleteResource.mutateAsync(resource.id);
      toast.success(t(($) => $.resources.toast_removed));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.resources.toast_remove_failed),
      );
    }
  };

  const queryUrl = repoQuery.trim();
  const queryValid = queryUrl !== "" && isValidGitRepoURL(queryUrl);

  return (
    <div>
      <button
        className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors mb-2 hover:bg-accent/70 ${open ? "" : "text-muted-foreground hover:text-foreground"}`}
        onClick={() => setOpen(!open)}
      >
        {t(($) => $.resources.section_header)}
        <ChevronRight
          className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="pl-2 space-y-1.5">
          {resources.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t(($) => $.resources.empty)}
            </p>
          )}
          {resources.map((resource) => (
            <ResourceRow
              key={resource.id}
              resource={resource}
              onRemove={() => handleRemove(resource)}
            />
          ))}

          {/* Combobox: select a workspace repo or type a new URL. */}
          <Popover open={repoComboboxOpen} onOpenChange={setRepoComboboxOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground w-full justify-start"
                >
                  <Plus className="size-3" />
                  {t(($) => $.resources.combobox_placeholder)}
                </Button>
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
                    if (queryValid && !attachedUrls.has(queryUrl)) {
                      handleAttach(queryUrl);
                      setRepoQuery("");
                      setRepoComboboxOpen(false);
                    }
                  }
                }}
                placeholder={t(($) => $.resources.url_placeholder)}
                className={cn(
                  "w-full bg-transparent text-xs px-1 py-1 border-b outline-none placeholder:text-muted-foreground",
                  queryUrl !== "" && !queryValid && "border-destructive",
                )}
                autoFocus
              />
              {queryUrl !== "" && !queryValid && (
                <p className="px-1 py-1 text-xs text-destructive">
                  {t(($) => $.resources.invalid_hint)}
                </p>
              )}
              <div className="max-h-44 overflow-y-auto">
                {filteredRepos.map((repo) => {
                  const isAttached = attachedUrls.has(repo.url);
                  const isDisabled = isAttached || createResource.isPending;
                  return (
                    // aria-disabled (not native disabled) so hover events still
                    // reach the tooltip trigger on attached rows.
                    <button
                      key={repo.url}
                      type="button"
                      aria-disabled={isDisabled}
                      onClick={async () => {
                        if (isDisabled) return;
                        await handleAttach(repo.url);
                        setRepoComboboxOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left hover:bg-accent transition-colors aria-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-transparent"
                    >
                      <FolderGit className="size-3.5 shrink-0" />
                      <Tooltip>
                        <TooltipTrigger
                          render={<span className="truncate flex-1">{repo.url}</span>}
                        />
                        <TooltipContent side="top">{repo.url}</TooltipContent>
                      </Tooltip>
                      {isAttached && (
                        <span className="text-[10px] text-muted-foreground">
                          {t(($) => $.resources.attached_badge)}
                        </span>
                      )}
                    </button>
                  );
                })}
                {filteredRepos.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t(($) => $.resources.empty)}
                  </p>
                )}
              </div>
              {queryValid && !workspaceRepos.some((r) => r.url === queryUrl) && (
                <button
                  type="button"
                  onClick={() => {
                    handleAttach(queryUrl);
                    setRepoQuery("");
                    setRepoComboboxOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors border-t"
                >
                  <FolderGit className="size-3.5" />
                  <span className="truncate">
                    {t(($) => $.resources.add_new, { url: queryUrl })}
                  </span>
                </button>
              )}
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}

function ResourceRow({
  resource,
  onRemove,
}: {
  resource: ProjectResource;
  onRemove: () => void;
}) {
  const { t } = useT("projects");
  if (resource.resource_type === "github_repo") {
    const ref = resource.resource_ref as GithubRepoResourceRef;
    return (
      <div className="flex items-center gap-2 text-xs group">
        <FolderGit className="size-3.5 text-muted-foreground shrink-0" />
        <Tooltip>
          <TooltipTrigger
            render={
              <a
                href={ref.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate flex-1 hover:underline"
              >
                {resource.label || ref.url}
              </a>
            }
          />
          <TooltipContent side="top">{ref.url}</TooltipContent>
        </Tooltip>
        <button
          type="button"
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 transition-opacity rounded-sm p-0.5 hover:bg-accent"
          title={t(($) => $.resources.remove_tooltip)}
        >
          <Trash2 className="size-3 text-muted-foreground" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="truncate flex-1">
        {resource.label || resource.resource_type}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-sm p-0.5 hover:bg-accent"
        title={t(($) => $.resources.remove_tooltip)}
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}
