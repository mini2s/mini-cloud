"use client";

import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@multica/ui/components/ui/calendar";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@multica/ui/components/ui/popover";
import { Button } from "@multica/ui/components/ui/button";
import { useT } from "../../i18n";

/** `[fromStr, toStr]` in `YYYY-MM-DD`, or `null` when cleared. */
export type DateRangeValue = [string, string] | null;

function toDate(str: string | undefined): Date | undefined {
  if (!str) return undefined;
  const d = new Date(str);
  return isNaN(d.getTime()) ? undefined : d;
}

/** Format a `YYYY-MM-DD` string to a localized `M/D` short label. */
function shortLabel(str: string): string {
  const d = toDate(str);
  if (!d) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Custom date-range picker for the My Quota usage filter. Mirrors the source
 * project's kanban DateRangePicker UX: a trigger that shows the active range
 * (or a placeholder), a `react-day-picker` range calendar, and a clear action.
 * Returns the range as `YYYY-MM-DD` string tuples so the caller can append the
 * time component before sending to the API.
 */
export function DateRangePicker({
  value,
  onChange,
  placeholder,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  placeholder: string;
}) {
  const { t } = useT("me");
  const [open, setOpen] = useState(false);

  const selected: DateRange | undefined = value
    ? { from: toDate(value[0]), to: toDate(value[1]) }
    : undefined;

  const triggerLabel = value
    ? `${shortLabel(value[0])} - ${shortLabel(value[1])}`
    : placeholder;

  const handleSelect = (range: DateRange | undefined) => {
    if (!range || (!range.from && !range.to)) {
      onChange(null);
      return;
    }
    const from = range.from
      ? range.from.toISOString().slice(0, 10)
      : undefined;
    const to = range.to
      ? range.to.toISOString().slice(0, 10)
      : undefined;
    // Only commit once both ends are picked. react-day-picker fires onSelect
    // after the first click with only `from` set; waiting for `to` matches the
    // source project's behavior of confirming a full range.
    if (from && to) {
      onChange([from, to]);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex h-7 items-center gap-1.5 rounded-[min(var(--radius-md),12px)] border border-input bg-background px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground"
        aria-label={placeholder}
      >
        <CalendarDays className="size-3.5 text-muted-foreground" />
        <span className={value ? "" : "text-muted-foreground"}>{triggerLabel}</span>
        {value ? (
          <X
            className="size-3 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            aria-label={t(($) => $.filter.custom)}
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={selected}
          onSelect={handleSelect}
          numberOfMonths={1}
        />
        {value && (
          <div className="border-t px-3 py-2">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              {t(($) => $.filter.custom)}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
