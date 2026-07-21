"use client";

import { use } from "react";
import { IssueDetail } from "@multica/views/issues/components";
import { ErrorBoundary } from "@multica/ui/components/common/error-boundary";

export default function IssueDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string | string[]; takeover?: string | string[] }>;
}) {
  const { id } = use(params);
  const query = use(searchParams);
  const initialLiveSession = query.view === "session";
  const takeoverSessionOnOpen = initialLiveSession && query.takeover === "1";
  return (
    <ErrorBoundary resetKeys={[id]}>
      <IssueDetail
        issueId={id}
        initialLiveSession={initialLiveSession}
        takeoverSessionOnOpen={takeoverSessionOnOpen}
      />
    </ErrorBoundary>
  );
}
