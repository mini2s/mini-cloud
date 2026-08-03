export interface RuntimeDurationInput {
  summarySeconds: number | null | undefined;
  startedAt: string | null | undefined;
  completedAt: string | null | undefined;
  nowMs: number;
}

export function resolveRuntimeDurationSeconds({
  summarySeconds,
  startedAt,
  completedAt,
  nowMs,
}: RuntimeDurationInput): number | null {
  if (
    typeof summarySeconds === "number" &&
    Number.isFinite(summarySeconds) &&
    summarySeconds >= 0
  ) {
    return Math.floor(summarySeconds);
  }

  if (!startedAt || !Number.isFinite(nowMs)) return null;
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) return null;

  const endAtMs = completedAt ? Date.parse(completedAt) : nowMs;
  if (!Number.isFinite(endAtMs) || endAtMs < startedAtMs) return null;
  return Math.floor((endAtMs - startedAtMs) / 1000);
}

export function formatRuntimeDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`;
}
