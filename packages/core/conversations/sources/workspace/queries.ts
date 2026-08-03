import { queryOptions } from "@tanstack/react-query";
import { conversationKeys } from "../../query-keys";
import { fetchCostrictDevices, fetchCostrictWorkspaces } from "./api";

export function costrictDeviceListOptions() {
  return queryOptions({
    queryKey: [...conversationKeys.all, "costrict-devices"] as const,
    queryFn: ({ signal }) => fetchCostrictDevices(signal),
    staleTime: 15_000,
  });
}

export function costrictWorkspaceListOptions() {
  return queryOptions({
    queryKey: [...conversationKeys.all, "costrict-workspaces"] as const,
    queryFn: ({ signal }) => fetchCostrictWorkspaces(signal),
    staleTime: 15_000,
  });
}
