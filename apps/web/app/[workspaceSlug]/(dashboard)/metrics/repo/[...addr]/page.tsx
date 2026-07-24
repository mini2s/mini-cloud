"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { RepoDetail } from "@multica/views/efficiency";

// Route wrapper for the efficiency repo detail page. repoAddr contains a slash
// (owner/repo), and there may be an optional branch segment, so this uses a
// catch-all `[...addr]`. First 2 segments = repoAddr, optional 3rd onward =
// branch. Owns navigation (the shared RepoDetail view takes onBack and stays
// router-free); the workspace context is resolved by useWorkspaceId inside
// the view.
export default function RepoDetailRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string; addr: string[] }>;
}) {
  const { workspaceSlug, addr } = use(params);
  const router = useRouter();
  // addr[0..1] = owner/repo; addr[2+] (optional) = branch. Branches can contain
  // slashes (e.g. "feature/x"), so everything from index 2 onward is joined.
  const repoAddr = addr.slice(0, 2).join("/");
  const repoBranch = addr.length > 2 ? addr.slice(2).join("/") : undefined;
  return (
    <RepoDetail
      repoAddr={repoAddr}
      repoBranch={repoBranch}
      onBack={() => router.back()}
      onBranchChange={(branch) => {
        // Re-route on branch switch so the URL stays shareable. Whole-repo
        // scope (branch = "") drops the branch segment. The catch-all makes
        // multi-slash branches (feature/x) work without extra encoding.
        const base = `/${workspaceSlug}/metrics/repo/${repoAddr}`;
        const path = branch ? `${base}/${branch}` : base;
        router.push(path);
      }}
    />
  );
}
