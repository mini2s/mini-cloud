"use client";

import { useState } from "react";
import { Coins, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatPricingOptions,
  chatSystemConfigOptions,
  currencySymbol,
  type ModelPricing,
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
import { PageHeader } from "../../layout/page-header";
import {
  ErrorBanner,
  NotWiredNotice,
  Section,
  SettingsField,
  Td,
  TdNum,
  Th,
  ThNum,
} from "./shared";
import { ToneBadge, type BadgeTone } from "../detail/shared";

// Settings · Model pricing. Ports the source Pricing.tsx to the shared-views
// layer. The read table (model / mode / input / output / cache rates /
// currency / dates) is the deliverable; the add/edit dialog is rendered as
// UI-only — submit surfaces NotWiredNotice because the chat upsertPricing
// mutation throws NOT_WIRED in the mock phase.
//
// Per-token prices are stored "per token" but shown/entered "per 1M tokens"
// (×/÷ 1_000_000), matching the source. Non-system currency rows carry the
// original currency + exchange rate for reference; the table shows the
// system-currency-converted rate.

const M = 1_000_000;

const CURRENCY_OPTIONS = ["CNY", "USD", "EUR", "GBP", "JPY"] as const;

const MODE_OPTIONS = [
  { value: "token", label: "Token" },
  { value: "request", label: "Per request" },
  { value: "hybrid", label: "Hybrid" },
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

export function PricingPage() {
  const wsId = useWorkspaceId();
  const pricingQ = useQuery(chatPricingOptions(wsId));
  const sysCfgQ = useQuery(chatSystemConfigOptions(wsId));

  const systemCurrency = sysCfgQ.data?.system_currency || "CNY";
  const defaultRate =
    Number(sysCfgQ.data?.default_exchange_rate) > 0
      ? Number(sysCfgQ.data?.default_exchange_rate)
      : 7.242;

  const rows = pricingQ.data ?? [];

  // Add/edit dialog state (editing=null means "add"). Submit is UI-only.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ModelPricing | null>(null);

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Coins className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">Model pricing</h1>
          <span className="truncate text-xs text-muted-foreground">
            · {rows.length} {rows.length === 1 ? "entry" : "entries"}
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
          Add pricing
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-4 p-6">
          <Section
            title="Model pricing"
            count={rows.length}
            bodyClassName="overflow-x-auto"
          >
            {pricingQ.error ? (
              <ErrorBanner
                message={
                  (pricingQ.error as Error)?.message ||
                  "Failed to load pricing."
                }
              />
            ) : null}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <Th>Model</Th>
                  <Th>Mode</Th>
                  <ThNum>
                    Input ({currencySymbol(systemCurrency)}/1M)
                  </ThNum>
                  <ThNum>
                    Output ({currencySymbol(systemCurrency)}/1M)
                  </ThNum>
                  <ThNum>
                    Cache ({currencySymbol(systemCurrency)}/1M)
                  </ThNum>
                  <ThNum>Per-request</ThNum>
                  <Th>Effective</Th>
                  <Th>Expires</Th>
                  <Th>Original currency</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {pricingQ.isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={10} className="px-3 py-2">
                        <Skeleton className="h-6 w-full rounded" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center">
                      <span className="text-sm text-muted-foreground">
                        No pricing yet — click “Add pricing” to begin.
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
                                {currencySymbol(systemCurrency)}0 (off)
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
                          <Badge variant="secondary">permanent</Badge>
                        )}
                      </Td>
                      <Td>
                        {r.original_currency ? (
                          <span
                            title={`Original ${r.original_currency}, rate ${r.exchange_rate ?? "-"}`}
                          >
                            <Badge variant="outline">{r.original_currency}</Badge>
                            <span className="ml-1 text-xs text-muted-foreground">
                              rate {r.exchange_rate ?? "-"}
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Section>

          <p className="text-xs text-muted-foreground">
            Non-{systemCurrency} currencies are converted to {systemCurrency} at
            the stored exchange rate for display; the original price is kept for
            reference. Token-mode cost ={" "}
            <code className="font-mono">
              prompt_tokens × input + completion_tokens × output
            </code>{" "}
            (cache tokens use the cache rate when set).
          </p>
        </div>
      </div>

      <PricingDialog
        open={dialogOpen}
        editing={editing}
        systemCurrency={systemCurrency}
        defaultRate={defaultRate}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

// ---- Add / edit dialog (UI only — submit is NOT_WIRED) ----

interface PricingDialogProps {
  open: boolean;
  editing: ModelPricing | null;
  systemCurrency: string;
  defaultRate: number;
  onClose: () => void;
}

function PricingDialog({
  open,
  editing,
  systemCurrency,
  defaultRate,
  onClose,
}: PricingDialogProps) {
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
  const [showNotWired, setShowNotWired] = useState(false);

  // Reset / hydrate the form whenever the dialog opens. The source used a
  // useEffect; here we key off `open` to flip local state on each open.
  // Using onOpenChange to re-seed avoids stale-props issues across edits.
  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
      return;
    }
    // Seed defaults for a fresh "add".
    setModelName(editing?.model_name ?? "");
    setMode(editing?.pricing_mode ?? "token");
    const cur = editing?.original_currency ?? systemCurrency;
    setCurrency(cur);
    setExchangeRate(
      editing?.exchange_rate != null
        ? String(editing.exchange_rate)
        : String(defaultRate),
    );
    const inp = editing
      ? (editing.original_currency
          ? editing.original_input_price
          : editing.input_price_per_token) ?? null
      : null;
    const out = editing
      ? (editing.original_currency
          ? editing.original_output_price
          : editing.output_price_per_token) ?? null
      : null;
    const cache = editing
      ? (editing.original_currency
          ? editing.original_cache_price
          : editing.cache_price_per_token) ?? null
      : null;
    const req = editing
      ? (editing.original_currency
          ? editing.original_request_price
          : editing.request_price) ?? null
      : null;
    setInputM(inp != null ? String(inp * M) : "");
    setOutputM(out != null ? String(out * M) : "");
    setCacheM(cache != null ? String(cache * M) : "");
    setRequestPrice(req != null ? String(req) : "");
    setEffectiveDate(dateOnly(editing?.effective_date));
    setEndDate(editing?.end_date ? dateOnly(editing.end_date) : "");
    setNotes(editing?.notes ?? "");
    setShowNotWired(false);
  }

  const showToken = mode === "token" || mode === "hybrid";
  const showRequest = mode === "request" || mode === "hybrid";
  const isNonSystemCurrency = currency !== systemCurrency;

  // Submit handler. UI-only in the mock phase — the chat upsertPricing stub
  // throws NOT_WIRED, so we surface the notice instead of attempting the call.
  function handleSubmit() {
    setShowNotWired(true);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `Edit pricing — ${editing.model_name}`
              : "Add model pricing"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <SettingsField label="Model name">
            <Input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="e.g. glm-4.6"
            />
          </SettingsField>

          <SettingsField label="Pricing mode">
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
            <SettingsField label="Original currency">
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
                label={`1 ${currency} → ${systemCurrency} rate`}
                hint={`Default: ${defaultRate}`}
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
                label={`Input token price (${currencySymbol(currency)}/1M)`}
                hint="Non-cache prompt tokens are billed at this rate."
              >
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={inputM}
                  onChange={(e) => setInputM(e.target.value)}
                  placeholder="e.g. 2.00 per 1M"
                />
              </SettingsField>
              <SettingsField
                label={`Output token price (${currencySymbol(currency)}/1M)`}
              >
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={outputM}
                  onChange={(e) => setOutputM(e.target.value)}
                  placeholder="e.g. 8.00 per 1M"
                />
              </SettingsField>
              <SettingsField
                label={`Cache token price (${currencySymbol(currency)}/1M)`}
                hint="Cached tokens use this discounted rate; blank/0 disables the discount."
              >
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cacheM}
                  onChange={(e) => setCacheM(e.target.value)}
                  placeholder="e.g. 0.50 (optional, 50% of input)"
                />
              </SettingsField>
            </>
          )}

          {showRequest && (
            <SettingsField label={`Per-request price (${currencySymbol(currency)})`}>
              <Input
                type="number"
                step="0.01"
                value={requestPrice}
                onChange={(e) => setRequestPrice(e.target.value)}
                placeholder="e.g. 0.05"
              />
            </SettingsField>
          )}

          <div className="grid grid-cols-2 gap-3">
            <SettingsField label="Effective date">
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </SettingsField>
            <SettingsField label="Expiry date" hint="Blank = permanent.">
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </SettingsField>
          </div>

          <SettingsField label="Notes">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Price source / change notes"
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
