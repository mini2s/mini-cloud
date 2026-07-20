"use client";

import { SquadDetailPage } from "@multica/views/squads";

export default function Page() {
  // SquadDetailPage derives its squadId from the URL pathname internally,
  // so no prop is passed here. The [id] segment in the route is what it reads.
  return <SquadDetailPage />;
}
