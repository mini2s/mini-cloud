"use client";

import { useEffect, useState } from "react";
import { Settings, Save } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatSystemConfigOptions,
  chatDatasourcesOptions,
  useUpdateChatSystemConfig,
  type ChatSystemConfig,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { NativeSelect } from "@multica/ui/components/ui/native-select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { PageHeader } from "../../layout/page-header";
import { ErrorBanner, Section, SettingsField } from "./shared";

// Settings · System config. Ports the source SystemConfig.tsx to the shared-
// views layer. The chat config is a flat string→string KV map, so this page
// renders the known keys (ETL cron/datasource, system currency, default
// exchange rate, log preview settings) and an editable form. The save action
// submits via useUpdateChatSystemConfig: in the mock phase the mutation merges
// the patch onto the cached KV without hitting the network; once the backend
// is live (EFFICIENCY_MOCK=0) it PUTs the real chat config.
//
// The mock KV sample uses a slightly different key set than the live backend
// (system_currency / exchange_rate_usd_cny / realtime_refresh_seconds / etc.),
// so the form hydrates defensively: each field falls back to a sensible
// default when its key is absent. Unknown keys are surfaced read-only below
// the form so operators can see the full stored config.

const CURRENCY_OPTIONS = ["CNY", "USD", "EUR", "GBP", "JPY"] as const;

// Form field defaults (match the source's fallbacks).
const DEFAULTS = {
  dailyEtlEnabled: false,
  cron: "0 2 * * *",
  etlSource: "",
  currency: "CNY",
  rate: "7.2420",
  logPreviewSource: "",
  rawLogRootDir: "",
  rawLogPreviewMaxMb: "5",
} as const;

