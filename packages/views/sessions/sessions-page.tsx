"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  costrictDeviceListOptions,
  costrictWorkspaceListOptions,
  conversationKeys,
  createCloudProxyClient,
  resolveWorkspaceConversationSources,
  type ConversationDescriptor,
  type CostrictDevice,
  type CostrictWorkspace,
  type OpenCodeConversation,
  type WorkspaceConversationSource,
} from "@multica/core/conversations";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { Button } from "@multica/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { cn } from "@multica/ui/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Server,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ConversationRuntimeProvider, Session } from "../common/session";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";
import { createCostrictDeviceTransport } from "./costrict-device-transport";

const LIST_LIMIT = 50;
const directTransport = createCostrictDeviceTransport();

type SessionGroupKey = "today" | "this_week" | "older";

type WorkspaceEntry = {
  workspace: CostrictWorkspace;
  device?: CostrictDevice;
  sources: WorkspaceConversationSource[];
};

function sessionTimestamp(session: OpenCodeConversation): number {
  return session.time?.updated ?? session.time?.created ?? 0;
}

export function sessionGroupKey(
  session: OpenCodeConversation,
  now = Date.now(),
): SessionGroupKey {
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const timestamp = sessionTimestamp(session);
  if (timestamp >= startOfDay) return "today";
  if (timestamp >= sevenDaysAgo) return "this_week";
  return "older";
}

function deviceForWorkspace(
  workspace: CostrictWorkspace,
  devices: readonly CostrictDevice[],
): CostrictDevice | undefined {
  return devices.find(
    (device) =>
      device.id === workspace.deviceId ||
      device.deviceId === workspace.deviceUniqueId,
  );
}

function directoryLabel(
  source: WorkspaceConversationSource,
  fallback: string,
): string {
  return source.directoryLabel || source.workspaceDirectory || fallback;
}

