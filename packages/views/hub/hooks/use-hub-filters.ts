import { useQuery } from "@tanstack/react-query"
import { api } from "@multica/core/api"
import type { Category, ItemTag, ItemFilterOptions } from "@multica/core/types"

interface FilterOptions {
  categories: Category[]
  tags: ItemTag[]
}

export function useHubFilterOptions() {
  return useQuery<FilterOptions>({
    queryKey: ["hub", "filterOptions"],
    queryFn: async () => {
      const [filters, tags] = await Promise.all([
        api.hubListFilterOptions() as Promise<ItemFilterOptions>,
        api.hubListTags({ pageSize: 200 }),
      ])
      return {
        categories: filters.categories ?? [],
        tags: tags ?? [],
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}
