"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Coins, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatPricingOptions,
  chatSystemConfigOptions,
  currencySymbol,
  useDeleteChatPricing,
  useUpsertChatPricing,
  type ModelPricing,
  type ModelPricingUpsert,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Badge } from "@multica/ui/components/ui/badge";
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
  TdNum,
  Th,
  ThNum,
} from "./shared";
import { ToneBadge, type BadgeTone } from "../detail/shared";

// Per-token prices are stored "per token" but shown/entered "per 1M tokens"
// (×/÷ 1_000_000), matching the source. Non-system currency rows carry the
// original currency + exchange rate for reference; the table shows the
// system-currency-converted rate.

const M = 1_000_000;

const CURRENCY_OPTIONS = ["CNY", "USD", "EUR", "GBP", "JPY"] as const;

const MODE_OPTIONS = [
  { value: "token", label: "Token 计价" },
  { value: "request", label: "请求次数计价" },
  { value: "hybrid", label: "混合计价" },
] as const;

const MODE_TONE: Record<string, BadgeTone> = {
  token: "primary",
  request: "warning",
  hybrid: "info",
};

/** per-token price → per-1M-tokens display ("¥3.5000"). */
function fmtPerM(
  v: number | null | undefined,
  currency: string,
): string {
  if (v == null) return "-";
  return `${currencySymbol(currency)}${(v * M).toFixed(4)}`;
}

/** Defensive YYYY-MM-DD slice (backend may return ISO with time). */
function dateOnly(v: string | null | undefined): string {
  return (v || "").slice(0, 10);
}

function buildFormulaDetail(r: ModelPricing): {
  title: string;
  formula: string;
  note: string;
} {
  const hasCache =
    r.cache_price_per_token != null && r.cache_price_per_token > 0;
  if (r.pricing_mode === "token") {
    if (hasCache) {
      return {
        title: "Token 计价（含缓存折扣）",
        formula:
          "费用 = (prompt_tokens - cache_tokens) × 输入单价\n    + cache_tokens × 缓存单价\n    + completion_tokens × 输出单价",
        note: "缓存命中的 token 使用折扣价，未命中部分按正常输入单价计费。",
      };
    }
    return {
      title: "Token 计价（无缓存折扣）",
      formula:
        "费用 = prompt_tokens × 输入单价\n    + completion_tokens × 输出单价",
      note: "缓存单价为 0 或未设置，所有输入 token 均按输入单价计费。",
    };
  }
  if (r.pricing_mode === "request") {
    return {
      title: "按请求次数计价",
      formula: "费用 = 请求次数 × 每次请求单价",
      note: "每次调用按固定单价计费，与 token 消耗量无关。",
    };
  }
  if (r.pricing_mode === "hybrid") {
    return {
      title: hasCache
        ? "混合计价（Token + 请求次数，含缓存折扣）"
        : "混合计价（Token + 请求次数）",
      formula: hasCache
        ? "费用 = (prompt_tokens - cache_tokens) × 输入单价\n    + cache_tokens × 缓存单价\n    + completion_tokens × 输出单价\n    + 请求次数 × 每次请求单价"
        : "费用 = prompt_tokens × 输入单价\n    + completion_tokens × 输出单价\n    + 请求次数 × 每次请求单价",
      note: "同时按 token 消耗和请求次数两种维度计费。",
    };
  }
  return { title: "未知计价方式", formula: "-", note: "" };
}

