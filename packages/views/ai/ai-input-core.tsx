"use client";

import { useState, useCallback } from "react";
import { cn } from "@multica/ui/lib/utils";
import { SubmitButton } from "@multica/ui/components/common/submit-button";
import { Textarea } from "@multica/ui/components/ui/textarea";

export interface AiInputCoreProps {
  mode: "chat" | "command";
  placeholder: string;
  showAgentSelector: boolean;
  defaultAgentId?: string;
  onSubmit: (input: string, agentId: string) => Promise<void>;
  disabled?: boolean;
  /** Rendered at the bottom-left — typically the agent picker. */
  leftAdornment?: React.ReactNode;
}

export function AiInputCore({
  mode,
  placeholder,
  showAgentSelector,
  defaultAgentId,
  onSubmit,
  disabled,
  leftAdornment,
}: AiInputCoreProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || submitting || disabled) return;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed, defaultAgentId ?? "");
      setValue("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }, [value, submitting, disabled, onSubmit, defaultAgentId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Command mode: Enter submits (unless Shift is held for newline)
      if (mode === "command" && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      // Chat mode: Mod+Enter submits (matching existing chat behavior)
      if (mode === "chat" && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [mode, handleSubmit],
  );

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-lg border border-border bg-card px-3 py-2",
        "focus-within:border-brand transition-colors",
        disabled && "opacity-60 pointer-events-none",
      )}
    >
      <div className="flex-1 min-h-0">
        <Textarea
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || submitting}
          rows={1}
          className={cn(
            "min-h-8 max-h-32 resize-none border-0 bg-transparent p-0",
            "placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0",
          )}
        />
        {error && (
          <p className="mt-1 text-xs text-destructive">{error}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {leftAdornment}
        {showAgentSelector && (
          <select
            className="h-8 rounded border border-border bg-background px-2 text-xs text-muted-foreground"
            defaultValue={defaultAgentId ?? ""}
            disabled={disabled || submitting}
          >
            <option value="">Default agent</option>
            {/* Agent list populated by wrapper via leftAdornment or a query */}
          </select>
        )}
        <SubmitButton
          onClick={handleSubmit}
          disabled={!value.trim() || submitting || disabled}
          running={submitting}
        />
      </div>
    </div>
  );
}
