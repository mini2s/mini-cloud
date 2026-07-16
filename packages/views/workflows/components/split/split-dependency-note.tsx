"use client";

import { useT } from "@multica/views/i18n";
import type { SplitTask } from "@multica/core/types";

interface SplitDependencyNoteProps {
  tasks: SplitTask[];
}

function taskNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function buildDependencyRows(tasks: SplitTask[]): string[] {
  const numberByTaskId = new Map(tasks.map((task, index) => [task.id, taskNumber(index)]));
  return tasks
    .filter((task) => task.depends_on.length > 0)
    .map((task) => {
      const current = numberByTaskId.get(task.id) ?? task.id;
      const dependencies = task.depends_on
        .map((dependencyId) => numberByTaskId.get(dependencyId) ?? dependencyId)
        .join(", ");
      return `${dependencies} -> ${current}`;
    });
}

export function SplitDependencyNote({ tasks }: SplitDependencyNoteProps) {
  const { t } = useT("workflows");
  const rows = buildDependencyRows(tasks);

  if (tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(($) => $.detail_panel.split_dep_will_appear_after_draft)}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(($) => $.detail_panel.split_dep_can_start_in_parallel)}
      </p>
    );
  }

  return (
    <div
      data-testid="split-dependency-summary"
      className="space-y-1.5 rounded-md border bg-muted/20 px-3 py-2 text-xs text-foreground"
    >
      {rows.map((row) => (
        <div key={row} className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-muted-foreground/50" />
          <span>{row}</span>
        </div>
      ))}
    </div>
  );
}
