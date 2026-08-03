"use client";

import { use } from "react";
import { MemberDetailPage } from "@multica/views/members";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <MemberDetailPage userId={id} />;
}
