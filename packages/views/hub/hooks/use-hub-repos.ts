import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@multica/core/api"
import type {
  Repository,
  HubRepoCreateParams,
  HubRepoUpdateParams,
  HubRepoMemberAddParams,
  HubRepoInviteParams,
} from "@multica/core/types"

export function useHubMyRepos() {
  const { data, isLoading } = useQuery({
    queryKey: ["hub", "repos", "my"],
    queryFn: () => api.hubListMyRepos(),
  })
  return { repos: data ?? [], isLoading }
}

export function useHubCreateRepoMutation() {
  const qc = useQueryClient()
  return useMutation<Repository, Error, HubRepoCreateParams>({
    mutationFn: (data) => api.hubCreateRepo(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub", "repos"] })
    },
  })
}

export function useHubUpdateRepoMutation() {
  const qc = useQueryClient()
  return useMutation<Repository, Error, { id: string; data: HubRepoUpdateParams }>({
    mutationFn: ({ id, data }) => api.hubUpdateRepo(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub", "repos"] })
    },
  })
}

export function useHubDeleteRepoMutation() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.hubDeleteRepo(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub", "repos"] })
    },
  })
}

export function useHubRepoMembers(repoId: string) {
  const { data, isLoading } = useQuery({
    queryKey: ["hub", "repos", repoId, "members"],
    queryFn: () => api.hubListRepoMembers(repoId),
    enabled: !!repoId,
  })
  return { members: data ?? [], isLoading }
}

export function useHubAddRepoMemberMutation() {
  const qc = useQueryClient()
  return useMutation<void, Error, { repoId: string; data: HubRepoMemberAddParams }>({
    mutationFn: ({ repoId, data }) => api.hubAddRepoMember(repoId, data),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["hub", "repos", repoId, "members"] })
    },
  })
}

export function useHubRemoveRepoMemberMutation() {
  const qc = useQueryClient()
  return useMutation<void, Error, { repoId: string; userId: string }>({
    mutationFn: ({ repoId, userId }) => api.hubRemoveRepoMember(repoId, userId),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["hub", "repos", repoId, "members"] })
    },
  })
}

export function useHubInviteRepoMemberMutation() {
  const qc = useQueryClient()
  return useMutation<void, Error, { repoId: string; data: HubRepoInviteParams }>({
    mutationFn: ({ repoId, data }) => api.hubInviteRepoMember(repoId, data),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["hub", "repos", repoId, "members"] })
    },
  })
}
