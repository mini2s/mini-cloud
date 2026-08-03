"use client";

import { useEffect, useState } from "react";
import { Database, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatDatasourcesOptions,
  useDeleteChatDatasource,
  useTestChatDatasource,
  useUpsertChatDatasource,
  type ChatDatasource,
  type ChatDatasourceUpsert,
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
import { PageHeader } from "../../layout/page-header";
import {
  ErrorBanner,
  Section,
  SettingsField,
  Td,
  Th,
} from "./shared";
import { ToneBadge, type BadgeTone } from "../detail/shared";

const SOURCE_TYPES = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "elasticsearch", label: "Elasticsearch" },
  { value: "loki", label: "Loki（链路日志）" },
  { value: "dept_api", label: "部门查询 API" },
  { value: "log_storage", label: "日志存储（预览）" },
] as const;

const SSL_MODES = ["disable", "require", "verify-ca", "verify-full"] as const;

function typeLabel(t: string): string {
  const m: Record<string, string> = {
    postgres: "PG",
    elasticsearch: "ES",
    loki: "Loki",
    dept_api: "部门 API",
    log_storage: "日志存储",
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
          return names || `${qs.length} 个预设`;
        }
        case "dept_api":
          return "-";
        case "log_storage": {
          const s3 = cfg.s3 as Record<string, unknown> | undefined;
          return cfg.storage === "s3" && s3
            ? String(s3.bucket ?? "-")
            : `最大 ${cfg.max_size_mb ?? 5}MB`;
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
        return names || `${qs.length} 个预设`;
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
  const testDs = useTestChatDatasource();
  const deleteDs = useDeleteChatDatasource();

  const rows = dsQ.data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChatDatasource | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ChatDatasource | null>(
    null,
  );
  const [testState, setTestState] = useState<Record<number, TestState>>({});

  function handleTest(id: number) {
    setTestState((s) => ({ ...s, [id]: { loading: true } }));
    testDs.mutate(id, {
      onSuccess: (res) => {
        setTestState((s) => ({
          ...s,
          [id]: {
            ok: res.success,
            text: res.success
              ? `${res.message}（${res.ping_ms}ms）`
              : res.message || "连接失败",
          },
        }));
      },
      onError: (err: unknown) => {
        setTestState((s) => ({
          ...s,
          [id]: {
            ok: false,
            text: (err as Error)?.message || "连接测试失败",
          },
        }));
      },
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Database className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">数据源</h1>
          <span className="truncate text-xs text-muted-foreground">
            · {rows.length} 个
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
          新增数据源
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:px-8">
          <Section
            title="源数据源"
            count={rows.length}
            bodyClassName="overflow-x-auto"
          >
            {dsQ.error ? (
              <ErrorBanner
                message={
                  (dsQ.error as Error)?.message ||
                  "获取数据源列表失败"
                }
              />
            ) : null}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <Th>名称</Th>
                  <Th>类型</Th>
                  <Th>主机</Th>
                  <Th>库/索引</Th>
                  <Th>启用</Th>
                  <Th>连接测试</Th>
                  <Th>操作</Th>
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
                        暂无数据源，点击“新增数据源”配置
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
                            {r.is_enabled ? "是" : "否"}
                          </ToneBadge>
                        </Td>
                        <Td>
                          {ts?.loading ? (
                            <span className="text-xs text-muted-foreground">
                              测试中...
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
                              编辑
                            </Button>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto p-0"
                              disabled={ts?.loading}
                              onClick={() => handleTest(r.id)}
                            >
                              测试连接
                            </Button>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-destructive"
                              onClick={() => setPendingDelete(r)}
                            >
                              删除
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
        onSaved={() => setDialogOpen(false)}
      />

      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open && !deleteDs.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除数据源“{pendingDelete?.name}”吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteDs.error ? (
            <ErrorBanner
              message={(deleteDs.error as Error)?.message || "删除失败"}
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDs.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteDs.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!pendingDelete) return;
                deleteDs.mutate(pendingDelete.id, {
                  onSuccess: () => setPendingDelete(null),
                });
              }}
            >
              {deleteDs.isPending ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- Add / edit dialog ----

interface DatasourceDialogProps {
  open: boolean;
  editing: ChatDatasource | null;
  onClose: () => void;
  onSaved: () => void;
}

function DatasourceDialog({
  open,
  editing,
  onClose,
  onSaved,
}: DatasourceDialogProps) {
  const upsertDs = useUpsertChatDatasource();
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<string>("postgres");
  const [isEnabled, setIsEnabled] = useState(true);

  const [pgHost, setPgHost] = useState("");
  const [pgPort, setPgPort] = useState("5432");
  const [pgDatabase, setPgDatabase] = useState("");
  const [pgSchema, setPgSchema] = useState("");
  const [pgTable, setPgTable] = useState("");
  const [pgUsername, setPgUsername] = useState("");
  const [pgPassword, setPgPassword] = useState("");
  const [pgSslMode, setPgSslMode] = useState("disable");

  const [esHosts, setEsHosts] = useState("");
  const [esIndex, setEsIndex] = useState("");
  const [esUsername, setEsUsername] = useState("");
  const [esPassword, setEsPassword] = useState("");
  const [esScrollDuration, setEsScrollDuration] = useState("");
  const [esVerifyCerts, setEsVerifyCerts] = useState(true);

  const [lokiUrl, setLokiUrl] = useState("");
  const [lokiUsername, setLokiUsername] = useState("");
  const [lokiPassword, setLokiPassword] = useState("");
  const [lokiTenantId, setLokiTenantId] = useState("");
  const [lokiVerifyCerts, setLokiVerifyCerts] = useState(true);
  const [lokiQueries, setLokiQueries] = useState<
    Array<{ name: string; label_selector: string }>
  >([]);

  const [deptBaseUrl, setDeptBaseUrl] = useState("");
  const [deptQueryKey, setDeptQueryKey] = useState("");
  const [deptTimeout, setDeptTimeout] = useState("15");

  const [storageType, setStorageType] = useState("disk");
  const [storageRootDir, setStorageRootDir] = useState("");
  const [storageMaxSizeMb, setStorageMaxSizeMb] = useState("5");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3Region, setS3Region] = useState("");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [s3SessionToken, setS3SessionToken] = useState("");
  const [s3UseSsl, setS3UseSsl] = useState(true);
  const [s3InsecureSkipVerify, setS3InsecureSkipVerify] = useState(false);

  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cfg: Record<string, unknown> = {};
    if (editing?.config_json) {
      try {
        cfg = JSON.parse(editing.config_json) as Record<string, unknown>;
      } catch {
        cfg = {};
      }
    }

    const cfgString = (key: string) =>
      typeof cfg[key] === "string" ? String(cfg[key]) : "";
    const cfgNumber = (key: string, fallback: string) =>
      typeof cfg[key] === "number" ? String(cfg[key]) : fallback;
    const cfgBoolean = (key: string, fallback: boolean) =>
      typeof cfg[key] === "boolean" ? Boolean(cfg[key]) : fallback;

    setFormError("");
    setName(editing?.name ?? "");
    setSourceType(editing?.source_type ?? "postgres");
    setIsEnabled(editing?.is_enabled ?? true);
    setPgHost(editing?.pg_host ?? cfgString("host"));
    setPgPort(
      editing?.pg_port != null
        ? String(editing.pg_port)
        : cfgNumber("port", "5432"),
    );
    setPgDatabase(editing?.pg_database ?? cfgString("database"));
    setPgSchema(editing?.pg_schema ?? cfgString("schema"));
    setPgTable(editing?.pg_table ?? cfgString("table"));
    setPgUsername(editing?.pg_username ?? cfgString("username"));
    setPgPassword(editing?.pg_password ?? cfgString("password"));
    setPgSslMode(
      (editing?.pg_ssl_mode ?? cfgString("ssl_mode")) || "disable",
    );

    setEsHosts(
      editing?.es_hosts ??
        (Array.isArray(cfg.hosts) ? JSON.stringify(cfg.hosts) : ""),
    );
    setEsIndex(editing?.es_index ?? cfgString("index"));
    setEsUsername(editing?.es_username ?? cfgString("username"));
    setEsPassword(editing?.es_password ?? cfgString("password"));
    setEsScrollDuration(
      editing?.es_scroll_duration ?? cfgString("scroll_duration"),
    );
    setEsVerifyCerts(
      editing?.es_verify_certs ?? cfgBoolean("verify_certs", true),
    );

    setLokiUrl(editing?.loki_url ?? cfgString("url"));
    setLokiUsername(editing?.loki_username ?? cfgString("username"));
    setLokiPassword(editing?.loki_password ?? cfgString("password"));
    setLokiTenantId(editing?.loki_tenant_id ?? cfgString("tenant_id"));
    setLokiVerifyCerts(
      editing?.loki_verify_certs ?? cfgBoolean("verify_certs", true),
    );
    let queries: Array<{ name: string; label_selector: string }> = [];
    if (Array.isArray(cfg.queries)) {
      queries = cfg.queries.filter(
        (item): item is { name: string; label_selector: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof Reflect.get(item, "name") === "string" &&
          typeof Reflect.get(item, "label_selector") === "string",
      );
    } else if (editing?.loki_queries) {
      try {
        const parsed = JSON.parse(editing.loki_queries) as unknown;
        if (Array.isArray(parsed)) {
          queries = parsed as Array<{
            name: string;
            label_selector: string;
          }>;
        }
      } catch {
        queries = [];
      }
    }
    setLokiQueries(queries);

    setDeptBaseUrl(cfgString("base_url"));
    setDeptQueryKey(cfgString("query_key"));
    setDeptTimeout(cfgNumber("timeout", "15"));

    setStorageType(cfgString("storage") || "disk");
    setStorageRootDir(cfgString("root_dir"));
    setStorageMaxSizeMb(cfgNumber("max_size_mb", "5"));
    const s3 =
      typeof cfg.s3 === "object" && cfg.s3 !== null
        ? (cfg.s3 as Record<string, unknown>)
        : {};
    setS3Endpoint(typeof s3.endpoint === "string" ? s3.endpoint : "");
    setS3Bucket(typeof s3.bucket === "string" ? s3.bucket : "");
    setS3Region(typeof s3.region === "string" ? s3.region : "");
    setS3AccessKey(typeof s3.access_key === "string" ? s3.access_key : "");
    setS3SecretKey("");
    setS3SessionToken(
      typeof s3.session_token === "string" ? s3.session_token : "",
    );
    setS3UseSsl(typeof s3.use_ssl === "boolean" ? s3.use_ssl : true);
    setS3InsecureSkipVerify(
      typeof s3.insecure_skip_verify === "boolean"
        ? s3.insecure_skip_verify
        : false,
    );
    setNotes(editing?.notes ?? "");
  }, [editing, open]);

  function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("请输入名称");
      return;
    }

    const payload: ChatDatasourceUpsert & { id?: number } = {
      id: editing?.id,
      name: trimmedName,
      source_type: sourceType,
      is_enabled: isEnabled,
      notes: notes.trim() || null,
    };

    let config: Record<string, unknown>;
    if (sourceType === "postgres") {
      const port = Number(pgPort.trim());
      config = {
        host: pgHost.trim() || "127.0.0.1",
        port: Number.isFinite(port) && port > 0 ? port : 5432,
        database: pgDatabase.trim() || "user_indicator",
        schema: pgSchema.trim() || "public",
        table: pgTable.trim() || "chat_metrics",
        username: pgUsername.trim() || "postgres",
        password: pgPassword,
        ssl_mode: pgSslMode || "disable",
      };
      payload.pg_host = pgHost.trim() || null;
      payload.pg_port = Number.isFinite(port) && port > 0 ? port : null;
      payload.pg_database = pgDatabase.trim() || null;
      payload.pg_schema = pgSchema.trim() || null;
      payload.pg_table = pgTable.trim() || null;
      payload.pg_username = pgUsername.trim() || null;
      payload.pg_password = pgPassword || null;
      payload.pg_ssl_mode = pgSslMode || null;
    } else if (sourceType === "elasticsearch") {
      let hosts: unknown;
      try {
        hosts = JSON.parse(esHosts.trim() || "[]");
      } catch {
        setFormError("ES 地址必须是有效的 JSON 数组");
        return;
      }
      if (!Array.isArray(hosts)) {
        setFormError("ES 地址必须是 JSON 数组");
        return;
      }
      config = {
        hosts,
        username: esUsername.trim(),
        password: esPassword,
        index: esIndex.trim() || "costrict_chat_metrics_v3",
        verify_certs: esVerifyCerts,
        scroll_duration: esScrollDuration.trim() || "5m",
      };
      payload.es_hosts = esHosts.trim() || null;
      payload.es_index = esIndex.trim() || null;
      payload.es_username = esUsername.trim() || null;
      payload.es_password = esPassword || null;
      payload.es_scroll_duration = esScrollDuration.trim() || null;
      payload.es_verify_certs = esVerifyCerts;
    } else if (sourceType === "loki") {
      const queries = lokiQueries.filter(
        (query) => query.name || query.label_selector,
      );
      config = {
        url: lokiUrl.trim(),
        username: lokiUsername.trim(),
        password: lokiPassword,
        tenant_id: lokiTenantId.trim(),
        verify_certs: lokiVerifyCerts,
        queries,
      };
      payload.loki_url = lokiUrl.trim() || null;
      payload.loki_username = lokiUsername.trim() || null;
      payload.loki_password = lokiPassword || null;
      payload.loki_tenant_id = lokiTenantId.trim() || null;
      payload.loki_verify_certs = lokiVerifyCerts;
      payload.loki_queries = JSON.stringify(queries);
    } else if (sourceType === "dept_api") {
      config = {
        base_url: deptBaseUrl.trim(),
        query_key: deptQueryKey.trim(),
        timeout: Number(deptTimeout.trim()) || 15,
      };
    } else {
      config = {
        storage: storageType,
        root_dir: storageRootDir.trim(),
        max_size_mb: Number(storageMaxSizeMb.trim()) || 5,
      };
      if (storageType === "s3") {
        config.s3 = {
          endpoint: s3Endpoint.trim(),
          use_ssl: s3UseSsl,
          insecure_skip_verify: s3InsecureSkipVerify,
          bucket: s3Bucket.trim(),
          region: s3Region.trim(),
          access_key: s3AccessKey.trim(),
          secret_key: s3SecretKey,
          session_token: s3SessionToken.trim(),
        };
      }
    }
    payload.config_json = JSON.stringify(config);

    setFormError("");
    upsertDs.mutate(payload, {
      onSuccess: () => onSaved(),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !upsertDs.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? `编辑数据源 — ${editing.name}` : "新增数据源"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {formError ? <ErrorBanner message={formError} /> : null}

          <SettingsField label="名称">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如 生产PG、ES集群"
            />
          </SettingsField>

          <div className="grid grid-cols-2 gap-3">
            <SettingsField label="数据源类型">
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
              启用
            </label>
          </div>

          {sourceType === "postgres" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="主机">
                  <Input
                    type="text"
                    value={pgHost}
                    onChange={(e) => setPgHost(e.target.value)}
                    placeholder="127.0.0.1"
                  />
                </SettingsField>
                <SettingsField label="端口">
                  <Input
                    type="number"
                    value={pgPort}
                    onChange={(e) => setPgPort(e.target.value)}
                    placeholder="5432"
                  />
                </SettingsField>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <SettingsField label="数据库">
                  <Input
                    type="text"
                    value={pgDatabase}
                    onChange={(e) => setPgDatabase(e.target.value)}
                    placeholder="user_indicator"
                  />
                </SettingsField>
                <SettingsField label="Schema">
                  <Input
                    type="text"
                    value={pgSchema}
                    onChange={(e) => setPgSchema(e.target.value)}
                    placeholder="public"
                  />
                </SettingsField>
                <SettingsField label="表名">
                  <Input
                    type="text"
                    value={pgTable}
                    onChange={(e) => setPgTable(e.target.value)}
                    placeholder="chat_metrics"
                  />
                </SettingsField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="用户名">
                  <Input
                    type="text"
                    value={pgUsername}
                    onChange={(e) => setPgUsername(e.target.value)}
                  />
                </SettingsField>
                <SettingsField label="密码">
                  <Input
                    type="password"
                    value={pgPassword}
                    onChange={(e) => setPgPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </SettingsField>
              </div>
              <SettingsField label="SSL 模式">
                <NativeSelect
                  className="w-full"
                  value={pgSslMode}
                  onChange={(e) => setPgSslMode(e.target.value)}
                >
                  {SSL_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </NativeSelect>
              </SettingsField>
            </>
          )}

          {sourceType === "elasticsearch" && (
            <>
              <SettingsField
                label="ES 地址"
                hint='JSON 数组：["https://host:9200"]'
              >
                <Textarea
                  rows={2}
                  value={esHosts}
                  onChange={(e) => setEsHosts(e.target.value)}
                  placeholder='["https://10.0.0.20:9200"]'
                  className="resize-y font-mono"
                />
              </SettingsField>
              <SettingsField label="索引名">
                <Input
                  type="text"
                  value={esIndex}
                  onChange={(e) => setEsIndex(e.target.value)}
                  placeholder="costrict_chat_metrics_v3"
                />
              </SettingsField>
              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="用户名">
                  <Input
                    value={esUsername}
                    onChange={(e) => setEsUsername(e.target.value)}
                  />
                </SettingsField>
                <SettingsField label="密码">
                  <Input
                    type="password"
                    value={esPassword}
                    onChange={(e) => setEsPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </SettingsField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="Scroll 保持时间">
                  <Input
                    value={esScrollDuration}
                    onChange={(e) => setEsScrollDuration(e.target.value)}
                    placeholder="5m"
                  />
                </SettingsField>
                <label
                  className="flex cursor-pointer select-none items-end gap-1.5 pb-1.5 text-sm text-muted-foreground"
                  title="关闭后可连接自签名证书的 ES 节点"
                >
                  <input
                    type="checkbox"
                    checked={esVerifyCerts}
                    onChange={(e) => setEsVerifyCerts(e.target.checked)}
                    className="size-4 cursor-pointer"
                  />
                  验证 SSL 证书
                </label>
              </div>
            </>
          )}

          {sourceType === "loki" && (
            <>
              <SettingsField
                label="Loki 地址"
                hint="如 http://loki:3100（不要带 /loki/api 前缀）"
              >
                <Input
                  value={lokiUrl}
                  onChange={(e) => setLokiUrl(e.target.value)}
                  placeholder="http://loki:3100"
                />
              </SettingsField>
              <SettingsField
                label="查询预设"
                hint="每个预设独立配置 label 选择器，链路日志抽屉里可下拉切换"
              >
                <div className="space-y-2">
                  {lokiQueries.map((query, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <Input
                        className="w-40"
                        value={query.name}
                        onChange={(e) =>
                          setLokiQueries((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, name: e.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="预设名称"
                      />
                      <Input
                        className="flex-1"
                        value={query.label_selector}
                        onChange={(e) =>
                          setLokiQueries((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    label_selector: e.target.value,
                                  }
                                : item,
                            ),
                          )
                        }
                        placeholder='app="chat-rag",env="prod"'
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() =>
                          setLokiQueries((current) =>
                            current.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }
                        aria-label="删除查询预设"
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() =>
                      setLokiQueries((current) => [
                        ...current,
                        { name: "", label_selector: "" },
                      ])
                    }
                  >
                    + 添加查询预设
                  </Button>
                </div>
              </SettingsField>
              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="用户名（可选）">
                  <Input
                    value={lokiUsername}
                    onChange={(e) => setLokiUsername(e.target.value)}
                  />
                </SettingsField>
                <SettingsField label="密码（可选）">
                  <Input
                    type="password"
                    value={lokiPassword}
                    onChange={(e) => setLokiPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </SettingsField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="Tenant ID（多租户可选）">
                  <Input
                    value={lokiTenantId}
                    onChange={(e) => setLokiTenantId(e.target.value)}
                  />
                </SettingsField>
                <label className="flex cursor-pointer select-none items-end gap-1.5 pb-1.5 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={lokiVerifyCerts}
                    onChange={(e) => setLokiVerifyCerts(e.target.checked)}
                    className="size-4 cursor-pointer"
                  />
                  验证 SSL 证书
                </label>
              </div>
            </>
          )}

          {sourceType === "dept_api" && (
            <>
              <SettingsField
                label="API 基础地址"
                hint="costrict-dept-info 服务地址"
              >
                <Input
                  value={deptBaseUrl}
                  onChange={(e) => setDeptBaseUrl(e.target.value)}
                  placeholder="https://dept-api.example.com"
                />
              </SettingsField>
              <SettingsField label="查询密钥（query_key）">
                <Input
                  type="password"
                  value={deptQueryKey}
                  onChange={(e) => setDeptQueryKey(e.target.value)}
                  autoComplete="new-password"
                  placeholder="认证密钥"
                />
              </SettingsField>
              <SettingsField label="超时（秒）">
                <Input
                  type="number"
                  min={1}
                  max={120}
                  value={deptTimeout}
                  onChange={(e) => setDeptTimeout(e.target.value)}
                />
              </SettingsField>
            </>
          )}

          {sourceType === "log_storage" && (
            <>
              <SettingsField label="存储方式">
                <NativeSelect
                  className="w-full"
                  value={storageType}
                  onChange={(e) => setStorageType(e.target.value)}
                >
                  <option value="disk">本地磁盘（disk）</option>
                  <option value="s3">S3 / MinIO（s3）</option>
                </NativeSelect>
              </SettingsField>
              <SettingsField
                label="根目录/前缀"
                hint={
                  storageType === "disk"
                    ? "日志文件根目录"
                    : "S3 object key 前缀"
                }
              >
                <Input
                  value={storageRootDir}
                  onChange={(e) => setStorageRootDir(e.target.value)}
                  placeholder={
                    storageType === "disk" ? "/data/logs" : "chat-logs/"
                  }
                />
              </SettingsField>
              <SettingsField label="预览大小阈值（MB）">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={storageMaxSizeMb}
                  onChange={(e) => setStorageMaxSizeMb(e.target.value)}
                />
              </SettingsField>
              {storageType === "s3" && (
                <>
                  <SettingsField
                    label="S3 Endpoint"
                    hint="如 192.168.1.1:9000 或 https://s3.example.com"
                  >
                    <Input
                      value={s3Endpoint}
                      onChange={(e) => setS3Endpoint(e.target.value)}
                      placeholder="192.168.1.1:9000"
                    />
                  </SettingsField>
                  <div className="grid grid-cols-2 gap-3">
                    <SettingsField label="Bucket">
                      <Input
                        value={s3Bucket}
                        onChange={(e) => setS3Bucket(e.target.value)}
                        placeholder="chat-rag"
                      />
                    </SettingsField>
                    <SettingsField label="Region">
                      <Input
                        value={s3Region}
                        onChange={(e) => setS3Region(e.target.value)}
                        placeholder="us-east-1"
                      />
                    </SettingsField>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <SettingsField label="Access Key">
                      <Input
                        value={s3AccessKey}
                        onChange={(e) => setS3AccessKey(e.target.value)}
                      />
                    </SettingsField>
                    <SettingsField label="Secret Key">
                      <Input
                        type="password"
                        value={s3SecretKey}
                        onChange={(e) => setS3SecretKey(e.target.value)}
                        autoComplete="new-password"
                      />
                    </SettingsField>
                  </div>
                  <SettingsField label="Session Token（可选）">
                    <Input
                      value={s3SessionToken}
                      onChange={(e) => setS3SessionToken(e.target.value)}
                    />
                  </SettingsField>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={s3UseSsl}
                        onChange={(e) => setS3UseSsl(e.target.checked)}
                        className="size-4 cursor-pointer"
                      />
                      使用 SSL
                    </label>
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={s3InsecureSkipVerify}
                        onChange={(e) =>
                          setS3InsecureSkipVerify(e.target.checked)
                        }
                        className="size-4 cursor-pointer"
                      />
                      跳过证书验证
                    </label>
                  </div>
                </>
              )}
            </>
          )}

          <SettingsField label="备注">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </SettingsField>

          {upsertDs.error ? (
            <ErrorBanner
              message={
                (upsertDs.error as Error)?.message ||
                "保存数据源失败"
              }
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={upsertDs.isPending}
            onClick={handleSubmit}
          >
            {upsertDs.isPending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
