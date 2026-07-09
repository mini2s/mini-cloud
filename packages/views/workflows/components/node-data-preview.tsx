"use client";

import type { NodeRunStatus, WorkflowNodeRun } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { useT } from "../../i18n";

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;

  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

export function NodeDataPreview({ nodeRun }: { nodeRun: WorkflowNodeRun | null }) {
  const { t } = useT("workflows");

  if (!nodeRun) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        {t(($) => $.node.data_preview.empty)}
      </div>
    );
  }

  const status = nodeRun.status as NodeRunStatus;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {t(($) => $.node.data_preview.status)}
        </span>
        <Badge variant="secondary" className="h-5 text-[11px]">
          {t(($) => $.node_run.status[status as keyof typeof $.node_run.status] ?? status)}
        </Badge>
      </div>
      <JsonBlock label={t(($) => $.node.data_preview.worker_output)} value={nodeRun.worker_output} />
      <JsonBlock label={t(($) => $.node.data_preview.critic_output)} value={nodeRun.critic_output} />
      {nodeRun.critic_comment ? (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t(($) => $.node.data_preview.critic_comment)}
          </h4>
          <p className="rounded-md border bg-muted/30 p-2 text-xs leading-relaxed">
            {nodeRun.critic_comment}
          </p>
        </section>
      ) : null}
    </div>
  );
}
