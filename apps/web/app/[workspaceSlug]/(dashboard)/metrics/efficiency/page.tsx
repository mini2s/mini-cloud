"use client";

import { Gauge } from "lucide-react";
import { NavPlaceholderPage } from "@multica/views/placeholders";

export default function Page() {
  return <NavPlaceholderPage navKey="metrics_efficiency" icon={Gauge} />;
}
