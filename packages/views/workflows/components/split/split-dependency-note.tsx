"use client";

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
  const rows = buildDependencyRows(tasks);

  if (tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Dependencies will appear here after a draft is generated.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        These child issues can start in parallel.
      </p>
    );
  }

  return (
    <pre className="overflow-x-auto rounded-md border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-foreground">
      <code>{rows.join("\n")}</code>
    </pre>
  );
}
