"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { UserDetail } from "@multica/views/efficiency";

// Route wrapper for the efficiency user detail page. Owns navigation (the
// shared UserDetail view takes onBack and stays router-free); the workspace
// context is resolved by useWorkspaceId inside the view.
export default function UserDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = use(params);
  const query = use(searchParams);
  const router = useRouter();
  const startDate = normalizeDateQuery(query.startDate);
  const endDate = normalizeDateQuery(query.endDate);

  return (
    <UserDetail
      userId={userId}
      startDate={startDate && endDate ? startDate : undefined}
      endDate={startDate && endDate ? endDate : undefined}
      onBack={() => router.back()}
    />
  );
}

function normalizeDateQuery(
  value: string | string[] | undefined,
): string | undefined {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!raw) return undefined;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}
