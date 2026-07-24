"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { UserDetail } from "@multica/views/efficiency";

// Route wrapper for the efficiency user detail page. Owns navigation (the
// shared UserDetail view takes onBack and stays router-free); the workspace
// context is resolved by useWorkspaceId inside the view.
export default function UserDetailRoute({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);
  const router = useRouter();
  return <UserDetail userId={userId} onBack={() => router.back()} />;
}
