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

const CURRENCY_OPTIONS = [
  { value: "CNY", label: "CNY（人民币）" },
  { value: "USD", label: "USD（美元）" },
  { value: "EUR", label: "EUR（欧元）" },
  { value: "GBP", label: "GBP（英镑）" },
  { value: "JPY", label: "JPY（日元）" },
] as const;

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
  const [saveMessage, setSaveMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

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

  function handleSave() {
    const rateNumber = Number(rate.trim());
    const previewMaxMb =
      rawLogPreviewMaxMb.trim() === ""
        ? 5
        : Number(rawLogPreviewMaxMb.trim());
    if (!Number.isFinite(rateNumber) || rateNumber <= 0) {
      setSaveMessage({ ok: false, text: "默认汇率必须为正数" });
      return;
    }
    if (!Number.isFinite(previewMaxMb) || previewMaxMb <= 0) {
      setSaveMessage({
        ok: false,
        text: "日志预览最大大小必须为正数",
      });
      return;
    }
    if (etlEnabled && !etlSource) {
      setSaveMessage({
        ok: false,
        text: "启用定时 ETL 时必须选择绑定数据源",
      });
      return;
    }

    const patch: ChatSystemConfig = {
      daily_etl_enabled: etlEnabled ? "true" : "false",
      daily_etl_cron: cron.trim(),
      daily_etl_source: etlSource,
      system_currency: currency,
      default_exchange_rate: String(rateNumber),
      log_preview_source: logPreviewSource,
      raw_log_root_dir: rawLogRootDir.trim(),
      raw_log_preview_max_mb: String(previewMaxMb),
    };
    setSaveMessage(null);
    updateCfg.mutate(patch, {
      onSuccess: () => setSaveMessage({ ok: true, text: "配置已保存" }),
      onError: (error) =>
        setSaveMessage({
          ok: false,
          text: (error as Error)?.message || "保存失败",
        }),
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Settings className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">系统配置</h1>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          {cfgQ.error ? (
            <ErrorBanner
              message={
                (cfgQ.error as Error)?.message || "获取配置失败"
              }
            />
          ) : null}

          <Section title="系统配置">
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
                    启用每日自动 ETL
                  </label>

                  <SettingsField
                    label="定时任务 Cron 表达式"
                    hint="每天凌晨 2 点：0 2 * * *"
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
                    label="定时任务数据源"
                    hint="定时 ETL 绑定的数据源。留空则即使启用定时，也不会执行同步。仅支持 PostgreSQL 和 Elasticsearch。"
                  >
                    <NativeSelect
                      className="w-full"
                      value={etlSource}
                      onChange={(e) => setEtlSource(e.target.value)}
                    >
                      <option value="">未绑定</option>
                      {etlCandidates.map((d) => (
                        <option
                          key={d.id}
                          value={String(d.id)}
                          disabled={!d.is_enabled}
                        >
                          {d.name} ({d.source_type === "postgres" ? "PG" : "ES"})
                          {d.is_enabled ? "" : " - 未启用"}
                        </option>
                      ))}
                    </NativeSelect>
                  </SettingsField>

                  <SettingsField
                    label="日志预览存储数据源"
                    hint="选择原始日志预览使用的存储数据源（source_type=log_storage）。留空则回退到下方目录/MB 配置。"
                  >
                    <NativeSelect
                      className="w-full"
                      value={logPreviewSource}
                      onChange={(e) => setLogPreviewSource(e.target.value)}
                    >
                      <option value="">未绑定（使用下方目录/MB）</option>
                      {logPreviewCandidates.map((d) => (
                        <option
                          key={d.id}
                          value={String(d.id)}
                          disabled={!d.is_enabled}
                        >
                          {d.name}（日志存储）
                          {d.is_enabled ? "" : " - 未启用"}
                        </option>
                      ))}
                    </NativeSelect>
                  </SettingsField>

                  <SettingsField
                    label="系统币种"
                    hint="价格存储和成本计算使用的基准币种。修改后新建的价格按新币种换算，已有价格不受影响。"
                  >
                    <NativeSelect
                      className="w-full"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      {CURRENCY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </SettingsField>

                  <SettingsField
                    label="默认汇率（外币兑换系统币种）"
                    hint="新增模型价格时，非系统币种默认使用此汇率换算，可在价格编辑时单独修改。"
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
                    label="原始日志根目录"
                    hint="local_log_path 会被限制在该目录内读取。留空时使用 chat 服务 config.yaml 中的 raw_log_preview.root_dir。"
                  >
                    <Input
                      type="text"
                      value={rawLogRootDir}
                      onChange={(e) => setRawLogRootDir(e.target.value)}
                      placeholder="/data/chat-logs 或 ./logs/raw"
                      className="font-mono"
                    />
                  </SettingsField>

                  <SettingsField
                    label="日志预览最大大小（MB）"
                    hint="超过该大小时只显示文件大小和提示，不在线展示内容。"
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
                      {updateCfg.isPending ? "保存中..." : "保存配置"}
                    </Button>
                    {saveMessage ? (
                      <span
                        className={`text-sm ${
                          saveMessage.ok
                            ? "text-success"
                            : "text-destructive"
                        }`}
                      >
                        {saveMessage.text}
                      </span>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </Section>

          {extraKeys.length > 0 && (
            <Section title="其他已存储配置" bodyClassName="p-4">
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
