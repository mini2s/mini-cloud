import { formatV2Ratio } from "@multica/core/efficiency";

// Decimal-ratio pill (source RatioPill): value is a decimal multiplier, so
// 0.25 renders as "25.0%". Tone thresholds match the source dashboard —
// <0 red, >=300 green, >=150 blue, else neutral.

type Tone = "pos" | "neg" | "info" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  pos: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  neg: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300",
  neutral: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
};

function toneOf(value: number | null | undefined): Tone {
  if (value == null || !Number.isFinite(value)) return "neutral";
  const pct = value * 100;
  if (pct < 0) return "neg";
  if (pct >= 300) return "pos";
  if (pct >= 150) return "info";
  return "neutral";
}

export function RatioPill({
  value,
  digits = 1,
}: {
  value: number | null | undefined;
  digits?: number;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${TONE_CLASS[toneOf(value)]}`}
    >
      {formatV2Ratio(value, digits)}
    </span>
  );
}
