"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { paths } from "@multica/core/paths";
import { RepoDetail } from "@multica/views/efficiency";
import { resolveRepoParams } from "@/platform/efficiency-route-params";

// Route wrapper for the efficiency repo detail page. The complete repository
// address and optional branch are encoded as separate route values so neither
// value becomes ambiguous when it contains slashes.
export default function RepoDetailRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string; addr: string[] }>;
}) {
  const { workspaceSlug, addr } = use(params);
  const router = useRouter();
  const { repoAddr, repoBranch } = resolveRepoParams(addr);
  return (
    <RepoDetail
      repoAddr={repoAddr}
      repoBranch={repoBranch}
      onBack={() => router.back()}
      onBranchChange={(branch) => {
        router.push(
          paths
            .workspace(workspaceSlug)
            .metricsRepoDetail(repoAddr, branch || undefined),
        );
      }}
    />
  );
}
