"use client";

import { useState } from "react";
import { Database, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatDatasourcesOptions,
  type ChatDatasource,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { NativeSelect } from "@multica/ui/components/ui/native-select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { PageHeader } from "../../layout/page-header";
import {
  ErrorBanner,
  NotWiredNotice,
  Section,
  SettingsField,
  Td,
  Th,
} from "./shared";
import { ToneBadge, type BadgeTone } from "../detail/shared";

// Settings · Datasources. Ports the source Datasources.tsx to the shared-views
// layer. The read table (name / type / host / db / enabled / test result) is
// the deliverable; the add/edit dialog + the per-row "test connection" button
// are UI-only. The chat create/update/delete/testDatasource mutations throw
// NOT_WIRED in the mock phase, so both submit and test surface the
// NotWiredNotice / a placeholder result instead of calling the backend.

const SOURCE_TYPES = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "elasticsearch", label: "Elasticsearch" },
  { value: "loki", label: "Loki" },
  { value: "dept_api", label: "Dept API" },
  { value: "log_storage", label: "Log storage" },
] as const;

function typeLabel(t: string): string {
  const m: Record<string, string> = {
    postgres: "PG",
    elasticsearch: "ES",
    loki: "Loki",
    dept_api: "Dept API",
    log_storage: "Log",
  };
  return m[t] || t;
}

function typeTone(t: string): BadgeTone {
  if (t === "postgres") return "primary";
  if (t === "elasticsearch") return "warning";
  if (t === "loki") return "success";
  return "info";
}

/**
 * Parse host info out of config_json (preferred) with a fallback to the flat
 * PG/ES/Loki fields. Returns a compact host:port / hosts-array / url string.
 */
function dsHost(r: ChatDatasource): string {
  if (r.config_json) {
    try {
      const cfg = JSON.parse(r.config_json) as Record<string, unknown>;
      switch (r.source_type) {
        case "postgres":
          return `${cfg.host ?? r.pg_host ?? "-"}:${cfg.port ?? r.pg_port ?? "-"}`;
        case "elasticsearch":
          return JSON.stringify(cfg.hosts ?? []);
        case "loki":
          return String(cfg.url ?? r.loki_url ?? "-");
        case "dept_api":
          return String(cfg.base_url ?? "-");
        case "log_storage": {
          const s3 = cfg.s3 as Record<string, unknown> | undefined;
          return cfg.storage === "s3" && s3
            ? String(s3.endpoint ?? "-")
            : String(cfg.root_dir ?? "-");
        }
      }
    } catch {
      /* fall through to flat fields */
    }
  }
  if (r.source_type === "postgres")
    return `${r.pg_host ?? "-"}:${r.pg_port ?? "-"}`;
  if (r.source_type === "loki") return r.loki_url ?? "-";
  return r.es_hosts ?? "-";
}

/** Parse the db / index / query-presets label out of config_json or flat fields. */
function dsDb(r: ChatDatasource): string {
  if (r.config_json) {
    try {
      const cfg = JSON.parse(r.config_json) as Record<string, unknown>;
      switch (r.source_type) {
        case "postgres":
          return String(cfg.database ?? r.pg_database ?? "-");
        case "elasticsearch":
          return String(cfg.index ?? r.es_index ?? "-");
        case "loki": {
          const qs = (cfg.queries as Array<{ name?: string }>) ?? [];
          if (!qs.length) return "-";
          const names = qs.map((q) => q.name).filter(Boolean).join(", ");
          return names || `${qs.length} preset(s)`;
        }
        case "dept_api":
          return "-";
        case "log_storage": {
          const s3 = cfg.s3 as Record<string, unknown> | undefined;
          return cfg.storage === "s3" && s3
            ? String(s3.bucket ?? "-")
            : `max ${cfg.max_size_mb ?? 5}MB`;
        }
      }
    } catch {
      /* fall through */
    }
  }
  if (r.source_type === "postgres") return r.pg_database ?? "-";
  if (r.source_type === "elasticsearch") return r.es_index ?? "-";
  if (r.source_type === "loki") {
    try {
      const qs = JSON.parse(r.loki_queries || "[]") as Array<{ name?: string }>;
      if (Array.isArray(qs) && qs.length) {
        const names = qs.map((q) => q.name).filter(Boolean).join(", ");
        return names || `${qs.length} preset(s)`;
      }
    } catch {
      /* ignore */
    }
    return "-";
  }
  return "-";
}

