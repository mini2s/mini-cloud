"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Label } from "@multica/ui/components/ui/label";
import { CanvasInspector, type InspectorTab } from "./canvas-inspector";
import { AssigneePicker } from "../../issues/components/pickers/assignee-picker";
import { useWorkflowEditorStore } from "@multica/core/workflows/store";
import { useWorkspaceId } from "@multica/core/hooks";
import { useDeleteNode, useAssignNodeToStage } from "@multica/core/workflows/queries";
import type { WorkflowNode, WorkflowStage, WorkerType, CriticType } from "@multica/core/types";
import type { IssueAssigneeType } from "@multica/core/types/issue";

function toAssigneeType(t: string): IssueAssigneeType | null {
  if (t === "human") return "member";
  if (t === "agent" || t === "squad") return t as IssueAssigneeType;
  return null;
}

function fromAssigneeType(t: IssueAssigneeType | null): WorkerType {
  if (t === "member") return "human";
  if (t === "agent") return "agent";
  if (t === "squad") return "squad";
  return "human";
}

function fromAssigneeTypeCritic(t: IssueAssigneeType | null): CriticType {
  if (t === "member") return "human";
  if (t === "agent") return "agent";
  if (t === "squad") return "squad";
  return "human";
}

function toFormatSchemaString(fs: unknown): string {
  if (!fs) return "";
  if (typeof fs === "string") return fs;
  return JSON.stringify(fs, null, 2);
}

export interface EditorInspectorProps {
  node: WorkflowNode;
  workflowId: string;
  nodes?: WorkflowNode[];
  stages?: WorkflowStage[];
  disabled?: boolean;
  onClose: () => void;
}

export function EditorInspector({ node, workflowId, stages = [], disabled = false, onClose }: EditorInspectorProps) {
  const wsId = useWorkspaceId();
  const deleteMutation = useDeleteNode(wsId, workflowId);
  const assignStageMutation = useAssignNodeToStage(wsId, workflowId);
  const nodeEdits = useWorkflowEditorStore((s) => s.nodeEdits);
  const cacheNodeEdits = useWorkflowEditorStore((s) => s.cacheNodeEdits);
  const saved = nodeEdits[node.id];

  const [title, setTitle] = useState(saved?.title ?? node.title);
  const [description, setDescription] = useState(saved?.description ?? node.description);
  const [formatSchema, setFormatSchema] = useState(toFormatSchemaString(saved?.format_schema ?? node.format_schema));
  const [workerType, setWorkerType] = useState(saved?.worker_type ?? node.worker_type);
  const [workerId, setWorkerId] = useState<string | null>(saved?.worker_id ?? node.worker_id ?? null);
  const [criticType, setCriticType] = useState(saved?.critic_type ?? node.critic_type);
  const [criticId, setCriticId] = useState<string | null>(saved?.critic_id ?? node.critic_id ?? null);
  const [stageId, setStageId] = useState<string | null>(node.stage_id ?? null);

  useEffect(() => {
    setStageId(node.stage_id ?? null);
  }, [node.stage_id]);

  useEffect(() => {
    const s = nodeEdits[node.id];
    setTitle(s?.title ?? node.title);
    setDescription(s?.description ?? node.description);
    setFormatSchema(toFormatSchemaString(s?.format_schema ?? node.format_schema));
    setWorkerType(s?.worker_type ?? node.worker_type);
    setWorkerId(s?.worker_id ?? node.worker_id ?? null);
    setCriticType(s?.critic_type ?? node.critic_type);
    setCriticId(s?.critic_id ?? node.critic_id ?? null);
  }, [node.id, nodeEdits]);

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(node.id);
      toast.success("Node deleted");
      onClose();
    } catch { toast.error("Failed to delete node"); }
  };

  const tabs: InspectorTab[] = [
    {
      id: "worker",
      label: "Worker",
      content: (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">Title</Label>
            <Input disabled={disabled} value={title} onChange={(e) => { setTitle(e.target.value); cacheNodeEdits(node.id, { title: e.target.value }); }} className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Description</Label>
            <Textarea disabled={disabled} value={description} onChange={(e) => { setDescription(e.target.value); cacheNodeEdits(node.id, { description: e.target.value }); }} className="min-h-[60px] text-sm" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Worker</Label>
            <AssigneePicker
              assigneeType={toAssigneeType(workerType)}
              assigneeId={workerId}
              onUpdate={disabled ? () => {} : (u) => {
                const wt = fromAssigneeType(u.assignee_type ?? null);
                const wid = u.assignee_id ?? null;
                setWorkerType(wt); setWorkerId(wid);
                cacheNodeEdits(node.id, { worker_type: wt, worker_id: wid });
              }}
              align="start"
              skipBuiltinRuntimeSelection
            />
          </div>
        </div>
      ),
    },
    {
      id: "critic",
      label: "Critic",
      content: (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">Critic</Label>
            <AssigneePicker
              assigneeType={toAssigneeType(criticType)}
              assigneeId={criticId}
              onUpdate={disabled ? () => {} : (u) => {
                const ct = fromAssigneeTypeCritic(u.assignee_type ?? null);
                const cid = u.assignee_id ?? null;
                setCriticType(ct); setCriticId(cid);
                cacheNodeEdits(node.id, { critic_type: ct, critic_id: cid });
              }}
              align="start"
            />
          </div>
        </div>
      ),
    },
    {
      id: "parameters",
      label: "Parameters",
      content: (
        <div className="space-y-1.5">
          <Label className="text-sm">JSON Schema / Parameters</Label>
          <Textarea disabled={disabled} value={formatSchema} onChange={(e) => {
            setFormatSchema(e.target.value);
            const trimmed = e.target.value.trim();
            try { cacheNodeEdits(node.id, { format_schema: trimmed ? JSON.parse(trimmed) : null }); }
            catch { cacheNodeEdits(node.id, { format_schema: e.target.value }); }
          }} placeholder="{}" className="min-h-[120px] text-sm font-mono" rows={6} />
        </div>
      ),
    },
    {
      id: "stage",
      label: "Stage",
      content: (
        <div className="space-y-1.5">
          <Label className="text-sm">Belongs to Stage</Label>
          <select
            disabled={disabled || assignStageMutation.isPending}
            className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={stageId ?? ""}
            onChange={(e) => {
              const newVal = e.target.value;
              const newStageId = newVal || null;
              setStageId(newStageId);
              assignStageMutation.mutate(
                { nodeId: node.id, stage_id: newStageId },
                { onError: () => setStageId(node.stage_id ?? null) },
              );
            }}
          >
            <option value="">Unassigned</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      ),
    },
  ];

  return (
    <CanvasInspector
      title={title || "Untitled Node"}
      tabs={tabs}
      onClose={onClose}
      actions={
        !disabled ? (
          <Button size="sm" variant="destructive" className="w-full" onClick={handleDelete} disabled={deleteMutation.isPending}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete Node
          </Button>
        ) : undefined
      }
    />
  );
}
