"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";

interface SplitChatReviewProps {
  disabled?: boolean;
  onSubmit: (content: string, attachmentIds?: string[]) => Promise<void>;
}

const SUGGESTIONS = [
  "添加一个安全审计子 issue",
  "合并第 2 个和第 3 个",
  "恢复到最初生成的草案",
];

export function SplitChatReview({ disabled = false, onSubmit }: SplitChatReviewProps) {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (nextContent = content) => {
    const trimmed = nextContent.trim();
    if (!trimmed || disabled || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(trimmed);
      setContent("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      {content.trim().length === 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || isSubmitting}
              onClick={() => void submit(suggestion)}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="rounded-lg border bg-background p-2">
        <textarea
          className="min-h-20 w-full resize-none rounded-sm bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="输入调整要求"
          placeholder="输入调整要求…"
          value={content}
          disabled={disabled || isSubmitting}
          onChange={(event) => setContent(event.target.value)}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={disabled || isSubmitting || content.trim().length === 0}
            onClick={() => void submit()}
          >
            <Send className="mr-1.5 size-3.5" />
            {isSubmitting ? "发送中…" : "发送"}
          </Button>
        </div>
      </div>
    </div>
  );
}
