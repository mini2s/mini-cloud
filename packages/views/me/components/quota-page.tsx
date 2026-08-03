"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useUserQuota, useUsageStatistics } from "@multica/core/quota";
import type { QuotaBatch, UsageConsumptionRecord } from "@multica/core/quota";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@multica/ui/components/ui/card";
import { Progress } from "@multica/ui/components/ui/progress";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@multica/ui/components/ui/table";
import { NativeSelect, NativeSelectOption } from "@multica/ui/components/ui/native-select";
import { Button } from "@multica/ui/components/ui/button";
import { useT } from "../../i18n";
import { DateRangePicker, type DateRangeValue } from "./date-range-picker";

// ── Helpers ───────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format an ISO date string. `YYYY-MM-DD` for date-only, `YYYY-MM-DD HH:mm`
 *  for datetime display (matches the source page's two display formats). */
function formatDate(input: string, withTime = false): string {
  if (!input) return "";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "";
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

/** Format a datetime param for the API: `YYYY-MM-DD HH:mm:ss`. */
function formatDateTimeParam(input: string): string {
  return `${input} 00:00:00`;
}

function formatNumber(n: number): string {
  return n.toFixed(2);
}

/** Windowed page list (max 5 pages around the current page). */
function rangePages(page: number, totalPages: number): number[] {
  const size = 5;
  if (totalPages <= size) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const start = Math.max(1, Math.min(page - 2, totalPages - size + 1));
  return Array.from({ length: size }, (_, i) => start + i);
}

const USAGE_PAGE_SIZE_OPTIONS = [10, 20, 50];
const QUOTA_PAGE_SIZE_OPTIONS = [3, 5, 10];

// ── Page ──────────────────────────────────────────────────────────────────

export function QuotaPage() {
  const { t } = useT("me");

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-4xl mx-auto p-4 md:p-6 space-y-6">
          <div>
            <h1 className="text-lg font-semibold">{t(($) => $.title)}</h1>
          </div>
          <QuotaOverviewSection />
          <UsageConsumptionSection />
        </div>
      </div>
    </div>
  );
}

// ── Quota Overview ────────────────────────────────────────────────────────

function QuotaOverviewSection() {
  const { t } = useT("me");
  const { data, isLoading } = useUserQuota();

  const used = data?.used_quota ?? 0;
  const total = data?.total_quota ?? 0;
  const remaining = total - used;
  const percentage = total === 0 ? 0 : Math.round((used / total) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(($) => $.quotaOverview)}</CardTitle>
        <CardDescription>{t(($) => $.quotaOverviewDesc)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && !data ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <span className="inline-block size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {t(($) => $.usedQuota, { used: formatNumber(used), total: formatNumber(total) })}
              </span>
              <span className="text-sm text-muted-foreground">
                {t(($) => $.remainingQuota, { remaining: formatNumber(remaining) })}
              </span>
            </div>
            <Progress value={percentage} />

            <div className="pt-1">
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                {t(($) => $.quotaValidity)}
              </h3>
              <QuotaValidityTable data={data?.quota_list ?? []} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function QuotaValidityTable({ data }: { data: QuotaBatch[] }) {
  const { t } = useT("me");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(3);

  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const start = (page - 1) * pageSize;
  const display = data.slice(start, start + pageSize);

  return (
    <div className="space-y-3">
      <div className="rounded-lg ring-1 ring-foreground/10 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>{t(($) => $.quota.expiryDate)}</TableHead>
              <TableHead>{t(($) => $.quota.amount)}</TableHead>
              <TableHead>{t(($) => $.quota.source)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                  {t(($) => $.quota.empty)}
                </TableCell>
              </TableRow>
            ) : (
              display.map((row, i) => (
                <TableRow key={`${row.expiry_date}-${i}`}>
                  <TableCell>{formatDate(row.expiry_date)}</TableCell>
                  <TableCell>{formatNumber(row.amount)}</TableCell>
                  <TableCell className="text-muted-foreground">{row.source || "-"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          totalCount={data.length}
          pageSizeOptions={QUOTA_PAGE_SIZE_OPTIONS}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}

// ── Usage Consumption ─────────────────────────────────────────────────────

type TimeRange = "today" | "7days" | "30days" | "custom";

function UsageConsumptionSection() {
  const { t } = useT("me");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  const [customRange, setCustomRange] = useState<DateRangeValue>(null);

  const params = buildUsageParams(page, pageSize, timeRange, customRange);
  const { data, isLoading, isFetching } = useUsageStatistics(params);

  const records: UsageConsumptionRecord[] = data?.records ?? [];
  const total = data?.total ?? 0;
  const showSpinner = isLoading && records.length === 0;

  const handlePreset = (range: TimeRange) => {
    setTimeRange(range);
    setCustomRange(null);
    setPage(1);
  };

  const handleCustomChange = (value: DateRangeValue) => {
    if (value && value.length === 2) {
      setTimeRange("custom");
      setCustomRange(value);
      setPage(1);
    } else if (!value) {
      setTimeRange("today");
      setCustomRange(null);
      setPage(1);
    }
  };

  const presetButtons: { key: TimeRange; label: string }[] = [
    { key: "today", label: t(($) => $.filter.today) },
    { key: "7days", label: t(($) => $.filter.within7Days) },
    { key: "30days", label: t(($) => $.filter.within30Days) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(($) => $.consumptionTitle)}</CardTitle>
        <CardDescription>{t(($) => $.consumptionDesc)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {presetButtons.map((btn) => (
            <Button
              key={btn.key}
              type="button"
              size="sm"
              variant={timeRange === btn.key ? "default" : "outline"}
              onClick={() => handlePreset(btn.key)}
            >
              {btn.label}
            </Button>
          ))}
          <DateRangePicker
            value={customRange}
            onChange={handleCustomChange}
            placeholder={t(($) => $.filter.custom)}
          />
        </div>

        <div className="rounded-lg ring-1 ring-foreground/10 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t(($) => $.table.startTime)}</TableHead>
                <TableHead>{t(($) => $.table.model)}</TableHead>
                <TableHead>{t(($) => $.table.mode)}</TableHead>
                <TableHead>{t(($) => $.table.creditsUsed)}</TableHead>
                <TableHead>{t(($) => $.table.package)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {showSpinner ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center">
                    <span className="inline-block size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
                  </TableCell>
                </TableRow>
              ) : records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    {t(($) => $.table.empty)}
                  </TableCell>
                </TableRow>
              ) : (
                records.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatDate(row.record_time, true)}</TableCell>
                    <TableCell>{row.model || "-"}</TableCell>
                    <TableCell>{row.mode || "-"}</TableCell>
                    <TableCell>{row.credits_used ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{row.package || "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            totalPages={Math.ceil(total / pageSize)}
            totalCount={total}
            pageSizeOptions={USAGE_PAGE_SIZE_OPTIONS}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            busy={isFetching}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Build the API query params from the current filter state. Preset ranges use
 *  `time_range`; a custom range serializes to `start_time`/`end_time`. */
function buildUsageParams(
  page: number,
  pageSize: number,
  timeRange: TimeRange,
  customRange: DateRangeValue,
) {
  if (timeRange === "custom" && customRange) {
    return {
      page,
      page_size: pageSize,
      start_time: formatDateTimeParam(customRange[0]),
      end_time: formatDateTimeParam(customRange[1]),
    };
  }
  return {
    page,
    page_size: pageSize,
    time_range: timeRange === "custom" ? undefined : timeRange,
  };
}

// ── Shared pagination ─────────────────────────────────────────────────────

function Pagination({
  page,
  pageSize,
  totalPages,
  totalCount,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  busy,
}: {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  busy?: boolean;
}) {
  const { t } = useT("me");
  const from = Math.min((page - 1) * pageSize + 1, totalCount);
  const to = Math.min(page * pageSize, totalCount);
  const pages = rangePages(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">
        {t(($) => $.pagination.summary, { from: String(from), to: String(to), total: String(totalCount) })}
      </span>
      <div className="flex items-center gap-3">
        <NativeSelect
          size="sm"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.currentTarget.value))}
        >
          {pageSizeOptions.map((size) => (
            <NativeSelectOption key={size} value={size}>
              {size} / {t(($) => $.pagination.page)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <div className="flex items-center gap-1">
          <PagerButton disabled={page <= 1 || busy} onClick={() => onPageChange(1)} aria-label="first">
            <ChevronsLeft className="size-4" />
          </PagerButton>
          <PagerButton disabled={page <= 1 || busy} onClick={() => onPageChange(page - 1)} aria-label="prev">
            <ChevronLeft className="size-4" />
          </PagerButton>
          {pages.map((p) => (
            <PagerButton
              key={p}
              active={p === page}
              disabled={busy}
              onClick={() => onPageChange(p)}
            >
              {p}
            </PagerButton>
          ))}
          <PagerButton disabled={page >= totalPages || busy} onClick={() => onPageChange(page + 1)} aria-label="next">
            <ChevronRight className="size-4" />
          </PagerButton>
          <PagerButton disabled={page >= totalPages || busy} onClick={() => onPageChange(totalPages)} aria-label="last">
            <ChevronsRight className="size-4" />
          </PagerButton>
        </div>
      </div>
    </div>
  );
}

function PagerButton({
  children,
  active,
  disabled,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
} & React.AriaAttributes) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs transition-colors disabled:pointer-events-none disabled:opacity-40 " +
        (active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground")
      }
      {...rest}
    >
      {children}
    </button>
  );
}
