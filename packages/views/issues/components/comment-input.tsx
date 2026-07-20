"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@multica/ui/components/ui/tooltip";
import { cn } from "@multica/ui/lib/utils";
import { ContentEditor, type ContentEditorRef, useFileDropZone, FileDropOverlay } from "../../editor";
import { FileUploadButton } from "@multica/ui/components/common/file-upload-button";
import { SubmitButton } from "@multica/ui/components/common/submit-button";
import { useFileUpload } from "@multica/core/hooks/use-file-upload";
import { api } from "@multica/core/api";
import type { Attachment } from "@multica/core/types";
import { enterKey, formatShortcut, modKey } from "@multica/core/platform";
import { useCommentDraftStore } from "@multica/core/issues/stores";
import { useT } from "../../i18n";

interface CommentInputProps {
  issueId: string;
  onSubmit: (content: string, attachmentIds?: string[]) => Promise<void>;
  disabled?: boolean;
  variant?: "default" | "split-review";
  placeholder?: string;
}

function CommentInput({
  issueId,
  onSubmit,
  disabled = false,
  variant = "default",
  placeholder,
}: CommentInputProps) {
  const { t } = useT("issues");
  const editorRef = useRef<ContentEditorRef>(null);
  // Read the persisted draft once on mount. ContentEditor only honors
  // `defaultValue` at mount time, so this snapshot drives both the editor's
  // initial content and the submit-button enable state — without this the
  // button would be disabled even though the editor visibly contains text.
  const draftKey = `new:${issueId}` as const;
  const initialDraft = useCommentDraftStore.getState().getDraft(draftKey);
  const [isEmpty, setIsEmpty] = useState(() => !initialDraft?.trim());
  const [submitting, setSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  // Attachments uploaded in this composer session. Drives both:
  //  - submit-time `attachment_ids` payload (filtered to URLs still in markdown)
  //  - the editor's AttachmentDownloadProvider, so file-card Eye buttons can
  //    resolve text/code/markdown previews that require the attachment id.
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const { uploadWithToast } = useFileUpload(api);
  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: (files) => files.forEach((f) => editorRef.current?.uploadFile(f)),
  });
  const uploadEnabled = !disabled;
  const isSplitReview = variant === "split-review";

  // Draft persistence. Hydrate from store on mount via `defaultValue` above
  // (ContentEditorRef has no setContent, so this is the only injection point).
  // Flush on every onUpdate (debounced upstream) + visibilitychange/pagehide
  // so tab close / mobile background doesn't lose work. Cleared on submit.
  const setDraft = useCommentDraftStore((s) => s.setDraft);
  const clearDraft = useCommentDraftStore((s) => s.clearDraft);
  useEffect(() => {
    const flush = () => {
      const md = editorRef.current?.getMarkdown();
      if (md && md.trim().length > 0) setDraft(draftKey, md);
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
    };
  }, [draftKey, setDraft]);

  const handleUpload = useCallback(async (file: File) => {
    const result = await uploadWithToast(file, { issueId });
    if (result) {
      setPendingAttachments((prev) => [...prev, result]);
    }
    return result;
  }, [uploadWithToast, issueId]);

  const handleSubmit = async () => {
    const content = editorRef.current?.getMarkdown()?.replace(/(\n\s*)+$/, "").trim();
    if (!content || submitting || disabled) return;
    // Only send attachment IDs for uploads still present in the content.
    const activeIds = pendingAttachments
      .filter((a) => content.includes(a.url))
      .map((a) => a.id);
    setSubmitting(true);
    try {
      await onSubmit(content, activeIds.length > 0 ? activeIds : undefined);
      editorRef.current?.clearContent();
      setIsEmpty(true);
      setPendingAttachments([]);
      clearDraft(draftKey);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      {...(uploadEnabled ? dropZoneProps : {})}
      className={cn(
        "relative flex flex-col rounded-lg pb-8 ring-1",
        isSplitReview ? "bg-background/95 ring-border/80 shadow-sm" : "bg-card ring-border",
        isExpanded ? "h-[70vh]" : isSplitReview ? "min-h-28 max-h-48" : "max-h-56",
        disabled && "pointer-events-none opacity-60",
      )}
      aria-disabled={disabled || undefined}
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <ContentEditor
          ref={editorRef}
          defaultValue={initialDraft}
          placeholder={placeholder ?? t(($) => $.comment.leave_comment_placeholder)}
          onUpdate={(md) => {
            setIsEmpty(!md.trim());
            // Debounced upstream (debounceMs=100). Persist on every tick so a
            // reload or scroll-out-of-viewport restores work to the keystroke.
            if (md.trim().length > 0) setDraft(draftKey, md);
            else clearDraft(draftKey);
          }}
          onSubmit={handleSubmit}
          onUploadFile={uploadEnabled ? handleUpload : undefined}
          debounceMs={100}
          currentIssueId={issueId}
          attachments={pendingAttachments}
        />
      </div>
      <div
        className={cn(
          "absolute flex items-center gap-1",
          isSplitReview
            ? "bottom-2 right-2 rounded-md bg-background/90 p-0.5 shadow-sm ring-1 ring-border/60"
            : "bottom-1 right-1.5",
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  setIsExpanded((v) => !v);
                  editorRef.current?.focus();
                }}
                className="rounded-sm p-1.5 text-muted-foreground opacity-70 hover:opacity-100 hover:bg-accent/60 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
            }
          />
          <TooltipContent side="top">{isExpanded ? t(($) => $.comment.collapse_tooltip) : t(($) => $.comment.expand_tooltip)}</TooltipContent>
        </Tooltip>
        <FileUploadButton
          size="sm"
          disabled={disabled}
          onSelect={(file) => editorRef.current?.uploadFile(file)}
        />
        <SubmitButton
          onClick={handleSubmit}
          disabled={isEmpty || disabled}
          loading={submitting}
          tooltip={`${t(($) => $.comment.send_tooltip)} · ${formatShortcut(modKey, enterKey)}`}
        />
      </div>
      {isDragOver && <FileDropOverlay />}
    </div>
  );
}

export { CommentInput };
