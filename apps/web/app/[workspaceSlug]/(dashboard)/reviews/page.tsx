"use client";

import { ClipboardCheck } from "lucide-react";
import { NavPlaceholderPage } from "@multica/views/placeholders";

export default function Page() {
  return <NavPlaceholderPage navKey="reviews" icon={ClipboardCheck} />;
}
