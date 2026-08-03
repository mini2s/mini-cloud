import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { nodeRunDeliverableSubmissionsOptions } from "@multica/core/workflows/queries";
import { useUploadIssueDeliverable, useUploadIssueDeliverablePR } from "@multica/core/issues/mutations";
import { ExternalLink, Upload, Link as LinkIcon, FileText, X } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { hasInvalidLinkLine, parseLinkLines, readFileAsBase64 } from "../../common/deliverable-upload";
import { useT } from "../../i18n";

/**
 * Renders a node run's deliverables as ONE unified section. Each deliverable
 * lists its submitted PR/merge-request links and, when `canUpload` + `issueId`
 * are set (a member-assigned issue whose node-run worker is human), offers
 * BOTH a file picker (staged, then submitted together) and a one-link-per-line
 * URL input. Both are the human counterparts to the agent's cs-workflow submit.
 */
export function NodeRunDeliverables({
  wsId,
  nodeRunId,
  issueId,
  canUpload,
}: {
  wsId: string;
  nodeRunId: string;
  issueId?: string;
  canUpload?: boolean;
}) {
  const { t } = useT("workflows");
  const { data } = useQuery({
    ...nodeRunDeliverableSubmissionsOptions(wsId, nodeRunId),
    enabled: !!nodeRunId,
  });
  const submissions = data?.submissions ?? [];
  const deliverables = data?.deliverables ?? [];

  const showUpload = canUpload && !!issueId;
  const linksByDeliverable = new Map<string, typeof submissions>();
  for (const s of submissions) {
    if (s.pull_request_url && s.pull_request_url.length > 0) {
      const arr = linksByDeliverable.get(s.deliverable_id) ?? [];
      arr.push(s);
      linksByDeliverable.set(s.deliverable_id, arr);
    }
  }
  const hasAnyLinks = linksByDeliverable.size > 0;
  if (!hasAnyLinks && !(showUpload && deliverables.length > 0)) {
    return null;
  }

  return (
    <div className="space-y-3 py-1">
      <div className="space-y-1.5">
        <div className="text-muted-foreground text-xs font-medium">
          {t(($) => $.node_run.deliverables.deliverables_section)}
        </div>
        {deliverables.map((deliverable) => {
          const links = linksByDeliverable.get(deliverable.id) ?? [];
          if (links.length === 0 && !(showUpload)) return null;
          return (
            <div key={deliverable.id} className="space-y-1">
              {deliverables.length > 1 ? (
                <div className="text-xs font-medium">{deliverable.title}</div>
              ) : null}
              {links.length > 0 ? (
                <ul className="space-y-1">
                  {links.map((s) => (
                    <li key={s.id}>
                      <a
                        href={s.pull_request_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                      >
                        <ExternalLink className="size-3.5" />
                        <span>
                          {t(($) => $.node_run.deliverables.pull_request_label)} · {s.status}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {showUpload && issueId ? (
                <div className="flex items-center gap-1.5">
                  <DocumentUpload issueId={issueId} nodeRunId={nodeRunId} deliverableId={deliverable.id} />
                  <PRLinkUpload issueId={issueId} nodeRunId={nodeRunId} deliverableId={deliverable.id} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DocumentUploadButton({ onClick }: { onClick: () => void }) {
  const { t } = useT("workflows");
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <Upload className="size-3.5" />
      {t(($) => $.node_run.deliverables.upload_button)}
    </Button>
  );
}

function DocumentUploadPanel({
  issueId,
  nodeRunId,
  deliverableId,
  onClose,
}: {
  issueId: string;
  nodeRunId: string;
  deliverableId: string;
  onClose: () => void;
}) {
  const { t } = useT("workflows");
  // Files are staged first (repeat selections accumulate, each removable) and
  // uploaded together only when the submit button is pressed — picking a file
  // must never submit on its own.
  const [staged, setStaged] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const mutation = useUploadIssueDeliverable(issueId, nodeRunId, deliverableId);
  const submitting = mutation.isPending;

  const stageFiles = (fileList: FileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setStaged((prev) => [...prev, ...files]);
  };

  const removeStaged = (index: number) => {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (staged.length === 0 || submitting) return;
    Promise.all(staged.map(readFileAsBase64)).then((filesData) => mutation.mutate(filesData, { onSuccess: onClose }));
  };

  return (
    <div className="space-y-2 rounded-md border border-muted p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <FileText className="text-muted-foreground size-3.5" />
          {t(($) => $.node_run.deliverables.upload_heading)}
        </div>
        <Button size="icon" variant="ghost" className="size-6" onClick={onClose} disabled={submitting}>
          <X className="size-3.5" />
        </Button>
      </div>
      <label className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-muted px-3 py-4 text-center transition-colors hover:bg-muted/40">
        <Upload className="text-muted-foreground size-4" />
        <span className="line-clamp-2 max-w-full text-sm font-medium">
          {t(($) => $.node_run.deliverables.upload_file_choose)}
        </span>
        <span className="text-muted-foreground text-xs">{t(($) => $.node_run.deliverables.upload_file_hint)}</span>
        <input
          key={fileInputKey}
          type="file"
          multiple
          disabled={submitting}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) stageFiles(e.target.files);
            // Recreate the native control so subsequent selections, including
            // the same file, always emit a change event.
            setFileInputKey((key) => key + 1);
          }}
        />
      </label>
      {staged.length > 0 ? (
        <ul className="space-y-1">
          {staged.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-1.5 text-xs">
              <FileText className="text-muted-foreground size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                disabled={submitting}
                onClick={() => removeStaged(index)}
                className="text-muted-foreground hover:text-foreground inline-flex size-5 shrink-0 items-center justify-center rounded"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={submitting}>
          {t(($) => $.node_run.deliverables.cancel)}
        </Button>
        <Button size="sm" disabled={submitting || staged.length === 0} onClick={handleSubmit}>
          <Upload className="size-3.5" />
          {submitting
            ? t(($) => $.node_run.deliverables.uploading)
            : t(($) => $.node_run.deliverables.upload_submit_count, { n: staged.length })}
        </Button>
      </div>
    </div>
  );
}

function DocumentUpload({
  issueId,
  nodeRunId,
  deliverableId,
}: {
  issueId: string;
  nodeRunId: string;
  deliverableId: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) return <DocumentUploadButton onClick={() => setOpen(true)} />;
  return (
    <DocumentUploadPanel
      issueId={issueId}
      nodeRunId={nodeRunId}
      deliverableId={deliverableId}
      onClose={() => setOpen(false)}
    />
  );
}

function PRLinkUploadButton({ onClick }: { onClick: () => void }) {
  const { t } = useT("workflows");
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <LinkIcon className="size-3.5" />
      {t(($) => $.node_run.deliverables.upload_pr_button)}
    </Button>
  );
}

function PRLinkUploadPanel({
  issueId,
  nodeRunId,
  deliverableId,
  onClose,
}: {
  issueId: string;
  nodeRunId: string;
  deliverableId: string;
  onClose: () => void;
}) {
  const { t } = useT("workflows");
  const [value, setValue] = useState("");
  const mutation = useUploadIssueDeliverablePR(issueId, nodeRunId, deliverableId);
  const submitting = mutation.isPending;
  // One link per line; every line must be an http(s) URL before submitting.
  const lines = parseLinkLines(value);
  const hasInvalid = hasInvalidLinkLine(lines);

  return (
    <div className="space-y-2 rounded-md border border-muted p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <LinkIcon className="text-muted-foreground size-3.5" />
          {t(($) => $.node_run.deliverables.upload_pr_heading)}
        </div>
        <Button size="icon" variant="ghost" className="size-6" onClick={onClose} disabled={submitting}>
          <X className="size-3.5" />
        </Button>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t(($) => $.node_run.deliverables.upload_pr_placeholder)}
        disabled={submitting}
        rows={2}
        className="bg-background w-full resize-none rounded-md border px-2 py-1.5 text-sm"
      />
      {hasInvalid ? (
        <p className="text-destructive text-xs">{t(($) => $.node_run.deliverables.upload_pr_invalid)}</p>
      ) : null}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={submitting}>
          {t(($) => $.node_run.deliverables.cancel)}
        </Button>
        <Button
          size="sm"
          disabled={submitting || lines.length === 0 || hasInvalid}
          onClick={() => mutation.mutate(lines, { onSuccess: onClose })}
        >
          <LinkIcon className="size-3.5" />
          {submitting ? t(($) => $.node_run.deliverables.uploading) : t(($) => $.node_run.deliverables.upload_pr_submit)}
        </Button>
      </div>
    </div>
  );
}

function PRLinkUpload({
  issueId,
  nodeRunId,
  deliverableId,
}: {
  issueId: string;
  nodeRunId: string;
  deliverableId: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) return <PRLinkUploadButton onClick={() => setOpen(true)} />;
  return (
    <PRLinkUploadPanel
      issueId={issueId}
      nodeRunId={nodeRunId}
      deliverableId={deliverableId}
      onClose={() => setOpen(false)}
    />
  );
}
