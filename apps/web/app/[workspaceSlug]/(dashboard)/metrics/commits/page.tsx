import { ActivityListRoute } from "../activity-list-route";

type SearchParams = Record<string, string | string[] | undefined>;

export default function CommitsRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <ActivityListRoute kind="commit" searchParams={searchParams} />;
}
