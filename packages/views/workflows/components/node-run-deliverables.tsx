import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { nodeRunDeliverableSubmissionsOptions } from "@multica/core/workflows/queries";
import { useUploadIssueDeliverable } from "@multica/core/issues/mutations";
import { ExternalLink, Upload } from "lucide-react";
import { useT } from "../../i18n";

/**
 * Renders the document-deliverable submissions for a node run: for each
 * submission carrying a pull_request_url, a link to the Gitea PR. This is the
 * critic's review surface for document deliverables (click through to Gitea to
 * read the diff, then approve/reject in NodeRunCard).
 *
 * `pull_request_url` on a submission is the document-PR pointer (code-type PRs
 * are tracked separately in issue_pull_request/issue_merge_request), so any
 * non-empty URL here is a document deliverable PR.
 *
 * When `canUpload` + `issueId` are set (a member-assigned issue whose node-run
 * worker is human), also renders an upload control so the member can submit a
 * document — the server writes it to the default-workflow Gitea repo + opens a
 * PR, symmetric with the agent's cs-workflow submit.
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
  const { data: submissions } = useQuery({
    ...nodeRunDeliverableSubmissionsOptions(wsId, nodeRunId),
    enabled: !!nodeRunId,
  });

  const withPR = (submissions ?? []).filter((s) => s.pull_request_url && s.pull_request_url.length > 0);
  const showUpload = canUpload && !!issueId;
  if (withPR.length === 0 && !showUpload) {
    return null;
  }

  return (
    <div className="space-y-1.5 py-1">
      <div className="text-muted-foreground text-xs font-medium">{t(($) => $.node_run.deliverables.heading)}</div>
      {showUpload && issueId ? <MemberUpload issueId={issueId} nodeRunId={nodeRunId} /> : null}
      {withPR.length > 0 ? (
        <ul className="space-y-1">
          {withPR.map((s) => (
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
    </div>
  );
}

/**
 * Member deliverable upload: a collapsible textarea that POSTs the document
 * content to the issue's upload endpoint. On success the submissions query
 * invalidates (see useUploadIssueDeliverable) and the PR link replaces the form.
 */
function MemberUpload({ issueId, nodeRunId }: { issueId: string; nodeRunId: string }) {
  const { t } = useT("workflows");
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const mutation = useUploadIssueDeliverable(issueId, nodeRunId);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
      >
        <Upload className="size-3.5" />
        <span>{t(($) => $.node_run.deliverables.upload_button)}</span>
      </button>
    );
  }

  const submitting = mutation.isPending;
  return (
    <div className="space-y-1.5">
      <div className="text-muted-foreground text-xs font-medium">
        {t(($) => $.node_run.deliverables.upload_heading)}
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t(($) => $.node_run.deliverables.upload_placeholder)}
        rows={6}
        className="bg-background w-full rounded-md border px-2 py-1.5 text-sm"
      />
      <button
        type="button"
        disabled={submitting || content.trim().length === 0}
        onClick={() => {
          mutation.mutate(content, {
            onSuccess: () => {
              setContent("");
              setOpen(false);
            },
          });
        }}
        className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50"
      >
        <Upload className="size-3" />
        <span>{submitting ? t(($) => $.node_run.deliverables.uploading) : t(($) => $.node_run.deliverables.upload_submit)}</span>
      </button>
    </div>
  );
}
