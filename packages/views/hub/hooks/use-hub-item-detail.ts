import { useQuery } from "@tanstack/react-query"
import { api } from "@multica/core/api"
import type { CapabilityItem } from "@multica/core/types"

export function useHubItemDetail(id: string | undefined) {
  return useQuery<CapabilityItem | undefined>({
    queryKey: ["hub", "item", id],
    queryFn: async () => {
      if (!id) return undefined
      return api.hubGetItem(id)
    },
    enabled: !!id,
  })
}
