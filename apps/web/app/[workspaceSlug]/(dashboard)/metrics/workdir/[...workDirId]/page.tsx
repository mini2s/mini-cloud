"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { WorkDirDetail } from "@multica/views/efficiency";

export default function WorkDirDetailRoute({
  params,
}: {
  params: Promise<{ workDirId: string[] }>;
}) {
  const { workDirId } = use(params);
  const router = useRouter();
  return (
    <WorkDirDetail
      workDirId={workDirId.join("/")}
      onBack={() => router.back()}
    />
  );
}
