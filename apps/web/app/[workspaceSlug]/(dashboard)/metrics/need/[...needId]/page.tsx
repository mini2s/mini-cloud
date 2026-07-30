"use client";

import { use } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NeedDetail } from "@multica/views/efficiency";
import { resolveNeedIdFromPathname } from "@/platform/efficiency-route-params";

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
  const pathname = usePathname();
  const needId = resolveNeedIdFromPathname(pathname, parts);
  const router = useRouter();
  return <NeedDetail needId={needId} onBack={() => router.back()} />;
}
