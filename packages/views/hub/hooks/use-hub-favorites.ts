import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@multica/core/api"

interface FavStatus {
  favorited: boolean
  favoriteCount: number
}

export function useHubFavoriteStatus(id: string) {
  return useQuery<FavStatus>({
    queryKey: ["hub", "favorite", id],
    queryFn: async () => {
      const item = await api.hubGetItem(id)
      return {
        favorited: item.favorited ?? false,
        favoriteCount: item.favoriteCount ?? 0,
      }
    },
  })
}

export function useHubFavoriteMutation() {
  const qc = useQueryClient()
  return useMutation<FavStatus, Error, string>({
    mutationFn: (id) => api.hubFavoriteItem(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["hub", "favorite", id] })
      qc.invalidateQueries({ queryKey: ["hub", "items"] })
      qc.invalidateQueries({ queryKey: ["hub", "item", id] })
    },
  })
}

export function useHubUnfavoriteMutation() {
  const qc = useQueryClient()
  return useMutation<FavStatus, Error, string>({
    mutationFn: (id) => api.hubUnfavoriteItem(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["hub", "favorite", id] })
      qc.invalidateQueries({ queryKey: ["hub", "items"] })
      qc.invalidateQueries({ queryKey: ["hub", "item", id] })
    },
  })
}
