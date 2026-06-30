import { Button } from "@multica/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@multica/ui/components/ui/tooltip";
import { Separator } from "@multica/ui/components/ui/separator";
import { Undo2, Redo2, AppWindow, MessageSquareText, ZoomIn, ZoomOut, Save } from "lucide-react";
import { useWorkflowEditorStore } from "@multica/core/workflows/store";
import { useT } from "../../../i18n";

export interface PanoramaToolbarProps {
  onAutoLayout: () => void;
  onSave: () => void;
  hasUnsaved: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomLevel: number;
}

export function PanoramaToolbar({
  onAutoLayout,
  onSave,
  hasUnsaved,
  zoomIn,
  zoomOut,
  zoomLevel,
}: PanoramaToolbarProps) {
  const { t } = useT("workflows");
  const canUndo = useWorkflowEditorStore((s) => s.undoStack.length > 0);
  const canRedo = useWorkflowEditorStore((s) => s.redoStack.length > 0);
  const showAnnotations = useWorkflowEditorStore((s) => s.showAnnotations);
  const undo = useWorkflowEditorStore((s) => s.undo);
  const redo = useWorkflowEditorStore((s) => s.redo);
  const toggleAnnotations = useWorkflowEditorStore((s) => s.toggleAnnotations);

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b bg-card shrink-0" data-testid="panorama-toolbar">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" disabled={!canUndo} onClick={undo} aria-label="Undo">
              <Undo2 className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" disabled={!canRedo} onClick={redo} aria-label="Redo">
              <Redo2 className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Redo</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-5" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" onClick={onAutoLayout} aria-label="Auto layout">
              <AppWindow className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Auto layout</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={showAnnotations ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={toggleAnnotations}
              aria-label="Toggle annotations"
            >
              <MessageSquareText className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Toggle annotations</TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" onClick={zoomOut} aria-label="Zoom out">
              <ZoomOut className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Zoom out</TooltipContent>
      </Tooltip>

      <span className="text-xs text-muted-foreground tabular-nums w-10 text-center select-none">
        {zoomLevel}%
      </span>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" onClick={zoomIn} aria-label="Zoom in">
              <ZoomIn className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Zoom in</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-5" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="default" size="sm" onClick={onSave} aria-label="Save changes" className="relative">
              {hasUnsaved && (
                <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
              )}
              <Save className="size-3.5 mr-1.5" />
              Save
            </Button>
          }
        />
        <TooltipContent>{hasUnsaved ? "Unsaved changes" : "Save changes"}</TooltipContent>
      </Tooltip>
    </div>
  );
}
