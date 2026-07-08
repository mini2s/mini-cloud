"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Switch } from "@multica/ui/components/ui/switch";
import { Plus, Trash2, FileText, GitPullRequest } from "lucide-react";
import { useT } from "../../i18n";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  workflowNodeDeliverablesOptions,
  useCreateWorkflowNodeDeliverable,
  useUpdateWorkflowNodeDeliverable,
  useDeleteWorkflowNodeDeliverable,
} from "@multica/core/workflows/queries";
import type { WorkflowNodeDeliverable, WorkflowDeliverableKind } from "@multica/core/types";

function getKindOptions(t: ReturnType<typeof useT<"workflows">>["t"]) {
  return [
    { value: "document" as WorkflowDeliverableKind, icon: FileText, label: t(($) => $.detail_panel.deliverable_kind_document) },
    { value: "pull_request" as WorkflowDeliverableKind, icon: GitPullRequest, label: t(($) => $.detail_panel.deliverable_kind_pull_request) },
  ];
}

function DeliverableRow({
  workflowId,
  nodeId,
  deliverable,
  disabled,
  kindOptions,
  t,
}: {
  workflowId: string;
  nodeId: string;
  deliverable: WorkflowNodeDeliverable;
  disabled?: boolean;
  kindOptions: { value: WorkflowDeliverableKind; icon: typeof FileText; label: string }[];
  t: ReturnType<typeof useT<"workflows">>["t"];
}) {
  const wsId = useWorkspaceId();
  const updateMutation = useUpdateWorkflowNodeDeliverable(wsId, workflowId, nodeId);
  const deleteMutation = useDeleteWorkflowNodeDeliverable(wsId, workflowId, nodeId);
  const [draftTitle, setDraftTitle] = useState(deliverable.title);
  const composingRef = useRef(false);

  const kindOption = kindOptions.find((k) => k.value === deliverable.kind) ?? kindOptions[0]!;
  const KindIcon = kindOption.icon;

  useEffect(() => {
    setDraftTitle(deliverable.title);
  }, [deliverable.id, deliverable.title]);

  const saveTitle = (title: string) => {
    if (title === deliverable.title) return;
    updateMutation.mutate({ deliverableId: deliverable.id, title });
  };

  const cycleKind = () => {
    if (disabled) return;
    const next = kindOptions.find((k) => k.value !== deliverable.kind) ?? kindOptions[0]!;
    updateMutation.mutate({ deliverableId: deliverable.id, kind: next.value });
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={cycleKind}
        className="shrink-0 rounded p-0.5 hover:bg-muted"
        title={kindOption.label}
      >
        <KindIcon className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <Input
        disabled={disabled}
        value={draftTitle}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          const nextTitle = e.currentTarget.value;
          setDraftTitle(nextTitle);
          saveTitle(nextTitle);
        }}
        onChange={(e) => {
          const nextTitle = e.target.value;
          setDraftTitle(nextTitle);
          if (!composingRef.current) saveTitle(nextTitle);
        }}
        onBlur={(e) => saveTitle(e.currentTarget.value)}
        className="h-7 min-w-0 flex-1 text-xs"
        placeholder={t(($) => $.detail_panel.deliverable_title_placeholder)}
      />
      <div className="flex items-center gap-1 shrink-0">
        <Switch
          checked={deliverable.required}
          disabled={disabled}
          onCheckedChange={(checked) =>
            updateMutation.mutate({ deliverableId: deliverable.id, required: checked })
          }
          className="scale-75"
        />
        <span className="text-[10px] text-muted-foreground">{t(($) => $.detail_panel.deliverable_required)}</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || deleteMutation.isPending}
        className="h-6 w-6 shrink-0"
        onClick={() => deleteMutation.mutate(deliverable.id)}
      >
        <Trash2 className="h-3 w-3 text-muted-foreground" />
      </Button>
    </div>
  );
}

export function NodeDeliverablesEditor({
  workflowId,
  nodeId,
  disabled,
}: {
  workflowId: string;
  nodeId: string;
  disabled?: boolean;
}) {
  const wsId = useWorkspaceId();
  const { t } = useT("workflows");
  const kindOptions = useMemo(() => getKindOptions(t), [t]);
  const { data: deliverables = [] } = useQuery(
    workflowNodeDeliverablesOptions(wsId, workflowId, nodeId),
  );
  const createMutation = useCreateWorkflowNodeDeliverable(wsId, workflowId, nodeId);

  return (
    <div className="space-y-2">
      <Label className="text-sm">{t(($) => $.detail_panel.deliverable_section_label)}</Label>
      {deliverables.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t(($) => $.detail_panel.deliverable_empty)}
        </p>
      )}
      {deliverables.map((d) => (
        <DeliverableRow
          key={d.id}
          workflowId={workflowId}
          nodeId={nodeId}
          deliverable={d}
          disabled={disabled}
          kindOptions={kindOptions}
          t={t}
        />
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || createMutation.isPending}
        onClick={() =>
          createMutation.mutate({
            kind: "document",
            title: "",
            description: "",
            required: true,
            sort_order: deliverables.length,
          })
        }
        className="h-7 w-full text-xs"
      >
        <Plus className="h-3 w-3 mr-1" />
        {t(($) => $.detail_panel.deliverable_add)}
      </Button>
    </div>
  );
}
