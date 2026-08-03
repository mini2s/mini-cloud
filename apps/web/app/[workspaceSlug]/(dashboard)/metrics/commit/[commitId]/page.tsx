"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { CommitDetail } from "@multica/views/efficiency";

// Route wrapper for the efficiency commit detail page. Owns navigation (the
// shared CommitDetail view takes onBack and stays router-free); the workspace
// context is resolved by useWorkspaceId inside the view.
export default function CommitDetailRoute({
  params,
}: {
  params: Promise<{ commitId: string }>;
}) {
  const { commitId } = use(params);
  const router = useRouter();
  return <CommitDetail commitId={commitId} onBack={() => router.back()} />;
}
