"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Loader2, Send, Upload, X } from "lucide-react";
import { api } from "@multica/core/api";
import { issueKeys } from "@multica/core/issues/queries";
import { workflowKeys } from "@multica/core/workflows/queries";
import type {
  WorkflowNodeDeliverable,
  WorkflowNodeDeliverableSubmission,
} from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@multica/ui/components/ui/native-select";
import { useT } from "@multica/views/i18n";
import { hasInvalidLinkLine, parseLinkLines, readFileAsBase64 } from "../../../common/deliverable-upload";

interface NodeRunDeliveryFormProps {
  wsId: string;
  issueId: string;
  nodeRunId: string;
  deliverables: WorkflowNodeDeliverable[];
  submissions: WorkflowNodeDeliverableSubmission[];
  workflowId?: string;
  runId?: string | null;
}

/**
 * The human worker's unified delivery form, hosted in the execution panel's
 * footer dock. Documents and code links are staged locally (repeat file picks
 * accumulate, links one per line) together with an optional execution summary;
 * a single Submit uploads the staged deliverables — the summary rides along
 * and lands in the worker output when the upload advances the node into
 * review — or, when nothing is staged, submits the summary alone. Server-side
 * the advance happens once every required deliverable is submitted, so staging
 * a partial set is safe.
 */
