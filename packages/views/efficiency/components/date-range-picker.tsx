"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { enUS, zhCN } from "react-day-picker/locale";
import { getDefaultDateRangeWide } from "@multica/core/efficiency";
import { Calendar } from "@multica/ui/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover";
import { buttonVariants } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";

// Date range picker — preset shortcuts plus a custom range calendar. Replaces
// the 7d/30d/90d-only PeriodSelect with the full selection model of the source
// project's top-bar picker (efficiency-dashboard
// frontend-react/src/components/ui/DateRangePicker.tsx), rebuilt on the shadcn
// Popover + react-day-picker primitives instead of the source's dual native
// date inputs. Shortcuts and the committed [start, end] YYYY-MM-DD contract
// match the source one-for-one; the committed value only changes when a full
// range (shortcut, or both calendar endpoints) is chosen — a half-picked range
// stays a local draft so closing the popover discards it.

const SHORTCUTS = [
  { key: "today", days: 1 },
  { key: "one_day_ago", days: 2 },
  { key: "three_days_ago", days: 4 },
  { key: "one_week_ago", days: 7 },
  { key: "one_month_ago", days: 30 },
  { key: "three_months_ago", days: 90 },
] as const;

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Local-time parse (no UTC shift), matching core/efficiency/utils/date.ts.
function parseDay(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(value + "T00:00:00");
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function DateRangePicker({
  value,
  onChange,
  align = "end",
  defaultOpen = false,
}: {
  value: [string, string];
  onChange: (range: [string, string]) => void;
  align?: "start" | "center" | "end";
  /** Open the popover on first mount. Used by tests to reach the calendar
   *  without a trigger click. */
  defaultOpen?: boolean;
}) {
  const { t, i18n } = useT("efficiency");
  const [open, setOpen] = useState(defaultOpen);
  const [start, end] = value;
  // Draft selection while the popover is open. Deriving `selected` straight
  // from the committed value would lose the user's first click on re-render.
  const [draft, setDraft] = useState<DateRange | undefined>(() => ({
    from: parseDay(start),
    to: parseDay(end),
  }));
  // Whether the user has begun a fresh range since the popover opened.
  // react-day-picker's addToRange moves the *end* of a complete range on the
  // next click instead of restarting, so without this the very first click
  // would silently commit [oldStart, clickedDay].
  const [picking, setPicking] = useState(false);
  const calendarLocale = (
    i18n.resolvedLanguage ?? i18n.language
  ).startsWith("zh")
    ? zhCN
    : enUS;
  const shortcutLabels = {
    today: t(($) => $.common.date_range.today),
    one_day_ago: t(($) => $.common.date_range.one_day_ago),
    three_days_ago: t(($) => $.common.date_range.three_days_ago),
    one_week_ago: t(($) => $.common.date_range.one_week_ago),
    one_month_ago: t(($) => $.common.date_range.one_month_ago),
    three_months_ago: t(($) => $.common.date_range.three_months_ago),
  };

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setDraft({ from: parseDay(start), to: parseDay(end) });
      setPicking(false);
    }
  }

  function handleSelect(range: DateRange | undefined, day: Date) {
    if (!picking) {
      // First click after opening starts a fresh range from the clicked day.
      setDraft({ from: day, to: undefined });
      setPicking(true);
      return;
    }
    setDraft(range);
    if (range?.from && range?.to) {
      onChange([fmt(range.from), fmt(range.to)]);
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "font-normal",
        )}
      >
        <CalendarDays className="text-muted-foreground" />
        <span className="tabular-nums">
          {start} ~ {end}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-auto flex-row gap-0 p-0" align={align}>
        <div className="flex flex-col gap-0.5 border-r p-2">
          {SHORTCUTS.map((sc) => (
            <button
              key={sc.key}
              type="button"
              onClick={() => {
                onChange(getDefaultDateRangeWide(sc.days));
                setOpen(false);
              }}
              className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {shortcutLabels[sc.key]}
            </button>
          ))}
        </div>
        <Calendar
          mode="range"
          locale={calendarLocale}
          selected={draft}
          onSelect={handleSelect}
          defaultMonth={parseDay(start)}
        />
      </PopoverContent>
    </Popover>
  );
}
