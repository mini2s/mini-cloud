"use client";

import { Trash2 } from "lucide-react";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Textarea } from "@multica/ui/components/ui/textarea";
import type { SplitTaskAssigneeType, SplitTaskStatus } from "@multica/core/types";

export interface SplitTaskDraft {
  id: string;
  sourceTaskId: string | null;
  title: string;
  description: string;
  dependsOn: string[];
  suggestedAssigneeType: SplitTaskAssigneeType | null;
  suggestedAssigneeId: string | null;
  status: SplitTaskStatus;
  approved: boolean;
  deleted: boolean;
}

interface SplitTaskListProps {
  tasks: SplitTaskDraft[];
  editable: boolean;
  onTaskChange: (taskId: string, patch: Partial<SplitTaskDraft>) => void;
  onToggleDependency: (taskId: string, dependencyTaskId: string, checked: boolean) => void;
  onDeleteTask: (taskId: string) => void;
}

function getTaskStatusLabel(task: SplitTaskDraft): string {
  if (task.deleted) return "deleted";
  if (task.sourceTaskId && !task.approved) return "discard";
  if (!task.sourceTaskId) return "new";
  return task.status;
}

export function SplitTaskList({
  tasks,
  editable,
  onTaskChange,
  onToggleDependency,
  onDeleteTask,
}: SplitTaskListProps) {
  const visibleTasks = tasks.filter((task) => !task.deleted);

  if (visibleTasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No split tasks available.</p>;
  }

  return (
    <div className="space-y-3">
      {visibleTasks.map((task, index) => {
        const dependencyOptions = visibleTasks.filter(
          (candidate) => candidate.id !== task.id && candidate.sourceTaskId !== null,
        );

        return (
          <div key={task.id} className="rounded-lg border border-border/70 bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{index + 1}. {task.title || "Untitled task"}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {task.sourceTaskId ? (
                    <Label
                      htmlFor={`approve-${task.id}`}
                      className="cursor-pointer text-[11px] font-medium text-muted-foreground"
                    >
                      <Checkbox
                        id={`approve-${task.id}`}
                        aria-label={`Approve task ${task.id}`}
                        checked={task.approved}
                        disabled={!editable}
                        onCheckedChange={(checked) => onTaskChange(task.id, { approved: checked === true })}
                      />
                      Include in create
                    </Label>
                  ) : (
                    <Badge variant="outline">New task</Badge>
                  )}
                  <Badge variant="secondary">{getTaskStatusLabel(task)}</Badge>
                </div>
              </div>
              {editable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete task ${task.id}`}
                  onClick={() => onDeleteTask(task.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>

            <div className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor={`task-title-${task.id}`} className="text-xs text-muted-foreground">
                  Title
                </Label>
                <Input
                  id={`task-title-${task.id}`}
                  aria-label={`Task title ${task.id}`}
                  value={task.title}
                  readOnly={!editable}
                  onChange={(event) => onTaskChange(task.id, { title: event.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`task-description-${task.id}`} className="text-xs text-muted-foreground">
                  Description
                </Label>
                <Textarea
                  id={`task-description-${task.id}`}
                  aria-label={`Task description ${task.id}`}
                  value={task.description}
                  readOnly={!editable}
                  onChange={(event) => onTaskChange(task.id, { description: event.target.value })}
                />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Dependencies</p>
                {dependencyOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No dependency options yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {dependencyOptions.map((candidate) => {
                      const dependencyId = candidate.sourceTaskId ?? candidate.id;
                      return (
                        <Label
                          key={`${task.id}-${dependencyId}`}
                          htmlFor={`dependency-${task.id}-${dependencyId}`}
                          className="cursor-pointer rounded-md border border-border/70 px-2 py-1 text-[11px] font-normal"
                        >
                          <Checkbox
                            id={`dependency-${task.id}-${dependencyId}`}
                            aria-label={`Dependency ${dependencyId} for ${task.id}`}
                            checked={task.dependsOn.includes(dependencyId)}
                            disabled={!editable}
                            onCheckedChange={(checked) =>
                              onToggleDependency(task.id, dependencyId, checked === true)}
                          />
                          {candidate.title || dependencyId}
                        </Label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