export function NodeRunDeliveryForm({
  wsId,
  issueId,
  nodeRunId,
  deliverables,
  submissions,
  workflowId,
  runId,
}: NodeRunDeliveryFormProps) {
  const { t } = useT("issues");
  const { t: tw } = useT("workflows");
  const queryClient = useQueryClient();
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [linkInput, setLinkInput] = useState("");
  const [summary, setSummary] = useState("");
  const [documentTarget, setDocumentTarget] = useState<string>();
  const [pullRequestTarget, setPullRequestTarget] = useState<string>();

  const kindById = new Map(deliverables.map((d) => [d.id, d.kind]));
  const titleById = new Map(deliverables.map((d) => [d.id, d.title]));
  const documentDeliverables = deliverables.filter((d) => d.kind === "document");
  const pullRequestDeliverables = deliverables.filter((d) => d.kind === "pull_request");
  const selectedDocumentID = documentDeliverables.some((d) => d.id === documentTarget)
    ? documentTarget
    : documentDeliverables[0]?.id;
  const selectedPullRequestID = pullRequestDeliverables.some((d) => d.id === pullRequestTarget)
    ? pullRequestTarget
    : pullRequestDeliverables[0]?.id;
  const hasDocument = documentDeliverables.length > 0;
  const hasPR = pullRequestDeliverables.length > 0;
  const linksOf = (kind: string) =>
    submissions.filter((s) => s.pull_request_url && kindById.get(s.deliverable_id) === kind);
  const docLinks = linksOf("document");
  const codeLinks = linksOf("pull_request");

  const links = parseLinkLines(linkInput);
  const linksInvalid = hasInvalidLinkLine(links);
  const dirty = stagedFiles.length > 0 || links.length > 0 || summary.trim().length > 0;

  // Summary-only submits go through the worker-output endpoint, which the
  // server rejects while required deliverables are still unsubmitted. Catch
  // that case locally (the server error stays as the fallback): a required
  // deliverable counts as submitted once any of its rows is live.
  const requiredMissing = deliverables.some(
    (d) =>
      d.required &&
      !submissions.some((s) => s.deliverable_id === d.id && s.status !== "missing" && s.status !== "rejected"),
  );
  const summaryOnlyBlocked =
    stagedFiles.length === 0 && links.length === 0 && summary.trim().length > 0 && requiredMissing;

  const submitMutation = useMutation({
    mutationFn: async () => {
      const note = summary.trim();
      let uploaded = false;
      if (stagedFiles.length > 0) {
        const filesData = await Promise.all(stagedFiles.map(readFileAsBase64));
        await api.uploadIssueDeliverable(issueId, filesData, note || undefined, selectedDocumentID);
        uploaded = true;
      }
      if (links.length > 0) {
        await api.uploadIssueDeliverablePR(issueId, links, note || undefined, selectedPullRequestID);
        uploaded = true;
      }
      if (!uploaded && note) {
        await api.submitNodeRun(nodeRunId, { summary: note });
      }
    },
    onSuccess: async () => {
      // Keep the summary in place: when the upload was a partial set the node
      // stays in the worker phase and the note applies to the next round too.
      setStagedFiles([]);
      setLinkInput("");
      await queryClient.invalidateQueries({
        queryKey: workflowKeys.nodeRunDeliverables(nodeRunId),
      });
      await queryClient.invalidateQueries({
        queryKey: issueKeys.detail(wsId, issueId),
      });
      if (workflowId && runId) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: workflowKeys.nodeRuns(wsId, workflowId, runId),
          }),
          queryClient.invalidateQueries({
            queryKey: workflowKeys.runCanvasSummary(wsId, workflowId, runId),
          }),
        ]);
      }
    },
  });

  const groupTag = (label: string) => (
    <span className="shrink-0 rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {label}
    </span>
  );
  const chipLink = (s: WorkflowNodeDeliverableSubmission) => (
    <a
      key={s.id}
      href={s.pull_request_url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="text-primary inline-flex max-w-56 items-center gap-1 rounded-md border bg-muted/30 px-2 py-0.5 text-xs hover:bg-muted"
    >
      <ExternalLink className="size-3 shrink-0" />
      <span className="truncate">
        {titleById.get(s.deliverable_id) ?? tw(($) => $.node_run.deliverables.pull_request_label)} · {s.status}
      </span>
    </a>
  );

  return (
    <div data-testid="node-run-delivery-form" className="space-y-2.5">
      {hasDocument ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {groupTag(tw(($) => $.node_run.deliverables.document_section))}
            {documentDeliverables.length > 1 ? (
              <NativeSelect
                size="sm"
                aria-label={tw(($) => $.node_run.deliverables.document_section)}
                value={selectedDocumentID}
                onChange={(event) => setDocumentTarget(event.target.value)}
              >
                {documentDeliverables.map((deliverable) => (
                  <NativeSelectOption key={deliverable.id} value={deliverable.id}>
                    {deliverable.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
            {docLinks.map(chipLink)}
            <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted">
              <Upload className="h-3.5 w-3.5" />
              {tw(($) => $.node_run.deliverables.upload_file_choose)}
              <input
                key={fileInputKey}
                type="file"
                multiple
                className="hidden"
                disabled={submitMutation.isPending}
                onChange={(e) => {
                  if (e.target.files) {
                    setStagedFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
                  }
                  // Replace the native input after every selection. Some
                  // browsers retain internal file-picker state even after
                  // assigning value="", which prevents a later selection
                  // from firing. A fresh input reliably accepts both new and
                  // same-file selections while staged files stay in React.
                  setFileInputKey((key) => key + 1);
                }}
              />
            </label>
          </div>
          {stagedFiles.length > 0 ? (
            <ul className="space-y-1">
              {stagedFiles.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center gap-1.5 text-xs">
                  <FileText className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    disabled={submitMutation.isPending}
                    onClick={() => setStagedFiles((prev) => prev.filter((_, i) => i !== index))}
                    className="text-muted-foreground hover:text-foreground inline-flex size-5 shrink-0 items-center justify-center rounded"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {hasPR ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {groupTag(tw(($) => $.node_run.deliverables.code_section))}
            {pullRequestDeliverables.length > 1 ? (
              <NativeSelect
                size="sm"
                aria-label={tw(($) => $.node_run.deliverables.code_section)}
                value={selectedPullRequestID}
                onChange={(event) => setPullRequestTarget(event.target.value)}
              >
                {pullRequestDeliverables.map((deliverable) => (
                  <NativeSelectOption key={deliverable.id} value={deliverable.id}>
                    {deliverable.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
            {codeLinks.map(chipLink)}
          </div>
          <textarea
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder={tw(($) => $.node_run.deliverables.upload_pr_placeholder)}
            rows={2}
            disabled={submitMutation.isPending}
            className="bg-background w-full resize-none rounded-md border px-2 py-1.5 text-sm"
          />
          {linksInvalid ? (
            <p className="text-destructive text-xs">{tw(($) => $.node_run.deliverables.upload_pr_invalid)}</p>
          ) : null}
        </div>
      ) : null}

      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder={t(($) => $.execution.detail_panel.execution_summary_placeholder)}
        aria-label={t(($) => $.execution.detail_panel.execution_summary)}
        rows={3}
        disabled={submitMutation.isPending}
        className="bg-background min-h-20 w-full resize-none rounded-md border px-2 py-1.5 text-sm"
      />

      {submitMutation.isError ? (
        <p role="alert" className="text-destructive text-xs">
          {submitMutation.error instanceof Error
            ? submitMutation.error.message
            : "Failed to submit deliverables"}
        </p>
      ) : null}

      {summaryOnlyBlocked ? (
        <p className="text-muted-foreground text-xs">
          {t(($) => $.execution.detail_panel.deliverables_required_first)}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={submitMutation.isPending || !dirty}
          onClick={() => {
            setStagedFiles([]);
            setLinkInput("");
            setSummary("");
          }}
        >
          {tw(($) => $.node_run.deliverables.cancel)}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={submitMutation.isPending || !dirty || linksInvalid || summaryOnlyBlocked}
          onClick={() => submitMutation.mutate()}
        >
          {submitMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {submitMutation.isPending
            ? t(($) => $.execution.detail_panel.submitting_result)
            : t(($) => $.execution.detail_panel.submit_result)}
        </Button>
      </div>
    </div>
  );
}
