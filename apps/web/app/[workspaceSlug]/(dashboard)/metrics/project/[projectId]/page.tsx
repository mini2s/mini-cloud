"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { ProjectDetail } from "@multica/views/efficiency";

// Route wrapper for the efficiency project detail page. Owns navigation (the
// shared ProjectDetail view takes onBack and stays router-free); the workspace
// context is resolved by useWorkspaceId inside the view.
export default function ProjectDetailRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();
  return <ProjectDetail projectId={projectId} onBack={() => router.back()} />;
}