export function PricingPage() {
  const wsId = useWorkspaceId();
  const pricingQ = useQuery(chatPricingOptions(wsId));
  const sysCfgQ = useQuery(chatSystemConfigOptions(wsId));
  const deletePricing = useDeleteChatPricing();

  const systemCurrency = sysCfgQ.data?.system_currency || "CNY";
  const defaultRate =
    Number(sysCfgQ.data?.default_exchange_rate) > 0
      ? Number(sysCfgQ.data?.default_exchange_rate)
      : 7.242;

  const rows = pricingQ.data ?? [];

  // Add/edit dialog state (editing=null means "add").
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ModelPricing | null>(null);
  const [detailRecord, setDetailRecord] = useState<ModelPricing | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ModelPricing | null>(null);

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Coins className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">模型价格</h1>
          <span className="truncate text-xs text-muted-foreground">
            · {rows.length} 条
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
          新增价格
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:px-8">
          <Section
            title="模型价格"
            count={rows.length}
            bodyClassName="overflow-x-auto"
          >
            {pricingQ.error ? (
              <ErrorBanner
                message={
                  (pricingQ.error as Error)?.message ||
                  "获取价格列表失败"
                }
              />
            ) : null}

            <div className="border-b bg-success/5 px-4 py-3 text-xs leading-5 text-success">
              <strong>计价逻辑说明（点击"详情"查看完整公式）：</strong>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>
                  token：prompt_tokens × 输入单价 + completion_tokens ×
                  输出单价，设置缓存单价后缓存命中部分按折扣价计费。
                </li>
                <li>request：请求次数 × 每次请求单价。</li>
                <li>hybrid：token 部分成本 + 请求次数 × 每次请求单价。</li>
              </ul>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <Th>模型名</Th>
                  <Th>计价模式</Th>
                  <ThNum>
                    输入单价（{currencySymbol(systemCurrency)}/1M）
                  </ThNum>
                  <ThNum>
                    输出单价（{currencySymbol(systemCurrency)}/1M）
                  </ThNum>
                  <ThNum>
                    缓存单价（{currencySymbol(systemCurrency)}/1M）
                  </ThNum>
                  <ThNum>请求单价</ThNum>
                  <Th>生效日期</Th>
                  <Th>失效日期</Th>
                  <Th>原始货币</Th>
                  <Th>备注</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {pricingQ.isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={11} className="px-3 py-2">
                        <Skeleton className="h-6 w-full rounded" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-10 text-center">
                      <span className="text-sm text-muted-foreground">
                        暂无价格数据，点击"新增价格"开始
                      </span>
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b last:border-0 hover:bg-muted/50"
                    >
                      <Td>
                        <span className="font-medium text-card-foreground">
                          {r.model_name}
                        </span>
                      </Td>
                      <Td>
                        <ToneBadge tone={MODE_TONE[r.pricing_mode] ?? "neutral"}>
                          {r.pricing_mode}
                        </ToneBadge>
                      </Td>
                      <TdNum>{fmtPerM(r.input_price_per_token, systemCurrency)}</TdNum>
                      <TdNum>{fmtPerM(r.output_price_per_token, systemCurrency)}</TdNum>
                      <TdNum>
                        {r.cache_price_per_token == null
                          ? "-"
                          : r.cache_price_per_token === 0
                            ? (
                              <span className="text-muted-foreground">
                                {currencySymbol(systemCurrency)}0（不启用）
                              </span>
                            )
                            : fmtPerM(r.cache_price_per_token, systemCurrency)}
                      </TdNum>
                      <TdNum>
                        {r.request_price != null
                          ? `${currencySymbol(systemCurrency)}${r.request_price}`
                          : "-"}
                      </TdNum>
                      <Td>{dateOnly(r.effective_date) || "-"}</Td>
                      <Td>
                        {r.end_date ? (
                          dateOnly(r.end_date)
                        ) : (
                          <Badge variant="secondary">永久有效</Badge>
                        )}
                      </Td>
                      <Td>
                        {r.original_currency ? (
                          <span
                            title={`原始货币 ${r.original_currency}，汇率 ${r.exchange_rate ?? "-"}`}
                          >
                            <Badge variant="outline">{r.original_currency}</Badge>
                            <span className="ml-1 text-xs text-muted-foreground">
                              汇率 {r.exchange_rate ?? "-"}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </Td>
                      <Td>
                        <div
                          className="max-w-[160px] truncate text-muted-foreground"
                          title={r.notes || ""}
                        >
                          {r.notes || "-"}
                        </div>
                      </Td>
                      <Td>
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto p-0"
                            onClick={() => setDetailRecord(r)}
                          >
                            详情
                          </Button>
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
                            className="h-auto p-0 text-destructive"
                            onClick={() => {
                              deletePricing.reset();
                              setPendingDelete(r);
                            }}
                          >
                            删除
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Section>

          <p className="text-xs text-muted-foreground">
            非 {systemCurrency} 货币按汇率换算为 {systemCurrency}
            存储，原始价格保留参考。Token 计价费用 ={" "}
            <code className="font-mono">
              prompt_tokens × input + completion_tokens × output
            </code>{" "}
            （设置缓存单价后，缓存命中部分按折扣价计费）。
          </p>
        </div>
      </div>

      <PricingDialog
        open={dialogOpen}
        editing={editing}
        systemCurrency={systemCurrency}
        defaultRate={defaultRate}
        onClose={() => setDialogOpen(false)}
        onSaved={() => setDialogOpen(false)}
      />

      <PricingDetailDialog
        record={detailRecord}
        systemCurrency={systemCurrency}
        onClose={() => setDetailRecord(null)}
      />

      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open && !deletePricing.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除"{pendingDelete?.model_name}"（生效日期{" "}
              {dateOnly(pendingDelete?.effective_date)}）的价格记录吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deletePricing.error ? (
            <ErrorBanner
              message={(deletePricing.error as Error)?.message || "删除失败"}
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePricing.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deletePricing.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!pendingDelete) return;
                deletePricing.mutate(pendingDelete.id, {
                  onSuccess: () => setPendingDelete(null),
                });
              }}
            >
              {deletePricing.isPending ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PricingDetailDialog({
  record,
  systemCurrency,
  onClose,
}: {
  record: ModelPricing | null;
  systemCurrency: string;
  onClose: () => void;
}) {
  const detail = record ? buildFormulaDetail(record) : null;
  return (
    <Dialog open={record != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>模型价格详情 — {record?.model_name ?? ""}</DialogTitle>
        </DialogHeader>
        {record && detail ? (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <DetailItem label="计价模式">
                <ToneBadge
                  tone={MODE_TONE[record.pricing_mode] ?? "neutral"}
                >
                  {record.pricing_mode}
                </ToneBadge>
              </DetailItem>
              <DetailItem label="货币">
                {record.original_currency
                  ? `${record.original_currency} → ${systemCurrency}（汇率 ${record.exchange_rate ?? "-"}）`
                  : systemCurrency}
              </DetailItem>
              <DetailItem
                label={`输入单价（${currencySymbol(systemCurrency)}/1M）`}
              >
                {fmtPerM(record.input_price_per_token, systemCurrency)}
              </DetailItem>
              <DetailItem
                label={`输出单价（${currencySymbol(systemCurrency)}/1M）`}
              >
                {fmtPerM(record.output_price_per_token, systemCurrency)}
              </DetailItem>
              <DetailItem
                label={`缓存单价（${currencySymbol(systemCurrency)}/1M）`}
              >
                {record.cache_price_per_token == null
                  ? "-"
                  : record.cache_price_per_token === 0
                    ? `${currencySymbol(systemCurrency)}0（不启用折扣）`
                    : fmtPerM(
                        record.cache_price_per_token,
                        systemCurrency,
                      )}
              </DetailItem>
              <DetailItem label="请求单价">
                {record.request_price != null
                  ? `${currencySymbol(systemCurrency)}${record.request_price}`
                  : "-"}
              </DetailItem>
              {record.original_currency ? (
                <>
                  <DetailItem
                    label={`原始输入价（${record.original_currency}/1M）`}
                  >
                    {fmtPerM(
                      record.original_input_price,
                      record.original_currency,
                    )}
                  </DetailItem>
                  <DetailItem
                    label={`原始输出价（${record.original_currency}/1M）`}
                  >
                    {fmtPerM(
                      record.original_output_price,
                      record.original_currency,
                    )}
                  </DetailItem>
                </>
              ) : null}
              <DetailItem label="生效日期">
                {dateOnly(record.effective_date) || "-"}
              </DetailItem>
              <DetailItem label="失效日期">
                {record.end_date ? dateOnly(record.end_date) : "永久有效"}
              </DetailItem>
              {record.notes ? (
                <div className="col-span-2">
                  <DetailItem label="备注">{record.notes}</DetailItem>
                </div>
              ) : null}
            </dl>
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="mb-2 font-semibold text-card-foreground">
                {detail.title}
              </div>
              <pre className="mb-2 whitespace-pre-wrap rounded-md bg-background p-3 text-xs text-primary">
                {detail.formula}
              </pre>
              {detail.note ? (
                <p className="text-xs text-muted-foreground">{detail.note}</p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                字段说明：prompt_tokens = 输入总 token（含缓存命中部分），
                cache_tokens = 缓存命中 token，completion_tokens = 输出 token
              </p>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-card-foreground">{children}</dd>
    </div>
  );
}

// ---- Add / edit dialog ----

interface PricingDialogProps {
  open: boolean;
  editing: ModelPricing | null;
  systemCurrency: string;
  defaultRate: number;
  onClose: () => void;
  onSaved: () => void;
}

function PricingDialog({
  open,
  editing,
  systemCurrency,
  defaultRate,
  onClose,
  onSaved,
}: PricingDialogProps) {
  const upsertPricing = useUpsertChatPricing();
  const [modelName, setModelName] = useState("");
  const [mode, setMode] = useState<string>("token");
  const [currency, setCurrency] = useState<string>(systemCurrency);
  const [exchangeRate, setExchangeRate] = useState<string>("");
  const [inputM, setInputM] = useState("");
  const [outputM, setOutputM] = useState("");
  const [cacheM, setCacheM] = useState("");
  const [requestPrice, setRequestPrice] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return;
    setFormError("");
    if (!editing) {
      setModelName("");
      setMode("token");
      setCurrency(systemCurrency);
      setExchangeRate(String(defaultRate));
      setInputM("");
      setOutputM("");
      setCacheM("");
      setRequestPrice("");
      setEffectiveDate("");
      setEndDate("");
      setNotes("");
      return;
    }

    setModelName(editing.model_name);
    setMode(editing.pricing_mode || "token");
    const cur = editing.original_currency || systemCurrency;
    setCurrency(cur);
    setExchangeRate(
      editing.exchange_rate != null
        ? String(editing.exchange_rate)
        : String(defaultRate),
    );
    const inp = editing.original_currency
      ? editing.original_input_price
      : editing.input_price_per_token;
    const out = editing.original_currency
      ? editing.original_output_price
      : editing.output_price_per_token;
    const cache = editing.original_currency
      ? editing.original_cache_price
      : editing.cache_price_per_token;
    const req = editing.original_currency
      ? editing.original_request_price
      : editing.request_price;
    setInputM(inp != null ? String(inp * M) : "");
    setOutputM(out != null ? String(out * M) : "");
    setCacheM(cache != null ? String(cache * M) : "");
    setRequestPrice(req != null ? String(req) : "");
    setEffectiveDate(dateOnly(editing.effective_date));
    setEndDate(editing.end_date ? dateOnly(editing.end_date) : "");
    setNotes(editing.notes ?? "");
  }, [defaultRate, editing, open, systemCurrency]);

  const showToken = mode === "token" || mode === "hybrid";
  const showRequest = mode === "request" || mode === "hybrid";
  const isNonSystemCurrency = currency !== systemCurrency;

  function handleSubmit() {
    const numOrNull = (value: string): number | null => {
      if (value.trim() === "") return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const name = modelName.trim();
    if (!name) {
      setFormError("请输入模型名");
      return;
    }
    if (!effectiveDate) {
      setFormError("请选择生效日期");
      return;
    }
    const rate = numOrNull(exchangeRate);
    if (isNonSystemCurrency && (rate == null || rate <= 0)) {
      setFormError("非系统币种必须填写有效汇率");
      return;
    }

    const inputPerM = showToken ? numOrNull(inputM) : null;
    const outputPerM = showToken ? numOrNull(outputM) : null;
    const cachePerM = showToken ? numOrNull(cacheM) : null;

    const payload: ModelPricingUpsert = {
      id: editing?.id,
      model_name: name,
      pricing_mode: mode,
      input_price_per_token: inputPerM != null ? inputPerM / M : null,
      output_price_per_token: outputPerM != null ? outputPerM / M : null,
      cache_price_per_token: cachePerM != null ? cachePerM / M : null,
      request_price: showRequest ? numOrNull(requestPrice) : null,
      currency,
      exchange_rate: isNonSystemCurrency ? rate : null,
      original_currency: null,
      original_input_price: null,
      original_output_price: null,
      original_cache_price: null,
      original_request_price: null,
      effective_date: effectiveDate,
      end_date: endDate ? endDate : null,
      notes: notes.trim() || null,
    };
    setFormError("");
    upsertPricing.mutate(payload, {
      onSuccess: () => onSaved(),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !upsertPricing.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `修改模型价格 — ${editing.model_name}`
              : "新增模型价格"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {formError ? <ErrorBanner message={formError} /> : null}

          <SettingsField label="模型名">
            <Input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="如 deepseek-v3"
            />
          </SettingsField>

          <SettingsField label="计价方案">
            <NativeSelect
              className="w-full"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </SettingsField>

          <div className="grid grid-cols-2 gap-3">
            <SettingsField label="原始货币">
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
            {isNonSystemCurrency && (
              <SettingsField
                label={`1 ${currency} 兑换 ${systemCurrency} 汇率`}
                hint={`系统默认：${defaultRate}`}
              >
                <Input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                />
              </SettingsField>
            )}
          </div>

          {showToken && (
            <>
              <SettingsField
                label={`输入 Token 单价（${currencySymbol(currency)}/1M tokens）`}
                hint="用于 prompt_tokens 中非缓存命中部分的计费"
              >
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={inputM}
                  onChange={(e) => setInputM(e.target.value)}
                  placeholder="如 2.00（每百万 tokens）"
                />
              </SettingsField>
              <SettingsField
                label={`输出 Token 单价（${currencySymbol(currency)}/1M tokens）`}
                hint="用于 completion_tokens 的计费"
              >
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={outputM}
                  onChange={(e) => setOutputM(e.target.value)}
                  placeholder="如 8.00（每百万 tokens）"
                />
              </SettingsField>
              <SettingsField
                label={`缓存 Token 单价（${currencySymbol(currency)}/1M tokens）`}
                hint="缓存命中 token 按此折扣价计费；留空或填 0 则不启用折扣"
              >
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cacheM}
                  onChange={(e) => setCacheM(e.target.value)}
                  placeholder="如 0.50（可选，输入价的 50%）"
                />
              </SettingsField>
            </>
          )}

          {showRequest && (
            <SettingsField
              label={`每次请求单价（${currencySymbol(currency)}）`}
            >
              <Input
                type="number"
                step="0.01"
                value={requestPrice}
                onChange={(e) => setRequestPrice(e.target.value)}
                placeholder="如 0.05"
              />
            </SettingsField>
          )}

          <div className="grid grid-cols-2 gap-3">
            <SettingsField label="生效日期">
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </SettingsField>
            <SettingsField label="失效日期" hint="留空表示永久有效">
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </SettingsField>
          </div>

          <SettingsField label="备注">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="价格来源、变更说明"
            />
          </SettingsField>

          {isNonSystemCurrency ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
              价格将按汇率 <strong>{exchangeRate || defaultRate}</strong> 将{" "}
              {currency} 换算为 {systemCurrency} 存储并用于计算，原始价格保留参考。
            </div>
          ) : null}

          {upsertPricing.error ? (
            <ErrorBanner
              message={
                (upsertPricing.error as Error)?.message ||
                "保存价格失败"
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
            disabled={upsertPricing.isPending}
            onClick={handleSubmit}
          >
            {upsertPricing.isPending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
