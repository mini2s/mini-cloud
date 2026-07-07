"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  MoreHorizontal,
  PanelsTopLeft,
  PauseCircle,
  Play,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  WandSparkles,
} from "lucide-react";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@multica/ui/components/ui/popover";
import { Separator } from "@multica/ui/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@multica/ui/components/ui/tooltip";
import { PageHeader } from "../../../layout/page-header";
import { useT } from "../../../i18n";
import { NodeTemplatePicker } from "./node-template-picker";
import type { NodeTemplate } from "./node-template-catalog";
import type { WorkflowStatus } from "@multica/core/types";

interface ToolbarWorkflow {
  id: string;
  title: string;
  status: WorkflowStatus;
}

export interface WorkflowEditorToolbarProps {
  workflow: ToolbarWorkflow;
  statusLabel: string;
  canUndo: boolean;
  canRedo: boolean;
  hasUnsavedEdits: boolean;
  hasBlockingPreflightIssues: boolean;
  onBackToWorkflows: () => void;
  onUpdateTitle: (title: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void | boolean | Promise<void | boolean>;
  onAutoLayout: () => void;
  onSelectTemplate: (template: NodeTemplate) => void;
  onTestRun: () => void | Promise<void>;
  onToggleWorkflowStatus: () => void;
  onOpenRunHistory: () => void;
  onDeleteWorkflow: () => void;
}

function ToolbarTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function WorkflowEditorToolbar({
  workflow,
  statusLabel,
  canUndo,
  canRedo,
  hasUnsavedEdits,
  hasBlockingPreflightIssues,
  onBackToWorkflows,
  onUpdateTitle,
  onUndo,
  onRedo,
  onSave,
  onAutoLayout,
  onSelectTemplate,
  onTestRun,
  onToggleWorkflowStatus,
  onOpenRunHistory,
  onDeleteWorkflow,
}: WorkflowEditorToolbarProps) {
  const { t } = useT("workflows");
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(workflow.title);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const isActive = workflow.status === "active";
  const statusActionLabel = isActive ? t(($) => $.detail.deactivate) : t(($) => $.detail.activate);
  const testRunLabel = hasUnsavedEdits
    ? t(($) => $.panorama.toolbar.save_and_test)
    : t(($) => $.panorama.toolbar.test_run);
  const statusDisabled = !isActive && (hasUnsavedEdits || hasBlockingPreflightIssues);
  const blockingTooltip = t(($) => $.panorama.toolbar.blocked_tooltip);
  const activateUnsavedTooltip = t(($) => $.panorama.toolbar.activate_disabled_unsaved);

  const handleStartEditTitle = useCallback(() => {
    setDraftTitle(workflow.title);
    setEditingTitle(true);
    requestAnimationFrame(() => titleInputRef.current?.select());
  }, [workflow.title]);

  const handleSaveTitle = useCallback(() => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== workflow.title) {
      onUpdateTitle(trimmed);
    } else {
      setDraftTitle(workflow.title);
    }
    setEditingTitle(false);
  }, [draftTitle, workflow.title, onUpdateTitle]);

  const handleTitleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Enter") handleSaveTitle();
      if (event.key === "Escape") {
        setDraftTitle(workflow.title);
        setEditingTitle(false);
      }
    },
    [handleSaveTitle, workflow.title],
  );

  const handleSelectTemplate = useCallback(
    (template: NodeTemplate) => {
      onSelectTemplate(template);
      setPopoverOpen(false);
    },
    [onSelectTemplate],
  );

  return (
    <PageHeader className="min-h-14 justify-between gap-3 border-b bg-background/95 px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBackToWorkflows}
          aria-label={t(($) => $.detail.back_to_workflows)}
        >
          <ArrowLeft className="size-4" />
        </Button>

        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/50 text-muted-foreground">
          <PanelsTopLeft className="size-4" strokeWidth={1.9} />
        </span>

        <div className="min-w-0">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="w-full min-w-0 truncate border-b border-primary bg-transparent text-sm font-semibold outline-none"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={handleTitleKeyDown}
            />
          ) : (
            <h1
              className="truncate text-sm font-semibold transition-colors hover:text-primary"
              onClick={handleStartEditTitle}
              title={t(($) => $.detail.click_to_rename)}
            >
              {workflow.title}
            </h1>
          )}

          <div className="mt-1 flex min-w-0 items-center gap-2">
            <Badge
              variant={isActive ? "default" : "secondary"}
              className="h-4 rounded px-1.5 text-[10px] capitalize"
            >
              {statusLabel}
            </Badge>
            {hasUnsavedEdits ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <Clock3 className="size-3" />
                {t(($) => $.panorama.toolbar.unsaved)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3" />
                {t(($) => $.panorama.toolbar.saved)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <ToolbarTooltip label={t(($) => $.panorama.toolbar.undo)}>
          <Button variant="ghost" size="icon-sm" disabled={!canUndo} onClick={onUndo} aria-label={t(($) => $.panorama.toolbar.undo)}>
            <Undo2 className="size-4" />
          </Button>
        </ToolbarTooltip>

        <ToolbarTooltip label={t(($) => $.panorama.toolbar.redo)}>
          <Button variant="ghost" size="icon-sm" disabled={!canRedo} onClick={onRedo} aria-label={t(($) => $.panorama.toolbar.redo)}>
            <Redo2 className="size-4" />
          </Button>
        </ToolbarTooltip>

        {hasUnsavedEdits && (
          <Button variant="outline" size="sm" onClick={() => void onSave()} aria-label={t(($) => $.panorama.toolbar.save)}>
            <Save className="size-3.5" />
            {t(($) => $.panorama.toolbar.save)}
          </Button>
        )}

        <Separator orientation="vertical" className="mx-1 h-5" />

        <ToolbarTooltip label={t(($) => $.panorama.toolbar.auto_layout)}>
          <Button variant="ghost" size="icon-sm" onClick={onAutoLayout} aria-label={t(($) => $.panorama.toolbar.auto_layout)}>
            <WandSparkles className="size-4" />
          </Button>
        </ToolbarTooltip>

        <Popover open={popoverOpen} onOpenChange={setPopoverOpen} modal={false}>
          <PopoverTrigger
            render={
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1.5 rounded-lg px-3 shadow-sm"
                aria-label={t(($) => $.detail.add_node)}
              >
                <Plus className="size-3.5" />
                {t(($) => $.detail.add_node)}
                <ChevronDown className="size-3 opacity-70" />
              </Button>
            }
          />
          <PopoverContent
            className="w-[min(360px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
            align="start"
            side="bottom"
          >
            <NodeTemplatePicker onSelect={handleSelectTemplate} />
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />

        <ToolbarTooltip label={testRunLabel}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onTestRun()}
            aria-label={testRunLabel}
          >
            <Play className="size-3.5" />
            {testRunLabel}
          </Button>
        </ToolbarTooltip>

        <ToolbarTooltip label={statusDisabled ? (hasUnsavedEdits ? activateUnsavedTooltip : blockingTooltip) : statusActionLabel}>
          <Button
            variant={isActive ? "outline" : "default"}
            size="sm"
            disabled={statusDisabled}
            onClick={onToggleWorkflowStatus}
            aria-label={statusActionLabel}
          >
            {isActive ? <PauseCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
            {statusActionLabel}
          </Button>
        </ToolbarTooltip>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={t(($) => $.panorama.toolbar.more)}>
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onOpenRunHistory}>
              <History className="size-4" />
              {t(($) => $.panorama.toolbar.run_history)}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDeleteWorkflow}>
              <Trash2 className="size-4" />
              {t(($) => $.detail.delete)}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </PageHeader>
  );
}
