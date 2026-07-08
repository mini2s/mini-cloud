"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Switch } from "@multica/ui/components/ui/switch";
import { Plus, Trash2, FileText, GitPullRequest } from "lucide-react";
import { useT } from "../../i18n";
import type { WorkflowNodeDeliverable, WorkflowDeliverableKind } from "@multica/core/types";

export type WorkflowNodeDeliverableDraft = WorkflowNodeDeliverable & {
  isDraft?: boolean;
};

function getKindOptions(t: ReturnType<typeof useT<"workflows">>["t"]) {
  return [
    { value: "document" as WorkflowDeliverableKind, icon: FileText, label: t(($) => $.detail_panel.deliverable_kind_document) },
    { value: "pull_request" as WorkflowDeliverableKind, icon: GitPullRequest, label: t(($) => $.detail_panel.deliverable_kind_pull_request) },
  ];
}

function DeliverableRow({
  deliverable,
  disabled,
  kindOptions,
  t,
  onChange,
  onDelete,
}: {
  deliverable: WorkflowNodeDeliverableDraft;
  disabled?: boolean;
  kindOptions: { value: WorkflowDeliverableKind; icon: typeof FileText; label: string }[];
  t: ReturnType<typeof useT<"workflows">>["t"];
  onChange: (deliverable: WorkflowNodeDeliverableDraft) => void;
  onDelete: (deliverableId: string) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(deliverable.title);
  const composingRef = useRef(false);

  const kindOption = kindOptions.find((k) => k.value === deliverable.kind) ?? kindOptions[0]!;
  const KindIcon = kindOption.icon;

  useEffect(() => {
    setDraftTitle(deliverable.title);
  }, [deliverable.id, deliverable.title]);

  const saveTitle = (title: string) => {
    if (title === deliverable.title) return;
    onChange({ ...deliverable, title });
  };

  const cycleKind = () => {
    if (disabled) return;
    const next = kindOptions.find((k) => k.value !== deliverable.kind) ?? kindOptions[0]!;
    onChange({ ...deliverable, kind: next.value });
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
            onChange({ ...deliverable, required: checked })
          }
          className="scale-75"
        />
        <span className="text-[10px] text-muted-foreground">{t(($) => $.detail_panel.deliverable_required)}</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        className="h-6 w-6 shrink-0"
        onClick={() => onDelete(deliverable.id)}
      >
        <Trash2 className="h-3 w-3 text-muted-foreground" />
      </Button>
    </div>
  );
}

export function NodeDeliverablesEditor({
  nodeId,
  disabled,
  deliverables,
  onChange,
}: {
  nodeId: string;
  disabled?: boolean;
  deliverables: WorkflowNodeDeliverableDraft[];
  onChange: (deliverables: WorkflowNodeDeliverableDraft[]) => void;
}) {
  const { t } = useT("workflows");
  const kindOptions = useMemo(() => getKindOptions(t), [t]);

  const updateDeliverable = (next: WorkflowNodeDeliverableDraft) => {
    onChange(deliverables.map((d) => (d.id === next.id ? next : d)));
  };

  const deleteDeliverable = (deliverableId: string) => {
    onChange(deliverables.filter((d) => d.id !== deliverableId));
  };

  const addDeliverable = () => {
    const now = new Date().toISOString();
    onChange([
      ...deliverables,
      {
        id: `draft-${Date.now()}`,
        workflow_node_id: nodeId,
        kind: "document",
        title: t(($) => $.detail_panel.deliverable_default_title),
        description: "",
        required: true,
        sort_order: deliverables.length,
        created_at: now,
        updated_at: now,
        isDraft: true,
      },
    ]);
  };

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
          deliverable={d}
          disabled={disabled}
          kindOptions={kindOptions}
          t={t}
          onChange={updateDeliverable}
          onDelete={deleteDeliverable}
        />
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={addDeliverable}
        className="h-7 w-full text-xs"
      >
        <Plus className="h-3 w-3 mr-1" />
        {t(($) => $.detail_panel.deliverable_add)}
      </Button>
    </div>
  );
}
