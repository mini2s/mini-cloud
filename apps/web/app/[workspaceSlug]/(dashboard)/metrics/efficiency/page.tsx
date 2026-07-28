"use client";

import { use } from "react";
import { usePathname, useRouter } from "next/navigation";
import { EfficiencyDimension } from "@multica/views/efficiency";

type SearchParams = Record<string, string | string[] | undefined>;
type EfficiencyEntity = "org" | "user" | "project" | "repo";

export default function EfficiencyRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearchParams = use(searchParams);
  const router = useRouter();
  const pathname = usePathname();
  const entity = normalizeEntity(first(rawSearchParams.entity));
  const object = first(rawSearchParams.object)?.trim() ?? "";
  const subView =
    first(rawSearchParams.sub) === "distribution"
      ? "distribution"
      : "overview";

  return (
    <EfficiencyDimension
      initialEntity={entity}
      initialObject={object}
      initialSubView={subView}
      onStateChange={(state) => {
        const next = toUrlSearchParams(rawSearchParams);
        next.set("entity", state.entity);
        if (state.object) next.set("object", state.object);
        else next.delete("object");
        if (state.subView === "distribution") {
          next.set("sub", "distribution");
        } else {
          next.delete("sub");
        }
        const query = next.toString();
        router.replace(query ? `${pathname}?${query}` : pathname);
      }}
    />
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeEntity(value: string | undefined): EfficiencyEntity {
  return value === "user" || value === "project" || value === "repo"
    ? value
    : "org";
}

function toUrlSearchParams(raw: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value != null) {
      params.set(key, value);
    }
  }
  return params;
}