type TestState = { loading?: boolean; ok?: boolean; text?: string };

export function DatasourcesPage() {
  const wsId = useWorkspaceId();
  const dsQ = useQuery(chatDatasourcesOptions(wsId));

  const rows = dsQ.data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChatDatasource | null>(null);
  // Per-row test placeholder result (UI-only — real test is NOT_WIRED).
  const [testState, setTestState] = useState<Record<number, TestState>>({});

  function handleTest(id: number) {
    // Placeholder: surface the "not wired" notice as the test result so the
    // button visibly does something without a live backend.
    setTestState((s) => ({
      ...s,
      [id]: { ok: false, text: "Backend not wired (mock phase)" },
    }));
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Database className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">Datasources</h1>
          <span className="truncate text-xs text-muted-foreground">
            · {rows.length} {rows.length === 1 ? "source" : "sources"}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          Add datasource
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-4 p-6">
          <Section
            title="Source datasources"
            count={rows.length}
            bodyClassName="overflow-x-auto"
          >
            {dsQ.error ? (
              <ErrorBanner
                message={
                  (dsQ.error as Error)?.message ||
                  "Failed to load datasources."
                }
              />
            ) : null}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Host</Th>
                  <Th>Database / index</Th>
                  <Th>Enabled</Th>
                  <Th>Connection test</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {dsQ.isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={7} className="px-3 py-2">
                        <Skeleton className="h-6 w-full rounded" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center">
                      <span className="text-sm text-muted-foreground">
                        No datasources — click “Add datasource” to configure one.
                      </span>
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const ts = testState[r.id];
                    return (
                      <tr
                        key={r.id}
                        className="border-b last:border-0 hover:bg-muted/50"
                      >
                        <Td>
                          <span className="font-medium text-card-foreground">
                            {r.name}
                          </span>
                        </Td>
                        <Td>
                          <ToneBadge tone={typeTone(r.source_type)}>
                            {typeLabel(r.source_type)}
                          </ToneBadge>
                        </Td>
                        <Td>
                          <div
                            className="max-w-[260px] truncate font-mono text-xs"
                            title={dsHost(r)}
                          >
                            {dsHost(r)}
                          </div>
                        </Td>
                        <Td>{dsDb(r)}</Td>
                        <Td>
                          <ToneBadge tone={r.is_enabled ? "success" : "error"}>
                            {r.is_enabled ? "yes" : "no"}
                          </ToneBadge>
                        </Td>
                        <Td>
                          {ts?.loading ? (
                            <span className="text-xs text-muted-foreground">
                              Testing…
                            </span>
                          ) : ts?.text ? (
                            <span
                              className={`text-xs ${ts.ok ? "text-success" : "text-destructive"}`}
                              title={ts.text}
                            >
                              {ts.text}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </Td>
                        <Td>
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto p-0"
                              onClick={() => {
                                setEditing(r);
                                setDialogOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto p-0"
                              disabled={ts?.loading}
                              onClick={() => handleTest(r.id)}
                            >
                              Test
                            </Button>
                          </div>
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </Section>
        </div>
      </div>

      <DatasourceDialog
        open={dialogOpen}
        editing={editing}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

// ---- Add / edit dialog (UI only — submit is NOT_WIRED) ----

interface DatasourceDialogProps {
  open: boolean;
  editing: ChatDatasource | null;
  onClose: () => void;
}

function DatasourceDialog({
  open,
  editing,
  onClose,
}: DatasourceDialogProps) {
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<string>("postgres");
  const [isEnabled, setIsEnabled] = useState(true);
  // Common PG/ES config fields (the Loki/dept_api/log_storage variants are
  // voluminous; for the mock phase we surface the two canonical types plus a
  // notes box. The full per-type form returns once mutations are wired.)
  const [pgHost, setPgHost] = useState("");
  const [pgPort, setPgPort] = useState("5432");
  const [pgDatabase, setPgDatabase] = useState("");
  const [pgUsername, setPgUsername] = useState("");
  const [pgPassword, setPgPassword] = useState("");
  const [esHosts, setEsHosts] = useState("");
  const [esIndex, setEsIndex] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [showNotWired, setShowNotWired] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
      return;
    }
    setName(editing?.name ?? "");
    setSourceType(editing?.source_type ?? "postgres");
    setIsEnabled(editing?.is_enabled ?? true);
    // Re-hydrate from flat fields (sufficient for the mock; config_json parse
    // is handled by the read table). Passwords are never echoed back.
    setPgHost(editing?.pg_host ?? "");
    setPgPort(editing?.pg_port != null ? String(editing.pg_port) : "5432");
    setPgDatabase(editing?.pg_database ?? "");
    setPgUsername(editing?.pg_username ?? "");
    setPgPassword("");
    setEsHosts(editing?.es_hosts ?? "");
    setEsIndex(editing?.es_index ?? "");
    setBaseUrl("");
    setNotes(editing?.notes ?? "");
    setShowNotWired(false);
  }

  // Submit is UI-only in the mock phase.
  function handleSubmit() {
    setShowNotWired(true);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit datasource — ${editing.name}` : "Add datasource"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <SettingsField label="Name">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Primary Postgres"
            />
          </SettingsField>

          <div className="grid grid-cols-2 gap-3">
            <SettingsField label="Type">
              <NativeSelect
                className="w-full"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </SettingsField>
            <label className="flex cursor-pointer select-none items-end gap-1.5 pb-1.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => setIsEnabled(e.target.checked)}
                className="size-4 cursor-pointer"
              />
              Enabled
            </label>
          </div>

          {sourceType === "postgres" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="Host">
                  <Input
                    type="text"
                    value={pgHost}
                    onChange={(e) => setPgHost(e.target.value)}
                    placeholder="127.0.0.1"
                  />
                </SettingsField>
                <SettingsField label="Port">
                  <Input
                    type="number"
                    value={pgPort}
                    onChange={(e) => setPgPort(e.target.value)}
                    placeholder="5432"
                  />
                </SettingsField>
              </div>
              <SettingsField label="Database">
                <Input
                  type="text"
                  value={pgDatabase}
                  onChange={(e) => setPgDatabase(e.target.value)}
                  placeholder="chat_metrics"
                />
              </SettingsField>
              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="Username">
                  <Input
                    type="text"
                    value={pgUsername}
                    onChange={(e) => setPgUsername(e.target.value)}
                  />
                </SettingsField>
                <SettingsField label="Password">
                  <Input
                    type="password"
                    value={pgPassword}
                    onChange={(e) => setPgPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </SettingsField>
              </div>
            </>
          )}

          {sourceType === "elasticsearch" && (
            <>
              <SettingsField label="ES hosts" hint='JSON array: ["https://host:9200"]'>
                <Textarea
                  rows={2}
                  value={esHosts}
                  onChange={(e) => setEsHosts(e.target.value)}
                  placeholder='["https://10.0.0.20:9200"]'
                  className="resize-y font-mono"
                />
              </SettingsField>
              <SettingsField label="Index">
                <Input
                  type="text"
                  value={esIndex}
                  onChange={(e) => setEsIndex(e.target.value)}
                  placeholder="chat-logs-*"
                />
              </SettingsField>
            </>
          )}

          {(sourceType === "dept_api" || sourceType === "loki" || sourceType === "log_storage") && (
            <SettingsField label="Base URL">
              <Input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  sourceType === "loki"
                    ? "http://loki:3100"
                    : "https://dept-api.example.com"
                }
              />
            </SettingsField>
          )}

          <SettingsField label="Notes">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </SettingsField>

          {showNotWired && <NotWiredNotice />}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit}>
            {editing ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
