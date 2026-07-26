"use client";

import { use } from "react";
import { HubDetail } from "@multica/views/hub";

export default function Page({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = use(params);
  return <HubDetail itemId={itemId} />;
}
