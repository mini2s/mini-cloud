import { useQuery } from "@tanstack/react-query"
import { api } from "@multica/core/api"
import type { CapabilityItem, HubItemListParams } from "@multica/core/types"

interface HubItemsResult {
  items: CapabilityItem[]
  total: number
}

export function useHubItems(params: HubItemListParams) {
  return useQuery<HubItemsResult>({
    queryKey: ["hub", "items", params],
    queryFn: async () => {
      const res = await api.hubListItems(params)
      return { items: res.items ?? [], total: res.total ?? 0 }
    },
  })
}
