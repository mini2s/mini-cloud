"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { NeedDetail } from "@multica/views/efficiency";

// Route wrapper for the efficiency need detail page. needId may contain
// slashes (e.g. org/repo#branch/need), so this uses a catch-all segment and
// rejoins the parts. Owns navigation (the shared NeedDetail view takes onBack
// and stays router-free); the workspace context is resolved by
// useWorkspaceId inside the view.
export default function NeedDetailRoute({
  params,
}: {
  params: Promise<{ needId: string[] }>;
}) {
  const { needId: parts } = use(params);
  const needId = Array.isArray(parts) ? parts.join("/") : String(parts);
  const router = useRouter();
  return <NeedDetail needId={needId} onBack={() => router.back()} />;
}
