"use client";

import { use } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ContributionDimension } from "@multica/views/efficiency";

type SearchParams = Record<string, string | string[] | undefined>;
type ContributionEntity = "org" | "user" | "project" | "repo";

export default function ContributionRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearchParams = use(searchParams);
  const router = useRouter();
  const pathname = usePathname();

  return (
    <ContributionDimension
      initialEntity={normalizeEntity(first(rawSearchParams.entity))}
      initialObject={first(rawSearchParams.object)?.trim() ?? ""}
      onStateChange={(state) => {
        const next = toUrlSearchParams(rawSearchParams);
        next.set("entity", state.entity);
        if (state.object) next.set("object", state.object);
        else next.delete("object");
        next.delete("sub");
        const query = next.toString();
        router.replace(query ? `${pathname}?${query}` : pathname);
      }}
    />
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeEntity(value: string | undefined): ContributionEntity {
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
