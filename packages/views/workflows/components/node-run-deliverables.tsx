import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { nodeRunDeliverableSubmissionsOptions } from "@multica/core/workflows/queries";
import { useUploadIssueDeliverable, useUploadIssueDeliverablePR } from "@multica/core/issues/mutations";
import { ExternalLink, Upload, Link as LinkIcon, FileText, X } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { useT } from "../../i18n";

/**
 * Renders a node run's deliverables, split into explicit 文档 (document) and
 * 代码 (code) sections. Each section lists its submitted PR/merge-request
 * links and, when `canUpload` + `issueId` are set (a member-assigned issue
 * whose node-run worker is human), the matching manual upload control — a file
 * picker for documents, a URL input for code. Both are the human counterparts
 * to the agent's cs-workflow submit.
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

  const kindById = new Map(deliverables.map((d) => [d.id, d.kind]));
  const docLinks = submissions.filter(
    (s) => s.pull_request_url && s.pull_request_url.length > 0 && kindById.get(s.deliverable_id) === "document",
  );
  const codeLinks = submissions.filter(
    (s) => s.pull_request_url && s.pull_request_url.length > 0 && kindById.get(s.deliverable_id) === "pull_request",
  );
  const hasDocument = deliverables.some((d) => d.kind === "document");
  const hasPR = deliverables.some((d) => d.kind === "pull_request");
  const showUpload = canUpload && !!issueId;

  const showDoc = docLinks.length > 0 || (showUpload && hasDocument);
  const showCode = codeLinks.length > 0 || (showUpload && hasPR);
  if (!showDoc && !showCode) {
    return null;
  }

  const renderLinks = (links: typeof docLinks) =>
    links.length > 0 ? (
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
    ) : null;

  return (
    <div className="space-y-3 py-1">
      {showDoc ? (
        <div className="space-y-1.5">
          <div className="text-muted-foreground text-xs font-medium">
            {t(($) => $.node_run.deliverables.document_section)}
          </div>
          {renderLinks(docLinks)}
          {showUpload && hasDocument && issueId ? (
            <DocumentUpload issueId={issueId} nodeRunId={nodeRunId} />
          ) : null}
        </div>
      ) : null}
      {showCode ? (
        <div className="space-y-1.5">
          <div className="text-muted-foreground text-xs font-medium">
            {t(($) => $.node_run.deliverables.code_section)}
          </div>
          {renderLinks(codeLinks)}
          {showUpload && hasPR && issueId ? (
            <PRLinkUpload issueId={issueId} nodeRunId={nodeRunId} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DocumentUpload({ issueId, nodeRunId }: { issueId: string; nodeRunId: string }) {
  const { t } = useT("workflows");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const mutation = useUploadIssueDeliverable(issueId, nodeRunId);
  const submitting = mutation.isPending;

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Upload className="size-3.5" />
        {t(($) => $.node_run.deliverables.upload_button)}
      </Button>
    );
  }

  const collapse = () => setOpen(false);
  const handleFiles = (fileList: FileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setSelected(files.map((f) => f.name));
    Promise.all(
      files.map(
        (file) =>
          new Promise<{ name: string; content: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              // readAsDataURL yields "data:<mime>;base64,<b64>"; strip the prefix
              // so the backend gets raw base64 (binary-safe, any format).
              const r = String(reader.result ?? "");
              const comma = r.indexOf(",");
              resolve({ name: file.name, content: comma >= 0 ? r.slice(comma + 1) : r });
            };
            reader.readAsDataURL(file);
          }),
      ),
    ).then((filesData) => mutation.mutate(filesData, { onSuccess: collapse }));
  };

  return (
    <div className="space-y-2 rounded-md border border-muted p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <FileText className="text-muted-foreground size-3.5" />
          {t(($) => $.node_run.deliverables.upload_heading)}
        </div>
        <Button size="icon" variant="ghost" className="size-6" onClick={collapse} disabled={submitting}>
          <X className="size-3.5" />
        </Button>
      </div>
      <label className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-muted px-3 py-4 text-center transition-colors hover:bg-muted/40">
        <Upload className="text-muted-foreground size-4" />
        <span className="line-clamp-2 max-w-full text-sm font-medium">
          {selected.length > 0 ? selected.join(", ") : t(($) => $.node_run.deliverables.upload_file_choose)}
        </span>
        <span className="text-muted-foreground text-xs">{t(($) => $.node_run.deliverables.upload_file_hint)}</span>
        <input
          type="file"
          multiple
          disabled={submitting}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
          }}
        />
      </label>
      {submitting ? (
        <p className="text-muted-foreground text-xs">{t(($) => $.node_run.deliverables.uploading)}</p>
      ) : null}
    </div>
  );
}

function PRLinkUpload({ issueId, nodeRunId }: { issueId: string; nodeRunId: string }) {
  const { t } = useT("workflows");
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const mutation = useUploadIssueDeliverablePR(issueId, nodeRunId);
  const submitting = mutation.isPending;

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <LinkIcon className="size-3.5" />
        {t(($) => $.node_run.deliverables.upload_pr_button)}
      </Button>
    );
  }

  const collapse = () => setOpen(false);
  return (
    <div className="space-y-2 rounded-md border border-muted p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <LinkIcon className="text-muted-foreground size-3.5" />
          {t(($) => $.node_run.deliverables.upload_pr_heading)}
        </div>
        <Button size="icon" variant="ghost" className="size-6" onClick={collapse} disabled={submitting}>
          <X className="size-3.5" />
        </Button>
      </div>
      <Input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t(($) => $.node_run.deliverables.upload_pr_placeholder)}
        disabled={submitting}
      />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={collapse} disabled={submitting}>
          {t(($) => $.node_run.deliverables.cancel)}
        </Button>
        <Button
          size="sm"
          disabled={submitting || url.trim().length === 0}
          onClick={() => mutation.mutate(url.trim(), { onSuccess: collapse })}
        >
          <LinkIcon className="size-3.5" />
          {submitting ? t(($) => $.node_run.deliverables.uploading) : t(($) => $.node_run.deliverables.upload_pr_submit)}
        </Button>
      </div>
    </div>
  );
}
