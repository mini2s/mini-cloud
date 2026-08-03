"use client";

import { use } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TaskDetail } from "@multica/views/efficiency";
import { resolveTaskIdFromPathname } from "@/platform/efficiency-route-params";

// Route wrapper for the efficiency task detail page. Owns navigation (the
// shared TaskDetail view takes onBack and stays router-free); the workspace
// context is resolved by useWorkspaceId inside the view.
export default function TaskDetailRoute({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId: routeTaskId } = use(params);
  const pathname = usePathname();
  const taskId = resolveTaskIdFromPathname(pathname, routeTaskId);
  const router = useRouter();
  return <TaskDetail taskId={taskId} onBack={() => router.back()} />;
}
