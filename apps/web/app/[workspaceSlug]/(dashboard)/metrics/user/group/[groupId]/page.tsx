"use client";

import { use } from "react";
import { UserGroupDetail } from "@multica/views/efficiency";

export default function UserGroupDetailRoute({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  return <UserGroupDetail groupId={decodeURIComponent(groupId)} />;
}
