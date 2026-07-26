"use client";

import { use } from "react";
import { CapabilityEditorPage } from "@multica/views/hub";

export default function Page({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = use(params);
  return <CapabilityEditorPage itemId={itemId} />;
}
