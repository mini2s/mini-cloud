"use client";

import { use } from "react";
import { SkillDetailPage } from "@multica/views/skills";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <SkillDetailPage skillId={id} />;
}
