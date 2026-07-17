import { useQuery } from "@tanstack/react-query";
import { nodeRunDeliverableSubmissionsOptions } from "@multica/core/workflows/queries";
import { ExternalLink } from "lucide-react";
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
 */
export function NodeRunDeliverables({ wsId, nodeRunId }: { wsId: string; nodeRunId: string }) {
  const { t } = useT("workflows");
  const { data: submissions } = useQuery({
    ...nodeRunDeliverableSubmissionsOptions(wsId, nodeRunId),
    enabled: !!nodeRunId,
  });

  const withPR = (submissions ?? []).filter((s) => s.pull_request_url && s.pull_request_url.length > 0);
  if (withPR.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5 py-1">
      <div className="text-muted-foreground text-xs font-medium">{t(($) => $.node_run.deliverables.heading)}</div>
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
              <span>{t(($) => $.node_run.deliverables.pull_request_label)} · {s.status}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
