"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { TaskDetail } from "@multica/views/efficiency";

// Route wrapper for the efficiency task detail page. Owns navigation (the
// shared TaskDetail view takes onBack and stays router-free); the workspace
// context is resolved by useWorkspaceId inside the view.
export default function TaskDetailRoute({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = use(params);
  const router = useRouter();
  return <TaskDetail taskId={taskId} onBack={() => router.back()} />;
}