export function SessionsPage() {
  const { t } = useT("chat");
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const sourceId = navigation.searchParams.get("source") ?? "";
  const conversationId = navigation.searchParams.get("session") ?? "";
  const [collapsedGroups, setCollapsedGroups] = useState<
    Partial<Record<SessionGroupKey, boolean>>
  >({ older: true });
  const [renaming, setRenaming] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<OpenCodeConversation | null>(null);
  const [draft, setDraft] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [openedWorkspaceIds, setOpenedWorkspaceIds] = useState<string[]>([]);

  const workspaceOptions = costrictWorkspaceListOptions();
  const deviceOptions = costrictDeviceListOptions();
  const workspacesQuery = useQuery({
    ...workspaceOptions,
    refetchInterval: 30_000,
  });
  const devicesQuery = useQuery({
    ...deviceOptions,
    refetchInterval: 30_000,
  });
  const sources = useMemo(
    () =>
      resolveWorkspaceConversationSources(
        workspacesQuery.data ?? [],
        devicesQuery.data ?? [],
      ),
    [devicesQuery.data, workspacesQuery.data],
  );
  const workspaceEntries = useMemo<WorkspaceEntry[]>(
    () =>
      (workspacesQuery.data ?? [])
        .map((workspace) => ({
          workspace,
          device: deviceForWorkspace(workspace, devicesQuery.data ?? []),
          sources: sources.filter(
            (source) => source.workspaceId === workspace.id,
          ),
        })),
    [devicesQuery.data, sources, workspacesQuery.data],
  );
  const selectedSource = sources.find((source) => source.id === sourceId);
  const selectedWorkspace = workspaceEntries.find(
    (entry) => entry.workspace.id === selectedSource?.workspaceId,
  );
  const currentWorkspaces = workspaceEntries.filter((entry) =>
    openedWorkspaceIds.includes(entry.workspace.id),
  );
  const otherWorkspaces = workspaceEntries.filter(
    (entry) => !openedWorkspaceIds.includes(entry.workspace.id),
  );
  const sourcesLoading = workspacesQuery.isPending || devicesQuery.isPending;
  const noSource = !sourcesLoading && sources.length === 0;
  const selectedDeviceOffline = selectedSource?.deviceStatus === "offline";

  const replaceSelection = (next: {
    source?: string;
    session?: string;
  }) => {
    const search = new URLSearchParams();
    if (next.source) search.set("source", next.source);
    if (next.session) search.set("session", next.session);
    const query = search.toString();
    navigation.replace(`${paths.sessions()}${query ? `?${query}` : ""}`);
  };

  useEffect(() => {
    if (!selectedSource) return;
    setOpenedWorkspaceIds((current) =>
      current.includes(selectedSource.workspaceId)
        ? current
        : [...current, selectedSource.workspaceId],
    );
  }, [selectedSource]);

  useEffect(() => {
    if (sourcesLoading || !sourceId || selectedSource) return;
    replaceSelection({});
    // Invalid deep links return to the same empty Workspace home state as the
    // original application.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSource, sourceId, sourcesLoading]);

  const client = useMemo(() => {
    if (!selectedSource || selectedSource.deviceStatus === "offline") return null;
    return createCloudProxyClient({
      baseUrl: selectedSource.proxyBaseUrl,
      directory: selectedSource.workspaceDirectory,
      transport: directTransport,
      onProtocolError: (error) => {
        console.warn("[sessions] Invalid cloud proxy payload", error);
      },
    });
  }, [selectedSource]);

  const listKey = selectedSource
    ? conversationKeys.workspaceList(
        selectedSource.proxyBaseUrl,
        selectedSource.workspaceDirectory,
      )
    : [...conversationKeys.all, "workspace-list", "disabled"];
  const sessionsQuery = useQuery({
    queryKey: listKey,
    queryFn: () =>
      client!.conversation.list({ roots: true, limit: LIST_LIMIT }),
    enabled: client !== null,
    staleTime: 15_000,
  });
  const statusQuery = useQuery({
    queryKey: [...listKey, "status"],
    queryFn: () => client!.conversation.status(),
    enabled: client !== null,
    refetchInterval: 5_000,
  });
  const sessions = useMemo(
    () =>
      [...(sessionsQuery.data ?? [])]
        .filter((session) => !session.parentID)
        .sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a)),
    [sessionsQuery.data],
  );
  const sessionGroups = useMemo(
    () => {
      const groups: Record<SessionGroupKey, OpenCodeConversation[]> = {
        today: [],
        this_week: [],
        older: [],
      };
      for (const session of sessions) {
        groups[sessionGroupKey(session)].push(session);
      }
      return (Object.keys(groups) as SessionGroupKey[])
        .map((key) => ({ key, sessions: groups[key] }))
        .filter((group) => group.sessions.length > 0);
    },
    [sessions],
  );
  const activeSession = sessions.find(
    (session) => session.id === conversationId,
  );

  useEffect(() => {
    if (!conversationId || sessionsQuery.isPending) return;
    if (sessions.some((session) => session.id === conversationId)) return;
    replaceSelection({ source: selectedSource?.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, sessions, sessionsQuery.isPending]);

  const createSession = useMutation({
    mutationFn: async (initialPrompt?: string) => {
      if (!client) throw new Error("Conversation source is unavailable");
      const created = await client.conversation.create({});
      if (!created.id) throw new Error("Conversation service returned no id");
      let promptError: unknown;
      if (initialPrompt) {
        try {
          await client.conversation.promptAsync(created.id, {
            parts: [{ type: "text", text: initialPrompt }],
          });
        } catch (error) {
          promptError = error;
        }
      }
      return { created, promptError };
    },
    onSuccess: ({ created, promptError }) => {
      queryClient.setQueryData<OpenCodeConversation[]>(listKey, (current) => [
        created,
        ...(current ?? []).filter((session) => session.id !== created.id),
      ]);
      setDraft("");
      replaceSelection({ source: selectedSource?.id, session: created.id });
      if (promptError) {
        toast.error(t(($) => $.workspace_sessions.prompt_error));
      }
    },
    onError: () => toast.error(t(($) => $.workspace_sessions.create_error)),
  });

  const renameSession = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      if (!client) throw new Error("Conversation source is unavailable");
      return client.conversation.update(id, { title });
    },
    onSuccess: (updated, input) => {
      queryClient.setQueryData<OpenCodeConversation[]>(listKey, (current) =>
        (current ?? []).map((session) =>
          session.id === input.id
            ? { ...session, ...updated, title: updated.title || input.title }
            : session,
        ),
      );
      setRenaming(null);
    },
    onError: () => toast.error(t(($) => $.workspace_sessions.rename_error)),
  });

  const deleteSession = useMutation({
    mutationFn: async (id: string) => {
      if (!client) throw new Error("Conversation source is unavailable");
      await client.conversation.delete(id);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<OpenCodeConversation[]>(listKey, (current) =>
        (current ?? []).filter((session) => session.id !== id),
      );
      setDeleteTarget(null);
      if (conversationId === id) {
        replaceSelection({ source: selectedSource?.id });
      }
    },
    onError: () => toast.error(t(($) => $.workspace_sessions.delete_error)),
  });

  const commitRename = () => {
    if (!renaming) return;
    const title = renaming.value.trim();
    const original = sessions.find((session) => session.id === renaming.id);
    if (!title || title === original?.title) {
      setRenaming(null);
      return;
    }
    renameSession.mutate({ id: renaming.id, title });
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    }
    if (event.key === "Escape") setRenaming(null);
  };

  const handleWelcomeSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || !client || createSession.isPending) return;
    createSession.mutate(prompt);
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await Promise.all([workspacesQuery.refetch(), devicesQuery.refetch()]);
    setRefreshing(false);
  };

  const openWorkspace = (entry: WorkspaceEntry) => {
    const source = entry.sources[0];
    if (!source || source.deviceStatus === "offline") return;
    setOpenedWorkspaceIds((current) =>
      current.includes(entry.workspace.id)
        ? current
        : [...current, entry.workspace.id],
    );
    replaceSelection({ source: source.id });
  };

  const closeWorkspace = (workspaceId: string) => {
    const remainingIds = openedWorkspaceIds.filter((id) => id !== workspaceId);
    setOpenedWorkspaceIds(remainingIds);
    if (selectedSource?.workspaceId !== workspaceId) return;
    const nextSource = remainingIds
      .map(
        (id) =>
          workspaceEntries.find((entry) => entry.workspace.id === id)
            ?.sources[0],
      )
      .find((source) => source?.deviceStatus !== "offline");
    replaceSelection(nextSource ? { source: nextSource.id } : {});
  };

  const closeAllWorkspaces = () => {
    setOpenedWorkspaceIds([]);
    replaceSelection({});
  };

  useEffect(() => {
    if (
      !selectedSource ||
      selectedSource.deviceStatus !== "offline" ||
      !openedWorkspaceIds.includes(selectedSource.workspaceId)
    ) {
      return;
    }
    toast.error(t(($) => $.workspace_sessions.device_disconnected));
    const timer = window.setTimeout(
      () => closeWorkspace(selectedSource.workspaceId),
      1_500,
    );
    return () => window.clearTimeout(timer);
    // Closing is intentionally delayed to match the original offline-device
    // transition and give the user time to understand why the view changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSource?.deviceStatus, selectedSource?.workspaceId]);

  const descriptor: ConversationDescriptor | null =
    selectedSource && selectedSource.deviceStatus !== "offline" && conversationId
      ? {
          conversationId,
          workspaceDirectory: selectedSource.workspaceDirectory,
          proxyBaseUrl: selectedSource.proxyBaseUrl,
        }
      : null;
  const renderWorkspaceCard = (entry: WorkspaceEntry, running: boolean) => {
    const source = entry.sources[0];
    const status = entry.workspace.deviceStatus ?? "";
    const offline = status === "offline" || !source;
    const selected = entry.workspace.id === selectedSource?.workspaceId;
    const primaryDirectory = source?.workspaceDirectory
      ? source.workspaceDirectory
      : source
        ? t(($) => $.workspace_sessions.default_directory)
        : t(($) => $.workspace_sessions.device_unbound);
    return (
      <div key={entry.workspace.id} className="group/workspace relative">
        <button
          type="button"
          disabled={offline}
          onClick={() => openWorkspace(entry)}
          className={cn(
            "flex w-full min-w-0 flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors",
            running && "pr-9",
            selected
              ? "bg-primary/10 text-foreground ring-1 ring-primary/15"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
            offline && "cursor-not-allowed opacity-55",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                status === "online"
                  ? "bg-emerald-500"
                  : status === "offline"
                    ? "bg-destructive"
                    : "bg-border",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {entry.workspace.name}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-2 pl-4 text-[11px] text-muted-foreground">
            <Server className="size-3 shrink-0" />
            <span className="truncate">
              {[
                entry.device?.displayName,
                primaryDirectory,
                entry.workspace.isDefault
                  ? t(($) => $.workspace_sessions.default_workspace)
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </button>
        {running ? (
          <button
            type="button"
            className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/workspace:opacity-100 focus:opacity-100"
            onClick={() => closeWorkspace(entry.workspace.id)}
            aria-label={t(($) => $.workspace_sessions.close_workspace)}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(16rem,45vh)_minmax(28rem,1fr)] overflow-auto bg-background md:grid-cols-[18rem_minmax(0,1fr)] md:grid-rows-1 md:overflow-hidden xl:grid-cols-[17rem_18rem_minmax(0,1fr)]">
      <aside className="hidden min-h-0 min-w-0 flex-col border-r bg-muted/35 xl:flex">
        <div className="flex h-[41px] shrink-0 items-center gap-2 px-3">
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
            {t(($) => $.workspace_sessions.workspaces_title)}
          </h1>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-label={t(($) => $.workspace_sessions.refresh_sources)}
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                refreshing && "animate-spin motion-reduce:animate-none",
              )}
            />
          </Button>
        </div>

        <div className="shrink-0 px-3 py-2.5">
          <Button
            type="button"
            size="sm"
            className="w-full"
            onClick={() => createSession.mutate(undefined)}
            disabled={!client || createSession.isPending}
          >
            {createSession.isPending ? (
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {t(($) => $.workspace_sessions.new_session)}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {sourcesLoading ? (
            <div className="flex items-center gap-2 px-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
              {t(($) => $.workspace_sessions.loading_sources)}
            </div>
          ) : workspaceEntries.length === 0 ? (
            <div className="mx-1 mt-2 rounded-lg border border-dashed px-3 py-8 text-center">
              <Folder className="mx-auto mb-2 size-7 text-muted-foreground/40" />
              <p className="text-xs font-medium">
                {t(($) => $.workspace_sessions.no_workspace_title)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t(($) => $.workspace_sessions.no_source_description)}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3">
                <div className="flex items-center px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {t(($) => $.workspace_sessions.current_workspaces)}
                  <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                    {currentWorkspaces.length}
                  </span>
                  {currentWorkspaces.length > 0 ? (
                    <button
                      type="button"
                      className="ml-1 flex size-5 items-center justify-center rounded hover:bg-accent hover:text-foreground"
                      onClick={closeAllWorkspaces}
                      aria-label={t(
                        ($) => $.workspace_sessions.close_all_workspaces,
                      )}
                    >
                      <X className="size-3" />
                    </button>
                  ) : null}
                </div>
                <div className="space-y-1">
                  {currentWorkspaces.length > 0 ? (
                    currentWorkspaces.map((entry) =>
                      renderWorkspaceCard(entry, true),
                    )
                  ) : (
                    <div className="mx-1 rounded-md border border-dashed px-3 py-4 text-center text-[11px] text-muted-foreground">
                      {t(($) => $.workspace_sessions.current_empty)}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {t(($) => $.workspace_sessions.other_workspaces)}
                  <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-medium">
                    {otherWorkspaces.length}
                  </span>
                </div>
                <div className="space-y-1">
                  {otherWorkspaces.map((entry) =>
                    renderWorkspaceCard(entry, false),
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </aside>

      <aside className="flex min-h-64 min-w-0 flex-col border-b bg-background md:min-h-0 md:border-r md:border-b-0">
        <div className="flex h-[41px] shrink-0 items-center gap-1 border-b px-2">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label={t(($) => $.workspace_sessions.section_sessions)}
          >
            <MessageSquareText className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled
            title={t(($) => $.workspace_sessions.section_unavailable)}
            aria-label={t(($) => $.workspace_sessions.section_files)}
          >
            <Folder className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled
            title={t(($) => $.workspace_sessions.section_unavailable)}
            aria-label={t(($) => $.workspace_sessions.section_changes)}
          >
            <GitBranch className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled
            title={t(($) => $.workspace_sessions.section_unavailable)}
            aria-label={t(($) => $.workspace_sessions.section_terminal)}
          >
            <Terminal className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto h-7"
            onClick={() => createSession.mutate(undefined)}
            disabled={!client || createSession.isPending}
          >
            <Plus className="size-3.5" />
            {t(($) => $.workspace_sessions.new_session)}
          </Button>
        </div>

        <div className="space-y-2 border-b px-3 py-2.5">
          {workspaceEntries.length > 0 ? (
            <div className="xl:hidden">
              <Select
                value={selectedSource?.workspaceId ?? null}
                onValueChange={(workspaceId) => {
                  if (!workspaceId) return;
                  const source = workspaceEntries.find(
                    (entry) => entry.workspace.id === workspaceId,
                  )?.sources[0];
                  if (source) replaceSelection({ source: source.id });
                }}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>
                    <Server className="size-3.5" />
                    <span className="truncate">
                      {selectedSource?.workspaceName ??
                        t(($) => $.workspace_sessions.select_workspace)}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  {workspaceEntries
                    .filter((entry) => entry.sources.length > 0)
                    .map((entry) => (
                      <SelectItem
                        key={entry.workspace.id}
                        value={entry.workspace.id}
                        disabled={
                          entry.workspace.deviceStatus === "offline" ||
                          entry.sources.length === 0
                        }
                      >
                        {entry.workspace.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                !selectedSource
                  ? "bg-border"
                  : selectedSource.deviceStatus === "online"
                  ? "bg-emerald-500"
                  : "bg-destructive",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {selectedSource?.workspaceName ??
                t(($) => $.workspace_sessions.title)}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {selectedSource?.deviceName}
            </span>
          </div>
          {selectedWorkspace && selectedSource ? (
            <Select
              value={selectedSource.id}
              onValueChange={(next) => {
                if (next) replaceSelection({ source: next });
              }}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue>
                  <Folder className="size-3.5" />
                  <span className="truncate">
                    {directoryLabel(
                      selectedSource,
                      t(($) => $.workspace_sessions.default_directory),
                    )}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                {selectedWorkspace.sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {directoryLabel(
                      source,
                      t(($) => $.workspace_sessions.default_directory),
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {sourcesLoading ? (
            <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              {t(($) => $.workspace_sessions.loading_sources)}
            </div>
          ) : noSource ? (
            <div className="px-2 py-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {t(($) => $.workspace_sessions.no_source_title)}
              </p>
              <p className="mt-1 text-xs">
                {t(($) => $.workspace_sessions.no_source_description)}
              </p>
            </div>
          ) : !selectedSource ? (
            <div className="px-2 py-6 text-sm text-muted-foreground">
              {t(($) => $.workspace_sessions.select_workspace_description)}
            </div>
          ) : selectedDeviceOffline ? (
            <div className="px-2 py-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {t(($) => $.workspace_sessions.device_offline_title)}
              </p>
              <p className="mt-1 text-xs">
                {t(($) => $.workspace_sessions.device_offline_description)}
              </p>
            </div>
          ) : sessionsQuery.isPending ? (
            <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              {t(($) => $.workspace_sessions.loading_sessions)}
            </div>
          ) : sessionsQuery.isError ? (
            <div className="space-y-3 px-2 py-6 text-sm text-muted-foreground">
              <p>{t(($) => $.workspace_sessions.list_error)}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void sessionsQuery.refetch()}
              >
                <RefreshCw className="size-3.5" />
                {t(($) => $.session.retry)}
              </Button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-2 py-6 text-sm text-muted-foreground">
              {t(($) => $.workspace_sessions.empty_list)}
            </div>
          ) : (
            <div className="space-y-1">
              {sessionGroups.map((group) => {
                const collapsed = collapsedGroups[group.key] === true;
                return (
                  <div key={group.key}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1 px-1.5 pt-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() =>
                        setCollapsedGroups((current) => ({
                          ...current,
                          [group.key]: !current[group.key],
                        }))
                      }
                    >
                      {collapsed ? (
                        <ChevronRight className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                      {t(($) => $.workspace_sessions.groups[group.key])}
                    </button>
                    {!collapsed
                      ? group.sessions.map((session) => {
                          const status = statusQuery.data?.[session.id]?.type;
                          const working = status === "busy" || status === "retry";
                          const isActive = session.id === conversationId;
                          const isRenaming = renaming?.id === session.id;
                          return (
                            <div
                              key={session.id}
                              className={cn(
                                "group/session flex h-9 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm transition-colors",
                                isActive
                                  ? "bg-primary/10 text-foreground"
                                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
                              )}
                            >
                              <div
                                role="button"
                                tabIndex={0}
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                onClick={() =>
                                  replaceSelection({
                                    source: selectedSource?.id,
                                    session: session.id,
                                  })
                                }
                                onKeyDown={(event) => {
                                  if (
                                    event.target === event.currentTarget &&
                                    (event.key === "Enter" || event.key === " ")
                                  ) {
                                    event.preventDefault();
                                    replaceSelection({
                                      source: selectedSource?.id,
                                      session: session.id,
                                    });
                                  }
                                }}
                              >
                                {working ? (
                                  <Loader2
                                    className={cn(
                                      "size-3.5 shrink-0 animate-spin motion-reduce:animate-none",
                                      isActive ? "text-primary" : "text-muted-foreground",
                                    )}
                                  />
                                ) : (
                                  <MessageSquareText className="size-3.5 shrink-0" />
                                )}
                                {isRenaming ? (
                                  <input
                                    autoFocus
                                    value={renaming.value}
                                    onChange={(event) =>
                                      setRenaming({
                                        id: session.id,
                                        value: event.target.value,
                                      })
                                    }
                                    onBlur={commitRename}
                                    onKeyDown={handleRenameKeyDown}
                                    onClick={(event) => event.stopPropagation()}
                                    className="h-7 min-w-0 flex-1 rounded border bg-background px-1.5 text-xs outline-none focus:border-ring"
                                  />
                                ) : (
                                  <span
                                    className="min-w-0 flex-1 truncate"
                                    onDoubleClick={(event) => {
                                      event.stopPropagation();
                                      setRenaming({
                                        id: session.id,
                                        value:
                                          session.title ||
                                          t(($) => $.workspace_sessions.untitled),
                                      });
                                    }}
                                  >
                                    {session.title ||
                                      t(($) => $.workspace_sessions.untitled)}
                                  </span>
                                )}
                              </div>
                              {!isRenaming ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    render={
                                      <button
                                        type="button"
                                        className="flex size-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-accent group-hover/session:opacity-100 focus:opacity-100"
                                        aria-label={t(
                                          ($) => $.workspace_sessions.session_actions,
                                        )}
                                      />
                                    }
                                  >
                                    <MoreHorizontal className="size-3.5" />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-32">
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setRenaming({
                                          id: session.id,
                                          value:
                                            session.title ||
                                            t(($) => $.workspace_sessions.untitled),
                                        })
                                      }
                                    >
                                      <Pencil className="size-3.5" />
                                      {t(($) => $.workspace_sessions.rename)}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={() => setDeleteTarget(session)}
                                    >
                                      <Trash2 className="size-3.5" />
                                      {t(($) => $.workspace_sessions.delete)}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}
                            </div>
                          );
                        })
                      : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-[28rem] min-w-0 flex-col bg-background md:min-h-0">
        <div className="flex h-[41px] shrink-0 items-center border-b">
          {activeSession ? (
            <div className="flex h-full w-44 min-w-0 items-center gap-1.5 border-r border-t-2 border-t-primary bg-background px-2 text-xs">
              <MessageSquareText className="size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">
                {activeSession.title || t(($) => $.workspace_sessions.untitled)}
              </span>
              <button
                type="button"
                className="flex size-5 items-center justify-center rounded hover:bg-accent"
                onClick={() => replaceSelection({ source: selectedSource?.id })}
                aria-label={t(($) => $.workspace_sessions.close_session)}
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <div className="px-3 text-xs text-muted-foreground">
              {selectedSource?.workspaceName ??
                t(($) => $.workspace_sessions.title)}
            </div>
          )}
        </div>

        {descriptor ? (
          <ConversationRuntimeProvider
            descriptor={descriptor}
            mode="control"
            transport={directTransport}
          >
            <Session
              mode="control"
              active
              onTakeover={() => undefined}
              className="m-0 h-full flex-1 rounded-none border-0"
            />
          </ConversationRuntimeProvider>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
            {selectedDeviceOffline ? (
              <div className="max-w-sm">
                <Server className="mx-auto mb-4 size-9 text-muted-foreground/40" />
                <h2 className="text-xl font-semibold tracking-tight">
                  {t(($) => $.workspace_sessions.device_offline_title)}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t(($) => $.workspace_sessions.device_offline_description)}
                </p>
              </div>
            ) : client ? (
              <div className="flex w-full max-w-2xl flex-col items-center gap-10">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">
                    {t(($) => $.workspace_sessions.welcome_title)}
                  </h2>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t(($) => $.workspace_sessions.welcome_description)}
                  </p>
                </div>
                <form
                  className="w-full rounded-xl border bg-background p-2 text-left shadow-sm focus-within:border-ring"
                  onSubmit={handleWelcomeSubmit}
                >
                  <textarea
                    rows={2}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder={t(($) => $.workspace_sessions.welcome_placeholder)}
                    aria-label={t(($) => $.workspace_sessions.welcome_placeholder)}
                    className="max-h-36 min-h-16 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <div className="flex items-center justify-between gap-2 px-1 pt-1">
                    <span className="truncate text-[11px] text-muted-foreground">
                      {selectedSource?.workspaceDirectory ||
                        t(($) => $.workspace_sessions.default_directory)}
                    </span>
                    <Button
                      type="submit"
                      size="icon-sm"
                      disabled={!draft.trim() || createSession.isPending}
                      aria-label={t(($) => $.workspace_sessions.send_prompt)}
                    >
                      {createSession.isPending ? (
                        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Send className="size-4" />
                      )}
                    </Button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="max-w-sm">
                <MessageSquareText className="mx-auto mb-4 size-9 text-muted-foreground/40" />
                <h2 className="text-xl font-semibold tracking-tight">
                  {t(($) => $.workspace_sessions.empty_title)}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t(($) => $.workspace_sessions.empty_description)}
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSession.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.workspace_sessions.delete_dialog_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.workspace_sessions.delete_dialog_description, {
                title:
                  deleteTarget?.title ||
                  t(($) => $.workspace_sessions.untitled),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSession.isPending}>
              {t(($) => $.workspace_sessions.cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteSession.isPending}
              onClick={() => {
                if (deleteTarget) deleteSession.mutate(deleteTarget.id);
              }}
            >
              {t(($) => $.workspace_sessions.delete)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