export function SystemConfigPage() {
  const wsId = useWorkspaceId();
  const cfgQ = useQuery(chatSystemConfigOptions(wsId));
  const dsQ = useQuery(chatDatasourcesOptions(wsId));
  const updateCfg = useUpdateChatSystemConfig();

  const cfg = cfgQ.data;

  const [etlEnabled, setEtlEnabled] = useState<boolean>(DEFAULTS.dailyEtlEnabled);
  const [cron, setCron] = useState<string>(DEFAULTS.cron);
  const [etlSource, setEtlSource] = useState<string>(DEFAULTS.etlSource);
  const [currency, setCurrency] = useState<string>(DEFAULTS.currency);
  const [rate, setRate] = useState<string>(DEFAULTS.rate);
  const [logPreviewSource, setLogPreviewSource] = useState<string>(
    DEFAULTS.logPreviewSource,
  );
  const [rawLogRootDir, setRawLogRootDir] = useState<string>(DEFAULTS.rawLogRootDir);
  const [rawLogPreviewMaxMb, setRawLogPreviewMaxMb] = useState<string>(
    DEFAULTS.rawLogPreviewMaxMb,
  );

  // Hydrate the form once the config KV lands. The live backend uses the
  // daily_etl_* / system_currency / default_exchange_rate / log_preview_* /
  // raw_log_* keys; the mock sample uses a subset, so missing keys keep their
  // defaults.
  useEffect(() => {
    if (!cfg) return;
    setEtlEnabled(cfg.daily_etl_enabled === "true");
    setCron(cfg.daily_etl_cron || DEFAULTS.cron);
    setEtlSource(cfg.daily_etl_source || DEFAULTS.etlSource);
    setCurrency(cfg.system_currency || DEFAULTS.currency);
    setRate(
      cfg.default_exchange_rate ||
        cfg.exchange_rate_usd_cny ||
        DEFAULTS.rate,
    );
    setLogPreviewSource(cfg.log_preview_source || DEFAULTS.logPreviewSource);
    setRawLogRootDir(cfg.raw_log_root_dir || DEFAULTS.rawLogRootDir);
    setRawLogPreviewMaxMb(
      cfg.raw_log_preview_max_mb || DEFAULTS.rawLogPreviewMaxMb,
    );
  }, [cfg]);

  // PG/ES datasources eligible to bind as the daily ETL source; log_storage
  // datasources eligible for log preview storage.
  const etlCandidates = (dsQ.data ?? []).filter(
    (d) => d.source_type === "postgres" || d.source_type === "elasticsearch",
  );
  const logPreviewCandidates = (dsQ.data ?? []).filter(
    (d) => d.source_type === "log_storage",
  );

  // Unknown keys (anything not covered by the form above) — shown read-only so
  // operators see the full stored config.
  const knownKeys = new Set([
    "daily_etl_enabled",
    "daily_etl_cron",
    "daily_etl_source",
    "system_currency",
    "default_exchange_rate",
    "log_preview_source",
    "raw_log_root_dir",
    "raw_log_preview_max_mb",
  ]);
  const extraKeys = cfg
    ? Object.keys(cfg).filter((k) => !knownKeys.has(k))
    : [];

  // Save handler. In the mock phase the mutation merges the patch onto the
  // cached KV without hitting the network; once wired it PUTs the chat config.
  function handleSave() {
    const patch: ChatSystemConfig = {
      daily_etl_enabled: etlEnabled ? "true" : "false",
      daily_etl_cron: cron,
      daily_etl_source: etlSource,
      system_currency: currency,
      default_exchange_rate: rate,
      log_preview_source: logPreviewSource,
      raw_log_root_dir: rawLogRootDir,
      raw_log_preview_max_mb: rawLogPreviewMaxMb,
    };
    updateCfg.mutate(patch);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Settings className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">System config</h1>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          {cfgQ.error ? (
            <ErrorBanner
              message={
                (cfgQ.error as Error)?.message || "Failed to load config."
              }
            />
          ) : null}

          <Section title="System config">
            <div className="space-y-4 p-4">
              {cfgQ.isLoading ? (
                <div className="max-w-lg space-y-3">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                <>
                  <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-sm text-card-foreground">
                    <input
                      type="checkbox"
                      checked={etlEnabled}
                      onChange={(e) => setEtlEnabled(e.target.checked)}
                      className="size-4 cursor-pointer"
                    />
                    Enable daily auto ETL
                  </label>

                  <SettingsField
                    label="Daily ETL cron expression"
                    hint="Daily 02:00 → 0 2 * * *"
                  >
                    <Input
                      type="text"
                      value={cron}
                      onChange={(e) => setCron(e.target.value)}
                      placeholder="0 2 * * *"
                      className="font-mono"
                    />
                  </SettingsField>

                  <SettingsField
                    label="Daily ETL datasource"
                    hint="Bound datasource for the daily sync. Leave empty to skip even when enabled. PostgreSQL / Elasticsearch only."
                  >
                    <NativeSelect
                      className="w-full"
                      value={etlSource}
                      onChange={(e) => setEtlSource(e.target.value)}
                    >
                      <option value="">Unbound</option>
                      {etlCandidates.map((d) => (
                        <option
                          key={d.id}
                          value={String(d.id)}
                          disabled={!d.is_enabled}
                        >
                          {d.name} ({d.source_type === "postgres" ? "PG" : "ES"})
                          {d.is_enabled ? "" : " - disabled"}
                        </option>
                      ))}
                    </NativeSelect>
                  </SettingsField>

                  <SettingsField
                    label="Log preview datasource"
                    hint="Storage datasource (log_storage) for raw-log preview. Leave empty to fall back to the dir/MB fields below."
                  >
                    <NativeSelect
                      className="w-full"
                      value={logPreviewSource}
                      onChange={(e) => setLogPreviewSource(e.target.value)}
                    >
                      <option value="">Unbound (use dir/MB below)</option>
                      {logPreviewCandidates.map((d) => (
                        <option
                          key={d.id}
                          value={String(d.id)}
                          disabled={!d.is_enabled}
                        >
                          {d.name} (log storage)
                          {d.is_enabled ? "" : " - disabled"}
                        </option>
                      ))}
                    </NativeSelect>
                  </SettingsField>

                  <SettingsField
                    label="System currency"
                    hint="Base currency for price storage and cost calculation. Only newly-created prices use this; existing prices are unaffected."
                  >
                    <NativeSelect
                      className="w-full"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      {CURRENCY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </NativeSelect>
                  </SettingsField>

                  <SettingsField
                    label="Default exchange rate (foreign → system)"
                    hint="Used as the default when adding a non-system-currency price; overridable per price."
                  >
                    <Input
                      type="number"
                      step="0.0001"
                      min="0.0001"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      placeholder="7.2420"
                    />
                  </SettingsField>

                  <SettingsField
                    label="Raw log root dir"
                    hint="local_log_path reads are constrained to this directory. Blank falls back to the chat service's raw_log_preview.root_dir."
                  >
                    <Input
                      type="text"
                      value={rawLogRootDir}
                      onChange={(e) => setRawLogRootDir(e.target.value)}
                      placeholder="/data/chat-logs or ./logs/raw"
                      className="font-mono"
                    />
                  </SettingsField>

                  <SettingsField
                    label="Log preview max size (MB)"
                    hint="Above this size only the file size + notice is shown; content is not rendered inline."
                  >
                    <Input
                      type="number"
                      step="0.5"
                      min="0.1"
                      value={rawLogPreviewMaxMb}
                      onChange={(e) => setRawLogPreviewMaxMb(e.target.value)}
                      placeholder="5"
                    />
                  </SettingsField>

                  <div className="flex items-center gap-3 pt-1">
                    <Button
                      type="button"
                      disabled={updateCfg.isPending}
                      onClick={handleSave}
                    >
                      <Save className="size-3.5" />
                      Save config
                    </Button>
                    {updateCfg.isError ? (
                      <ErrorBanner
                        message={
                          (updateCfg.error as Error)?.message ||
                          "Failed to save config."
                        }
                      />
                    ) : null}
                    {updateCfg.isSuccess ? (
                      <span className="text-xs text-success">
                        Config saved.
                      </span>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </Section>

          {extraKeys.length > 0 && (
            <Section title="Other stored keys" bodyClassName="p-4">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {extraKeys.map((k) => (
                  <div key={k} className="flex flex-col gap-0.5">
                    <dt className="break-all font-mono text-xs text-muted-foreground">
                      {k}
                    </dt>
                    <dd className="break-all text-sm text-card-foreground">
                      {cfg?.[k] ?? ""}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
