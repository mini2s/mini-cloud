"use client";

import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { CircleHelp, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useT } from "../../../i18n";
import {
  asRecord,
  firstString,
} from "./tool-ui-shared";

export type ConversationQuestionOption = {
  label: string;
  description: string;
};

export type ConversationQuestion = {
  header: string;
  question: string;
  multiple: boolean;
  custom: boolean;
  options: readonly ConversationQuestionOption[];
};

export type ConversationQuestionRequest = {
  id: string;
  questions: readonly ConversationQuestion[];
};

export function normalizeQuestionRequest(
  value: unknown,
): ConversationQuestionRequest | undefined {
  const record = asRecord(value);
  const id = firstString(record, ["id", "requestID", "requestId"]);
  if (!id || !Array.isArray(record?.questions)) return undefined;

  const questions = record.questions.flatMap(
    (rawQuestion): ConversationQuestion[] => {
      const question = asRecord(rawQuestion);
      if (!question) return [];
      const options = Array.isArray(question.options)
        ? question.options.flatMap(
            (rawOption): ConversationQuestionOption[] => {
              const option = asRecord(rawOption);
              const label = firstString(option, ["label"]);
              if (!label) return [];
              return [
                {
                  label,
                  description: firstString(option, ["description"]),
                },
              ];
            },
          )
        : [];
      return [
        {
          header: firstString(question, ["header"]),
          question: firstString(question, ["question"]),
          multiple: question.multiple === true,
          custom: question.custom === true,
          options,
        },
      ];
    },
  );
  return questions.length > 0 ? { id, questions } : undefined;
}

type QuestionAnswerState = {
  selected: readonly string[];
  custom: string;
};

function buildInitialState(
  request: ConversationQuestionRequest,
): QuestionAnswerState[] {
  return request.questions.map(() => ({ selected: [], custom: "" }));
}

export function QuestionCard({
  request,
  canInteract,
  onSubmit,
  onReject,
}: {
  request: ConversationQuestionRequest;
  canInteract: boolean;
  onSubmit: (answers: readonly (readonly string[])[]) => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const { t } = useT("chat");
  const [answers, setAnswers] = useState(() => buildInitialState(request));
  const [submission, setSubmission] = useState<
    "reply" | "reject" | "submitted" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const submissionRef = useRef(false);
  const encodedAnswers = useMemo(
    () =>
      request.questions.map((question, index) => {
        const answer = answers[index] ?? { selected: [], custom: "" };
        if (answer.custom.trim()) return [answer.custom.trim()];
        return question.multiple
          ? [...answer.selected]
          : answer.selected.slice(0, 1);
      }),
    [answers, request.questions],
  );
  const canSubmit =
    canInteract &&
    submission === null &&
    encodedAnswers.every((answer) => answer.length > 0);

  const updateAnswer = (
    index: number,
    updater: (current: QuestionAnswerState) => QuestionAnswerState,
  ) => {
    setAnswers((current) =>
      current.map((answer, answerIndex) =>
        answerIndex === index ? updater(answer) : answer,
      ),
    );
  };

  const submit = async () => {
    if (!canSubmit || submissionRef.current) return;
    submissionRef.current = true;
    setSubmission("reply");
    setError(null);
    try {
      await onSubmit(encodedAnswers);
      setSubmission("submitted");
    } catch (submitError) {
      submissionRef.current = false;
      setSubmission(null);
      setError(
        submitError instanceof Error
          ? submitError.message
          : t(($) => $.session.tools.question.submit_failed),
      );
    }
  };

  const reject = async () => {
    if (!canInteract || submission !== null || submissionRef.current) return;
    submissionRef.current = true;
    setSubmission("reject");
    setError(null);
    try {
      await onReject();
      setSubmission("submitted");
    } catch (submitError) {
      submissionRef.current = false;
      setSubmission(null);
      setError(
        submitError instanceof Error
          ? submitError.message
          : t(($) => $.session.tools.question.reject_failed),
      );
    }
  };

  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <CircleHelp className="size-4 shrink-0 text-sky-600" />
        <span className="font-medium">
          {submission === "submitted"
            ? t(($) => $.session.tools.question.submitted)
            : t(($) => $.session.tools.question.answer_required)}
        </span>
      </div>
      {request.questions.map((question, index) => {
        const answer = answers[index] ?? { selected: [], custom: "" };
        const disabled = !canInteract || submission !== null;
        return (
          <fieldset
            key={`${request.id}-${index}`}
            className="mt-3 space-y-2"
            disabled={disabled}
          >
            <legend className="text-sm font-medium">
              {question.question || question.header}
            </legend>
            <div className="space-y-1">
              {question.options.map((option) => {
                const selected = answer.selected.includes(option.label);
                return (
                  <label
                    key={option.label}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors",
                      selected
                        ? "border-primary/50 bg-primary/5"
                        : "border-transparent hover:bg-muted/50",
                      disabled && "cursor-default opacity-70",
                    )}
                  >
                    <input
                      type={question.multiple ? "checkbox" : "radio"}
                      name={`question-${request.id}-${index}`}
                      checked={selected}
                      onChange={() => {
                        updateAnswer(index, (current) => ({
                          custom: "",
                          selected: question.multiple
                            ? selected
                              ? current.selected.filter(
                                  (label) => label !== option.label,
                                )
                              : [...current.selected, option.label]
                            : [option.label],
                        }));
                      }}
                      className="mt-0.5 size-3.5 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{option.label}</span>
                      {option.description ? (
                        <span className="block text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {question.custom ? (
              <input
                type="text"
                value={answer.custom}
                onChange={(event) => {
                  const custom = event.target.value;
                  updateAnswer(index, (current) => ({
                    custom,
                    selected: custom.trim() ? [] : current.selected,
                  }));
                }}
                placeholder={t(
                  ($) => $.session.tools.question.custom_placeholder,
                )}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            ) : null}
          </fieldset>
        );
      })}
      {submission !== "submitted" ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          {!canInteract ? (
            <span className="mr-auto text-xs text-muted-foreground">
              {t(($) => $.session.tools.question.takeover_required)}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={!canInteract || submission !== null}
            onClick={() => void reject()}
          >
            {submission === "reject" ? (
              <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
            ) : null}
            {t(($) => $.session.tools.question.reject)}
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {submission === "reply" ? (
              <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
            ) : null}
            {t(($) => $.session.tools.question.submit)}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
