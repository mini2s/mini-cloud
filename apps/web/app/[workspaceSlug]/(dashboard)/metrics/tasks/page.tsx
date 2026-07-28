import { ActivityListRoute } from "../activity-list-route";

type SearchParams = Record<string, string | string[] | undefined>;

export default function TasksRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <ActivityListRoute kind="task" searchParams={searchParams} />;
}
